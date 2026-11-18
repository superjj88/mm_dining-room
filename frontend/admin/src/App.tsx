import { useEffect, useState } from "react";
import { getSession, logout } from "./api/admin";
import LoginPage from "./pages/LoginPage";
import DinersPage from "./pages/DinersPage";
import ProcurementPage from "./pages/ProcurementPage";
import DailyMenuPage from "./pages/DailyMenuPage";
import RecipesPage from "./pages/RecipesPage";
import ShiftsPage from "./pages/ShiftsPage";
import type { Session } from "./types";

type Tab = "diners" | "procurement" | "recipes" | "daily" | "shifts";

const TABS: { key: Tab; label: string }[] = [
  { key: "diners", label: "סועדים" },
  { key: "procurement", label: "רכש" },
  { key: "recipes", label: "מתכונים" },
  { key: "daily", label: "תפריט יומי" },
  { key: "shifts", label: "משמרות וייצוא" },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("diners");

  const checkSession = async () => {
    try {
      const s = await getSession();
      if (s.user && s.user !== "Guest") {
        setSession(s);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkSession();
  }, []);

  const handleLogout = async () => {
    await logout();
    setSession(null);
    setActiveTab("diners");
  };

  if (loading) {
    return (
      <div className="admin-root" dir="rtl">
        <div className="loading">טוען...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div dir="rtl">
        <LoginPage onLogin={checkSession} />
      </div>
    );
  }

  return (
    <div className="admin-root" dir="rtl">
      <header className="admin-header">
        <h1>🍽️ ניהול חדר אוכל</h1>
        <div className="user">
          {session.user} |{" "}
          <button className="btn-secondary btn-small" onClick={handleLogout}>
            יציאה
          </button>
        </div>
      </header>

      <nav className="admin-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={activeTab === t.key ? "active" : ""}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="admin-body">
        {activeTab === "diners" && <DinersPage />}
        {activeTab === "procurement" && <ProcurementPage />}
        {activeTab === "recipes" && <RecipesPage />}
        {activeTab === "daily" && <DailyMenuPage />}
        {activeTab === "shifts" && <ShiftsPage />}
      </main>
    </div>
  );
}
