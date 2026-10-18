import { useEffect, useRef, useState } from "react";
import { api, type Citation, type ProviderInfo, type Project } from "../api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  provider?: string;
  model?: string;
}

export default function ChatView({ project }: { project: Project }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [customModel, setCustomModel] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([]);
    setConversationId(undefined);
    api.listProviders(project.id).then((list) => {
      setProviders(list);
      const firstConfigured = list.find((p) => p.configured && p.name !== "mock");
      setProvider(firstConfigured?.name ?? "mock");
    });
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setTurns((t) => [...t, { role: "user", content: q }]);
    setQuestion("");
    setBusy(true);
    try {
      const res = await api.ask(project.id, q, conversationId, provider, customModel);
      setConversationId(res.conversationId);
      setTurns((t) => [
        ...t,
        { role: "assistant", content: res.answer, citations: res.citations, provider: res.provider, model: res.model },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setTurns((t) => t.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-toolbar">
        <div className="provider-picker">
          <label>Model</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {providers.map((p) => (
              <option key={p.name} value={p.name} disabled={!p.configured && p.name !== "mock"}>
                {p.label}
                {!p.configured && p.name !== "mock" ? " (no API key set)" : ""}
              </option>
            ))}
          </select>
          <input
            className="model-override"
            placeholder="model override (optional)"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        </div>
      </div>

      <div className="transcript">
        {turns.length === 0 && (
          <div className="empty-state">
            <p>No questions asked yet.</p>
            <p className="empty-hint">
              Try: <em>"Where is JWT authentication implemented?"</em> — once you've indexed some documents or a repo.
            </p>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={`turn turn-${turn.role}`}>
            <div className="turn-marker">{turn.role === "user" ? "You" : "Copilot"}</div>
            <div className="turn-body">
              <p className="turn-text">{turn.content}</p>
              {turn.citations && turn.citations.length > 0 && (
                <div className="citations">
                  {turn.citations.map((c, ci) => (
                    <span key={ci} className={`citation-chip ${c.supported ? "supported" : "unsupported"}`}>
                      <span className="mono">
                        {c.filePath}
                        {c.startLine != null ? `:${c.startLine}-${c.endLine}` : ""}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {turn.provider && (
                <div className="turn-meta mono">
                  {turn.provider} · {turn.model}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="turn turn-assistant turn-pending">Copilot is retrieving and answering…</div>}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-input" onSubmit={ask}>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about this codebase…"
          disabled={busy}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
