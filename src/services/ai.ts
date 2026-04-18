import type { Env, AssistantAction, ConversationState } from '../types';

/**
 * Context passed to the LLM so it can decide what to do with an inbound SMS.
 * The LLM has latitude to pick any authorized action, or to `reply` with a
 * natural-language clarification / smalltalk response.
 */
export interface AssistantContext {
  playerName: string;
  playerTeam: string;
  state: ConversationState;
  /** Formatted numbered list of games the bet manager can choose from. */
  availableGames?: string;
  /** Formatted numbered list of games players are making picks on. */
  selectedGames?: string;
  /** True if the player has already submitted picks for the current week. */
  hasSubmittedPicks?: boolean;
}

/**
 * Ask the LLM to pick one authorized action (or a free-form conversational
 * reply) in response to the user's message.
 */
export async function decideAction(
  env: Env,
  ctx: AssistantContext,
  message: string,
): Promise<AssistantAction> {
  const systemPrompt = buildSystemPrompt(ctx);

  try {
    const response = await (env.AI as any).run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });

    const text =
      typeof response === 'string'
        ? response
        : (response as { response?: string }).response ?? '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: 'reply', message: defaultClarification(ctx) };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    return validateAction(parsed, ctx);
  } catch {
    return { type: 'reply', message: defaultClarification(ctx) };
  }
}

function buildSystemPrompt(ctx: AssistantContext): string {
  const stateDescription: Record<ConversationState, string> = {
    idle: 'Nothing is pending for this player right now.',
    picking_games:
      'This player is the bet manager this week. They owe the group a selection of exactly 3 games from the available list below.',
    making_picks:
      "This player owes picks for this week's selected games (one winning team per game).",
  };

  let prompt = `You are the SMS assistant for "Bet Tracker", an app where a group of friends compete on MLB picks.
Talk like a helpful friend: warm, brief, casual. No emoji, no markdown.

PLAYER
  name: ${ctx.playerName}
  assigned team: ${ctx.playerTeam}

CONVERSATION STATE: ${ctx.state}
${stateDescription[ctx.state]}
`;

  if (ctx.hasSubmittedPicks) {
    prompt += `This player has already submitted their picks for the week.\n`;
  }

  if (ctx.availableGames) {
    prompt += `\nAVAILABLE GAMES (the bet manager picks 3 of these):\n${ctx.availableGames}\n`;
  }
  if (ctx.selectedGames) {
    prompt += `\nTHIS WEEK'S GAMES (players pick a winner for each):\n${ctx.selectedGames}\n`;
  }

  prompt += `
You must reply with EXACTLY ONE JSON object and nothing else. No prose, no markdown fences.
Shape: {"type": "<action>", ...params}

Authorized actions:

1. {"type": "reply", "message": "<short reply>"}
   Use when the user is chatting, saying thanks, asking something off-task, or when their
   request is ambiguous and you need to ask a clarifying question. Keep "message" under 2
   short sentences. This is your fallback whenever no other action fits cleanly.

2. {"type": "show_standings"}
   User wants to see standings, records, win/loss, over-under pace, leaderboard, "how we doing".

3. {"type": "show_games"}
   User wants to see this week's matchups / schedule / what games are up.

4. {"type": "show_my_picks"}
   User wants to see their own picks for the current week.

5. {"type": "show_help"}
   User is asking what they can do, for help, for commands, or seems lost.

6. {"type": "select_weekly_games", "games": [<int>, <int>, <int>]}
   ONLY valid when state is "picking_games". User is choosing exactly 3 games from the
   AVAILABLE GAMES list. Numbers are the 1-based indices from that list. If the user
   refers to a team, city, or pitcher, convert it to the matching game number. If they
   give fewer than 3 or are ambiguous, use "reply" to ask which ones.

7. {"type": "submit_picks", "picks": [{"gameIndex": <int>, "team": "<name>"}, ...]}
   ONLY valid when state is "making_picks". User is choosing a winner for each of THIS
   WEEK'S GAMES. gameIndex is 1-based from that list. For "team", pass one of:
     - the team's common short name (e.g. "Cubs", "Dodgers", "Yankees")
     - "home" or "away" (the app resolves these against the game)
   If the user lists teams in order without numbering, map them to games 1..N in order.
   Only include a pick if the user actually named a team for that game.

Rules:
- Exactly ONE action per turn.
- Never invent picks, games, or teams the user didn't mention.
- If an action isn't allowed in the current state (e.g. submit_picks while idle), use
  "reply" with a brief, friendly explanation instead.
- Users can ask for standings / games / help / their picks from ANY state — those read-only
  actions don't interrupt a pending game-pick or pick-submission turn.
- Output must be valid JSON. No commentary before or after.
`;

  return prompt;
}

function defaultClarification(ctx: AssistantContext): string {
  if (ctx.state === 'picking_games') {
    return "Sorry, I didn't catch that. You're picking this week's 3 games — want me to resend the list?";
  }
  if (ctx.state === 'making_picks') {
    return "Sorry, I didn't catch that. Who are you picking? You can reply with team names or 'home'/'away'.";
  }
  return "Sorry, I didn't catch that. Try asking for 'standings', 'games', 'my picks', or 'help'.";
}

/**
 * Coerce a parsed JSON blob from the LLM into a safe AssistantAction.
 * Unknown / malformed shapes become a friendly `reply` asking for clarification.
 */
function validateAction(
  parsed: Record<string, unknown>,
  ctx: AssistantContext,
): AssistantAction {
  switch (parsed.type) {
    case 'show_standings':
    case 'show_games':
    case 'show_my_picks':
    case 'show_help':
      return { type: parsed.type };

    case 'select_weekly_games': {
      const games = parsed.games;
      if (Array.isArray(games) && games.every((g) => typeof g === 'number')) {
        return { type: 'select_weekly_games', games: games as number[] };
      }
      return { type: 'reply', message: defaultClarification(ctx) };
    }

    case 'submit_picks': {
      const picks = parsed.picks;
      if (
        Array.isArray(picks) &&
        picks.every(
          (p) =>
            p &&
            typeof p === 'object' &&
            typeof (p as Record<string, unknown>).gameIndex === 'number' &&
            typeof (p as Record<string, unknown>).team === 'string',
        )
      ) {
        return {
          type: 'submit_picks',
          picks: (picks as { gameIndex: number; team: string }[]).map((p) => ({
            gameIndex: p.gameIndex,
            team: p.team,
          })),
        };
      }
      return { type: 'reply', message: defaultClarification(ctx) };
    }

    case 'reply': {
      const message = parsed.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return { type: 'reply', message: message.trim() };
      }
      return { type: 'reply', message: defaultClarification(ctx) };
    }

    default:
      return { type: 'reply', message: defaultClarification(ctx) };
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
