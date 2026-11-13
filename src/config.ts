export interface Config {
  env: string;
  port: number;
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlDays: number;
  bcryptCost: number;
  dbPath: string;
  logRequests: boolean;
  rateLimit: { windowMs: number; max: number; loginMax: number };
}

export function loadConfig(over: Partial<Config> = {}): Config {
  const env = process.env.NODE_ENV ?? "development";
  const secret = process.env.JWT_SECRET;
  // Production e secret na thakle server start-i hobe na (default secret leak er boro karon)
  if (env === "production" && (!secret || secret.length < 32)) {
    throw new Error("JWT_SECRET (min 32 chars) is required in production");
  }
  return {
    env,
    port: Number(process.env.PORT ?? 3000),
    jwtSecret: secret ?? "dev-only-secret-do-not-use-in-production",
    accessTtlSec: 15 * 60,
    refreshTtlDays: 7,
    bcryptCost: 10,
    dbPath: process.env.DB_PATH ?? ":memory:",
    logRequests: env !== "test",
    rateLimit: { windowMs: 60_000, max: 300, loginMax: 5 },
    ...over,
  };
}
