import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPlayers,
  getWeeks,
  fetchGames,
  adminCreateWeek,
  simulateResults,
  resolveWeek,
  advanceWeek,
  setRecords,
  endSeason,
  newSeason,
  resetConversations,
  deleteWeek,
  getCurrentWeek,
  getSeasonLines,
} from "../api";

const styles: Record<string, any> = {
  section: {
    marginBottom: "32px",
    padding: "16px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    background: "#fafafa",
  },
  heading: { fontSize: "16px", fontWeight: 600, marginBottom: "12px", marginTop: 0 },
  row: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" as const },
  input: {
    padding: "6px 8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "13px",
  },
  btn: {
    padding: "6px 14px",
    background: "#1a1a2e",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    whiteSpace: "nowrap" as const,
  },
  btnDanger: {
    padding: "6px 14px",
    background: "#c0392b",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    whiteSpace: "nowrap" as const,
  },
  btnOutline: {
    padding: "6px 14px",
    background: "#fff",
    color: "#1a1a2e",
    border: "1px solid #1a1a2e",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    whiteSpace: "nowrap" as const,
  },
  label: { fontSize: "13px", fontWeight: 500, minWidth: "80px" },
  status: { fontSize: "13px", marginTop: "8px" },
  success: { color: "#155724", fontSize: "13px", marginTop: "8px" },
  error: { color: "#c0392b", fontSize: "13px", marginTop: "8px" },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px", marginTop: "8px" },
  th: { textAlign: "left" as const, padding: "6px 8px", borderBottom: "2px solid #ddd", fontWeight: 600, fontSize: "12px" },
  td: { padding: "6px 8px", borderBottom: "1px solid #eee" },
  check: { width: "16px", height: "16px", cursor: "pointer" },
  pre: { background: "#f0f0f0", padding: "8px", borderRadius: "4px", fontSize: "12px", overflow: "auto", maxHeight: "200px" },
};

export default function AdminTools() {
  const { id: leagueId } = useParams<{ id: string }>();

  // Players for selectors
  const [players, setPlayers] = useState<any[]>([]);
  const [weeks, setWeeks] = useState<any[]>([]);
  const [currentWeekData, setCurrentWeekData] = useState<any>(null);
  const [seasonLines, setSeasonLines] = useState<any[]>([]);

  // Fetch Games state
  const [fetchStartDate, setFetchStartDate] = useState("");
  const [fetchEndDate, setFetchEndDate] = useState("");
  const [fetchedGames, setFetchedGames] = useState<any[]>([]);
  const [selectedGameIdxs, setSelectedGameIdxs] = useState<Set<number>>(new Set());
  const [fetchMsg, setFetchMsg] = useState("");

  // Create Week state
  const [createBetManagerId, setCreateBetManagerId] = useState<number>(0);
  const [createMsg, setCreateMsg] = useState("");

  // Simulate Results state
  const [simResults, setSimResults] = useState<Record<number, string>>({});
  const [simMsg, setSimMsg] = useState("");

  // Advance Week state
  const [advStartDate, setAdvStartDate] = useState("");
  const [advEndDate, setAdvEndDate] = useState("");
  const [advMsg, setAdvMsg] = useState("");

  // Set Records state
  const [recordInputs, setRecordInputs] = useState<Record<string, { wins: string; losses: string }>>({});
  const [recordsMsg, setRecordsMsg] = useState("");

  // Season state
  const [newSeasonYear, setNewSeasonYear] = useState("");
  const [seasonMsg, setSeasonMsg] = useState("");

  // General
  const [loading, setLoading] = useState(true);
  const [actionLog, setActionLog] = useState<string[]>([]);

  function log(msg: string) {
    setActionLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }

  async function loadData() {
    if (!leagueId) return;
    try {
      const [playersData, weeksData, weekData, linesData] = await Promise.all([
        getPlayers(leagueId).catch(() => []),
        getWeeks(leagueId).catch(() => []),
        getCurrentWeek(leagueId).catch(() => null),
        getSeasonLines(leagueId).catch(() => []),
      ]);
      setPlayers(Array.isArray(playersData) ? playersData : []);
      setWeeks(Array.isArray(weeksData) ? weeksData : []);
      setCurrentWeekData(weekData);
      setSeasonLines(Array.isArray(linesData) ? linesData : []);

      // Init record inputs
      const ri: Record<string, { wins: string; losses: string }> = {};
      for (const line of (Array.isArray(linesData) ? linesData : [])) {
        ri[line.team_name] = { wins: String(line.current_wins || 0), losses: String(line.current_losses || 0) };
      }
      setRecordInputs(ri);

      if (playersData?.[0] && !createBetManagerId) {
        setCreateBetManagerId(playersData[0].id);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [leagueId]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  async function handleFetchGames() {
    if (!leagueId || !fetchStartDate || !fetchEndDate) return;
    setFetchMsg("Fetching...");
    try {
      const data = await fetchGames(leagueId, fetchStartDate, fetchEndDate);
      setFetchedGames(data.games || []);
      setSelectedGameIdxs(new Set());
      setFetchMsg(`Found ${data.count} games`);
      log(`Fetched ${data.count} MLB games for ${fetchStartDate} to ${fetchEndDate}`);
    } catch (err: any) {
      setFetchMsg(err.message);
    }
  }

  function toggleGame(idx: number) {
    setSelectedGameIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleCreateWeek() {
    if (!leagueId) return;
    const games = Array.from(selectedGameIdxs).map((idx) => fetchedGames[idx]);
    if (games.length === 0) {
      setCreateMsg("Select at least 1 game");
      return;
    }
    setCreateMsg("Creating...");
    try {
      const data = await adminCreateWeek(leagueId, { betManagerId: createBetManagerId, games });
      setCreateMsg(`Week ${data.week.week_number} created with ${data.games.length} games`);
      log(`Created week ${data.week.week_number} with ${data.games.length} games`);
      await loadData();
    } catch (err: any) {
      setCreateMsg(err.message);
    }
  }

  async function handleSimulateResults() {
    if (!leagueId) return;
    const results = Object.entries(simResults)
      .filter(([_, winner]) => winner)
      .map(([gameId, winner]) => ({ gameId: Number(gameId), winner: winner as string }));
    if (results.length === 0) {
      setSimMsg("Set at least 1 winner");
      return;
    }
    setSimMsg("Simulating...");
    try {
      const data = await simulateResults(leagueId, results);
      setSimMsg(data.message);
      log(`Simulated ${results.length} game result(s)`);
      await loadData();
    } catch (err: any) {
      setSimMsg(err.message);
    }
  }

  async function handleResolveWeek() {
    if (!leagueId) return;
    try {
      const data = await resolveWeek(leagueId);
      log(`Resolved week ${data.week.week_number}: ${data.results.length} player results`);
      setSimMsg(`Week resolved. ${data.results.length} player results calculated.`);
      await loadData();
    } catch (err: any) {
      setSimMsg(err.message);
    }
  }

  async function handleAdvanceWeek() {
    if (!leagueId) return;
    setAdvMsg("Advancing...");
    try {
      const data = await advanceWeek(leagueId, {
        startDate: advStartDate || undefined,
        endDate: advEndDate || undefined,
      });
      setAdvMsg(data.message);
      log(data.message);
      await loadData();
    } catch (err: any) {
      setAdvMsg(err.message);
    }
  }

  async function handleSetRecords() {
    if (!leagueId) return;
    const records = Object.entries(recordInputs).map(([teamName, r]: [string, { wins: string; losses: string }]) => ({
      teamName,
      wins: parseInt(r.wins) || 0,
      losses: parseInt(r.losses) || 0,
    }));
    setRecordsMsg("Saving...");
    try {
      await setRecords(leagueId, records);
      setRecordsMsg("Records updated");
      log(`Updated ${records.length} team records`);
      await loadData();
    } catch (err: any) {
      setRecordsMsg(err.message);
    }
  }

  async function handleEndSeason() {
    if (!leagueId) return;
    if (!confirm("End the current season? This will cancel unresolved games.")) return;
    setSeasonMsg("Ending season...");
    try {
      const data = await endSeason(leagueId);
      setSeasonMsg(data.message);
      log(data.message);
      await loadData();
    } catch (err: any) {
      setSeasonMsg(err.message);
    }
  }

  async function handleNewSeason() {
    if (!leagueId || !newSeasonYear) return;
    setSeasonMsg("Starting season...");
    try {
      const data = await newSeason(leagueId, parseInt(newSeasonYear));
      setSeasonMsg(data.message);
      log(data.message);
      await loadData();
    } catch (err: any) {
      setSeasonMsg(err.message);
    }
  }

  async function handleResetConversations() {
    if (!leagueId) return;
    try {
      const data = await resetConversations(leagueId);
      log(data.message);
    } catch (err: any) {
      log(`Error: ${err.message}`);
    }
  }

  async function handleDeleteWeek(weekId: number) {
    if (!leagueId) return;
    if (!confirm(`Delete week ${weekId}? This removes all games, picks, and results.`)) return;
    try {
      await deleteWeek(leagueId, weekId);
      log(`Deleted week ${weekId}`);
      await loadData();
    } catch (err: any) {
      log(`Error: ${err.message}`);
    }
  }

  if (loading) return <p>Loading admin tools...</p>;

  const currentGames = currentWeekData?.games || [];

  return (
    <div>
      <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>Admin Testing Tools</h2>

      {/* Fetch MLB Games */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Fetch MLB Games</h3>
        <div style={styles.row}>
          <span style={styles.label}>Start:</span>
          <input type="date" value={fetchStartDate} onChange={(e) => setFetchStartDate(e.target.value)} style={styles.input} />
          <span style={styles.label}>End:</span>
          <input type="date" value={fetchEndDate} onChange={(e) => setFetchEndDate(e.target.value)} style={styles.input} />
          <button onClick={handleFetchGames} style={styles.btn}>Fetch Games</button>
        </div>
        {fetchMsg && <p style={styles.status}>{fetchMsg}</p>}
        {fetchedGames.length > 0 && (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}></th>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Away</th>
                  <th style={styles.th}>Home</th>
                  <th style={styles.th}>Pitchers</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {fetchedGames.map((g, idx) => (
                  <tr key={idx} style={{ background: selectedGameIdxs.has(idx) ? "#e8f5e9" : "transparent" }}>
                    <td style={styles.td}>
                      <input type="checkbox" checked={selectedGameIdxs.has(idx)} onChange={() => toggleGame(idx)} style={styles.check} />
                    </td>
                    <td style={styles.td}>{g.gameDate}</td>
                    <td style={styles.td}>{g.awayTeam}</td>
                    <td style={styles.td}>{g.homeTeam}</td>
                    <td style={styles.td}>{g.awayPitcher || "TBD"} vs {g.homePitcher || "TBD"}</td>
                    <td style={styles.td}>{g.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ ...styles.row, marginTop: "12px" }}>
              <span style={styles.label}>Bet Mgr:</span>
              <select
                value={createBetManagerId}
                onChange={(e) => setCreateBetManagerId(Number(e.target.value))}
                style={{ ...styles.input, minWidth: "140px" }}
              >
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button onClick={handleCreateWeek} style={styles.btn}>
                Create Week ({selectedGameIdxs.size} games)
              </button>
            </div>
            {createMsg && <p style={styles.status}>{createMsg}</p>}
          </>
        )}
      </section>

      {/* Simulate Game Results */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Simulate Game Results</h3>
        {currentGames.length === 0 ? (
          <p style={{ color: "#888", fontSize: "13px" }}>No games in current week.</p>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Game</th>
                  <th style={styles.th}>Current Result</th>
                  <th style={styles.th}>Set Winner</th>
                </tr>
              </thead>
              <tbody>
                {currentGames.map((g: any) => (
                  <tr key={g.id}>
                    <td style={styles.td}>{g.away_team} @ {g.home_team} ({g.game_date})</td>
                    <td style={styles.td}>
                      {g.winner ? `${g.winner} (${g.final_score})` : "Pending"}
                    </td>
                    <td style={styles.td}>
                      <select
                        value={simResults[g.id] || ""}
                        onChange={(e) => setSimResults((prev) => ({ ...prev, [g.id]: e.target.value }))}
                        style={{ ...styles.input, minWidth: "160px" }}
                      >
                        <option value="">-- pick winner --</option>
                        <option value={g.away_team}>{g.away_team}</option>
                        <option value={g.home_team}>{g.home_team}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ ...styles.row, marginTop: "12px" }}>
              <button onClick={handleSimulateResults} style={styles.btn}>Simulate Results</button>
              <button onClick={handleResolveWeek} style={styles.btnOutline}>Force Resolve Week</button>
            </div>
            {simMsg && <p style={styles.status}>{simMsg}</p>}
          </>
        )}
      </section>

      {/* Advance Week */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Advance Week</h3>
        <p style={{ fontSize: "13px", color: "#666", margin: "0 0 8px" }}>
          Creates the next week and assigns the next bet manager in rotation. Optionally fetch games for the date range.
        </p>
        <div style={styles.row}>
          <span style={styles.label}>Games from:</span>
          <input type="date" value={advStartDate} onChange={(e) => setAdvStartDate(e.target.value)} style={styles.input} />
          <span style={styles.label}>to:</span>
          <input type="date" value={advEndDate} onChange={(e) => setAdvEndDate(e.target.value)} style={styles.input} />
          <button onClick={handleAdvanceWeek} style={styles.btn}>Advance Week</button>
        </div>
        {advMsg && <p style={styles.status}>{advMsg}</p>}
      </section>

      {/* Set Team Records */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Set Team Records</h3>
        {seasonLines.length === 0 ? (
          <p style={{ color: "#888", fontSize: "13px" }}>No season lines configured.</p>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Team</th>
                  <th style={styles.th}>Wins</th>
                  <th style={styles.th}>Losses</th>
                  <th style={styles.th}>O/U Line</th>
                </tr>
              </thead>
              <tbody>
                {seasonLines.map((line: any) => (
                  <tr key={line.team_name}>
                    <td style={styles.td}>{line.team_name}</td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        value={recordInputs[line.team_name]?.wins || "0"}
                        onChange={(e) => setRecordInputs((prev) => ({
                          ...prev,
                          [line.team_name]: { ...prev[line.team_name], wins: e.target.value },
                        }))}
                        style={{ ...styles.input, width: "60px" }}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        type="number"
                        value={recordInputs[line.team_name]?.losses || "0"}
                        onChange={(e) => setRecordInputs((prev) => ({
                          ...prev,
                          [line.team_name]: { ...prev[line.team_name], losses: e.target.value },
                        }))}
                        style={{ ...styles.input, width: "60px" }}
                      />
                    </td>
                    <td style={styles.td}>{line.over_under_line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ ...styles.row, marginTop: "12px" }}>
              <button onClick={handleSetRecords} style={styles.btn}>Save Records</button>
            </div>
            {recordsMsg && <p style={styles.status}>{recordsMsg}</p>}
          </>
        )}
      </section>

      {/* Season Management */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Season Management</h3>
        <div style={styles.row}>
          <button onClick={handleEndSeason} style={styles.btnDanger}>End Current Season</button>
          <span style={{ color: "#888", fontSize: "12px" }}>Cancels unresolved games, finalizes standings</span>
        </div>
        <div style={{ ...styles.row, marginTop: "12px" }}>
          <span style={styles.label}>New season:</span>
          <input
            type="number"
            placeholder="e.g. 2027"
            value={newSeasonYear}
            onChange={(e) => setNewSeasonYear(e.target.value)}
            style={{ ...styles.input, width: "80px" }}
          />
          <button onClick={handleNewSeason} style={styles.btn}>Start New Season</button>
        </div>
        {seasonMsg && <p style={styles.status}>{seasonMsg}</p>}
      </section>

      {/* Utilities */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Utilities</h3>
        <div style={styles.row}>
          <button onClick={handleResetConversations} style={styles.btnOutline}>Reset All Conversations</button>
          <span style={{ color: "#888", fontSize: "12px" }}>Sets all players back to idle state</span>
        </div>
      </section>

      {/* Week History */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Week History</h3>
        {weeks.length === 0 ? (
          <p style={{ color: "#888", fontSize: "13px" }}>No weeks yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Week</th>
                <th style={styles.th}>Bet Manager</th>
                <th style={styles.th}>Locked</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w: any) => (
                <tr key={w.id}>
                  <td style={styles.td}>Week {w.week_number}</td>
                  <td style={styles.td}>{w.bet_manager_name || `Player #${w.bet_manager_id}`}</td>
                  <td style={styles.td}>{w.games_locked ? "Yes" : "No"}</td>
                  <td style={styles.td}>{new Date(w.created_at).toLocaleDateString()}</td>
                  <td style={styles.td}>
                    <button onClick={() => handleDeleteWeek(w.id)} style={{ ...styles.btnDanger, padding: "3px 8px", fontSize: "12px" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Action Log */}
      <section style={styles.section}>
        <h3 style={styles.heading}>Action Log</h3>
        {actionLog.length === 0 ? (
          <p style={{ color: "#888", fontSize: "13px" }}>No actions yet.</p>
        ) : (
          <div style={styles.pre}>
            {actionLog.map((entry, i) => (
              <div key={i}>{entry}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
