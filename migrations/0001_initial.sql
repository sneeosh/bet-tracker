-- League and user management
CREATE TABLE IF NOT EXISTS leagues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'mlb',
  division TEXT NOT NULL DEFAULT 'NL Central',
  season INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  rotation_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Season-long over/under lines
CREATE TABLE IF NOT EXISTS season_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season INTEGER NOT NULL,
  team_name TEXT NOT NULL,
  over_under_line REAL NOT NULL,
  current_wins INTEGER NOT NULL DEFAULT 0,
  current_losses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(league_id, season, team_name)
);

-- Weekly game picking
CREATE TABLE IF NOT EXISTS weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  week_number INTEGER NOT NULL,
  season INTEGER NOT NULL,
  bet_manager_id INTEGER NOT NULL REFERENCES players(id),
  games_locked INTEGER NOT NULL DEFAULT 0,
  picks_deadline TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(league_id, season, week_number)
);

CREATE TABLE IF NOT EXISTS weekly_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  mlb_game_id INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  game_time TEXT,
  away_team TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_pitcher TEXT,
  home_pitcher TEXT,
  winner TEXT,
  final_score TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  game_id INTEGER NOT NULL REFERENCES weekly_games(id),
  picked_team TEXT NOT NULL,
  is_correct INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(week_id, player_id, game_id)
);

-- Weekly pick results
CREATE TABLE IF NOT EXISTS weekly_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id INTEGER NOT NULL REFERENCES weeks(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  correct_picks INTEGER NOT NULL DEFAULT 0,
  total_picks INTEGER NOT NULL DEFAULT 0,
  UNIQUE(week_id, player_id)
);

-- Conversation state for SMS flows
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL UNIQUE REFERENCES players(id),
  state TEXT NOT NULL DEFAULT 'idle',
  context TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_players_phone ON players(phone);
CREATE INDEX IF NOT EXISTS idx_players_league ON players(league_id);
CREATE INDEX IF NOT EXISTS idx_weeks_league_season ON weeks(league_id, season);
CREATE INDEX IF NOT EXISTS idx_picks_week_player ON picks(week_id, player_id);
CREATE INDEX IF NOT EXISTS idx_conversations_player ON conversations(player_id);
