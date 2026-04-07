import type { Env, SmsIntent } from '../types';

/**
 * Use Cloudflare Workers AI to parse an incoming SMS into a structured intent.
 */
export async function parseMessage(
  env: Env,
  message: string,
  context: {
    state: string;
    availableGames?: string;
    selectedGames?: string;
  },
): Promise<SmsIntent> {
  const systemPrompt = buildSystemPrompt(context);

  try {
    const response = await (env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const text = typeof response === 'string'
      ? response
      : (response as { response?: string }).response ?? '';

    // Extract JSON from the response (the model may wrap it in markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: 'unknown', raw: message };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return validateIntent(parsed, message);
  } catch {
    return { type: 'unknown', raw: message };
  }
}

/**
 * Build the system prompt for the AI model based on conversation state.
 */
function buildSystemPrompt(context: {
  state: string;
  availableGames?: string;
  selectedGames?: string;
}): string {
  let prompt = `You are parsing short SMS messages for a sports betting tracker app.
Respond ONLY with a JSON object (no extra text) representing the user's intent.
Keep team names short — use the common nickname (e.g. "Cubs", "Dodgers", "Yankees"), NOT full names.

Possible intents:

1. pick_games - The user wants to select which games to include this week.
   Format: {"type": "pick_games", "games": [1, 3, 5]}
   The numbers refer to game indices from the available list.

2. make_picks - The user is choosing which team wins for each game.
   Format: {"type": "make_picks", "picks": [{"gameIndex": 1, "team": "Cubs"}, {"gameIndex": 2, "team": "Pirates"}]}
   IMPORTANT matching rules for team names:
   - Accept city names ("Chicago" → figure out which Chicago team from context), abbreviations ("NYY", "LAD"), nicknames ("Cubbies", "Yanks"), or partial matches
   - "home" or "h" means the home team for that game
   - "away" or "a" means the away team for that game
   - If the user lists teams in order without game numbers, assume they map to games 1, 2, 3 in order
   - Always return one pick per game. Use the team's common nickname in the "team" field.

3. standings - The user wants to see current standings, scores, records, or how teams are doing.
   Format: {"type": "standings"}

4. help - The user needs help or doesn't know what to do.
   Format: {"type": "help"}

5. unknown - You can't determine the intent.
   Format: {"type": "unknown", "raw": "<original message>"}

Current conversation state: ${context.state}
`;

  if (context.availableGames) {
    prompt += `\nAvailable games the user can choose from:\n${context.availableGames}\n`;
    prompt += `The user may refer to games by number, team name, pitcher name, or partial matches. Convert team/pitcher references to game numbers.\n`;
  }

  if (context.selectedGames) {
    prompt += `\nGames the user is making picks for:\n${context.selectedGames}\n`;
    // Count games from the list (each numbered line is a game)
    const gameCount = (context.selectedGames.match(/^\d+\./gm) || []).length || 3;
    prompt += `The user should pick a winning team for each game. They may use abbreviations, city names, nicknames, "home"/"away", or "h"/"a". If they list ${gameCount} names in order, map them to games 1-${gameCount}.\n`;
  }

  return prompt;
}

/**
 * Validate and coerce a parsed JSON object into a proper SmsIntent.
 */
function validateIntent(parsed: Record<string, unknown>, raw: string): SmsIntent {
  switch (parsed.type) {
    case 'pick_games': {
      const games = parsed.games;
      if (Array.isArray(games) && games.every((g) => typeof g === 'number')) {
        return { type: 'pick_games', games: games as number[] };
      }
      return { type: 'unknown', raw };
    }

    case 'make_picks': {
      const picks = parsed.picks;
      if (
        Array.isArray(picks) &&
        picks.every(
          (p) =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as Record<string, unknown>).gameIndex === 'number' &&
            typeof (p as Record<string, unknown>).team === 'string',
        )
      ) {
        return {
          type: 'make_picks',
          picks: (picks as { gameIndex: number; team: string }[]).map((p) => ({
            gameIndex: p.gameIndex,
            team: p.team,
          })),
        };
      }
      return { type: 'unknown', raw };
    }

    case 'standings':
      return { type: 'standings' };

    case 'help':
      return { type: 'help' };

    default:
      return { type: 'unknown', raw };
  }
}

/**
 * Format a list of games into a readable SMS-friendly text, grouped by date.
 *
 * When numbered=true, each game gets a selection number
 * (e.g. "1. Cubs @ Pirates - 7:05pm (Hendricks vs Skenes)").
 */
export function formatGameList(
  games: {
    awayTeam: string;
    homeTeam: string;
    awayPitcher: string | null;
    homePitcher: string | null;
    gameDate: string;
    gameTime: string | null;
  }[],
  numbered: boolean,
): string {
  if (games.length === 0) {
    return 'No games available.';
  }

  // Group games by date
  const byDate = new Map<string, typeof games>();
  for (const game of games) {
    const dateGames = byDate.get(game.gameDate) ?? [];
    dateGames.push(game);
    byDate.set(game.gameDate, dateGames);
  }

  const lines: string[] = [];
  let globalIndex = 1;

  for (const [date, dateGames] of byDate) {
    lines.push(`\n${formatDateHeader(date)}`);

    for (const game of dateGames) {
      const time = game.gameTime ? ` - ${formatTime(game.gameTime)}` : '';
      const pitchers =
        game.awayPitcher || game.homePitcher
          ? ` (${game.awayPitcher ?? 'TBD'} vs ${game.homePitcher ?? 'TBD'})`
          : '';
      const matchup = `${game.awayTeam} @ ${game.homeTeam}${time}${pitchers}`;

      if (numbered) {
        lines.push(`${globalIndex}. ${matchup}`);
      } else {
        lines.push(matchup);
      }
      globalIndex++;
    }
  }

  return lines.join('\n').trim();
}

/**
 * Format a date string (YYYY-MM-DD) into a friendlier header like "Mon 4/7".
 */
function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getUTCDay()];
  return `${day} ${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

/**
 * Format a time string (HH:MM or ISO) into a short 12-hour format like "7:05pm".
 */
function formatTime(time: string): string {
  // Handle HH:MM format
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return time;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = hours >= 12 ? 'pm' : 'am';
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;

  return `${hours}:${minutes}${ampm}`;
}
