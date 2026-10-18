import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initSchema, pool } from "../src/db.js";
import { redis } from "../src/redis.js";
import { startIngestionWorker, shutdownQueue } from "../src/queue.js";

const app = createApp();
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  await initSchema();
  await redis.flushdb(); // clean rate-limit/cache state left by other test files/runs
  startIngestionWorker();
});

after(async () => {
  await shutdownQueue();
  await pool.end();
  redis.disconnect();
  process.exit(0); // pg/ioredis/BullMQ can leave a handle alive even after cleanup; force exit once results are reported
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("end-to-end: register -> org -> project -> document -> chat", () => {
  test("a document uploaded through the API is retrievable via chat with a supported citation", async () => {
    const email = `pipeline-${unique()}@test.com`;
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "password123", name: "Pipeline Test" });
    assert.equal(register.status, 201);
    const token = register.body.token;

    const org = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "PipelineOrg" });
    assert.equal(org.status, 201);

    const project = await request(app)
      .post(`/api/v1/organizations/${org.body.id}/projects`)
      .set("authorization", `Bearer ${token}`)
      .send({ name: "PipelineProj" });
    assert.equal(project.status, 201);
    const projectId = project.body.id;

    const upload = await request(app)
      .post(`/api/v1/projects/${projectId}/documents`)
      .set("authorization", `Bearer ${token}`)
      .send({
        name: "src/widgets.ts",
        type: "code",
        content: "export function renderWidget(id: string) {\n  return document.getElementById(id);\n}\n",
      });
    assert.equal(upload.status, 202);
    assert.equal(upload.body.status, "PENDING");

    // Poll for the BullMQ worker to actually finish (real async processing,
    // not a stub -- this waits on real Postgres state).
    let status = "PENDING";
    for (let i = 0; i < 20 && status !== "COMPLETED"; i++) {
      await sleep(200);
      const doc = await request(app)
        .get(`/api/v1/projects/${projectId}/documents/${upload.body.id}`)
        .set("authorization", `Bearer ${token}`);
      status = doc.body.status;
    }
    assert.equal(status, "COMPLETED", "ingestion should complete within the polling window");

    const chat = await request(app)
      .post(`/api/v1/projects/${projectId}/chat`)
      .set("authorization", `Bearer ${token}`)
      .send({ question: "How does renderWidget work?", provider: "mock" });

    assert.equal(chat.status, 200);
    assert.ok(chat.body.citations.length > 0, "should have retrieved at least one citation");
    assert.equal(chat.body.citations[0].filePath, "src/widgets.ts");
    assert.equal(chat.body.provider, "mock");
  });

  test("a second identical question hits the Redis cache", async () => {
    const email = `cache-${unique()}@test.com`;
    const register = await request(app)
      .post("/api/v1/auth/register")
      .send({ email, password: "password123", name: "Cache Test" });
    const token = register.body.token;
    const org = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "CacheOrg" });
    const project = await request(app)
      .post(`/api/v1/organizations/${org.body.id}/projects`)
      .set("authorization", `Bearer ${token}`)
      .send({ name: "CacheProj" });
    const projectId = project.body.id;

    const first = await request(app)
      .post(`/api/v1/projects/${projectId}/chat`)
      .set("authorization", `Bearer ${token}`)
      .send({ question: "cache me please", provider: "mock" });
    const second = await request(app)
      .post(`/api/v1/projects/${projectId}/chat`)
      .set("authorization", `Bearer ${token}`)
      .send({ question: "cache me please", provider: "mock" });

    assert.equal(first.body.fromCache, false);
    assert.equal(second.body.fromCache, true);
  });
});
