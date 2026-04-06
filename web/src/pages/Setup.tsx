import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createLeague } from "../api";

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
};

export default function Setup() {
  const navigate = useNavigate();
  const currentYear = new Date().getFullYear();

  const [name, setName] = useState("");
  const [season, setSeason] = useState(currentYear);
  const [division, setDivision] = useState("NL Central");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [existingId, setExistingId] = useState("");

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

  function handleGoToLeague(e: React.FormEvent) {
    e.preventDefault();
    if (existingId.trim()) {
      navigate(`/league/${existingId.trim()}`);
    }
  }

  return (
    <div>
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

      <section style={styles.section}>
        <h2 style={styles.heading}>Go to Existing League</h2>
        <form onSubmit={handleGoToLeague} style={{ ...styles.form, flexDirection: "row" as const }}>
          <input
            style={{ ...styles.input, flex: 1 }}
            value={existingId}
            onChange={(e) => setExistingId(e.target.value)}
            placeholder="Enter league ID"
          />
          <button style={styles.button} type="submit">
            Go
          </button>
        </form>
      </section>
    </div>
  );
}
