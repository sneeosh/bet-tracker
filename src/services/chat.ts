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
import { sendSms, broadcastSms } from './sms';
import { parseMessage, formatGameList } from './ai';

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

  if (state === 'idle') {
    return handleIdle(env, player, message);
  } else if (state === 'picking_games') {
    return handlePickingGames(env, player, message, context);
  } else if (state === 'making_picks') {
    return handleMakingPicks(env, player, message, context);
  }

  return 'Something went wrong. Text "help" for assistance.';
}

async function handleIdle(env: Env, player: Player, message: string): Promise<string> {
  const intent = await parseMessage(env, message, { state: 'idle' });

  if (intent.type === 'standings') {
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

  if (intent.type === 'help') {
    return (
      'Bet Tracker Help:\n' +
      '- Text "standings" to see current standings\n' +
      '- When you\'re the bet manager, you\'ll be sent games to choose from\n' +
      '- When games are locked, reply with your picks for each game\n' +
      '- Text "help" anytime to see this message'
    );
  }

  return 'Not sure what you mean. Text "help" for a list of commands.';
}

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

  const intent = await parseMessage(env, message, {
    state: 'picking_games',
    availableGames: gameListText,
  });

  if (intent.type === 'pick_games') {
    const selectedIndices = intent.games;

    const invalidIndices = selectedIndices.filter(
      (i) => i < 1 || i > availableGames.length,
    );
    if (invalidIndices.length > 0) {
      return `Invalid game number(s): ${invalidIndices.join(', ')}. Please pick numbers between 1 and ${availableGames.length}.`;
    }

    if (selectedIndices.length !== 3) {
      return 'Please pick exactly 3 games. Reply with three game numbers (e.g. "1, 4, 7").';
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
        `This week's games are locked! ${player.name} picked:\n\n${gameListForPicks}\n\nReply with your picks (e.g. "Cubs, Pirates, Dodgers").`;

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

  return `Please reply with 3 game numbers to select.\n\nAvailable games:\n${gameListText}`;
}

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

  const intent = await parseMessage(env, message, {
    state: 'making_picks',
    selectedGames: gameListText,
  });

  if (intent.type === 'make_picks') {
    const picks = intent.picks;

    if (picks.length !== games.length) {
      return `Please pick a winner for all ${games.length} games. You provided ${picks.length} pick(s).`;
    }

    const invalidPicks = picks.filter(
      (p) => p.gameIndex < 1 || p.gameIndex > games.length,
    );
    if (invalidPicks.length > 0) {
      return 'Some of your picks reference invalid game numbers. Please try again.';
    }

    for (const pick of picks) {
      const game = games[pick.gameIndex - 1];
      await submitPick(env, weekId, player.id, game.id, pick.team);
    }

    await updateConversation(env, player.id, 'idle', null);

    const confirmationLines = picks.map((p) => {
      const game = games[p.gameIndex - 1];
      return `Game ${p.gameIndex} (${game.awayTeam} @ ${game.homeTeam}): ${p.team}`;
    });

    return `Picks submitted! Here's what you chose:\n${confirmationLines.join('\n')}\n\nGood luck!`;
  }

  return `Please pick a winner for each game:\n${gameListText}\n\nReply with team names (e.g. "Cubs, Pirates, Dodgers").`;
}
