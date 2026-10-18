export interface RawChunk {
  content: string;
  startLine: number;
  endLine: number;
  language: string | null;
  symbolName: string | null;
}

const CODE_EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
};

const CODE_SYMBOL_RE =
  /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|def)\s+([A-Za-z0-9_]+)/;

function extOf(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/** Splits code into chunks at top-level function/class/def boundaries
 * (heuristic, not a real parser — good enough for demo-scale repos). */
function chunkCode(text: string, ext: string): RawChunk[] {
  const language = CODE_EXT_LANG[ext] ?? ext;
  const lines = text.split("\n");
  const chunks: RawChunk[] = [];
  let bufStart = 0;
  let currentSymbol: string | null = null;

  const flush = (endIdx: number) => {
    if (endIdx <= bufStart) return;
    const content = lines.slice(bufStart, endIdx).join("\n").trim();
    if (content.length === 0) return;
    chunks.push({
      content,
      startLine: bufStart + 1,
      endLine: endIdx,
      language,
      symbolName: currentSymbol,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const m = CODE_SYMBOL_RE.exec(lines[i].trim());
    if (m) {
      flush(i);
      bufStart = i;
      currentSymbol = m[5];
    }
  }
  flush(lines.length);

  // Fallback: no symbols found (e.g. config file) -> fixed-size windows
  if (chunks.length === 0) return chunkProse(text, 60);
  return chunks;
}

/** Splits prose (md/txt) into paragraph-ish windows of ~N lines with a small overlap. */
function chunkProse(text: string, windowLines = 40, overlap = 5): RawChunk[] {
  const lines = text.split("\n");
  const chunks: RawChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + windowLines, lines.length);
    const content = lines.slice(start, end).join("\n").trim();
    if (content.length > 0) {
      chunks.push({ content, startLine: start + 1, endLine: end, language: null, symbolName: null });
    }
    if (end === lines.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function chunkFile(fileName: string, text: string): RawChunk[] {
  const ext = extOf(fileName);
  if (ext in CODE_EXT_LANG) return chunkCode(text, ext);
  return chunkProse(text);
}
