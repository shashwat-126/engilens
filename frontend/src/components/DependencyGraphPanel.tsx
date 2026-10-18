import { useEffect, useState } from "react";
import { api, type Project, type DependencyNeighbors, type DependencyGraph } from "../api";

export default function DependencyGraphPanel({ project }: { project: Project }) {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [query, setQuery] = useState("");
  const [neighbors, setNeighbors] = useState<DependencyNeighbors | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGraph(null);
    setNeighbors(null);
    setQuery("");
    api.getDependencyGraph(project.id).then(setGraph).catch(() => setGraph({ nodes: [], edges: [] }));
  }, [project.id]);

  async function lookup(file: string) {
    if (!file.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setNeighbors(await api.getDependencyNeighbors(project.id, file.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
      setNeighbors(null);
    } finally {
      setBusy(false);
    }
  }

  const projectFiles = graph ? [...new Set(graph.nodes)].filter((n) => !n.includes("/node_modules/")).sort() : [];

  return (
    <div className="panel dep-panel">
      <form
        className="dep-search"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(query);
        }}
      >
        <input
          className="mono"
          list="dep-files"
          placeholder="file path, e.g. src/auth/jwt.service.ts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <datalist id="dep-files">
          {projectFiles.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button className="btn btn-primary" type="submit" disabled={busy || !query.trim()}>
          Look up
        </button>
      </form>

      {error && <div className="chat-error">{error}</div>}

      {neighbors && (
        <div className="dep-result">
          <h3 className="mono">{neighbors.file}</h3>
          <div className="dep-columns">
            <div>
              <div className="dep-col-label">Depends on ({neighbors.dependsOn.length})</div>
              {neighbors.dependsOn.length === 0 && <p className="empty-hint">No tracked imports.</p>}
              <ul className="dep-list">
                {neighbors.dependsOn.map((f) => (
                  <li key={f}>
                    <button className="dep-link mono" onClick={() => { setQuery(f); lookup(f); }}>
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="dep-col-label">Depended on by ({neighbors.dependedOnBy.length})</div>
              {neighbors.dependedOnBy.length === 0 && <p className="empty-hint">Nothing in this project imports it.</p>}
              <ul className="dep-list">
                {neighbors.dependedOnBy.map((f) => (
                  <li key={f}>
                    <button className="dep-link mono" onClick={() => { setQuery(f); lookup(f); }}>
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {!neighbors && graph && graph.edges.length > 0 && (
        <div className="dep-all-edges">
          <div className="dep-col-label">All tracked edges ({graph.edges.length})</div>
          <ul className="dep-list">
            {graph.edges.slice(0, 100).map((e, i) => (
              <li key={i} className="mono dep-edge-row">
                {e.from} <span className="dep-arrow">&rarr;</span> {e.to}
              </li>
            ))}
          </ul>
          {graph.edges.length > 100 && (
            <p className="empty-hint">Showing first 100 of {graph.edges.length} edges. Search a specific file above.</p>
          )}
        </div>
      )}

      {!neighbors && graph && graph.edges.length === 0 && (
        <p className="empty-hint">
          No import/require edges tracked yet -- index some code files with relative imports (Documents or Repositories tab)
          to populate this.
        </p>
      )}
    </div>
  );
}
