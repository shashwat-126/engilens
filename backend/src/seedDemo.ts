// One-shot demo seeder: creates a user/org/project and 3 documents so you
// can immediately try /chat and `npm run evaluate` without doing the
// register -> org -> project -> upload dance by hand.
// Usage: npm run seed-demo   (then copy the printed projectId + token)

import { v4 as uuid } from "uuid";
import { pool, initSchema } from "./db.js";
import { hashPassword, signToken } from "./auth.js";
import { enqueueIngestion } from "./queue.js";
import { startIngestionWorker } from "./queue.js";

async function main() {
  await initSchema();
  startIngestionWorker(); // this script isn't running server.ts's worker, so start one here too

  const email = "demo@acme.com";
  const existing = await pool.query<{ id: string; email: string }>(`SELECT id, email FROM users WHERE email = $1`, [
    email,
  ]);
  let user = existing.rows[0];

  if (!user) {
    const id = uuid();
    await pool.query(`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`, [
      id,
      email,
      hashPassword("password123"),
      "Demo User",
    ]);
    user = { id, email };
  }

  const orgId = uuid();
  await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, "Acme Corp"]);
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
    [orgId, user.id]
  );

  const projectId = uuid();
  await pool.query(`INSERT INTO projects (id, organization_id, name) VALUES ($1, $2, $3)`, [
    projectId,
    orgId,
    "Payment Platform",
  ]);

  const docs = [
    {
      name: "src/auth/jwt.service.ts",
      type: "code",
      content: `export class JWTService {
  generateAccessToken(userId: string): string {
    // signs a short-lived JWT access token for the given user
    return sign({ sub: userId }, SECRET, { expiresIn: '15m' });
  }

  verifyToken(token: string): Payload {
    return verify(token, SECRET) as Payload;
  }

  refreshToken(oldToken: string): string {
    const payload = this.verifyToken(oldToken);
    return this.generateAccessToken(payload.sub);
  }
}
`,
    },
    {
      name: "src/middleware/auth.ts",
      type: "code",
      content: `export function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).end();
  const token = header.replace('Bearer ', '');
  const payload = jwtService.verifyToken(token);
  req.user = payload;
  next();
}
`,
    },
    {
      name: "docs/architecture.md",
      type: "markdown",
      content: `# Payment Platform Architecture

The payment service depends on Redis for idempotency key caching and PostgreSQL for transaction records.

## Auth flow

All requests go through the JWT auth middleware before reaching the payment controller.
`,
    },
  ];

  for (const d of docs) {
    const id = uuid();
    await pool.query(
      `INSERT INTO documents (id, project_id, name, type, source, status) VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
      [id, projectId, d.name, d.type, d.content]
    );
    await enqueueIngestion(id);
  }

  const token = signToken({ sub: user.id, email: user.email });

  setTimeout(() => {
    console.log("\nDemo seeded.\n");
    console.log("projectId:", projectId);
    console.log("token:", token);
    console.log(
      `\nTry:\ncurl -X POST localhost:4000/api/v1/projects/${projectId}/chat \\\n  -H "authorization: Bearer ${token}" -H 'content-type: application/json' \\\n  -d '{"question":"Where is JWT authentication implemented?"}'\n`
    );
    console.log(`Evaluate:\nnpm run evaluate -- ${projectId}\n`);
    process.exit(0);
  }, 1500); // give the BullMQ worker time to process the 3 tiny documents
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
