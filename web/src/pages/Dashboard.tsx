import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getStandings, getCurrentWeek } from "../api";

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: "32px" },
  heading: { fontSize: "18px", fontWeight: 600, marginBottom: "12px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { textAlign: "left", padding: "8px", borderBottom: "2px solid #ddd", fontWeight: 600 },
  td: { padding: "8px", borderBottom: "1px solid #eee" },
  subheading: { fontSize: "15px", fontWeight: 600, margin: "16px 0 8px" },
  info: { fontSize: "14px", margin: "4px 0" },
  empty: { color: "#888", fontStyle: "italic", fontSize: "14px" },
  error: { color: "red", fontSize: "13px" },
  pill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "12px",
    fontWeight: 600,
  },
};

interface SeasonLine {
  team: string;
  player_name?: string;
  wins: number;
  losses: number;
  over_under_line: number;
  over_under_diff: number;
}

interface WeekData {
  week_number: number;
  bet_manager_name?: string;
  games?: { home: string; away: string; date: string }[];
  picks?: { player_name: string; submitted: boolean }[];
}

export default function Dashboard() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [standings, setStandings] = useState<SeasonLine[]>([]);
  const [week, setWeek] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leagueId) return;

    async function load() {
      try {
        const [standingsData, weekData] = await Promise.all([
          getStandings(leagueId!).catch(() => []),
          getCurrentWeek(leagueId!).catch(() => null),
        ]);
        // Map API response shape to the flat SeasonLine[] the UI expects
        const lines: SeasonLine[] = [];
        if (standingsData?.seasonLines) {
          const players: Record<string, string> = {};
          if (standingsData.league && Array.isArray(standingsData.playerStandings)) {
            // We don't have team→player mapping on seasonLines, so build it from players list if available
          }
          for (const sl of standingsData.seasonLines) {
            lines.push({
              team: sl.team_name ?? sl.team ?? '',
              player_name: sl.player_name,
              wins: sl.current_wins ?? sl.wins ?? 0,
              losses: sl.current_losses ?? sl.losses ?? 0,
              over_under_line: sl.over_under_line ?? 0,
              over_under_diff: sl.overUnderDiff ?? sl.over_under_diff ?? 0,
            });
          }
        } else if (Array.isArray(standingsData)) {
          lines.push(...standingsData);
        }
        setStandings(lines);
        setWeek(weekData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [leagueId]);

  if (loading) return <p>Loading dashboard...</p>;
  if (error) return <p style={styles.error}>{error}</p>;

  // Sort standings by total wins descending for ranking
  const ranked = [...standings].sort((a, b) => b.wins - a.wins);

  return (
    <div>
      <section style={styles.section}>
        <h2 style={styles.heading}>Season Standings</h2>
        {standings.length === 0 ? (
          <p style={styles.empty}>No standings data yet. Set season lines and play some weeks first.</p>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Team</th>
                  <th style={styles.th}>Player</th>
                  <th style={styles.th}>W-L</th>
                  <th style={styles.th}>O/U Line</th>
                  <th style={styles.th}>O/U Diff</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((line, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{line.team}</td>
                    <td style={styles.td}>{line.player_name || "-"}</td>
                    <td style={styles.td}>
                      {line.wins}-{line.losses}
                    </td>
                    <td style={styles.td}>{line.over_under_line}</td>
                    <td style={styles.td}>
                      <span
                        style={{
                          ...styles.pill,
                          background: line.over_under_diff > 0 ? "#d4edda" : line.over_under_diff < 0 ? "#f8d7da" : "#e2e3e5",
                          color: line.over_under_diff > 0 ? "#155724" : line.over_under_diff < 0 ? "#721c24" : "#383d41",
                        }}
                      >
                        {line.over_under_diff > 0 ? "+" : ""}
                        {line.over_under_diff}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={styles.subheading}>Total Wins Ranking</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Team</th>
                  <th style={styles.th}>Wins</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((line, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{i + 1}</td>
                    <td style={styles.td}>{line.team}</td>
                    <td style={styles.td}>{line.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Current Week</h2>
        {!week ? (
          <p style={styles.empty}>No active week.</p>
        ) : (
          <>
            <p style={styles.info}>
              <strong>Week {week.week_number}</strong>
            </p>
            <p style={styles.info}>
              Bet Manager: {week.bet_manager_name || "Not assigned"}
            </p>

            {week.games && week.games.length > 0 && (
              <>
                <h3 style={styles.subheading}>Selected Games</h3>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Away</th>
                      <th style={styles.th}>Home</th>
                      <th style={styles.th}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.games.map((g, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{g.away}</td>
                        <td style={styles.td}>{g.home}</td>
                        <td style={styles.td}>{g.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {week.picks && week.picks.length > 0 && (
              <>
                <h3 style={styles.subheading}>Picks Status</h3>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Player</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {week.picks.map((p, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{p.player_name}</td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.pill,
                              background: p.submitted ? "#d4edda" : "#fff3cd",
                              color: p.submitted ? "#155724" : "#856404",
                            }}
                          >
                            {p.submitted ? "Submitted" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
