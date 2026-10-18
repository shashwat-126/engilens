import { useEffect, useState } from "react";
import { api, getToken, setToken, type Org, type Project, type User } from "./api";
import AuthScreen from "./components/AuthScreen";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import DocumentsPanel from "./components/DocumentsPanel";
import RepositoriesPanel from "./components/RepositoriesPanel";
import DependencyGraphPanel from "./components/DependencyGraphPanel";
import StatsBar from "./components/StatsBar";

type Tab = "chat" | "documents" | "repositories" | "dependencies";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("chat");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setRestoring(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setRestoring(false));
  }, []);

  if (restoring) return <div className="restoring">Loading…</div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  function selectProject(o: Org, p: Project) {
    setOrg(o);
    setProject(p);
    setTab("chat");
  }

  function logout() {
    setToken(null);
    setUser(null);
    setOrg(null);
    setProject(null);
  }

  return (
    <div className="app-shell">
      <Sidebar user={user} activeOrg={org} activeProject={project} onSelectProject={selectProject} onLogout={logout} />

      <main className="workspace">
        {!project ? (
          <div className="no-project">
            <h2>Select or create a project</h2>
            <p>Pick an organization on the left, then a project, to start indexing docs and asking questions.</p>
          </div>
        ) : (
          <>
            <header className="workspace-header">
              <div>
                <div className="breadcrumb">{org?.name}</div>
                <h1>{project.name}</h1>
              </div>
              <StatsBar project={project} />
            </header>

            <nav className="tabs">
              {(["chat", "documents", "repositories", "dependencies"] as Tab[]).map((t) => (
                <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                  {t === "chat"
                    ? "Chat"
                    : t === "documents"
                    ? "Documents"
                    : t === "repositories"
                    ? "Repositories"
                    : "Dependencies"}
                </button>
              ))}
            </nav>

            <div className="tab-content">
              {tab === "chat" && <ChatView project={project} />}
              {tab === "documents" && <DocumentsPanel project={project} />}
              {tab === "repositories" && <RepositoriesPanel project={project} />}
              {tab === "dependencies" && <DependencyGraphPanel project={project} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
