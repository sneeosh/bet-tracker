/**
 * Fuzzy team name matching for SMS-based input.
 *
 * Users may text city names, abbreviations, nicknames, or partial names.
 * This module normalizes all of those into canonical MLB team names so
 * picks are stored consistently and compared correctly.
 */

// Canonical team name → all known aliases (lowercase)
const TEAM_ALIASES: Record<string, string[]> = {
  'Arizona Diamondbacks': ['diamondbacks', 'dbacks', 'd-backs', 'arizona', 'ari', 'az', 'snakes'],
  'Atlanta Braves': ['braves', 'atlanta', 'atl'],
  'Baltimore Orioles': ['orioles', 'baltimore', 'bal', 'os', 'birds'],
  'Boston Red Sox': ['red sox', 'redsox', 'boston', 'bos', 'sox'],
  'Chicago Cubs': ['cubs', 'chicago cubs', 'chc', 'cubbies'],
  'Chicago White Sox': ['white sox', 'whitesox', 'chicago white sox', 'chw', 'cws', 'chi sox', 'pale hose'],
  'Cincinnati Reds': ['reds', 'cincinnati', 'cin', 'cincy'],
  'Cleveland Guardians': ['guardians', 'cleveland', 'cle', 'guards'],
  'Colorado Rockies': ['rockies', 'colorado', 'col', 'rox'],
  'Detroit Tigers': ['tigers', 'detroit', 'det'],
  'Houston Astros': ['astros', 'houston', 'hou', 'stros'],
  'Kansas City Royals': ['royals', 'kansas city', 'kc', 'kcr'],
  'Los Angeles Angels': ['angels', 'la angels', 'laa', 'anaheim', 'halos'],
  'Los Angeles Dodgers': ['dodgers', 'la dodgers', 'lad', 'la'],
  'Miami Marlins': ['marlins', 'miami', 'mia', 'fish'],
  'Milwaukee Brewers': ['brewers', 'milwaukee', 'mil', 'brew crew'],
  'Minnesota Twins': ['twins', 'minnesota', 'min', 'twinkies'],
  'New York Mets': ['mets', 'ny mets', 'nym', 'amazins'],
  'New York Yankees': ['yankees', 'ny yankees', 'nyy', 'yanks', 'bronx bombers'],
  'Oakland Athletics': ['athletics', 'oakland', 'oak', 'as', "a's"],
  'Philadelphia Phillies': ['phillies', 'philadelphia', 'phi', 'philly', 'phils'],
  'Pittsburgh Pirates': ['pirates', 'pittsburgh', 'pit', 'bucs', 'buccos'],
  'San Diego Padres': ['padres', 'san diego', 'sd', 'sdp', 'friars'],
  'San Francisco Giants': ['giants', 'san francisco', 'sf', 'sfg'],
  'Seattle Mariners': ['mariners', 'seattle', 'sea', 'ms'],
  'St. Louis Cardinals': ['cardinals', 'st louis', 'st. louis', 'stl', 'cards', 'st louis cardinals'],
  'Tampa Bay Rays': ['rays', 'tampa bay', 'tampa', 'tb', 'tbr'],
  'Texas Rangers': ['rangers', 'texas', 'tex'],
  'Toronto Blue Jays': ['blue jays', 'bluejays', 'toronto', 'tor', 'jays'],
  'Washington Nationals': ['nationals', 'washington', 'was', 'wsh', 'nats'],
};

// Build reverse lookup: alias → canonical name
const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  // Also index the canonical name itself (lowercased)
  ALIAS_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

/**
 * Normalize an input string for comparison: lowercase, trim, strip punctuation.
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[.,!?'"]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Simple Levenshtein distance for short strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Try to match a user-provided team name against all known aliases.
 * Returns the canonical team name or null if no confident match.
 *
 * Matching strategy (in priority order):
 * 1. Exact alias match
 * 2. Alias starts-with or contains match
 * 3. Levenshtein distance ≤ 2 (catches typos like "Cubbs", "Dodegers")
 */
export function matchTeamName(input: string): string | null {
  const norm = normalize(input);
  if (!norm) return null;

  // 1. Exact match against aliases
  const exact = ALIAS_TO_CANONICAL.get(norm);
  if (exact) return exact;

  // 2. Check if input starts with or is contained in any alias (or vice versa)
  let bestContains: string | null = null;
  let bestContainsLen = Infinity;

  for (const [alias, canonical] of ALIAS_TO_CANONICAL) {
    if (alias.startsWith(norm) || norm.startsWith(alias)) {
      // Prefer shorter aliases (more specific matches)
      if (alias.length < bestContainsLen) {
        bestContains = canonical;
        bestContainsLen = alias.length;
      }
    }
  }
  if (bestContains) return bestContains;

  // 3. Levenshtein fuzzy match (only for inputs >= 3 chars to avoid false positives)
  if (norm.length >= 3) {
    let bestDist = Infinity;
    let bestMatch: string | null = null;

    for (const [alias, canonical] of ALIAS_TO_CANONICAL) {
      // Only compare against aliases of similar length to avoid nonsense matches
      if (Math.abs(alias.length - norm.length) > 3) continue;
      const dist = levenshtein(norm, alias);
      if (dist < bestDist && dist <= 2) {
        bestDist = dist;
        bestMatch = canonical;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

/**
 * Given a user input and the two teams in a game, resolve which team the user picked.
 *
 * Accepts:
 * - Team names (fuzzy matched)
 * - "home" / "away" / "h" / "a"
 * - The actual home/away team names from the game
 *
 * Returns the canonical team name from the game, or null if unresolvable.
 */
export function resolvePickedTeam(
  input: string,
  awayTeam: string,
  homeTeam: string,
): string | null {
  const norm = normalize(input);

  // Check home/away shorthand
  if (['home', 'h'].includes(norm)) return homeTeam;
  if (['away', 'a'].includes(norm)) return awayTeam;

  // Try fuzzy matching the input
  const matched = matchTeamName(input);
  if (!matched) return null;

  // Now check which game team it corresponds to
  // The game's team names might be partial (e.g. "Cubs" vs "Chicago Cubs")
  const awayCanonical = matchTeamName(awayTeam);
  const homeCanonical = matchTeamName(homeTeam);

  if (matched === awayCanonical) return awayTeam;
  if (matched === homeCanonical) return homeTeam;

  // Direct substring check as fallback
  const normAway = normalize(awayTeam);
  const normHome = normalize(homeTeam);
  const normMatched = normalize(matched);

  if (normMatched.includes(normAway) || normAway.includes(normMatched)) return awayTeam;
  if (normMatched.includes(normHome) || normHome.includes(normMatched)) return homeTeam;

  return null;
}

/**
 * Parse a simple comma/space-separated list of picks.
 * Handles inputs like:
 *   "Cubs, Pirates, Dodgers"
 *   "home away home"
 *   "h a h"
 *   "cubs pirates dodgers"
 */
export function parseSimplePicks(
  input: string,
  games: { awayTeam: string; homeTeam: string }[],
): { gameIndex: number; team: string }[] | null {
  const norm = normalize(input);

  // Split on commas, "and", or whitespace (but keep multi-word team names together)
  let parts: string[];

  if (norm.includes(',')) {
    parts = norm.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    // Split on " and " first, then check if we have the right count
    const andSplit = norm.split(/\band\b/).map((s) => s.trim()).filter(Boolean);
    if (andSplit.length === games.length) {
      parts = andSplit;
    } else {
      // Split on whitespace - works for single-word names and h/a shorthand
      parts = norm.split(/\s+/).filter(Boolean);
    }
  }

  if (parts.length !== games.length) return null;

  const picks: { gameIndex: number; team: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const resolved = resolvePickedTeam(parts[i], games[i].awayTeam, games[i].homeTeam);
    if (!resolved) return null; // Couldn't match one of the picks
    picks.push({ gameIndex: i + 1, team: resolved });
  }

  return picks;
}
