import { Hono } from 'hono';
import type { Env } from '../types';
import {
  getLeague,
  getPlayersByLeague,
  getCurrentWeek,
  getGamesForWeek,
  updateGameResult,
  updateWeeklyResults,
  createWeek,
  getNextBetManager,
  addGameToWeek,
  lockGames,
  updateConversation,
  updateTeamRecord,
  getSeasonLines,
  upsertSeasonLine,
} from '../db/queries';
import { getUpcomingGames, getGamesForDateRange } from '../services/mlb';
import { formatGameList } from '../services/ai';

const admin = new Hono<{ Bindings: Env }>();

// GET /api/admin/leagues/:id/weeks - List all weeks for a league
admin.get('/api/admin/leagues/:id/weeks', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const { results: weeks } = await c.env.DB
      .prepare(
        `SELECT w.*, p.name as bet_manager_name
         FROM weeks w
         LEFT JOIN players p ON p.id = w.bet_manager_id
         WHERE w.league_id = ?
         ORDER BY w.week_number DESC`
      )
      .bind(leagueId)
      .all();
    return c.json(weeks);
  } catch (err) {
    return c.json({ error: 'Failed to list weeks' }, 500);
  }
});

// GET /api/admin/leagues/:id/fetch-games - Fetch MLB games for a date range
admin.get('/api/admin/leagues/:id/fetch-games', async (c) => {
  try {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    if (!startDate || !endDate) {
      return c.json({ error: 'startDate and endDate query params required (YYYY-MM-DD)' }, 400);
    }

    const games = await getGamesForDateRange(startDate, endDate);
    return c.json({ games, count: games.length });
  } catch (err) {
    return c.json({ error: 'Failed to fetch games' }, 500);
  }
});

// POST /api/admin/leagues/:id/create-week - Manually create a week with specific games
admin.post('/api/admin/leagues/:id/create-week', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    const body = await c.req.json();
    const { betManagerId, games } = body;

    if (!betManagerId || !Array.isArray(games) || games.length === 0) {
      return c.json({ error: 'betManagerId and games array required' }, 400);
    }

    const currentWeek = await getCurrentWeek(c.env, leagueId);
    const nextWeekNumber = currentWeek ? currentWeek.week_number + 1 : 1;

    const newWeek = await createWeek(c.env, leagueId, nextWeekNumber, league.season, betManagerId);
    if (!newWeek) return c.json({ error: 'Failed to create week' }, 500);

    const addedGames = [];
    for (const game of games) {
      const added = await addGameToWeek(
        c.env,
        newWeek.id,
        game.gamePk || game.mlbGameId || 0,
        game.gameDate,
        game.gameTime || null,
        game.awayTeam,
        game.homeTeam,
        game.awayPitcher || null,
        game.homePitcher || null
      );
      if (added) addedGames.push(added);
    }

    // Lock games and set a deadline
    const deadline = body.picksDeadline || null;
    await lockGames(c.env, newWeek.id, deadline);

    // Set all players to making_picks state
    const players = await getPlayersByLeague(c.env, leagueId);
    for (const player of players) {
      await updateConversation(c.env, player.id, 'making_picks', JSON.stringify({
        weekId: newWeek.id,
        games: addedGames.map((g) => ({
          id: g.id,
          awayTeam: g.away_team,
          homeTeam: g.home_team,
          gameDate: g.game_date,
        })),
      }));
    }

    return c.json({ week: newWeek, games: addedGames }, 201);
  } catch (err) {
    console.error('Create week error:', err);
    return c.json({ error: 'Failed to create week' }, 500);
  }
});

// POST /api/admin/leagues/:id/simulate-results - Set game results manually
admin.post('/api/admin/leagues/:id/simulate-results', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const body = await c.req.json();
    const { results } = body;

    if (!Array.isArray(results) || results.length === 0) {
      return c.json({ error: 'results array required: [{ gameId, winner, finalScore }]' }, 400);
    }

    for (const result of results) {
      if (!result.gameId || !result.winner) {
        return c.json({ error: 'Each result needs gameId and winner' }, 400);
      }
      await updateGameResult(
        c.env,
        result.gameId,
        result.winner,
        result.finalScore || 'SIM'
      );
    }

    // Check if all games in the current week are resolved
    const week = await getCurrentWeek(c.env, leagueId);
    if (week) {
      const games = await getGamesForWeek(c.env, week.id);
      const allResolved = games.every((g) => g.winner !== null);
      if (allResolved) {
        await updateWeeklyResults(c.env, week.id);
      }
    }

    return c.json({ success: true, message: `Updated ${results.length} game result(s)` });
  } catch (err) {
    return c.json({ error: 'Failed to simulate results' }, 500);
  }
});

// POST /api/admin/leagues/:id/resolve-week - Force-calculate results for current week
admin.post('/api/admin/leagues/:id/resolve-week', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const week = await getCurrentWeek(c.env, leagueId);
    if (!week) return c.json({ error: 'No current week found' }, 404);

    await updateWeeklyResults(c.env, week.id);

    const { results: weeklyResults } = await c.env.DB
      .prepare(
        `SELECT wr.*, p.name as player_name
         FROM weekly_results wr
         JOIN players p ON p.id = wr.player_id
         WHERE wr.week_id = ?
         ORDER BY wr.correct_picks DESC`
      )
      .bind(week.id)
      .all();

    return c.json({ week, results: weeklyResults });
  } catch (err) {
    return c.json({ error: 'Failed to resolve week' }, 500);
  }
});

// POST /api/admin/leagues/:id/advance-week - Create the next week (like Sunday morning but without SMS)
admin.post('/api/admin/leagues/:id/advance-week', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const { startDate, endDate } = body;

    const nextManager = await getNextBetManager(c.env, leagueId);
    if (!nextManager) return c.json({ error: 'No players in league' }, 400);

    const currentWeek = await getCurrentWeek(c.env, leagueId);
    const nextWeekNumber = currentWeek ? currentWeek.week_number + 1 : 1;

    const newWeek = await createWeek(c.env, leagueId, nextWeekNumber, league.season, nextManager.id);
    if (!newWeek) return c.json({ error: 'Failed to create week' }, 500);

    let availableGames: any[] = [];
    if (startDate && endDate) {
      availableGames = await getUpcomingGames(startDate, endDate);
    }

    // Set bet manager to picking_games state
    await updateConversation(c.env, nextManager.id, 'picking_games', JSON.stringify({
      weekId: newWeek.id,
      availableGames,
    }));

    return c.json({
      week: newWeek,
      betManager: { id: nextManager.id, name: nextManager.name },
      availableGames: availableGames.length,
      message: `Week ${nextWeekNumber} created. ${nextManager.name} is the bet manager.`,
    });
  } catch (err) {
    return c.json({ error: 'Failed to advance week' }, 500);
  }
});

// POST /api/admin/leagues/:id/set-records - Manually set team W-L records
admin.post('/api/admin/leagues/:id/set-records', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    const body = await c.req.json();
    const { records } = body;

    if (!Array.isArray(records) || records.length === 0) {
      return c.json({ error: 'records array required: [{ teamName, wins, losses }]' }, 400);
    }

    for (const record of records) {
      if (!record.teamName || record.wins == null || record.losses == null) {
        return c.json({ error: 'Each record needs teamName, wins, losses' }, 400);
      }
      await updateTeamRecord(c.env, leagueId, league.season, record.teamName, record.wins, record.losses);
    }

    const updated = await getSeasonLines(c.env, leagueId, league.season);
    return c.json({ success: true, seasonLines: updated });
  } catch (err) {
    return c.json({ error: 'Failed to set records' }, 500);
  }
});

// POST /api/admin/leagues/:id/end-season - End the current season (clear active week, finalize standings)
admin.post('/api/admin/leagues/:id/end-season', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    // Resolve any remaining weeks
    const week = await getCurrentWeek(c.env, leagueId);
    if (week) {
      const games = await getGamesForWeek(c.env, week.id);
      const unresolvedGames = games.filter((g) => g.winner === null);
      if (unresolvedGames.length > 0) {
        // Mark unresolved games as cancelled
        for (const game of unresolvedGames) {
          await updateGameResult(c.env, game.id, 'CANCELLED', 'N/A');
        }
      }
      await updateWeeklyResults(c.env, week.id);
    }

    // Reset all player conversations to idle
    const players = await getPlayersByLeague(c.env, leagueId);
    for (const player of players) {
      await updateConversation(c.env, player.id, 'idle', null);
    }

    // Get final standings
    const seasonLines = await getSeasonLines(c.env, leagueId, league.season);

    // Get all weekly results for final pick totals
    const { results: allResults } = await c.env.DB
      .prepare(
        `SELECT p.name, SUM(wr.correct_picks) as total_correct, SUM(wr.total_picks) as total_picks
         FROM weekly_results wr
         JOIN players p ON p.id = wr.player_id
         JOIN weeks w ON w.id = wr.week_id
         WHERE w.league_id = ?
         GROUP BY wr.player_id
         ORDER BY total_correct DESC`
      )
      .bind(leagueId)
      .all();

    return c.json({
      success: true,
      message: `Season ${league.season} ended for ${league.name}`,
      finalStandings: seasonLines,
      pickLeaderboard: allResults,
    });
  } catch (err) {
    return c.json({ error: 'Failed to end season' }, 500);
  }
});

// POST /api/admin/leagues/:id/new-season - Start a new season
admin.post('/api/admin/leagues/:id/new-season', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const league = await getLeague(c.env, leagueId);
    if (!league) return c.json({ error: 'League not found' }, 404);

    const body = await c.req.json();
    const { season } = body;

    if (!season) {
      return c.json({ error: 'season (year) is required' }, 400);
    }

    // Update league season
    await c.env.DB
      .prepare('UPDATE leagues SET season = ? WHERE id = ?')
      .bind(season, leagueId)
      .run();

    // Create fresh season lines for each player's team
    const players = await getPlayersByLeague(c.env, leagueId);
    for (const player of players) {
      await upsertSeasonLine(c.env, leagueId, season, player.team_name, 0);
    }

    // Reset all conversations to idle
    for (const player of players) {
      await updateConversation(c.env, player.id, 'idle', null);
    }

    const seasonLines = await getSeasonLines(c.env, leagueId, season);

    return c.json({
      success: true,
      message: `Season ${season} started for ${league.name}`,
      league: { ...league, season },
      seasonLines,
    });
  } catch (err) {
    return c.json({ error: 'Failed to start new season' }, 500);
  }
});

// POST /api/admin/leagues/:id/reset-conversations - Reset all player conversation states
admin.post('/api/admin/leagues/:id/reset-conversations', async (c) => {
  try {
    const leagueId = Number(c.req.param('id'));
    const players = await getPlayersByLeague(c.env, leagueId);

    for (const player of players) {
      await updateConversation(c.env, player.id, 'idle', null);
    }

    return c.json({ success: true, message: `Reset ${players.length} conversations to idle` });
  } catch (err) {
    return c.json({ error: 'Failed to reset conversations' }, 500);
  }
});

// DELETE /api/admin/leagues/:id/weeks/:weekId - Delete a week and its games/picks
admin.delete('/api/admin/leagues/:id/weeks/:weekId', async (c) => {
  try {
    const weekId = Number(c.req.param('weekId'));

    await c.env.DB.prepare('DELETE FROM weekly_results WHERE week_id = ?').bind(weekId).run();
    await c.env.DB.prepare('DELETE FROM picks WHERE week_id = ?').bind(weekId).run();
    await c.env.DB.prepare('DELETE FROM weekly_games WHERE week_id = ?').bind(weekId).run();
    await c.env.DB.prepare('DELETE FROM weeks WHERE id = ?').bind(weekId).run();

    return c.json({ success: true, message: `Week ${weekId} deleted` });
  } catch (err) {
    return c.json({ error: 'Failed to delete week' }, 500);
  }
});

export default admin;
