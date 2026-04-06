import type { Env, League, Player, SeasonLine, Week, WeeklyGame, Pick, WeeklyResult, Conversation } from '../types';

// ─── League ──────────────────────────────────────────────────────────────────

export async function createLeague(
  env: Env,
  name: string,
  sport: string,
  division: string,
  season: number
): Promise<League | null> {
  const db = env.DB;
  return db
    .prepare('INSERT INTO leagues (name, sport, division, season) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(name, sport, division, season)
    .first<League>();
}

export async function getLeague(env: Env, id: number): Promise<League | null> {
  const db = env.DB;
  return db.prepare('SELECT * FROM leagues WHERE id = ?').bind(id).first<League>();
}

export async function getLeagueByPlayer(env: Env, playerId: number): Promise<League | null> {
  const db = env.DB;
  return db
    .prepare('SELECT l.* FROM leagues l JOIN players p ON p.league_id = l.id WHERE p.id = ?')
    .bind(playerId)
    .first<League>();
}

// ─── Players ─────────────────────────────────────────────────────────────────

export async function createPlayer(
  env: Env,
  leagueId: number,
  name: string,
  phone: string,
  teamName: string,
  isAdmin: number,
  rotationOrder: number
): Promise<Player | null> {
  const db = env.DB;
  return db
    .prepare(
      'INSERT INTO players (league_id, name, phone, team_name, is_admin, rotation_order) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
    )
    .bind(leagueId, name, phone, teamName, isAdmin, rotationOrder)
    .first<Player>();
}

export async function getPlayerByPhone(env: Env, phone: string): Promise<Player | null> {
  const db = env.DB;
  return db.prepare('SELECT * FROM players WHERE phone = ?').bind(phone).first<Player>();
}

export async function getPlayersByLeague(env: Env, leagueId: number): Promise<Player[]> {
  const db = env.DB;
  const { results } = await db
    .prepare('SELECT * FROM players WHERE league_id = ? ORDER BY rotation_order')
    .bind(leagueId)
    .all<Player>();
  return results;
}

export async function getAdminByLeague(env: Env, leagueId: number): Promise<Player | null> {
  const db = env.DB;
  return db
    .prepare('SELECT * FROM players WHERE league_id = ? AND is_admin = 1 LIMIT 1')
    .bind(leagueId)
    .first<Player>();
}

// ─── Season Lines ────────────────────────────────────────────────────────────

export async function upsertSeasonLine(
  env: Env,
  leagueId: number,
  season: number,
  teamName: string,
  overUnderLine: number
): Promise<void> {
  const db = env.DB;
  await db
    .prepare(
      `INSERT INTO season_lines (league_id, season, team_name, over_under_line, current_wins, current_losses)
       VALUES (?, ?, ?, ?, 0, 0)
       ON CONFLICT (league_id, season, team_name)
       DO UPDATE SET over_under_line = excluded.over_under_line`
    )
    .bind(leagueId, season, teamName, overUnderLine)
    .run();
}

export async function getSeasonLines(env: Env, leagueId: number, season: number): Promise<SeasonLine[]> {
  const db = env.DB;
  const { results } = await db
    .prepare('SELECT * FROM season_lines WHERE league_id = ? AND season = ? ORDER BY team_name')
    .bind(leagueId, season)
    .all<SeasonLine>();
  return results;
}

export async function updateTeamRecord(
  env: Env,
  leagueId: number,
  season: number,
  teamName: string,
  wins: number,
  losses: number
): Promise<void> {
  const db = env.DB;
  await db
    .prepare(
      'UPDATE season_lines SET current_wins = ?, current_losses = ? WHERE league_id = ? AND season = ? AND team_name = ?'
    )
    .bind(wins, losses, leagueId, season, teamName)
    .run();
}

// ─── Weeks ───────────────────────────────────────────────────────────────────

export async function createWeek(
  env: Env,
  leagueId: number,
  weekNumber: number,
  season: number,
  betManagerId: number
): Promise<Week | null> {
  const db = env.DB;
  return db
    .prepare(
      'INSERT INTO weeks (league_id, week_number, season, bet_manager_id, games_locked) VALUES (?, ?, ?, ?, 0) RETURNING *'
    )
    .bind(leagueId, weekNumber, season, betManagerId)
    .first<Week>();
}

export async function getCurrentWeek(env: Env, leagueId: number): Promise<Week | null> {
  const db = env.DB;
  return db
    .prepare('SELECT * FROM weeks WHERE league_id = ? ORDER BY week_number DESC LIMIT 1')
    .bind(leagueId)
    .first<Week>();
}

export async function getWeekById(env: Env, weekId: number): Promise<Week | null> {
  const db = env.DB;
  return db.prepare('SELECT * FROM weeks WHERE id = ?').bind(weekId).first<Week>();
}

export async function lockGames(env: Env, weekId: number, picksDeadline: string | null): Promise<void> {
  const db = env.DB;
  await db
    .prepare('UPDATE weeks SET games_locked = 1, picks_deadline = ? WHERE id = ?')
    .bind(picksDeadline, weekId)
    .run();
}

export async function getNextBetManager(env: Env, leagueId: number): Promise<Player | null> {
  const db = env.DB;

  const lastWeek = await db
    .prepare('SELECT bet_manager_id FROM weeks WHERE league_id = ? ORDER BY week_number DESC LIMIT 1')
    .bind(leagueId)
    .first<{ bet_manager_id: number }>();

  if (!lastWeek) {
    // No weeks yet — return the player with the lowest rotation_order
    return db
      .prepare('SELECT * FROM players WHERE league_id = ? ORDER BY rotation_order ASC LIMIT 1')
      .bind(leagueId)
      .first<Player>();
  }

  const lastManager = await db
    .prepare('SELECT rotation_order FROM players WHERE id = ?')
    .bind(lastWeek.bet_manager_id)
    .first<{ rotation_order: number }>();

  if (!lastManager) {
    return db
      .prepare('SELECT * FROM players WHERE league_id = ? ORDER BY rotation_order ASC LIMIT 1')
      .bind(leagueId)
      .first<Player>();
  }

  // Find the next player in rotation (wrap around)
  const next = await db
    .prepare(
      'SELECT * FROM players WHERE league_id = ? AND rotation_order > ? ORDER BY rotation_order ASC LIMIT 1'
    )
    .bind(leagueId, lastManager.rotation_order)
    .first<Player>();

  if (next) return next;

  // Wrap around to the first player
  return db
    .prepare('SELECT * FROM players WHERE league_id = ? ORDER BY rotation_order ASC LIMIT 1')
    .bind(leagueId)
    .first<Player>();
}

// ─── Weekly Games ────────────────────────────────────────────────────────────

export async function addGameToWeek(
  env: Env,
  weekId: number,
  mlbGameId: number,
  gameDate: string,
  gameTime: string | null,
  awayTeam: string,
  homeTeam: string,
  awayPitcher: string | null,
  homePitcher: string | null
): Promise<WeeklyGame | null> {
  const db = env.DB;
  return db
    .prepare(
      `INSERT INTO weekly_games (week_id, mlb_game_id, game_date, game_time, away_team, home_team, away_pitcher, home_pitcher)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(weekId, mlbGameId, gameDate, gameTime, awayTeam, homeTeam, awayPitcher, homePitcher)
    .first<WeeklyGame>();
}

export async function getGamesForWeek(env: Env, weekId: number): Promise<WeeklyGame[]> {
  const db = env.DB;
  const { results } = await db
    .prepare('SELECT * FROM weekly_games WHERE week_id = ? ORDER BY game_date, game_time')
    .bind(weekId)
    .all<WeeklyGame>();
  return results;
}

export async function updateGameResult(
  env: Env,
  gameId: number,
  winner: string,
  finalScore: string
): Promise<void> {
  const db = env.DB;
  await db
    .prepare('UPDATE weekly_games SET winner = ?, final_score = ? WHERE id = ?')
    .bind(winner, finalScore, gameId)
    .run();
}

// ─── Picks ───────────────────────────────────────────────────────────────────

export async function submitPick(
  env: Env,
  weekId: number,
  playerId: number,
  gameId: number,
  pickedTeam: string
): Promise<Pick | null> {
  const db = env.DB;
  return db
    .prepare(
      `INSERT INTO picks (week_id, player_id, game_id, picked_team)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (week_id, player_id, game_id)
       DO UPDATE SET picked_team = excluded.picked_team
       RETURNING *`
    )
    .bind(weekId, playerId, gameId, pickedTeam)
    .first<Pick>();
}

export async function getPicksForWeek(env: Env, weekId: number): Promise<Pick[]> {
  const db = env.DB;
  const { results } = await db
    .prepare('SELECT * FROM picks WHERE week_id = ? ORDER BY player_id, game_id')
    .bind(weekId)
    .all<Pick>();
  return results;
}

export async function getPicksByPlayer(env: Env, weekId: number, playerId: number): Promise<Pick[]> {
  const db = env.DB;
  const { results } = await db
    .prepare('SELECT * FROM picks WHERE week_id = ? AND player_id = ? ORDER BY game_id')
    .bind(weekId, playerId)
    .all<Pick>();
  return results;
}

export async function getPlayersWithoutPicks(env: Env, weekId: number, leagueId: number): Promise<Player[]> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT p.* FROM players p
       WHERE p.league_id = ?
         AND p.id NOT IN (SELECT DISTINCT player_id FROM picks WHERE week_id = ?)
       ORDER BY p.name`
    )
    .bind(leagueId, weekId)
    .all<Player>();
  return results;
}

// ─── Weekly Results ──────────────────────────────────────────────────────────

export async function updateWeeklyResults(env: Env, weekId: number): Promise<void> {
  const db = env.DB;

  // Mark each pick as correct or incorrect based on the game winner
  await db
    .prepare(
      `UPDATE picks SET is_correct = CASE
         WHEN picked_team = (SELECT winner FROM weekly_games WHERE weekly_games.id = picks.game_id) THEN 1
         ELSE 0
       END
       WHERE week_id = ? AND (SELECT winner FROM weekly_games WHERE weekly_games.id = picks.game_id) IS NOT NULL`
    )
    .bind(weekId)
    .run();

  // Upsert aggregated results per player
  await db
    .prepare(
      `INSERT INTO weekly_results (week_id, player_id, correct_picks, total_picks)
       SELECT week_id, player_id, SUM(is_correct), COUNT(*) FROM picks
       WHERE week_id = ? AND is_correct IS NOT NULL
       GROUP BY week_id, player_id
       ON CONFLICT (week_id, player_id)
       DO UPDATE SET correct_picks = excluded.correct_picks, total_picks = excluded.total_picks`
    )
    .bind(weekId)
    .run();
}

// ─── Conversations ───────────────────────────────────────────────────────────

export async function getConversation(env: Env, playerId: number): Promise<Conversation | null> {
  const db = env.DB;
  return db
    .prepare('SELECT * FROM conversations WHERE player_id = ?')
    .bind(playerId)
    .first<Conversation>();
}

export async function updateConversation(
  env: Env,
  playerId: number,
  state: string,
  context: string | null
): Promise<void> {
  const db = env.DB;
  await db
    .prepare(
      `INSERT INTO conversations (player_id, state, context, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (player_id)
       DO UPDATE SET state = excluded.state, context = excluded.context, updated_at = excluded.updated_at`
    )
    .bind(playerId, state, context)
    .run();
}
