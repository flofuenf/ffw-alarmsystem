import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import Planung from "./pages/Planung.jsx";
import Monitor from "./pages/Monitor.jsx";

export default function App() {
  return (
    <Routes>
      {/* Monitor laeuft im Vollbild ohne globale Navigation */}
      <Route path="/monitor" element={<Monitor />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}

function Shell() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">🚒</span>
          <span>FFW Alarmsystem</span>
        </div>
        <nav className="mainnav">
          <NavLink to="/planung">Planung &amp; Alarmierung</NavLink>
          <NavLink to="/monitor" target="_blank" rel="noreferrer">
            Alarmmonitor ↗
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/planung" replace />} />
          <Route path="/planung" element={<Planung />} />
          <Route path="*" element={<Navigate to="/planung" replace />} />
        </Routes>
      </main>
    </div>
  );
}
