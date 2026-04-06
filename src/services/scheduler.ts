import type { Env } from '../types';
import {
  getPlayersByLeague,
  getSeasonLines,
  updateTeamRecord,
  getCurrentWeek,
  getNextBetManager,
  createWeek,
  getGamesForWeek,
  updateGameResult,
  updateWeeklyResults,
  getPlayersWithoutPicks,
  updateConversation,
} from '../db/queries';
import { getUpcomingGames, getTeamStandings, getGameResult } from './mlb';
import { sendSms, broadcastSms } from './sms';
import { formatGameList } from './ai';

/**
 * Runs every Sunday morning. Updates standings, broadcasts them,
 * determines the next bet manager, creates a new week, and sends
 * the available game list to the bet manager.
 */
export async function handleSundayMorning(env: Env): Promise<void> {
  // Get all leagues by querying for distinct league IDs from players
  const { results: leagues } = await env.DB
    .prepare('SELECT * FROM leagues')
    .all<{ id: number; name: string; sport: string; division: string; season: number }>();

  for (const league of leagues) {
    const players = await getPlayersByLeague(env, league.id);
    if (players.length === 0) continue;

    // Fetch current standings from MLB API
    const standings = await getTeamStandings(league.season, league.division);

    // Update season_lines with current win/loss records
    for (const team of standings) {
      await updateTeamRecord(env, league.id, league.season, team.teamName, team.wins, team.losses);
    }

    // Build standings message
    const seasonLines = await getSeasonLines(env, league.id, league.season);
    let standingsMsg = `Weekly Standings Update - ${league.name}\n\n`;

    if (seasonLines.length > 0) {
      standingsMsg += 'Season Lines:\n';
      for (const line of seasonLines) {
        const pace = line.current_wins + line.current_losses > 0
          ? ((line.current_wins / (line.current_wins + line.current_losses)) * 162).toFixed(0)
          : '0';
        standingsMsg += `${line.team_name}: ${line.current_wins}-${line.current_losses} (O/U ${line.over_under_line}, pace: ${pace} wins)\n`;
      }
    }

    // Broadcast standings to all players
    await broadcastSms(env, players, standingsMsg.trim());

    // Determine next bet manager (round-robin)
    const nextManager = await getNextBetManager(env, league.id);
    if (!nextManager) continue;

    // Calculate the next week number
    const currentWeek = await getCurrentWeek(env, league.id);
    const nextWeekNumber = currentWeek ? currentWeek.week_number + 1 : 1;

    // Create a new week record
    const newWeek = await createWeek(env, league.id, nextWeekNumber, league.season, nextManager.id);
    if (!newWeek) continue;

    // Get upcoming Mon-Sat games from MLB API
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() + 1); // Sunday + 1 = Monday
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5); // Monday + 5 = Saturday

    const startDate = formatDate(monday);
    const endDate = formatDate(saturday);

    const upcomingGames = await getUpcomingGames(startDate, endDate);

    if (upcomingGames.length === 0) {
      await sendSms(env, nextManager.phone, `You're the bet manager this week but no games were found for ${startDate} to ${endDate}. Sit tight!`);
      continue;
    }

    // Format the game list for the bet manager
    const gameListText = formatGameList(
      upcomingGames.map((g) => ({
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        awayPitcher: g.awayPitcher,
        homePitcher: g.homePitcher,
        gameDate: g.gameDate,
        gameTime: g.gameTime,
      })),
      true,
    );

    // Send available game list to the bet manager
    await sendSms(
      env,
      nextManager.phone,
      `You're the bet manager this week! Pick 3 games for everyone to bet on:\n\n${gameListText}\n\nReply with 3 game numbers (e.g. "1, 5, 12").`,
    );

    // Set bet manager's conversation state to 'picking_games'
    await updateConversation(env, nextManager.id, 'picking_games', JSON.stringify({
      weekId: newWeek.id,
      availableGames: upcomingGames,
    }));
  }
}

/**
 * Runs daily to check game results. When all 3 games in a week
 * are resolved, calculates results and broadcasts the winner.
 */
export async function handleDailyResultCheck(env: Env): Promise<void> {
  const { results: leagues } = await env.DB
    .prepare('SELECT * FROM leagues')
    .all<{ id: number; name: string; sport: string; division: string; season: number }>();

  for (const league of leagues) {
    const week = await getCurrentWeek(env, league.id);
    if (!week || !week.games_locked) continue;

    const games = await getGamesForWeek(env, week.id);
    if (games.length === 0) continue;

    // Check if all games already have results
    const unresolvedGames = games.filter((g) => g.winner === null);
    if (unresolvedGames.length === 0) continue;

    // Check each unresolved game's result via MLB API
    let newlyResolved = 0;
    for (const game of unresolvedGames) {
      const result = await getGameResult(game.mlb_game_id);
      if (result && result.winner) {
        await updateGameResult(
          env,
          game.id,
          result.winner,
          `${result.awayScore}-${result.homeScore}`,
        );
        newlyResolved++;
      }
    }

    // Re-check if all games are now resolved
    const updatedGames = await getGamesForWeek(env, week.id);
    const stillUnresolved = updatedGames.filter((g) => g.winner === null);

    if (stillUnresolved.length === 0) {
      // All 3 games are resolved -- calculate weekly results
      await updateWeeklyResults(env, week.id);

      // Get results and broadcast the winner
      const { results: weeklyResults } = await env.DB
        .prepare(
          `SELECT wr.*, p.name as player_name
           FROM weekly_results wr
           JOIN players p ON p.id = wr.player_id
           WHERE wr.week_id = ?
           ORDER BY wr.correct_picks DESC`
        )
        .bind(week.id)
        .all<{ player_id: number; correct_picks: number; total_picks: number; player_name: string }>();

      let resultsMsg = `Week ${week.week_number} Results:\n\n`;

      // Show game results
      for (const game of updatedGames) {
        resultsMsg += `${game.away_team} @ ${game.home_team}: ${game.winner} wins (${game.final_score})\n`;
      }

      resultsMsg += '\nScoreboard:\n';
      for (const result of weeklyResults) {
        resultsMsg += `${result.player_name}: ${result.correct_picks}/${result.total_picks} correct\n`;
      }

      if (weeklyResults.length > 0) {
        const winner = weeklyResults[0];
        resultsMsg += `\nThis week's winner: ${winner.player_name}!`;
      }

      const players = await getPlayersByLeague(env, league.id);
      await broadcastSms(env, players, resultsMsg.trim());
    }
  }
}

/**
 * Runs periodically to remind players who haven't submitted picks.
 * Sends a reminder when the picks deadline is within 2 hours.
 */
export async function handlePickReminder(env: Env): Promise<void> {
  const { results: leagues } = await env.DB
    .prepare('SELECT * FROM leagues')
    .all<{ id: number; name: string; sport: string; division: string; season: number }>();

  for (const league of leagues) {
    const week = await getCurrentWeek(env, league.id);
    if (!week || !week.games_locked) continue;
    if (!week.picks_deadline) continue;

    // Check if the deadline is within 2 hours
    const now = new Date();
    const deadline = new Date(week.picks_deadline);
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilDeadline <= 0 || hoursUntilDeadline > 2) continue;

    // Find players who haven't submitted picks
    const missingPlayers = await getPlayersWithoutPicks(env, week.id, league.id);
    if (missingPlayers.length === 0) continue;

    // Get the games for context
    const games = await getGamesForWeek(env, week.id);
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

    const reminderMsg =
      `Reminder: You haven't submitted your picks yet! The deadline is in less than 2 hours.\n\n` +
      `This week's games:\n${gameListText}\n\n` +
      `Reply with your picks (e.g. "Cubs, Pirates, Dodgers").`;

    for (const player of missingPlayers) {
      await sendSms(env, player.phone, reminderMsg);

      // Make sure their conversation state is set for making picks
      await updateConversation(env, player.id, 'making_picks', JSON.stringify({
        weekId: week.id,
        games: games.map((g) => ({
          id: g.id,
          awayTeam: g.away_team,
          homeTeam: g.home_team,
          gameDate: g.game_date,
        })),
      }));
    }
  }
}

/**
 * Format a Date object as YYYY-MM-DD.
 */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
