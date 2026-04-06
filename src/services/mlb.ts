import { MlbGame } from '../types';

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

// Division IDs
const NL_CENTRAL = 205;
const NL_EAST = 204;
const NL_WEST = 203;

const DIVISION_IDS: Record<string, number> = {
  'NL Central': NL_CENTRAL,
  'NL East': NL_EAST,
  'NL West': NL_WEST,
};

function parsePitcherName(pitcher: any): string | null {
  if (!pitcher) return null;
  return pitcher.fullName || null;
}

function parseGame(game: any): MlbGame {
  const status = game.status?.detailedState || game.status?.abstractGameState || 'Unknown';
  const linescore = game.linescore;

  const awayScore = linescore?.teams?.away?.runs ?? null;
  const homeScore = linescore?.teams?.home?.runs ?? null;

  let winner: string | null = null;
  if (status === 'Final' || status === 'Game Over') {
    if (awayScore !== null && homeScore !== null) {
      if (awayScore > homeScore) {
        winner = game.teams.away.team.name;
      } else if (homeScore > awayScore) {
        winner = game.teams.home.team.name;
      }
    }
  }

  const gameDate = game.gameDate || '';
  const dateObj = new Date(gameDate);
  const formattedDate = gameDate
    ? `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`
    : '';
  const formattedTime = gameDate
    ? `${String(dateObj.getUTCHours()).padStart(2, '0')}:${String(dateObj.getUTCMinutes()).padStart(2, '0')}`
    : '';

  return {
    gamePk: game.gamePk,
    gameDate: formattedDate,
    gameTime: formattedTime,
    awayTeam: game.teams.away.team.name,
    homeTeam: game.teams.home.team.name,
    awayPitcher: parsePitcherName(game.teams.away.probablePitcher),
    homePitcher: parsePitcherName(game.teams.home.probablePitcher),
    status,
    awayScore,
    homeScore,
    winner,
  };
}

export async function getGamesForDateRange(startDate: string, endDate: string): Promise<MlbGame[]> {
  const url = `${MLB_API_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,linescore`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`MLB API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();
    const games: MlbGame[] = [];

    if (!data.dates || !Array.isArray(data.dates)) {
      return [];
    }

    for (const date of data.dates) {
      if (!date.games || !Array.isArray(date.games)) continue;
      for (const game of date.games) {
        games.push(parseGame(game));
      }
    }

    return games;
  } catch (error) {
    console.error('Failed to fetch MLB schedule:', error);
    return [];
  }
}

export async function getGameResult(gamePk: number): Promise<MlbGame | null> {
  const url = `${MLB_API_BASE}/game/${gamePk}/feed/live`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null;
      console.error(`MLB API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();
    const gameData = data.gameData;
    const liveData = data.liveData;

    if (!gameData || !liveData) return null;

    const status = gameData.status?.detailedState || gameData.status?.abstractGameState || 'Unknown';
    const linescore = liveData.linescore;

    const awayScore = linescore?.teams?.away?.runs ?? null;
    const homeScore = linescore?.teams?.home?.runs ?? null;

    let winner: string | null = null;
    if (status === 'Final' || status === 'Game Over') {
      if (awayScore !== null && homeScore !== null) {
        if (awayScore > homeScore) {
          winner = gameData.teams.away.name;
        } else if (homeScore > awayScore) {
          winner = gameData.teams.home.name;
        }
      }
    }

    const gameDate = gameData.datetime?.dateTime || '';
    const dateObj = new Date(gameDate);
    const formattedDate = gameDate
      ? `${dateObj.getUTCFullYear()}-${String(dateObj.getUTCMonth() + 1).padStart(2, '0')}-${String(dateObj.getUTCDate()).padStart(2, '0')}`
      : '';
    const formattedTime = gameDate
      ? `${String(dateObj.getUTCHours()).padStart(2, '0')}:${String(dateObj.getUTCMinutes()).padStart(2, '0')}`
      : '';

    const awayPitcher = gameData.probablePitchers?.away?.fullName ?? null;
    const homePitcher = gameData.probablePitchers?.home?.fullName ?? null;

    return {
      gamePk: gameData.game?.pk || gamePk,
      gameDate: formattedDate,
      gameTime: formattedTime,
      awayTeam: gameData.teams.away.name,
      homeTeam: gameData.teams.home.name,
      awayPitcher,
      homePitcher,
      status,
      awayScore,
      homeScore,
      winner,
    };
  } catch (error) {
    console.error('Failed to fetch MLB game result:', error);
    return null;
  }
}

export async function getTeamStandings(
  season: number,
  divisionName: string
): Promise<{ teamName: string; wins: number; losses: number }[]> {
  const url = `${MLB_API_BASE}/standings?leagueId=104&season=${season}`;
  const divisionId = DIVISION_IDS[divisionName];

  if (!divisionId) {
    console.error(`Unknown division name: ${divisionName}`);
    return [];
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`MLB API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: any = await response.json();
    const records = data.records;

    if (!records || !Array.isArray(records)) return [];

    const divisionRecord = records.find(
      (r: any) => r.division?.id === divisionId
    );

    if (!divisionRecord || !divisionRecord.teamRecords) return [];

    return divisionRecord.teamRecords.map((tr: any) => ({
      teamName: tr.team.name,
      wins: tr.wins,
      losses: tr.losses,
    }));
  } catch (error) {
    console.error('Failed to fetch MLB standings:', error);
    return [];
  }
}

export async function getUpcomingGames(startDate: string, endDate: string): Promise<MlbGame[]> {
  const allGames = await getGamesForDateRange(startDate, endDate);

  const upcoming = allGames.filter(
    (game) => game.status === 'Scheduled' || game.status === 'Pre-Game' || game.status === 'Warmup'
  );

  // Sort by date then time for grouped display
  upcoming.sort((a, b) => {
    const dateCompare = a.gameDate.localeCompare(b.gameDate);
    if (dateCompare !== 0) return dateCompare;
    return a.gameTime.localeCompare(b.gameTime);
  });

  return upcoming;
}
