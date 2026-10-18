import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { initSchema, pool } from "../src/db.js";
import { redis } from "../src/redis.js";

const app = createApp();
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  await initSchema();
  await redis.flushdb(); // clean rate-limit/cache state between test runs
});

after(async () => {
  await pool.end();
  redis.disconnect();
  process.exit(0); // pg/ioredis can leave a handle alive even after cleanup; force exit once results are reported
});

async function registerAndLogin(emailPrefix: string) {
  const email = `${emailPrefix}-${unique()}@test.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "password123", name: "Test User" });
  return { token: res.body.token as string, userId: res.body.user.id as string, email };
}

describe("privilege escalation (org member role assignment)", () => {
  test("an ADMIN cannot self-grant OWNER", async () => {
    const owner = await registerAndLogin("owner");
    const admin = await registerAndLogin("admin");

    const orgRes = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${owner.token}`)
      .send({ name: "TestOrg" });
    const orgId = orgRes.body.id;

    // OWNER grants ADMIN
    await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ userId: admin.userId, role: "ADMIN" })
      .expect(201);

    // ADMIN tries to self-promote to OWNER -- must be blocked
    const escalation = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set("authorization", `Bearer ${admin.token}`)
      .send({ userId: admin.userId, role: "OWNER" });

    assert.equal(escalation.status, 403);
  });

  test("an OWNER can still grant OWNER", async () => {
    const owner = await registerAndLogin("owner2");
    const other = await registerAndLogin("other2");

    const orgRes = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${owner.token}`)
      .send({ name: "TestOrg2" });

    const res = await request(app)
      .post(`/api/v1/organizations/${orgRes.body.id}/members`)
      .set("authorization", `Bearer ${owner.token}`)
      .send({ userId: other.userId, role: "OWNER" });

    assert.equal(res.status, 201);
  });
});

describe("IDOR (cross-project conversation access)", () => {
  test("a VIEWER of project B cannot read a conversation that belongs to project A", async () => {
    const userA = await registerAndLogin("usera");
    const userB = await registerAndLogin("userb");

    const orgA = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${userA.token}`)
      .send({ name: "OrgA" });
    const projA = await request(app)
      .post(`/api/v1/organizations/${orgA.body.id}/projects`)
      .set("authorization", `Bearer ${userA.token}`)
      .send({ name: "ProjA" });
    const chatA = await request(app)
      .post(`/api/v1/projects/${projA.body.id}/chat`)
      .set("authorization", `Bearer ${userA.token}`)
      .send({ question: "a secret question", provider: "mock" });
    const conversationId = chatA.body.conversationId;

    const orgB = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${userB.token}`)
      .send({ name: "OrgB" });
    const projB = await request(app)
      .post(`/api/v1/organizations/${orgB.body.id}/projects`)
      .set("authorization", `Bearer ${userB.token}`)
      .send({ name: "ProjB" });

    // B tries to read A's conversation through B's own (legitimate) project URL
    const crossRead = await request(app)
      .get(`/api/v1/projects/${projB.body.id}/chat/${conversationId}`)
      .set("authorization", `Bearer ${userB.token}`);

    assert.equal(crossRead.status, 404);
  });
});

describe("RBAC baseline", () => {
  test("unauthenticated requests are rejected", async () => {
    const res = await request(app).get("/api/v1/organizations");
    assert.equal(res.status, 401);
  });

  test("a non-member cannot read another org's projects", async () => {
    const owner = await registerAndLogin("privateowner");
    const outsider = await registerAndLogin("outsider");

    const org = await request(app)
      .post("/api/v1/organizations")
      .set("authorization", `Bearer ${owner.token}`)
      .send({ name: "PrivateOrg" });

    const res = await request(app)
      .get(`/api/v1/organizations/${org.body.id}/projects`)
      .set("authorization", `Bearer ${outsider.token}`);

    assert.equal(res.status, 403);
  });
});

// Runs last deliberately: it exhausts the auth rate-limit bucket for
// 127.0.0.1 (the shared "IP" every supertest request comes from), which
// would otherwise block every subsequent test's register/login calls in
// this file.
describe("auth brute-force protection", () => {
  test("login gets rate limited after repeated failures", async () => {
    const email = `bruteforce-${unique()}@test.com`;
    const attempts = await Promise.all(
      Array.from({ length: 15 }, () => request(app).post("/api/v1/auth/login").send({ email, password: "wrong" }))
    );
    const statuses = attempts.map((r) => r.status);
    assert.ok(statuses.includes(429), `expected at least one 429 among: ${statuses.join(",")}`);
  });
});
