import { useEffect, useState } from "react";
import { api, type DocumentRow, type Project } from "../api";

export default function DocumentsPanel({ project }: { project: Project }) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setDocs(await api.listDocuments(project.id));
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    setBusy(true);
    try {
      const ext = name.split(".").pop() ?? "";
      const type = ["ts", "tsx", "js", "jsx", "py", "java", "go", "rs"].includes(ext) ? "code" : "text";
      await api.uploadDocument(project.id, name.trim(), type, content);
      setName("");
      setContent("");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteDocument(project.id, id);
    refresh();
  }

  return (
    <div className="panel">
      <form className="upload-form" onSubmit={upload}>
        <input
          placeholder="file path, e.g. src/auth/jwt.service.ts"
          className="mono"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          placeholder="paste file contents…"
          className="mono"
          rows={8}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Upload
        </button>
      </form>

      <table className="doc-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td className="mono">{d.name}</td>
              <td>
                <span className={`status-pill status-${d.status.toLowerCase()}`}>{d.status}</span>
                {d.error && <span className="doc-error" title={d.error}>⚠</span>}
              </td>
              <td>
                <button className="link-btn" onClick={() => remove(d.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-row">
                No documents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
