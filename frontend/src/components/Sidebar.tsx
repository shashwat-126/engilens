import { useEffect, useState } from "react";
import { api, type Org, type Project, type User } from "../api";

export default function Sidebar({
  user,
  activeOrg,
  activeProject,
  onSelectProject,
  onLogout,
}: {
  user: User;
  activeOrg: Org | null;
  activeProject: Project | null;
  onSelectProject: (org: Org, project: Project) => void;
  onLogout: () => void;
}) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [projectsByOrg, setProjectsByOrg] = useState<Record<string, Project[]>>({});
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewOrg, setShowNewOrg] = useState(false);

  async function refreshOrgs() {
    const list = await api.listOrgs();
    setOrgs(list);
    if (!expandedOrg && list.length) setExpandedOrg(list[0].id);
  }

  useEffect(() => {
    refreshOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleOrg(org: Org) {
    const next = expandedOrg === org.id ? null : org.id;
    setExpandedOrg(next);
    if (next && !projectsByOrg[org.id]) {
      const projects = await api.listProjects(org.id);
      setProjectsByOrg((p) => ({ ...p, [org.id]: projects }));
    }
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    const org = await api.createOrg(newOrgName.trim());
    setNewOrgName("");
    setShowNewOrg(false);
    await refreshOrgs();
    setExpandedOrg(org.id);
  }

  async function createProject(orgId: string) {
    if (!newProjectName.trim()) return;
    const project = await api.createProject(orgId, newProjectName.trim());
    setNewProjectName("");
    const projects = await api.listProjects(orgId);
    setProjectsByOrg((p) => ({ ...p, [orgId]: projects }));
    const org = orgs.find((o) => o.id === orgId);
    if (org) onSelectProject(org, project);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-glyph">{"{ }"}</span>
        <span>Eng Copilot</span>
      </div>

      <nav className="org-tree">
        {orgs.map((org) => (
          <div key={org.id} className="org-node">
            <button className="org-row" onClick={() => toggleOrg(org)}>
              <span className={`chevron ${expandedOrg === org.id ? "open" : ""}`}>▸</span>
              <span className="org-name">{org.name}</span>
              <span className="org-role">{org.role}</span>
            </button>
            {expandedOrg === org.id && (
              <div className="project-list">
                {(projectsByOrg[org.id] ?? []).map((project) => (
                  <button
                    key={project.id}
                    className={`project-row ${activeProject?.id === project.id ? "active" : ""}`}
                    onClick={() => onSelectProject(org, project)}
                  >
                    {project.name}
                  </button>
                ))}
                <form
                  className="inline-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createProject(org.id);
                  }}
                >
                  <input
                    placeholder="New project…"
                    value={activeOrg?.id === org.id ? newProjectName : ""}
                    onFocus={() => setNewProjectName("")}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                </form>
              </div>
            )}
          </div>
        ))}

        {showNewOrg ? (
          <form className="inline-add" onSubmit={createOrg}>
            <input
              autoFocus
              placeholder="Organization name…"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              onBlur={() => !newOrgName && setShowNewOrg(false)}
            />
          </form>
        ) : (
          <button className="new-org-btn" onClick={() => setShowNewOrg(true)}>
            + New organization
          </button>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-chip">
          <span className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{user.name}</span>
        </div>
        <button className="link-btn" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  );
}
