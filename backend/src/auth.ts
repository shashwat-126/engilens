import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
if (!process.env.JWT_SECRET) {
  // This default is published in the project's own source, so anyone who
  // finds this code and knows it can forge valid tokens for any user
  // against a deployment that never set JWT_SECRET. Fine for local dev,
  // never acceptable beyond that.
  console.warn(
    "\n⚠️  JWT_SECRET is not set -- using the built-in dev default, which is PUBLIC in this project's source.\n" +
      "   Anyone who reads the code can forge auth tokens against this server. Set JWT_SECRET before any real deployment.\n"
  );
}

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw: string, hash: string): boolean {
  return bcrypt.compareSync(pw, hash);
}

export interface JWTPayload {
  sub: string; // user id
  email: string;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}
