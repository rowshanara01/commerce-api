# commerce-api: Production-Style Backend (Node.js + TypeScript + Express) #

The core skeleton of almost every software company's backend: **Auth + RBAC + CRUD + Orders (transactions) + security**.
E-commerce, booking, SaaS, fintech: the same pattern shows up everywhere.

## How to run (Node 22.13+) ##

```bash
npm install
npm test                 # 28 tests
npm run dev              # http://localhost:3000  (DB: in-memory; otherwise set DB_PATH=./data.db)
```

Production-like:

```bash
cp .env.example .env     # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD properly
npm run build && npm start
```

Docker:

```bash
docker build -t commerce-api .
docker run -p 3000:3000 -e JWT_SECRET=$(openssl rand -hex 32) commerce-api
```

## Endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | public |
| GET | `/auth/me` | logged in |
| GET | `/products?q=&minPrice=&maxPrice=&sort=&order=&page=&limit=` | public |
| GET | `/products/:id` | public |
| POST / PATCH / DELETE | `/products` (`/:id`) | admin |
| POST | `/orders` (requires `Idempotency-Key` header) | logged in |
| GET | `/orders`, `/orders/:id` | owner / admin |
| POST | `/orders/:id/cancel` | owner / admin |
| PATCH | `/orders/:id/status` | admin |
| GET | `/health` | public |

## What's included (what companies look for)

### Auth & Security
- **Passwords:** bcrypt. **Tokens:** JWT access token (15 min) plus a refresh token (only the hash is stored in the DB), with **rotation and reuse detection**.
- JWT algorithm is pinned (blocks the `alg:none` attack). User enumeration and timing attacks are closed. Mass assignment is closed (a role can't be set at registration).
- **RBAC** (customer / admin) and **IDOR protection** (someone else's order returns 404).
- **Rate limiting:** global, plus login brute-force protection (per IP + email), with a `Retry-After` header.
- helmet, request body size limit, SQL injection protection (parameterized queries, sort whitelist, LIKE escaping), and the app refuses to boot in production with a weak `JWT_SECRET`.

### Data correctness
- Money is stored as **integer cents** (never floats), with a DB-level `CHECK (stock >= 0)` and versioned migrations.
- An order is **a single transaction** (atomic). Stock is decremented with an atomic conditional update, so **overselling can't happen**: 20 parallel orders against a stock of 5 produce exactly 5 successes.
- **Idempotency-Key:** a network retry never creates a duplicate order or a duplicate charge.
- **Order state machine:** placed -> paid -> shipped. Cancelling returns stock, and a double cancel is safe.
- **Soft delete** and **price snapshot** (changing a product's price later doesn't change old orders).

### Operability
- Structured JSON logs with a request id (`X-Request-Id`), a consistent error format, and `/health` (includes a DB check).
- Graceful shutdown (SIGTERM), a multi-stage non-root Dockerfile with a healthcheck, and CI (typecheck + test + audit).

## Limitations (honest notes)

- The rate limiter is in-memory. Running more than one server needs Redis.
- SQLite is fine for a single server. At larger scale, use PostgreSQL (mostly the same SQL, and the transaction concepts are identical).
- Payment gateway, email verification, and password reset are not part of this project.
- `node:sqlite` is still "experimental" in Node. In production, use `better-sqlite3` or PostgreSQL.

## Challenges / next steps

1. Move to PostgreSQL (`pg` plus `SELECT ... FOR UPDATE`, or the same conditional update).
2. Redis rate limiter and a refresh token blacklist.
3. Payment webhook: signature verification and idempotent processing.
4. Email verification and password reset (tokens with expiry).
5. Generate OpenAPI / Swagger docs (`zod-to-openapi`).
6. Prometheus `/metrics` and OpenTelemetry tracing.
7. Cursor pagination (offset gets slow on large pages).
