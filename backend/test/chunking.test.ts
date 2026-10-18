import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chunkFile } from "../src/chunking.js";

describe("chunkFile", () => {
  test("splits TypeScript at function/class boundaries with correct line numbers", () => {
    const source = `export function a() {
  return 1;
}

export function b() {
  return 2;
}
`;
    const chunks = chunkFile("src/example.ts", source);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].symbolName, "a");
    assert.equal(chunks[0].startLine, 1);
    assert.equal(chunks[1].symbolName, "b");
    assert.equal(chunks[1].startLine, 5);
  });

  test("falls back to windowed chunking for files with no recognizable symbols", () => {
    const source = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkFile("config.json", source);
    assert.ok(chunks.length > 1, "a 100-line file should split into multiple windows");
    assert.equal(chunks[0].symbolName, null);
  });

  test("markdown chunks preserve line ranges without overlap gaps", () => {
    const source = Array.from({ length: 90 }, (_, i) => `paragraph ${i}`).join("\n");
    const chunks = chunkFile("README.md", source);
    // consecutive chunks should overlap, not skip lines
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i].startLine <= chunks[i - 1].endLine + 1, "chunks should not leave a line-number gap");
    }
  });

  test("empty file produces no chunks rather than throwing", () => {
    const chunks = chunkFile("empty.ts", "");
    assert.deepEqual(chunks, []);
  });
});
