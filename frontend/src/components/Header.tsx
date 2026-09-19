import { useState } from "react";
import type { ConnectionState } from "../types/usage";
import { authApi } from "../lib/authApi";

export default function Header({ connection }: { connection: ConnectionState }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const labels: Record<ConnectionState, string> = {
    live: "Live stream",
    connecting: "Connecting",
    offline: "Stream offline",
    demo: "Demo data",
  };

  async function logout() {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <b>R</b>
        <div><strong>Resolute Corp</strong><span>Claude Usage Admin</span></div>
      </div>
      <div className="head-actions">
        <div className={`connection ${connection}`}><i />{labels[connection]}</div>
        <button className="logout-button" onClick={logout} disabled={loggingOut} aria-label="Log out of Claude Usage Admin"><span aria-hidden="true">↪</span>{loggingOut ? "Logging out…" : "Logout"}</button>
        <button className="avatar" aria-label="Admin account">AD</button>
      </div>
    </header>
  );
}
