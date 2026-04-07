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
  getPlayerByPhone,
  getConversation,
} from '../db/queries';
import { handleMessage } from '../services/chat';

const api = new Hono<{ Bindings: Env }>();

// GET /api/leagues - List all leagues
api.get('/api/leagues', async (c) => {
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM leagues ORDER BY created_at DESC')
      .all();
    return c.json(results);
  } catch (err) {
    return c.json({ error: 'Failed to list leagues' }, 500);
  }
});

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

    // Build team→player mapping
    const teamToPlayer: Record<string, string> = {};
    for (const player of players) {
      teamToPlayer[player.team_name] = player.name;
    }

    // Add over/under performance and player name to each season line
    const linesWithPerformance = seasonLines.map((line) => ({
      ...line,
      player_name: teamToPlayer[line.team_name] ?? null,
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

// GET /api/leagues/:id/fetch-lines - Fetch O/U lines from The Odds API
api.get('/api/leagues/:id/fetch-lines', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    const apiKey = c.env.ODDS_API_KEY;
    if (!apiKey) return c.json({ error: 'ODDS_API_KEY not configured' }, 500);

    // Try the win totals endpoint first
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=totals&oddsFormat=american`;
    const sportsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`
    );
    const sports: any[] = await sportsRes.json();

    // Look for an MLB win totals sport key
    const winTotalsSport = sports.find(
      (s: any) => s.key?.includes('baseball_mlb') && s.key?.includes('win')
    );

    let lines: { teamName: string; overUnderLine: number }[] = [];

    if (winTotalsSport) {
      // Fetch win totals odds
      const oddsRes = await fetch(
        `https://api.the-odds-api.com/v4/sports/${winTotalsSport.key}/odds/?apiKey=${apiKey}&regions=us&markets=totals&oddsFormat=american`
      );
      if (oddsRes.ok) {
        const oddsData: any[] = await oddsRes.json();
        for (const event of oddsData) {
          const teamName = event.home_team || event.away_team;
          // Get the first bookmaker's totals
          const bookmaker = event.bookmakers?.[0];
          const market = bookmaker?.markets?.find((m: any) => m.key === 'totals');
          const overOutcome = market?.outcomes?.find((o: any) => o.name === 'Over');
          if (teamName && overOutcome?.point) {
            lines.push({ teamName, overUnderLine: overOutcome.point });
          }
        }
      }
    }

    if (lines.length === 0) {
      // Fallback: try outrights endpoint
      const outrightsRes = await fetch(
        `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`
      );
      if (outrightsRes.ok) {
        // Outrights won't have O/U lines, so report that
        return c.json({
          lines: [],
          message: 'Win totals market not available. Enter lines manually.',
          sports: sports
            .filter((s: any) => s.key?.includes('baseball'))
            .map((s: any) => s.key),
        });
      }
    }

    // Filter to teams in this league's division
    const players = await getPlayersByLeague(c.env, leagueId);
    const leagueTeams = players.map((p) => p.team_name);

    // Try to match API team names to league team names
    const matched: { teamName: string; overUnderLine: number }[] = [];
    for (const line of lines) {
      // Check exact match or partial match
      const match = leagueTeams.find(
        (t) => line.teamName.includes(t) || t.includes(line.teamName)
      );
      if (match) {
        matched.push({ teamName: match, overUnderLine: line.overUnderLine });
      }
    }

    return c.json({
      lines: matched.length > 0 ? matched : lines,
      allLines: lines,
      message: matched.length > 0
        ? `Found ${matched.length} matching lines`
        : `Found ${lines.length} lines (no exact team matches for your division)`,
    });
  } catch (err) {
    console.error('Fetch lines error:', err);
    return c.json({ error: 'Failed to fetch odds' }, 500);
  }
});

// POST /api/chat - Web chat endpoint (mirrors SMS flow)
api.post('/api/chat', async (c) => {
  try {
    const { phone, message } = await c.req.json();

    if (!phone || !message) {
      return c.json({ error: 'phone and message are required' }, 400);
    }

    const player = await getPlayerByPhone(c.env, phone);
    if (!player) {
      return c.json({ error: 'Player not found for that phone number' }, 404);
    }

    const response = await handleMessage(c.env, player, message);

    // Return current conversation state for the UI
    const conversation = await getConversation(c.env, player.id);

    return c.json({
      response,
      state: conversation?.state ?? 'idle',
      playerName: player.name,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return c.json({ error: 'Failed to process message' }, 500);
  }
});

// GET /api/chat/state/:phone - Get current conversation state for a player
api.get('/api/chat/state/:phone', async (c) => {
  try {
    const phone = decodeURIComponent(c.req.param('phone'));
    const player = await getPlayerByPhone(c.env, phone);
    if (!player) {
      return c.json({ error: 'Player not found' }, 404);
    }

    const conversation = await getConversation(c.env, player.id);
    return c.json({
      playerName: player.name,
      teamName: player.team_name,
      state: conversation?.state ?? 'idle',
    });
  } catch (err) {
    return c.json({ error: 'Failed to get state' }, 500);
  }
});

export default api;
