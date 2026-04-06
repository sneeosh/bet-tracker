import { Hono } from 'hono';
import type { Env } from '../types';
import {
  createLeague,
  getLeague,
  createPlayer,
  getPlayersByLeague,
  upsertSeasonLine,
  getSeasonLines,
  getCurrentWeek,
  getGamesForWeek,
  getPicksForWeek,
} from '../db/queries';

const api = new Hono<{ Bindings: Env }>();

// POST /api/leagues - Create a league
api.post('/api/leagues', async (c) => {
  try {
    const body = await c.req.json();
    const { name, sport, division, season } = body;

    if (!name || season == null) {
      return c.json({ error: 'name and season are required' }, 400);
    }

    const league = await createLeague(
      c.env,
      name,
      sport || 'MLB',
      division || '',
      season
    );

    return c.json(league, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create league' }, 500);
  }
});

// GET /api/leagues/:id - Get league details
api.get('/api/leagues/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    const league = await getLeague(c.env, id);

    if (!league) {
      return c.json({ error: 'League not found' }, 404);
    }

    return c.json(league);
  } catch (err) {
    return c.json({ error: 'Failed to get league' }, 500);
  }
});

// POST /api/leagues/:id/players - Add a player to a league
api.post('/api/leagues/:id/players', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const body = await c.req.json();
    const { name, phone, teamName, isAdmin, rotationOrder } = body;

    if (!name || !phone || !teamName || rotationOrder == null) {
      return c.json(
        { error: 'name, phone, teamName, and rotationOrder are required' },
        400
      );
    }

    // Basic phone format validation
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return c.json({ error: 'Invalid phone number format' }, 400);
    }

    const league = await getLeague(c.env, leagueId);
    if (!league) {
      return c.json({ error: 'League not found' }, 404);
    }

    const player = await createPlayer(
      c.env,
      leagueId,
      name,
      phone,
      teamName,
      isAdmin ? 1 : 0,
      rotationOrder
    );

    return c.json(player, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create player' }, 500);
  }
});

// GET /api/leagues/:id/players - List players in a league
api.get('/api/leagues/:id/players', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const players = await getPlayersByLeague(c.env, leagueId);
    return c.json(players);
  } catch (err) {
    return c.json({ error: 'Failed to get players' }, 500);
  }
});

// POST /api/leagues/:id/season-lines - Set over/under lines
api.post('/api/leagues/:id/season-lines', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const body = await c.req.json();
    const { lines } = body;

    if (!Array.isArray(lines) || lines.length === 0) {
      return c.json(
        { error: 'lines array is required and must not be empty' },
        400
      );
    }

    const league = await getLeague(c.env, leagueId);
    if (!league) {
      return c.json({ error: 'League not found' }, 404);
    }

    for (const line of lines) {
      if (!line.teamName || line.overUnderLine == null) {
        return c.json(
          { error: 'Each line must have teamName and overUnderLine' },
          400
        );
      }
      await upsertSeasonLine(
        c.env,
        leagueId,
        league.season,
        line.teamName,
        line.overUnderLine
      );
    }

    const updated = await getSeasonLines(c.env, leagueId, league.season);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: 'Failed to set season lines' }, 500);
  }
});

// GET /api/leagues/:id/season-lines - Get current season lines with records
api.get('/api/leagues/:id/season-lines', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));

    const league = await getLeague(c.env, leagueId);
    if (!league) {
      return c.json({ error: 'League not found' }, 404);
    }

    const lines = await getSeasonLines(c.env, leagueId, league.season);
    return c.json(lines);
  } catch (err) {
    return c.json({ error: 'Failed to get season lines' }, 500);
  }
});

// GET /api/leagues/:id/current-week - Get current week with games and picks
api.get('/api/leagues/:id/current-week', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));

    const week = await getCurrentWeek(c.env, leagueId);
    if (!week) {
      return c.json({ error: 'No current week found' }, 404);
    }

    const [games, picks] = await Promise.all([
      getGamesForWeek(c.env, week.id),
      getPicksForWeek(c.env, week.id),
    ]);

    return c.json({ week, games, picks });
  } catch (err) {
    return c.json({ error: 'Failed to get current week' }, 500);
  }
});

// GET /api/leagues/:id/standings - Get full standings
api.get('/api/leagues/:id/standings', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));

    const league = await getLeague(c.env, leagueId);
    if (!league) {
      return c.json({ error: 'League not found' }, 404);
    }

    const [seasonLines, players] = await Promise.all([
      getSeasonLines(c.env, leagueId, league.season),
      getPlayersByLeague(c.env, leagueId),
    ]);

    // Add over/under performance to each season line
    const linesWithPerformance = seasonLines.map((line) => ({
      ...line,
      overUnderDiff: line.current_wins - line.over_under_line,
    }));

    // Get all weeks to compute weekly pick totals per player
    const allWeeks: { week_id: number; week_number: number }[] = [];
    let currentWeek = await getCurrentWeek(c.env, leagueId);

    // Fetch picks for all weeks by iterating through them
    // We'll use the DB directly to get all weeks
    const { results: weeks } = await c.env.DB
      .prepare('SELECT id, week_number FROM weeks WHERE league_id = ? ORDER BY week_number')
      .bind(leagueId)
      .all<{ id: number; week_number: number }>();

    const weeklyPickTotals: Record<
      number,
      { playerId: number; playerName: string; weeks: Record<number, { correct: number; total: number }> }
    > = {};

    // Initialize player entries
    for (const player of players) {
      weeklyPickTotals[player.id] = {
        playerId: player.id,
        playerName: player.name,
        weeks: {},
      };
    }

    // Gather picks for each week
    for (const week of weeks) {
      const picks = await getPicksForWeek(c.env, week.id);
      for (const pick of picks) {
        if (!weeklyPickTotals[pick.player_id]) continue;
        if (!weeklyPickTotals[pick.player_id].weeks[week.week_number]) {
          weeklyPickTotals[pick.player_id].weeks[week.week_number] = {
            correct: 0,
            total: 0,
          };
        }
        weeklyPickTotals[pick.player_id].weeks[week.week_number].total += 1;
        if (pick.is_correct === 1) {
          weeklyPickTotals[pick.player_id].weeks[week.week_number].correct += 1;
        }
      }
    }

    return c.json({
      league,
      seasonLines: linesWithPerformance,
      playerStandings: Object.values(weeklyPickTotals),
    });
  } catch (err) {
    return c.json({ error: 'Failed to get standings' }, 500);
  }
});

export default api;
