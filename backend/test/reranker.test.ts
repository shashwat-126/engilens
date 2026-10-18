import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rerank } from "../src/reranker.js";

describe("rerank", () => {
  test("ranks an exact identifier match above a vaguer semantic match", () => {
    const candidates = [
      {
        content: "export function generateAccessToken(userId) { return sign(userId); }",
        filePath: "src/auth.ts",
        symbolName: "generateAccessToken",
        vectorScore: 0.5, // deliberately lower vector score than the distractor
      },
      {
        content: "export function doSomethingUnrelatedWithTokens() { /* ... */ }",
        filePath: "src/misc.ts",
        symbolName: "doSomethingUnrelatedWithTokens",
        vectorScore: 0.6,
      },
    ];
    const results = rerank("generateAccessToken", candidates, 2);
    assert.equal(results[0].filePath, "src/auth.ts", "BM25 + exact symbol match should overcome a small vector-score deficit");
  });

  test("returns empty array for empty candidate list", () => {
    assert.deepEqual(rerank("anything", [], 5), []);
  });

  test("respects topK", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      content: `chunk number ${i} about authentication`,
      filePath: `file${i}.ts`,
      symbolName: null,
      vectorScore: Math.random(),
    }));
    const results = rerank("authentication", candidates, 3);
    assert.equal(results.length, 3);
  });

  test("every result carries a numeric rerankScore", () => {
    const candidates = [{ content: "some code", filePath: "a.ts", symbolName: null, vectorScore: 0.3 }];
    const [result] = rerank("code", candidates, 1);
    assert.equal(typeof result.rerankScore, "number");
    assert.ok(Number.isFinite(result.rerankScore));
  });
});
