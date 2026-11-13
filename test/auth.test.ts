import { describe, expect, it } from "vitest";
import { admin, bearer, customer, loginAs, setup } from "./helpers.js";

describe("auth", () => {
  it("register -> login -> /me, password hash kokhono response e ashe na", async () => {
    const { api } = setup();
    const reg = await api.post("/auth/register").send({ email: "Rahim@Test.io", password: "Password123" });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toEqual({ id: expect.any(Number), email: "rahim@test.io", role: "customer" });
    const t = await loginAs(api, "rahim@test.io", "Password123");
    const me = await api.get("/auth/me").set(bearer(t.accessToken));
    expect(me.status).toBe(200);
    expect(JSON.stringify([reg.body, t, me.body])).not.toMatch(/password|hash/i);
  });

  it("duplicate email (case-insensitive) = 409, weak password = 400 with details", async () => {
    const { api } = setup();
    await api.post("/auth/register").send({ email: "a@test.io", password: "Password123" });
    expect((await api.post("/auth/register").send({ email: "A@TEST.io", password: "Password123" })).status).toBe(409);
    const weak = await api.post("/auth/register").send({ email: "b@test.io", password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("validation_error");
    expect(weak.body.error.details[0].path).toBe("password");
  });

  it("register diye nijeke admin banano jay na (mass assignment)", async () => {
    const { api } = setup();
    const r = await api.post("/auth/register").send({ email: "evil@test.io", password: "Password123", role: "admin" });
    expect(r.body.user.role).toBe("customer");
  });

  it("vul password ar unknown email: ek response (user enumeration hoy na)", async () => {
    const { api } = setup();
    await api.post("/auth/register").send({ email: "c@test.io", password: "Password123" });
    const wrongPw = await api.post("/auth/login").send({ email: "c@test.io", password: "WrongPass123" });
    const noUser = await api.post("/auth/login").send({ email: "nobody@test.io", password: "WrongPass123" });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body.error.message).toBe(noUser.body.error.message);
  });

  it("refresh token rotation + reuse detection: chori hoyeche dhore shob session bondho", async () => {
    const { api } = setup();
    const t1 = await customer(api, "d@test.io");
    const r2 = await api.post("/auth/refresh").send({ refreshToken: t1.refreshToken });
    expect(r2.status).toBe(200);
    expect(r2.body.refreshToken).not.toBe(t1.refreshToken);
    // purono token abar -> reuse detected
    const reuse = await api.post("/auth/refresh").send({ refreshToken: t1.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("token_reuse_detected");
    // ar tar fole notun token-o bondho
    expect((await api.post("/auth/refresh").send({ refreshToken: r2.body.refreshToken })).status).toBe(401);
  });

  it("logout refresh token bondho kore", async () => {
    const { api } = setup();
    const t = await customer(api, "e@test.io");
    expect((await api.post("/auth/logout").send({ refreshToken: t.refreshToken })).status).toBe(204);
    expect((await api.post("/auth/refresh").send({ refreshToken: t.refreshToken })).status).toBe(401);
  });

  it("seeded admin login kore, role admin", async () => {
    const { api } = setup();
    expect((await admin(api)).user.role).toBe("admin");
  });
});
