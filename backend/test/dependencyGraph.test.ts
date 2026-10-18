import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractDependencyEdges } from "../src/dependencyGraph.js";

describe("extractDependencyEdges", () => {
  test("extracts relative and package imports from TypeScript", () => {
    const source = `import { verifyToken } from '../auth';\nimport jwt from 'jsonwebtoken';\nimport type { Foo } from './types';\n`;
    const edges = extractDependencyEdges("src/middleware/auth.ts", source);
    const raws = edges.map((e) => e.raw);
    assert.ok(raws.includes("../auth"));
    assert.ok(raws.includes("jsonwebtoken"));
    assert.ok(raws.includes("./types"));
  });

  test("resolves relative paths against the importing file's directory", () => {
    const edges = extractDependencyEdges("src/middleware/auth.ts", `import { x } from '../auth';`);
    assert.equal(edges[0].resolvedTo, "src/auth");
  });

  test("leaves package imports unresolved (not treated as relative)", () => {
    const edges = extractDependencyEdges("src/middleware/auth.ts", `import jwt from 'jsonwebtoken';`);
    assert.equal(edges[0].resolvedTo, "jsonwebtoken");
  });

  test("extracts require() calls too", () => {
    const edges = extractDependencyEdges("src/legacy.js", `const fs = require('fs');\nconst utils = require('./utils');`);
    const raws = edges.map((e) => e.raw);
    assert.ok(raws.includes("fs"));
    assert.ok(raws.includes("./utils"));
  });

  test("extracts Python imports: bare imports and 'from module import' as module-level edges", () => {
    const source = `import os\nfrom app.services import assignment_service\nfrom app.models import Incident, Department\n`;
    const edges = extractDependencyEdges("backend/app/main.py", source);
    const raws = edges.map((e) => e.raw);
    // 'import os' -> depends on the 'os' module
    assert.ok(raws.includes("os"));
    // 'from X import Y' -> depends on the module X (Y is a symbol within it,
    // not a separate file/module, so it should NOT appear as its own edge)
    assert.ok(raws.includes("app.services"));
    assert.ok(raws.includes("app.models"));
    assert.ok(!raws.includes("Incident"), "imported symbol names should not become their own edges");
  });

  test("bare 'import a, b, c' extracts each module without swallowing the next line", () => {
    const source = `import os, sys, re\nimport json\n`;
    const edges = extractDependencyEdges("script.py", source);
    const raws = edges.map((e) => e.raw);
    assert.deepEqual(raws.sort(), ["json", "os", "re", "sys"]);
  });

  test("unsupported file extensions yield no edges", () => {
    assert.deepEqual(extractDependencyEdges("README.md", "import { x } from './y';"), []);
  });
});
