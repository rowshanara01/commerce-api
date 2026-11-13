import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { bearer, customer, setup } from "./helpers.js";

describe("security & robustness", () => {
  it("JWT: tampered, expired, alg=none, wrong secret = 401", async () => {
    const { api, config } = setup();
    const t = await customer(api, "c@test.io");
    const forgedAdmin = jwt.sign({ role: "admin" }, "wrong-secret", { subject: String(t.user.id) });
    const expired = jwt.sign({ role: "customer" }, config.jwtSecret, { subject: String(t.user.id), expiresIn: -10 });
    const none = jwt.sign({ role: "admin" }, "", { subject: "1", algorithm: "none" } as jwt.SignOptions);
    for (const bad of [forgedAdmin, expired, none, t.accessToken.slice(0, -3) + "abc"]) {
      expect((await api.get("/auth/me").set(bearer(bad))).status).toBe(401);
    }
    expect((await api.get("/auth/me").set(bearer(t.accessToken))).status).toBe(200);
  });

  it("login brute force: 3 vul attempt er por 429 + Retry-After, onno email prabhabito na", async () => {
    const { api } = setup({ rateLimit: { windowMs: 60_000, max: 100_000, loginMax: 3 } });
    await api.post("/auth/register").send({ email: "v@test.io", password: "Password123" });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await api.post("/auth/login").send({ email: "v@test.io", password: "WrongPass123" })).status);
    expect(codes).toEqual([401, 401, 401, 429]);
    const blocked = await api.post("/auth/login").send({ email: "v@test.io", password: "Password123" });   // thik password-o ekhon block
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect((await api.post("/auth/login").send({ email: "other@test.io", password: "WrongPass123" })).status).toBe(401);
  });

  it("global rate limit", async () => {
    const { api } = setup({ rateLimit: { windowMs: 60_000, max: 5, loginMax: 100 } });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await api.get("/health")).status);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
  });

  it("error format shobshomoy ek, stack leak hoy na, malformed JSON = 400", async () => {
    const { api } = setup();
    const nf = await api.get("/nope");
    expect(nf.status).toBe(404);
    expect(nf.body.error).toMatchObject({ code: "not_found", requestId: expect.any(String) });
    const bad = await api.post("/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("bad_request");
    expect(JSON.stringify(bad.body)).not.toMatch(/node_modules|at Object/);
  });

  it("body size limit (100kb) = 413", async () => {
    const { api } = setup();
    const r = await api.post("/auth/register").send({ email: "a@test.io", password: "x".repeat(200_000) });
    expect(r.status).toBe(413);
  });

  it("request id echo, security headers, x-powered-by nai", async () => {
    const { api } = setup();
    const r = await api.get("/health").set("X-Request-Id", "my-trace-id-123");
    expect(r.headers["x-request-id"]).toBe("my-trace-id-123");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect((await api.get("/health").set("X-Request-Id", "bad id with spaces!")).headers["x-request-id"]).not.toBe("bad id with spaces!");
  });

  describe("config", () => {
    const old = { ...process.env };
    afterEach(() => { process.env = { ...old }; });
    it("production e JWT_SECRET chhara server start hoy na", () => {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      expect(() => loadConfig()).toThrow(/JWT_SECRET/);
      process.env.JWT_SECRET = "x".repeat(32);
      expect(loadConfig().jwtSecret).toHaveLength(32);
    });
  });
});
