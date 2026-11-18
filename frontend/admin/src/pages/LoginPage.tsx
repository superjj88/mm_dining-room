import { useState } from "react";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const mod = await import("../api/admin");
      await mod.login(usr, pwd);
      onLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <h1>🍽️ ניהול חדר אוכל</h1>
      <form className="login-panel" onSubmit={handleSubmit}>
        <h2>התחברות מנהל</h2>
        <input
          type="text"
          placeholder="שם משתמש"
          value={usr}
          onChange={(e) => setUsr(e.target.value)}
          required
          dir="ltr"
        />
        <input
          type="password"
          placeholder="סיסמה"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          required
          dir="ltr"
        />
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? "מתחבר..." : "כניסה"}
        </button>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </div>
  );
}
