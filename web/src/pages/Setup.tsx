import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createLeague, getLeagues } from "../api";

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: "32px" },
  heading: { fontSize: "18px", fontWeight: 600, marginBottom: "12px" },
  form: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "360px" },
  label: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" },
  input: { padding: "8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "14px" },
  button: {
    padding: "8px 16px",
    background: "#1a1a2e",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
  error: { color: "red", fontSize: "13px" },
  leagueList: { listStyle: "none", padding: 0, margin: 0 },
  leagueItem: {
    padding: "12px",
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leagueLink: {
    color: "#1a1a2e",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "15px",
  },
  leagueMeta: { color: "#888", fontSize: "13px" },
};

interface League {
  id: number;
  name: string;
  sport: string;
  division: string;
  season: number;
}

export default function Setup() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const [leagues, setLeagues] = useState<League[]>([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);

  const [name, setName] = useState("");
  const [season, setSeason] = useState(currentYear);
  const [division, setDivision] = useState("NL Central");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getLeagues()
      .then((data) => setLeagues(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingLeagues(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const league = await createLeague({ name, season, division });
      navigate(`/league/${league.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create league");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <section style={styles.section}>
        <h2 style={styles.heading}>Your Leagues</h2>
        {loadingLeagues ? (
          <p style={styles.leagueMeta}>Loading...</p>
        ) : leagues.length === 0 ? (
          <p style={styles.leagueMeta}>No leagues yet. Create one below.</p>
        ) : (
          <ul style={styles.leagueList}>
            {leagues.map((l) => (
              <li key={l.id} style={styles.leagueItem}>
                <Link to={`/league/${l.id}`} style={styles.leagueLink}>
                  {l.name}
                </Link>
                <span style={styles.leagueMeta}>
                  {l.division} &middot; {l.season}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Create a New League</h2>
        <form onSubmit={handleCreate} style={styles.form}>
          <label style={styles.label}>
            League Name
            <input
              style={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. NL Central 2026"
            />
          </label>
          <label style={styles.label}>
            Season
            <input
              style={styles.input}
              type="number"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              required
            />
          </label>
          <label style={styles.label}>
            Division
            <input
              style={styles.input}
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              required
            />
          </label>
          <button style={styles.button} type="submit" disabled={creating}>
            {creating ? "Creating..." : "Create League"}
          </button>
          {error && <p style={styles.error}>{error}</p>}
        </form>
      </section>
    </div>
  );
}
