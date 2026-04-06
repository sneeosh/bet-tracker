import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPlayers, addPlayer } from "../api";

const NL_CENTRAL_TEAMS = ["Pirates", "Cubs", "Brewers", "Cardinals", "Reds"];

const styles: Record<string, React.CSSProperties> = {
  section: { marginBottom: "32px" },
  heading: { fontSize: "18px", fontWeight: 600, marginBottom: "12px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
  th: { textAlign: "left", padding: "8px", borderBottom: "2px solid #ddd", fontWeight: 600 },
  td: { padding: "8px", borderBottom: "1px solid #eee" },
  badge: {
    display: "inline-block",
    padding: "2px 6px",
    background: "#1a1a2e",
    color: "#fff",
    borderRadius: "3px",
    fontSize: "11px",
  },
  form: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "360px" },
  label: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px" },
  input: { padding: "8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "14px" },
  select: { padding: "8px", border: "1px solid #ccc", borderRadius: "4px", fontSize: "14px" },
  button: {
    padding: "8px 16px",
    background: "#1a1a2e",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "14px",
  },
  checkRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" },
  error: { color: "red", fontSize: "13px" },
  empty: { color: "#888", fontStyle: "italic", fontSize: "14px" },
};

interface Player {
  id: string;
  name: string;
  phone: string;
  team_name: string;
  is_admin: boolean;
  rotation_order: number;
}

export default function Players() {
  const { id: leagueId } = useParams<{ id: string }>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [team, setTeam] = useState(NL_CENTRAL_TEAMS[0]);
  const [order, setOrder] = useState(1);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adding, setAdding] = useState(false);

  async function fetchPlayers() {
    if (!leagueId) return;
    try {
      const data = await getPlayers(leagueId);
      setPlayers(Array.isArray(data) ? data : data.players || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPlayers();
  }, [leagueId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!leagueId) return;
    setAdding(true);
    setError("");
    try {
      await addPlayer(leagueId, {
        name,
        phone,
        team_name: team,
        rotation_order: order,
        is_admin: isAdmin,
      });
      setName("");
      setPhone("");
      setTeam(NL_CENTRAL_TEAMS[0]);
      setOrder(players.length + 2);
      setIsAdmin(false);
      await fetchPlayers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <p>Loading players...</p>;

  return (
    <div>
      <section style={styles.section}>
        <h2 style={styles.heading}>Players</h2>
        {players.length === 0 ? (
          <p style={styles.empty}>No players yet. Add one below.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Phone</th>
                <th style={styles.th}>Team</th>
                <th style={styles.th}>Order</th>
                <th style={styles.th}>Role</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>{p.name}</td>
                  <td style={styles.td}>{p.phone}</td>
                  <td style={styles.td}>{p.team_name}</td>
                  <td style={styles.td}>{p.rotation_order}</td>
                  <td style={styles.td}>
                    {p.is_admin && <span style={styles.badge}>Admin</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Add Player</h2>
        <form onSubmit={handleAdd} style={styles.form}>
          <label style={styles.label}>
            Name
            <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Phone
            <input
              style={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1234567890"
              required
            />
          </label>
          <label style={styles.label}>
            Team
            <select style={styles.select} value={team} onChange={(e) => setTeam(e.target.value)}>
              {NL_CENTRAL_TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label style={styles.label}>
            Rotation Order
            <input
              style={styles.input}
              type="number"
              min={1}
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              required
            />
          </label>
          <div style={styles.checkRow}>
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} id="is-admin" />
            <label htmlFor="is-admin">Admin</label>
          </div>
          <button style={styles.button} type="submit" disabled={adding}>
            {adding ? "Adding..." : "Add Player"}
          </button>
          {error && <p style={styles.error}>{error}</p>}
        </form>
      </section>
    </div>
  );
}
