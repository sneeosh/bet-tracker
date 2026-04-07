import type { Env, Player } from '../types';
import {
  getLeagueByPlayer,
  getCurrentWeek,
  getGamesForWeek,
  addGameToWeek,
  lockGames,
  submitPick,
  getConversation,
  updateConversation,
  getPlayersByLeague,
  getSeasonLines,
  getPicksByPlayer,
} from '../db/queries';
import { sendSms } from './sms';
import { parseMessage, formatGameList } from './ai';
import { resolvePickedTeam, parseSimplePicks } from '../utils/team-matching';

// ─── Simple keyword matching (avoids unnecessary AI calls) ──────────────────

const STANDINGS_PATTERNS = /^(standings|scores|record|records|how we doing|where do i stand|leaderboard|stats)$/i;
const HELP_PATTERNS = /^(help|commands|menu|options|what can i do|how does this work|\?)$/i;
const MYPICKS_PATTERNS = /^(my ?picks|picks|my bets|bets|status|what did i pick)$/i;
const GAMES_PATTERNS = /^(games|this week|weekly games|what games|schedule|matchups)$/i;

/**
 * Try to match a simple command before calling AI.
 * Returns the intent type string or null if no match.
 */
function matchSimpleCommand(message: string): string | null {
  const trimmed = message.trim();
  if (STANDINGS_PATTERNS.test(trimmed)) return 'standings';
  if (HELP_PATTERNS.test(trimmed)) return 'help';
  if (MYPICKS_PATTERNS.test(trimmed)) return 'mypicks';
  if (GAMES_PATTERNS.test(trimmed)) return 'games';
  return null;
}

// ─── Core message handler ───────────────────────────────────────────────────

/**
 * Core message handler shared by both SMS webhook and web chat.
 * Returns a plain text response string.
 */
export async function handleMessage(
  env: Env,
  player: Player,
  message: string,
): Promise<string> {
  const conversation = await getConversation(env, player.id);
  const state = conversation?.state ?? 'idle';
  const context = conversation?.context ? JSON.parse(conversation.context) : {};

  // Quick commands that work from any state
  const simpleCmd = matchSimpleCommand(message);
  if (simpleCmd === 'standings') return handleStandings(env, player);
  if (simpleCmd === 'help') return buildHelpMessage(state);
  if (simpleCmd === 'mypicks') return handleMyPicks(env, player);
  if (simpleCmd === 'games') return handleGames(env, player);

  if (state === 'idle') {
    return handleIdle(env, player, message);
  } else if (state === 'picking_games') {
    return handlePickingGames(env, player, message, context);
  } else if (state === 'making_picks') {
    return handleMakingPicks(env, player, message, context);
  }

  return 'Something went wrong. Text "help" for assistance.';
}

// ─── Global commands (work from any state) ──────────────────────────────────

async function handleStandings(env: Env, player: Player): Promise<string> {
  const league = await getLeagueByPlayer(env, player.id);
  if (!league) return 'Could not find your league.';

  const seasonLines = await getSeasonLines(env, league.id, league.season);
  if (seasonLines.length === 0) return 'No standings available yet.';

  let msg = 'Current Standings:\n';
  for (const line of seasonLines) {
    msg += `${line.team_name}: ${line.current_wins}-${line.current_losses} (O/U ${line.over_under_line})\n`;
  }
  return msg.trim();
}

function buildHelpMessage(state: string): string {
  let msg =
    'Bet Tracker Commands:\n' +
    '- "standings" - current win/loss records\n' +
    '- "games" - this week\'s matchups\n' +
    '- "my picks" - see your picks for this week\n' +
    '- "help" - this message\n';

  if (state === 'picking_games') {
    msg += '\nYou\'re the bet manager! Reply with 3 game numbers (e.g. "1, 4, 7").';
  } else if (state === 'making_picks') {
    msg +=
      '\nYou have picks to make! Reply with team names, or use shortcuts:\n' +
      '- Team names: "Cubs, Pirates, Dodgers"\n' +
      '- Home/away: "home, away, home" or "h, a, h"';
  }

  return msg;
}

async function handleMyPicks(env: Env, player: Player): Promise<string> {
  const league = await getLeagueByPlayer(env, player.id);
  if (!league) return 'Could not find your league.';

  const week = await getCurrentWeek(env, league.id);
  if (!week) return 'No active week right now.';

  const picks = await getPicksByPlayer(env, week.id, player.id);
  if (picks.length === 0) {
    const conversation = await getConversation(env, player.id);
    if (conversation?.state === 'making_picks') {
      return 'You haven\'t submitted picks yet this week. Reply with your picks!';
    }
    return 'No picks submitted this week.';
  }

  const games = await getGamesForWeek(env, week.id);
  let msg = `Your Week ${week.week_number} picks:\n`;
  for (const pick of picks) {
    const game = games.find((g) => g.id === pick.game_id);
    if (game) {
      const result = pick.is_correct === 1 ? ' ✓' : pick.is_correct === 0 ? ' ✗' : '';
      msg += `${game.away_team} @ ${game.home_team}: ${pick.picked_team}${result}\n`;
    }
  }
  return msg.trim();
}

async function handleGames(env: Env, player: Player): Promise<string> {
  const league = await getLeagueByPlayer(env, player.id);
  if (!league) return 'Could not find your league.';

  const week = await getCurrentWeek(env, league.id);
  if (!week) return 'No active week right now.';

  if (!week.games_locked) {
    return 'Games haven\'t been picked yet this week. The bet manager is choosing!';
  }

  const games = await getGamesForWeek(env, week.id);
  if (games.length === 0) return 'No games this week.';

  const gameListText = formatGameList(
    games.map((g) => ({
      awayTeam: g.away_team,
      homeTeam: g.home_team,
      awayPitcher: g.away_pitcher,
      homePitcher: g.home_pitcher,
      gameDate: g.game_date,
      gameTime: g.game_time,
    })),
    true,
  );

  return `Week ${week.week_number} games:\n${gameListText}`;
}

// ─── Idle state ─────────────────────────────────────────────────────────────

async function handleIdle(env: Env, player: Player, message: string): Promise<string> {
  // Simple matching already handled above; try AI for anything else
  const intent = await parseMessage(env, message, { state: 'idle' });

  if (intent.type === 'standings') return handleStandings(env, player);
  if (intent.type === 'help') return buildHelpMessage('idle');

  return 'Not sure what you mean. Try "standings", "games", "my picks", or "help".';
}

// ─── Bet manager: picking games ─────────────────────────────────────────────

async function handlePickingGames(
  env: Env,
  player: Player,
  message: string,
  context: { availableGames?: any[]; weekId?: number },
): Promise<string> {
  const availableGames = context.availableGames ?? [];
  const weekId = context.weekId;

  if (!weekId || availableGames.length === 0) {
    await updateConversation(env, player.id, 'idle', null);
    return 'Something went wrong with game selection. Please wait for the next round.';
  }

  const gameListText = formatGameList(
    availableGames.map((g: any) => ({
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
      awayPitcher: g.awayPitcher ?? null,
      homePitcher: g.homePitcher ?? null,
      gameDate: g.gameDate,
      gameTime: g.gameTime ?? null,
    })),
    true,
  );

  // Try simple number parsing first (e.g. "1, 4, 7" or "1 4 7")
  const simpleNumbers = tryParseGameNumbers(message, availableGames.length);

  let selectedIndices: number[];

  if (simpleNumbers) {
    selectedIndices = simpleNumbers;
  } else {
    // Fall back to AI parsing
    const intent = await parseMessage(env, message, {
      state: 'picking_games',
      availableGames: gameListText,
    });

    if (intent.type !== 'pick_games') {
      return `Reply with 3 game numbers to select.\n\nAvailable games:\n${gameListText}\n\nExample: "1, 4, 7"`;
    }
    selectedIndices = intent.games;
  }

  // Validate indices
  const invalidIndices = selectedIndices.filter(
    (i) => i < 1 || i > availableGames.length,
  );
  if (invalidIndices.length > 0) {
    return `Invalid game number(s): ${invalidIndices.join(', ')}. Pick numbers between 1 and ${availableGames.length}.\n\nAvailable games:\n${gameListText}`;
  }

  if (selectedIndices.length !== 3) {
    return `You picked ${selectedIndices.length} game(s) — need exactly 3. Reply with three game numbers (e.g. "1, 4, 7").`;
  }

  // Check for duplicates
  const uniqueIndices = [...new Set(selectedIndices)];
  if (uniqueIndices.length !== selectedIndices.length) {
    return 'You picked the same game twice. Reply with 3 different game numbers.';
  }

  const selectedGames = selectedIndices.map((i) => availableGames[i - 1]);
  for (const game of selectedGames) {
    await addGameToWeek(
      env,
      weekId,
      game.gamePk,
      game.gameDate,
      game.gameTime ?? null,
      game.awayTeam,
      game.homeTeam,
      game.awayPitcher ?? null,
      game.homePitcher ?? null,
    );
  }

  const firstGameDate = selectedGames
    .map((g: any) => g.gameDate)
    .sort()[0];
  const picksDeadline = firstGameDate ? `${firstGameDate}T00:00:00Z` : null;

  await lockGames(env, weekId, picksDeadline);
  await updateConversation(env, player.id, 'idle', null);

  const league = await getLeagueByPlayer(env, player.id);
  if (league) {
    const players = await getPlayersByLeague(env, league.id);
    const weekGames = await getGamesForWeek(env, weekId);

    const gameListForPicks = formatGameList(
      weekGames.map((g) => ({
        awayTeam: g.away_team,
        homeTeam: g.home_team,
        awayPitcher: g.away_pitcher,
        homePitcher: g.home_pitcher,
        gameDate: g.game_date,
        gameTime: g.game_time,
      })),
      true,
    );

    const broadcastMsg =
      `This week's games are locked! ${player.name} picked:\n\n${gameListForPicks}\n\nReply with your picks (e.g. "Cubs, Pirates, Dodgers" or "home, away, home").`;

    for (const p of players) {
      if (p.id !== player.id) {
        try { await sendSms(env, p.phone, broadcastMsg); } catch {}
      }
      await updateConversation(env, p.id, 'making_picks', JSON.stringify({
        weekId,
        games: weekGames.map((g) => ({
          id: g.id,
          awayTeam: g.away_team,
          homeTeam: g.home_team,
          gameDate: g.game_date,
        })),
      }));
    }

    try {
      await sendSms(env, player.phone, `Games locked! Now make your own picks.\n\n${gameListForPicks}\n\nReply with your picks.`);
    } catch {}
  }

  return 'Games locked and all players have been notified!';
}

/**
 * Try to parse simple number inputs like "1, 4, 7" or "1 4 7" without AI.
 */
function tryParseGameNumbers(message: string, maxIndex: number): number[] | null {
  const cleaned = message.trim().replace(/[,\s]+/g, ' ');
  const parts = cleaned.split(' ').filter(Boolean);

  if (parts.length === 0) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const numbers = parts.map(Number);
  return numbers;
}

// ─── Players: making picks ──────────────────────────────────────────────────

async function handleMakingPicks(
  env: Env,
  player: Player,
  message: string,
  context: { weekId?: number; games?: any[] },
): Promise<string> {
  const weekId = context.weekId;
  const games = context.games ?? [];

  if (!weekId || games.length === 0) {
    await updateConversation(env, player.id, 'idle', null);
    return 'No active games to pick. Please wait for the next round.';
  }

  const existingPicks = await getPicksByPlayer(env, weekId, player.id);
  if (existingPicks.length >= games.length) {
    await updateConversation(env, player.id, 'idle', null);
    return 'You\'ve already submitted your picks for this week!';
  }

  const gameListText = formatGameList(
    games.map((g: any) => ({
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
      awayPitcher: null,
      homePitcher: null,
      gameDate: g.gameDate,
      gameTime: null,
    })),
    true,
  );

  // ── Try local fuzzy matching first (fast, no AI call needed) ──
  const localPicks = parseSimplePicks(message, games);
  if (localPicks && localPicks.length === games.length) {
    return await savePicks(env, player, weekId, games, localPicks);
  }

  // ── Fall back to AI parsing ──
  const intent = await parseMessage(env, message, {
    state: 'making_picks',
    selectedGames: gameListText,
  });

  if (intent.type === 'make_picks') {
    const picks = intent.picks;

    if (picks.length !== games.length) {
      return buildPickPrompt(games, gameListText, picks.length);
    }

    const invalidPicks = picks.filter(
      (p) => p.gameIndex < 1 || p.gameIndex > games.length,
    );
    if (invalidPicks.length > 0) {
      return `Some of your picks didn't match a game. Let's try again.\n\n${gameListText}\n\nReply with one team per game (e.g. "Cubs, Pirates, Dodgers").`;
    }

    // ── Normalize AI-returned team names against actual game teams ──
    const normalizedPicks: { gameIndex: number; team: string }[] = [];
    const unmatchedPicks: string[] = [];

    for (const pick of picks) {
      const game = games[pick.gameIndex - 1];
      const resolved = resolvePickedTeam(pick.team, game.awayTeam, game.homeTeam);
      if (resolved) {
        normalizedPicks.push({ gameIndex: pick.gameIndex, team: resolved });
      } else {
        unmatchedPicks.push(
          `Game ${pick.gameIndex} (${game.awayTeam} @ ${game.homeTeam}): couldn't match "${pick.team}"`,
        );
      }
    }

    if (unmatchedPicks.length > 0) {
      return (
        `I couldn't match some of your picks:\n${unmatchedPicks.join('\n')}\n\n` +
        `Try using the full team name, or "home"/"away".\n\n${gameListText}`
      );
    }

    return await savePicks(env, player, weekId, games, normalizedPicks);
  }

  return buildPickPrompt(games, gameListText, 0);
}

/**
 * Save validated picks and return a confirmation message.
 */
async function savePicks(
  env: Env,
  player: Player,
  weekId: number,
  games: any[],
  picks: { gameIndex: number; team: string }[],
): Promise<string> {
  for (const pick of picks) {
    const game = games[pick.gameIndex - 1];
    await submitPick(env, weekId, player.id, game.id, pick.team);
  }

  await updateConversation(env, player.id, 'idle', null);

  const confirmationLines = picks.map((p) => {
    const game = games[p.gameIndex - 1];
    return `${game.awayTeam} @ ${game.homeTeam} → ${p.team}`;
  });

  return `Picks locked in!\n${confirmationLines.join('\n')}\n\nGood luck! Text "my picks" anytime to review.`;
}

/**
 * Build a helpful re-prompt when picks don't match.
 */
function buildPickPrompt(games: any[], gameListText: string, providedCount: number): string {
  const teamExamples = games.map((g: any) => g.homeTeam.split(' ').pop()).join(', ');

  let msg = '';
  if (providedCount > 0) {
    msg += `Got ${providedCount} pick(s) but need ${games.length}.\n\n`;
  } else {
    msg += `Pick a winner for each game:\n\n`;
  }

  msg += `${gameListText}\n\n`;
  msg += `Reply with team names (e.g. "${teamExamples}") or use "home"/"away" for each game.`;

  return msg;
}
