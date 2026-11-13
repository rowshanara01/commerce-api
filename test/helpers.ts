import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { seedAdmin } from "../src/seed.js";

export function setup(over: Partial<Config> = {}) {
  const config = loadConfig({ bcryptCost: 4, logRequests: false, rateLimit: { windowMs: 60_000, max: 100_000, loginMax: 100_000 }, ...over });
  const db = openDb(":memory:");
  seedAdmin(db, "admin@test.io", "AdminPass123", 4);
  const app = createApp({ db, config });
  return { db, app, api: request(app), config };
}
export type Api = ReturnType<typeof setup>["api"];

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export async function loginAs(api: Api, email: string, password: string) {
  const r = await api.post("/auth/login").send({ email, password });
  return r.body as { accessToken: string; refreshToken: string; user: { id: number; role: string } };
}
export async function customer(api: Api, email: string) {
  await api.post("/auth/register").send({ email, password: "Password123" });
  return loginAs(api, email, "Password123");
}
export const admin = (api: Api) => loginAs(api, "admin@test.io", "AdminPass123");

export async function product(api: Api, adminToken: string, over: Record<string, unknown> = {}) {
  const r = await api.post("/products").set(bearer(adminToken)).send({ sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, name: "Test product", priceCents: 1000, stock: 10, ...over });
  return r.body as { id: number; stock: number; priceCents: number };
}
let n = 0;
export const idem = () => `key-${Date.now()}-${++n}-abcdef`;
