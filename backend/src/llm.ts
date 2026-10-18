export interface RetrievedChunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  score: number;
}

export interface LLMProvider {
  name: string;
  model: string;
  generateAnswer(question: string, context: RetrievedChunk[]): Promise<string>;
}

export type ProviderName = "anthropic" | "openai" | "gemini" | "mock";

function buildPrompt(question: string, context: RetrievedChunk[]): string {
  const sources = context
    .map(
      (c, i) =>
        `[Source ${i + 1}]\nfile: ${c.filePath}\nlines: ${c.startLine ?? "?"}-${c.endLine ?? "?"}\n${c.content}`
    )
    .join("\n\n");
  return `You are an engineering knowledge assistant. Answer ONLY using the supplied context. If the context is insufficient, say so plainly. Cite sources as [Source N].\n\nCONTEXT\n${sources}\n\nQUESTION\n${question}`;
}

/** Fully offline provider: no hallucination risk, but no fluent prose either —
 * it composes an answer extractively from the top-ranked chunks. Default
 * when no API key is configured for anything, so the system always works. */
export class MockLLMProvider implements LLMProvider {
  name = "mock";
  model = "extractive-v1";

  async generateAnswer(question: string, context: RetrievedChunk[]): Promise<string> {
    if (context.length === 0) {
      return "I don't have enough evidence in the indexed documents to answer that.";
    }
    const lines = context.slice(0, 3).map((c, i) => {
      const loc =
        c.startLine != null ? `${c.filePath}:${c.startLine}-${c.endLine}` : c.filePath;
      const snippet = c.content.trim().split("\n").slice(0, 3).join(" ").slice(0, 220);
      return `${i + 1}. ${loc} — ${snippet}${snippet.length >= 220 ? "…" : ""} [Source ${i + 1}]`;
    });
    return `Based on the indexed context, here's what's relevant to "${question}":\n\n${lines.join(
      "\n"
    )}`;
  }
}

export class AnthropicLLMProvider implements LLMProvider {
  name = "anthropic";
  constructor(private apiKey: string, public model = "claude-sonnet-4-6") {}

  async generateAnswer(question: string, context: RetrievedChunk[]): Promise<string> {
    const prompt = buildPrompt(question, context);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 700,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content.find((b) => b.type === "text")?.text ?? "";
  }
}

/** OpenAI's /v1/chat/completions shape is the de-facto standard now, so this
 * one provider also covers Groq, Together, Fireworks, OpenRouter, Mistral's
 * OpenAI-compat endpoint, local Ollama (with its OpenAI-compat server), and
 * Azure OpenAI (with baseUrl pointed at the deployment) — just change
 * baseUrl/apiKey/model. */
export class OpenAICompatibleLLMProvider implements LLMProvider {
  name: string;
  constructor(
    private apiKey: string,
    public model = "gpt-4o-mini",
    private baseUrl = "https://api.openai.com/v1",
    label = "openai"
  ) {
    this.name = label;
  }

  async generateAnswer(question: string, context: RetrievedChunk[]): Promise<string> {
    const prompt = buildPrompt(question, context);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 700,
        messages: [
          { role: "system", content: "You are a precise engineering knowledge assistant." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${this.name} API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  }
}

export class GeminiLLMProvider implements LLMProvider {
  name = "gemini";
  constructor(private apiKey: string, public model = "gemini-3.6-flash") {}

  async generateAnswer(question: string, context: RetrievedChunk[]): Promise<string> {
    const prompt = buildPrompt(question, context);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      candidates: { content: { parts: { text: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  }
}

interface ProviderConfig {
  name: ProviderName;
  label: string;
  configured: boolean;
  defaultModel: string;
}

/** What the frontend can show in a provider picker, without leaking keys. */
export function listProviders(): ProviderConfig[] {
  return [
    { name: "anthropic", label: "Anthropic (Claude)", configured: !!process.env.ANTHROPIC_API_KEY, defaultModel: "claude-sonnet-4-6" },
    { name: "openai", label: "OpenAI-compatible", configured: !!process.env.OPENAI_API_KEY, defaultModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini" },
    { name: "gemini", label: "Google Gemini", configured: !!process.env.GEMINI_API_KEY, defaultModel: "gemini-3.6-flash" },
    { name: "mock", label: "Offline (extractive)", configured: true, defaultModel: "extractive-v1" },
  ];
}

/** Resolves a provider for a single request. `provider`/`model` (e.g. from
 * the chat request body, so the React UI can offer a dropdown) win over the
 * LLM_PROVIDER env default, which wins over auto-detecting from whichever
 * API key is set. Falls back to Mock if the requested provider has no key. */
export function getLLMProvider(opts?: { provider?: string; model?: string }): LLMProvider {
  const requested = (opts?.provider as ProviderName | undefined) ?? (process.env.LLM_PROVIDER as ProviderName | undefined);

  const build = (p: ProviderName): LLMProvider | null => {
    switch (p) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY
          ? new AnthropicLLMProvider(process.env.ANTHROPIC_API_KEY, opts?.model)
          : null;
      case "openai":
        return process.env.OPENAI_API_KEY
          ? new OpenAICompatibleLLMProvider(
              process.env.OPENAI_API_KEY,
              opts?.model ?? process.env.OPENAI_MODEL,
              process.env.OPENAI_BASE_URL,
              process.env.OPENAI_BASE_URL ? "openai-compatible" : "openai"
            )
          : null;
      case "gemini":
        return process.env.GEMINI_API_KEY
          ? new GeminiLLMProvider(process.env.GEMINI_API_KEY, opts?.model)
          : null;
      case "mock":
        return new MockLLMProvider();
      default:
        return null;
    }
  };

  if (requested) {
    const provider = build(requested);
    if (provider) return provider;
    // Requested provider has no key configured -> fall back to mock rather
    // than 500ing the request; the UI surfaces `provider`/`model` in the
    // response so this is visible, not silent.
  }

  // Auto-detect: first configured provider wins.
  for (const p of ["anthropic", "openai", "gemini"] as ProviderName[]) {
    const provider = build(p);
    if (provider) return provider;
  }
  return new MockLLMProvider();
}
