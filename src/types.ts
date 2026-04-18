export interface Env {
  DB: D1Database;
  AI: Ai;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  ODDS_API_KEY: string;
  ENVIRONMENT: string;
}

export interface League {
  id: number;
  name: string;
  sport: string;
  division: string;
  season: number;
  created_at: string;
}

export interface Player {
  id: number;
  league_id: number;
  name: string;
  phone: string;
  team_name: string;
  is_admin: number;
  rotation_order: number;
  created_at: string;
}

export interface SeasonLine {
  id: number;
  league_id: number;
  season: number;
  team_name: string;
  over_under_line: number;
  current_wins: number;
  current_losses: number;
}

export interface Week {
  id: number;
  league_id: number;
  week_number: number;
  season: number;
  bet_manager_id: number;
  games_locked: number;
  picks_deadline: string | null;
  created_at: string;
}

export interface WeeklyGame {
  id: number;
  week_id: number;
  mlb_game_id: number;
  game_date: string;
  game_time: string | null;
  away_team: string;
  home_team: string;
  away_pitcher: string | null;
  home_pitcher: string | null;
  winner: string | null;
  final_score: string | null;
}

export interface Pick {
  id: number;
  week_id: number;
  player_id: number;
  game_id: number;
  picked_team: string;
  is_correct: number | null;
}

export interface WeeklyResult {
  id: number;
  week_id: number;
  player_id: number;
  correct_picks: number;
  total_picks: number;
}

export interface Conversation {
  id: number;
  player_id: number;
  state: string;
  context: string | null;
  updated_at: string;
}

// MLB API types
export interface MlbGame {
  gamePk: number;
  gameDate: string;
  gameTime: string;
  awayTeam: string;
  homeTeam: string;
  awayPitcher: string | null;
  homePitcher: string | null;
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  winner: string | null;
}

// Tool-calling style assistant actions. The LLM sees the conversation context
// and emits exactly one of these to drive the app. `reply` is a free-form
// conversational response (clarifications, smalltalk, "not right now" replies).
export type AssistantAction =
  | { type: 'show_standings' }
  | { type: 'show_games' }
  | { type: 'show_my_picks' }
  | { type: 'show_help' }
  | { type: 'select_weekly_games'; games: number[] }
  | { type: 'submit_picks'; picks: { gameIndex: number; team: string }[] }
  | { type: 'reply'; message: string };

export type ConversationState = 'idle' | 'picking_games' | 'making_picks';
