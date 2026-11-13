import bcrypt from "bcryptjs";
import type { Db } from "./db.js";

/** Prothom admin banano (register endpoint e keu nijeke admin banate parbe na) */
export function seedAdmin(db: Db, email: string, password: string, cost = 10) {
  const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email.toLowerCase());
  if (exists) return false;
  db.prepare("INSERT INTO users (email, password_hash, role, created_at) VALUES (?,?, 'admin', ?)").run(email.toLowerCase(), bcrypt.hashSync(password, cost), Date.now());
  return true;
}
