// EmbeddingProvider abstraction (mirrors the doc's design). LocalHashingEmbeddingProvider
// runs fully offline (feature-hashed char/word n-grams -> fixed-length vector), so the
// whole pipeline works with zero API keys. Add OpenAIEmbeddingProvider / HFEmbeddingProvider
// later and swap the export at the bottom — nothing else in the codebase changes.

export interface EmbeddingProvider {
  embed(text: string): number[];
  dim: number;
}

const DIM = 256;

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(" ")
    .filter(Boolean);
  // Add char-trigrams too, so identifiers like "generateAccessToken" share
  // signal with "access token" even without an exact word match.
  const trigrams: string[] = [];
  for (const w of words) {
    for (let i = 0; i < w.length - 2; i++) trigrams.push(w.slice(i, i + 3));
  }
  return [...words, ...trigrams];
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class LocalHashingEmbeddingProvider implements EmbeddingProvider {
  dim = DIM;

  embed(text: string): number[] {
    const vec = new Array(DIM).fill(0);
    const tokens = tokenize(text);
    for (const t of tokens) {
      const h = hashToken(t);
      const idx = h % DIM;
      const sign = h & 1 ? 1 : -1;
      vec[idx] += sign;
    }
    // L2 normalize so cosine similarity behaves well
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

export const embeddingProvider: EmbeddingProvider = new LocalHashingEmbeddingProvider();

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already unit vectors, so dot == cosine
}
