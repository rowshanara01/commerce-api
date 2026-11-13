import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Config } from "../config.js";
import { tx, type Db } from "../db.js";
import { AppError, parse } from "../errors.js";
import { authenticate } from "../middleware/common.js";

const creds = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),   // bcrypt 72 byte porjonto-i dekhe
});
const tokenBody = z.object({ refreshToken: z.string().min(20).max(200) });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const isUnique = (e: unknown) => String((e as Error)?.message).includes("UNIQUE constraint failed");

interface UserRow { id: number; email: string; password_hash: string; role: "customer" | "admin" }

export function authRoutes(db: Db, cfg: Config) {
  const r = Router();
  const dummyHash = bcrypt.hashSync("dummy-password", cfg.bcryptCost);  // user nai hole-o same shomoy lage (timing attack)

  function issueTokens(user: Pick<UserRow, "id" | "role" | "email">) {
    const accessToken = jwt.sign({ role: user.role }, cfg.jwtSecret, { subject: String(user.id), expiresIn: cfg.accessTtlSec, algorithm: "HS256" });
    const refreshToken = randomBytes(32).toString("base64url");
    // DB te shudhu hash rakhi: DB leak hole-o refresh token chole na
    db.prepare("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)").run(user.id, sha(refreshToken), Date.now() + cfg.refreshTtlDays * 864e5);
    return { accessToken, refreshToken, expiresIn: cfg.accessTtlSec, user: { id: user.id, email: user.email, role: user.role } };
  }

  r.post("/register", async (req, res) => {
    const { email, password } = parse(creds, req.body);
    const hash = await bcrypt.hash(password, cfg.bcryptCost);
    try {
      const info = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)").run(email, hash, Date.now());
      res.status(201).json({ user: { id: Number(info.lastInsertRowid), email, role: "customer" } });
    } catch (e) {
      if (isUnique(e)) throw new AppError(409, "email_taken", "Email already registered");
      throw e;
    }
  });

  r.post("/login", async (req, res) => {
    const { email, password } = parse(creds, req.body);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
    const ok = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
    if (!user || !ok) throw new AppError(401, "invalid_credentials", "Invalid email or password");  // kon ta vul seta bole dei na
    res.json(issueTokens(user));
  });

  r.post("/refresh", (req, res) => {
    const { refreshToken } = parse(tokenBody, req.body);
    const row = db.prepare("SELECT t.id, t.user_id, t.expires_at, t.revoked_at, u.email, u.role FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
      .get(sha(refreshToken)) as { id: number; user_id: number; expires_at: number; revoked_at: number | null; email: string; role: "customer" | "admin" } | undefined;
    if (!row) throw new AppError(401, "invalid_token", "Invalid refresh token");
    if (row.revoked_at) {
      // Purono (already use kora) token abar ashche = chori hoyeche dhore nei, oi user er shob session bondho
      db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(Date.now(), row.user_id);
      throw new AppError(401, "token_reuse_detected", "Refresh token reuse detected, please log in again");
    }
    if (row.expires_at < Date.now()) throw new AppError(401, "invalid_token", "Refresh token expired");
    const out = tx(db, () => {
      db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?").run(Date.now(), row.id);   // rotation: ekbar-i use kora jay
      return issueTokens({ id: row.user_id, email: row.email, role: row.role });
    });
    res.json(out);
  });

  r.post("/logout", (req, res) => {
    const { refreshToken } = parse(tokenBody, req.body);
    db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(Date.now(), sha(refreshToken));
    res.status(204).end();
  });

  r.get("/me", authenticate(cfg.jwtSecret), (req, res) => {
    const u = db.prepare("SELECT id, email, role, created_at FROM users WHERE id = ?").get(req.user!.id) as { id: number; email: string; role: string; created_at: number } | undefined;
    if (!u) throw new AppError(401, "invalid_token", "User no longer exists");
    res.json({ id: u.id, email: u.email, role: u.role, createdAt: u.created_at });
  });

  return r;
}
