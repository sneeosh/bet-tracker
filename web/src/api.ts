const BASE = "/api";

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function getLeagues() {
  return request("/leagues");
}

export function createLeague(data: { name: string; season: number; division: string }) {
  return request("/leagues", { method: "POST", body: JSON.stringify(data) });
}

export function getLeague(id: string) {
  return request(`/leagues/${id}`);
}

export function getPlayers(leagueId: string) {
  return request(`/leagues/${leagueId}/players`);
}

export function addPlayer(
  leagueId: string,
  data: { name: string; phone: string; team_name: string; rotation_order: number; is_admin: boolean }
) {
  const payload = {
    name: data.name,
    phone: data.phone,
    teamName: data.team_name,
    rotationOrder: data.rotation_order,
    isAdmin: data.is_admin,
  };
  return request(`/leagues/${leagueId}/players`, { method: "POST", body: JSON.stringify(payload) });
}

export function getSeasonLines(leagueId: string) {
  return request(`/leagues/${leagueId}/season-lines`);
}

export function setSeasonLines(leagueId: string, lines: unknown) {
  return request(`/leagues/${leagueId}/season-lines`, { method: "POST", body: JSON.stringify(lines) });
}

export function getStandings(leagueId: string) {
  return request(`/leagues/${leagueId}/standings`);
}

export function getCurrentWeek(leagueId: string) {
  return request(`/leagues/${leagueId}/current-week`);
}

// ─── Admin Testing Tools ────────────────────────────────────────────────────

export function getWeeks(leagueId: string) {
  return request(`/admin/leagues/${leagueId}/weeks`);
}

export function fetchGames(leagueId: string, startDate: string, endDate: string) {
  return request(`/admin/leagues/${leagueId}/fetch-games?startDate=${startDate}&endDate=${endDate}`);
}

export function adminCreateWeek(
  leagueId: string,
  data: { betManagerId: number; games: any[]; picksDeadline?: string }
) {
  return request(`/admin/leagues/${leagueId}/create-week`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function simulateResults(leagueId: string, results: { gameId: number; winner: string; finalScore?: string }[]) {
  return request(`/admin/leagues/${leagueId}/simulate-results`, {
    method: "POST",
    body: JSON.stringify({ results }),
  });
}

export function resolveWeek(leagueId: string) {
  return request(`/admin/leagues/${leagueId}/resolve-week`, { method: "POST" });
}

export function advanceWeek(leagueId: string, data?: { startDate?: string; endDate?: string }) {
  return request(`/admin/leagues/${leagueId}/advance-week`, {
    method: "POST",
    body: JSON.stringify(data || {}),
  });
}

export function setRecords(leagueId: string, records: { teamName: string; wins: number; losses: number }[]) {
  return request(`/admin/leagues/${leagueId}/set-records`, {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

export function endSeason(leagueId: string) {
  return request(`/admin/leagues/${leagueId}/end-season`, { method: "POST" });
}

export function newSeason(leagueId: string, season: number) {
  return request(`/admin/leagues/${leagueId}/new-season`, {
    method: "POST",
    body: JSON.stringify({ season }),
  });
}

export function resetConversations(leagueId: string) {
  return request(`/admin/leagues/${leagueId}/reset-conversations`, { method: "POST" });
}

export function deleteWeek(leagueId: string, weekId: number) {
  return request(`/admin/leagues/${leagueId}/weeks/${weekId}`, { method: "DELETE" });
}
