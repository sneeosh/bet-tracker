import type { AssistantAction, ConversationState, Env, Player } from '../types';
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
import { decideAction, formatGameList, type AssistantContext } from './ai';
import { resolvePickedTeam } from '../utils/team-matching';

/**
 * Core message handler shared by both SMS webhook and web chat.
 *
 * Flow:
 *   1. Load the player's conversation state + any pending context (available
 *      games for the bet manager, selected games for pickers).
 *   2. Ask the LLM what to do. The LLM has latitude to pick any authorized
 *      action OR reply conversationally (clarification, smalltalk).
 *   3. Dispatch the action — validate against state, run side effects,
 *      produce the text the user will see.
 */
export async function handleMessage(
  env: Env,
  player: Player,
  message: string,
): Promise<string> {
  const conversation = await getConversation(env, player.id);
  const state = (conversation?.state ?? 'idle') as ConversationState;
  const context = conversation?.context ? JSON.parse(conversation.context) : {};

  const assistantContext = await buildAssistantContext(env, player, state, context);
  const action = await decideAction(env, assistantContext, message);

  return dispatchAction(env, player, state, context, action);
}

/**
 * Gather everything the LLM needs to make an informed decision.
 */
async function buildAssistantContext(
  env: Env,
  player: Player,
  state: ConversationState,
  context: { availableGames?: any[]; games?: any[]; weekId?: number },
): Promise<AssistantContext> {
  const ctx: AssistantContext = {
    playerName: player.name,
    playerTeam: player.team_name,
    state,
  };

  if (state === 'picking_games' && context.availableGames) {
    ctx.availableGames = formatGameList(
      context.availableGames.map((g: any) => ({
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        awayPitcher: g.awayPitcher ?? null,
        homePitcher: g.homePitcher ?? null,
        gameDate: g.gameDate,
        gameTime: g.gameTime ?? null,
      })),
      true,
    );
  }

  if (state === 'making_picks' && context.games) {
    ctx.selectedGames = formatGameList(
      context.games.map((g: any) => ({
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        awayPitcher: null,
        homePitcher: null,
        gameDate: g.gameDate,
        gameTime: null,
      })),
      true,
    );

    if (context.weekId) {
      const existing = await getPicksByPlayer(env, context.weekId, player.id);
      ctx.hasSubmittedPicks = existing.length >= context.games.length;
    }
  }

  return ctx;
}

/**
 * Execute the LLM's chosen action, enforcing that mutating actions are only
 * allowed in a matching conversation state. Read-only actions always work.
 */
async function dispatchAction(
  env: Env,
  player: Player,
  state: ConversationState,
  context: { availableGames?: any[]; games?: any[]; weekId?: number },
  action: AssistantAction,
): Promise<string> {
  switch (action.type) {
    case 'reply':
      return action.message;

    case 'show_standings':
      return showStandings(env, player);

    case 'show_games':
      return showGames(env, player);

    case 'show_my_picks':
      return showMyPicks(env, player, state);

    case 'show_help':
      return buildHelpMessage(state);

    case 'select_weekly_games': {
      if (state !== 'picking_games') {
        return "That's the bet manager's call, not your turn this week. Want to see standings or this week's games instead?";
      }
      return applyWeeklyGameSelection(env, player, context, action.games);
    }

    case 'submit_picks': {
      if (state !== 'making_picks') {
        return "No picks are open right now. Text 'games' to see what's up, or 'standings' for current records.";
      }
      return applyPicks(env, player, context, action.picks);
    }
  }
}

// ─── Read-only actions ──────────────────────────────────────────────────────

async function showStandings(env: Env, player: Player): Promise<string> {
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

async function showGames(env: Env, player: Player): Promise<string> {
  const league = await getLeagueByPlayer(env, player.id);
  if (!league) return 'Could not find your league.';

  const week = await getCurrentWeek(env, league.id);
  if (!week) return 'No active week right now.';

  if (!week.games_locked) {
    return "Games haven't been picked yet this week. The bet manager is choosing!";
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

async function showMyPicks(
  env: Env,
  player: Player,
  state: ConversationState,
): Promise<string> {
  const league = await getLeagueByPlayer(env, player.id);
  if (!league) return 'Could not find your league.';

  const week = await getCurrentWeek(env, league.id);
  if (!week) return 'No active week right now.';

  const picks = await getPicksByPlayer(env, week.id, player.id);
  if (picks.length === 0) {
    if (state === 'making_picks') {
      return "You haven't submitted picks yet this week. Reply with your picks!";
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

function buildHelpMessage(state: ConversationState): string {
  let msg =
    "Hey! You can just text me naturally — I'll figure it out. Some things I can do:\n" +
    "- standings / records\n" +
    "- this week's games\n" +
    "- your picks this week\n";

  if (state === 'picking_games') {
    msg +=
      "\nYou're the bet manager — pick 3 games from the list I sent. You can say '1, 4, 7', " +
      "or just name the teams or pitchers you want.";
  } else if (state === 'making_picks') {
    msg +=
      "\nYou owe picks this week! Reply with one team per game — names, nicknames, or " +
      "'home'/'away' all work (e.g. 'Cubs, Pirates, Dodgers').";
  }

  return msg;
}

// ─── Mutating actions ───────────────────────────────────────────────────────

async function applyWeeklyGameSelection(
  env: Env,
  player: Player,
  context: { availableGames?: any[]; weekId?: number },
  selectedIndices: number[],
): Promise<string> {
  const availableGames = context.availableGames ?? [];
  const weekId = context.weekId;

  if (!weekId || availableGames.length === 0) {
    await updateConversation(env, player.id, 'idle', null);
    return 'Something went wrong with game selection. Please wait for the next round.';
  }

  const availableGameListText = formatGameList(
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

  const invalidIndices = selectedIndices.filter(
    (i) => i < 1 || i > availableGames.length,
  );
  if (invalidIndices.length > 0) {
    return `I got game number(s) ${invalidIndices.join(', ')} — those aren't in the list. Pick numbers between 1 and ${availableGames.length}.\n\n${availableGameListText}`;
  }

  if (selectedIndices.length !== 3) {
    return `I caught ${selectedIndices.length} game(s) — I need exactly 3. Which three?`;
  }

  const uniqueIndices = [...new Set(selectedIndices)];
  if (uniqueIndices.length !== selectedIndices.length) {
    return 'Looks like you picked the same game twice. Want to give me 3 different ones?';
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

  const firstGameDate = selectedGames.map((g: any) => g.gameDate).sort()[0];
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
        try {
          await sendSms(env, p.phone, broadcastMsg);
        } catch {}
      }
      await updateConversation(
        env,
        p.id,
        'making_picks',
        JSON.stringify({
          weekId,
          games: weekGames.map((g) => ({
            id: g.id,
            awayTeam: g.away_team,
            homeTeam: g.home_team,
            gameDate: g.game_date,
          })),
        }),
      );
    }

    try {
      await sendSms(
        env,
        player.phone,
        `Games locked! Now make your own picks.\n\n${gameListForPicks}\n\nReply with your picks.`,
      );
    } catch {}
  }

  return 'Games locked and all players have been notified!';
}

async function applyPicks(
  env: Env,
  player: Player,
  context: { weekId?: number; games?: any[] },
  picks: { gameIndex: number; team: string }[],
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
    return "You've already submitted your picks for this week!";
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

  if (picks.length !== games.length) {
    return buildPickPrompt(games, gameListText, picks.length);
  }

  const invalidPicks = picks.filter((p) => p.gameIndex < 1 || p.gameIndex > games.length);
  if (invalidPicks.length > 0) {
    return `Some of your picks didn't match a game. Let's try again.\n\n${gameListText}\n\nReply with one team per game (e.g. "Cubs, Pirates, Dodgers").`;
  }

  // Normalize team names against the actual game's teams.
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
      `Try the full team name, or "home"/"away".\n\n${gameListText}`
    );
  }

  for (const pick of normalizedPicks) {
    const game = games[pick.gameIndex - 1];
    await submitPick(env, weekId, player.id, game.id, pick.team);
  }

  await updateConversation(env, player.id, 'idle', null);

  const confirmationLines = normalizedPicks.map((p) => {
    const game = games[p.gameIndex - 1];
    return `${game.awayTeam} @ ${game.homeTeam} → ${p.team}`;
  });

  return `Picks locked in!\n${confirmationLines.join('\n')}\n\nGood luck! Text "my picks" anytime to review.`;
}

function buildPickPrompt(games: any[], gameListText: string, providedCount: number): string {
  const teamExamples = games.map((g: any) => g.homeTeam.split(' ').pop()).join(', ');

  let msg = '';
  if (providedCount > 0) {
    msg += `Got ${providedCount} pick(s) but I need ${games.length}.\n\n`;
  } else {
    msg += `Pick a winner for each game:\n\n`;
  }

  msg += `${gameListText}\n\n`;
  msg += `Reply with team names (e.g. "${teamExamples}") or "home"/"away" for each game.`;

  return msg;
}
