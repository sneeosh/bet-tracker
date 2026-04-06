import { Routes, Route, Link, useParams } from "react-router-dom";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import Players from "./pages/Players";

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: "24px",
    padding: "12px 24px",
    background: "#1a1a2e",
    color: "#fff",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    margin: 0,
  },
  nav: {
    display: "flex",
    gap: "16px",
  },
  link: {
    color: "#8ab4f8",
    textDecoration: "none",
    fontSize: "14px",
  },
  main: {
    padding: "24px",
    maxWidth: "960px",
    margin: "0 auto",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
};

function LeagueNav() {
  const { id } = useParams();
  if (!id) return null;
  return (
    <>
      <Link to={`/league/${id}`} style={styles.link}>Dashboard</Link>
      <Link to={`/league/${id}/players`} style={styles.link}>Players</Link>
    </>
  );
}

export default function App() {
  return (
    <div>
      <header style={styles.header}>
        <h1 style={styles.title}>Bet Tracker</h1>
        <nav style={styles.nav}>
          <Link to="/" style={styles.link}>Home</Link>
          <Routes>
            <Route path="/league/:id/*" element={<LeagueNav />} />
          </Routes>
        </nav>
      </header>
      <main style={styles.main}>
        <Routes>
          <Route path="/" element={<Setup />} />
          <Route path="/league/:id" element={<Dashboard />} />
          <Route path="/league/:id/players" element={<Players />} />
        </Routes>
      </main>
    </div>
  );
}
