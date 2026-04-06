import { Hono } from 'hono';
import type { Env } from '../types';
import {
  getPlayerByPhone,
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
import { sendSms, broadcastSms, twimlResponse, parseTwilioBody, validateTwilioWebhook } from '../services/sms';
import { parseMessage, formatGameList } from '../services/ai';

const sms = new Hono<{ Bindings: Env }>();

sms.post('/sms/webhook', async (c) => {
  // Validate Twilio signature in production
  if (c.env.ENVIRONMENT !== 'development') {
    const isValid = await validateTwilioWebhook(c.req.raw, c.env);
    if (!isValid) {
      return c.text('Forbidden', 403);
    }
  }

  const formData = await c.req.formData();
  const { from, body } = parseTwilioBody(formData);

  // Look up the player by phone number
  const player = await getPlayerByPhone(c.env, from);
  if (!player) {
    return twimlResponse('Sorry, this number is not registered with any league.');
  }

  // Get the player's conversation state
  const conversation = await getConversation(c.env, player.id);
  const state = conversation?.state ?? 'idle';
  const conversationContext = conversation?.context ? JSON.parse(conversation.context) : {};

  // Route based on conversation state
  if (state === 'idle') {
    return await handleIdle(c.env, player, body);
  } else if (state === 'picking_games') {
    return await handlePickingGames(c.env, player, body, conversationContext);
  } else if (state === 'making_picks') {
    return await handleMakingPicks(c.env, player, body, conversationContext);
  }

  return twimlResponse('Something went wrong. Text "help" for assistance.');
});

async function handleIdle(env: Env, player: { id: number; league_id: number; phone: string; name: string }, message: string) {
  const intent = await parseMessage(env, message, { state: 'idle' });

  if (intent.type === 'standings') {
    const league = await getLeagueByPlayer(env, player.id);
    if (!league) {
      return twimlResponse('Could not find your league.');
    }
    const seasonLines = await getSeasonLines(env, league.id, league.season);
    if (seasonLines.length === 0) {
      return twimlResponse('No standings available yet.');
    }

    let standingsMsg = 'Current Standings:\n';
    for (const line of seasonLines) {
      standingsMsg += `${line.team_name}: ${line.current_wins}-${line.current_losses} (O/U ${line.over_under_line})\n`;
    }
    return twimlResponse(standingsMsg.trim());
  }

  if (intent.type === 'help') {
    return twimlResponse(
      'Bet Tracker Help:\n' +
      '- Text "standings" to see current standings\n' +
      '- When you\'re the bet manager, you\'ll be sent games to choose from\n' +
      '- When games are locked, reply with your picks for each game\n' +
      '- Text "help" anytime to see this message'
    );
  }

  return twimlResponse('Not sure what you mean. Text "help" for a list of commands.');
}

async function handlePickingGames(
  env: Env,
  player: { id: number; league_id: number; phone: string; name: string },
  message: string,
  context: { availableGames?: any[]; weekId?: number },
) {
  const availableGames = context.availableGames ?? [];
  const weekId = context.weekId;

  if (!weekId || availableGames.length === 0) {
    await updateConversation(env, player.id, 'idle', null);
    return twimlResponse('Something went wrong with game selection. Please wait for the next round.');
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

    // Validate game numbers (1-based indices)
    const invalidIndices = selectedIndices.filter(
      (i) => i < 1 || i > availableGames.length,
    );
    if (invalidIndices.length > 0) {
      return twimlResponse(
        `Invalid game number(s): ${invalidIndices.join(', ')}. Please pick numbers between 1 and ${availableGames.length}.`,
      );
    }

    if (selectedIndices.length !== 3) {
      return twimlResponse('Please pick exactly 3 games. Reply with three game numbers (e.g. "1, 4, 7").');
    }

    // Add selected games to the week
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

    // Calculate picks deadline: first game time minus 1 hour, or null
    const firstGameDate = selectedGames
      .map((g: any) => g.gameDate)
      .sort()[0];
    const picksDeadline = firstGameDate ? `${firstGameDate}T00:00:00Z` : null;

    // Lock the games for the week
    await lockGames(env, weekId, picksDeadline);

    // Transition bet manager back to idle
    await updateConversation(env, player.id, 'idle', null);

    // Notify all players in the league about the locked games
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

      // Send to all players and set their conversation state to making_picks
      for (const p of players) {
        if (p.id !== player.id) {
          await sendSms(env, p.phone, broadcastMsg);
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

      // Also notify the bet manager
      await sendSms(env, player.phone, `Games locked! Now make your own picks.\n\n${gameListForPicks}\n\nReply with your picks.`);
    }

    return twimlResponse('Games locked and all players have been notified!');
  }

  return twimlResponse(
    `Please reply with 3 game numbers to select.\n\nAvailable games:\n${gameListText}`,
  );
}

async function handleMakingPicks(
  env: Env,
  player: { id: number; league_id: number; phone: string; name: string },
  message: string,
  context: { weekId?: number; games?: any[] },
) {
  const weekId = context.weekId;
  const games = context.games ?? [];

  if (!weekId || games.length === 0) {
    await updateConversation(env, player.id, 'idle', null);
    return twimlResponse('No active games to pick. Please wait for the next round.');
  }

  // Check if player already submitted picks
  const existingPicks = await getPicksByPlayer(env, weekId, player.id);
  if (existingPicks.length >= games.length) {
    await updateConversation(env, player.id, 'idle', null);
    return twimlResponse('You\'ve already submitted your picks for this week!');
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

    // Validate that we have a pick for each game
    if (picks.length !== games.length) {
      return twimlResponse(
        `Please pick a winner for all ${games.length} games. You provided ${picks.length} pick(s).`,
      );
    }

    // Validate game indices
    const invalidPicks = picks.filter(
      (p) => p.gameIndex < 1 || p.gameIndex > games.length,
    );
    if (invalidPicks.length > 0) {
      return twimlResponse('Some of your picks reference invalid game numbers. Please try again.');
    }

    // Submit each pick
    for (const pick of picks) {
      const game = games[pick.gameIndex - 1];
      await submitPick(env, weekId, player.id, game.id, pick.team);
    }

    // Transition back to idle
    await updateConversation(env, player.id, 'idle', null);

    const confirmationLines = picks.map((p) => {
      const game = games[p.gameIndex - 1];
      return `Game ${p.gameIndex} (${game.awayTeam} @ ${game.homeTeam}): ${p.team}`;
    });

    return twimlResponse(
      `Picks submitted! Here's what you chose:\n${confirmationLines.join('\n')}\n\nGood luck!`,
    );
  }

  return twimlResponse(
    `Please pick a winner for each game:\n${gameListText}\n\nReply with team names (e.g. "Cubs, Pirates, Dodgers").`,
  );
}

export default sms;
