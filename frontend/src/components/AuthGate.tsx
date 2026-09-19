import { useEffect, useState } from "react";
import App from "../App";
import { authApi, type AdminUser } from "../lib/authApi";
import LoginPage from "./LoginPage";

export default function AuthGate() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.session()
      .then(value => {
        setUser(value);
        if (value && location.pathname === "/login") {
          history.replaceState(null, "", "/");
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="auth-loading" aria-label="Checking access"><span /></main>;
  return user ? <App /> : <LoginPage onAuthenticated={setUser} />;
}
