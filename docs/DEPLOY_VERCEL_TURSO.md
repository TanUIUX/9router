# Deploying 9Router to Vercel with Turso

Vercel runs on an ephemeral filesystem: anything written outside `/tmp` fails, and
`/tmp` itself is wiped between cold starts. 9Router stores all of its state in a
SQLite file (`${DATA_DIR}/db/data.sqlite`), so a plain Vercel deploy would lose
every provider, API key and setting whenever the instance recycles.

This guide wires the database up to [Turso](https://turso.tech) (hosted libSQL) so
state survives cold starts.

## How it works

`src/lib/db/driver.js` tries drivers in order. Turso is now first, but it is only
attempted when `TURSO_DATABASE_URL` is set:

```
turso → bun:sqlite → better-sqlite3 → node:sqlite → sql.js
```

Local development and Docker are therefore completely unaffected — leave the
variable unset and the old behaviour applies.

The adapter (`src/lib/db/adapters/tursoAdapter.js`) uses the `libsql` package,
which exposes a synchronous, better-sqlite3 compatible API. That is why nothing
under `src/lib/db/repos/` had to be rewritten as async.

Two modes are available:

| `TURSO_MODE` | Behaviour |
| --- | --- |
| unset / `replica` | Embedded replica. Local file in `/tmp` acts as a read cache, writes go to Turso, `db.sync()` runs on boot and every 30s. |
| `remote` | Every statement goes over the network to Turso. No local file. Slower, but works on a fully read-only filesystem. |

Tune the pull interval with `TURSO_SYNC_INTERVAL_MS` (default `30000`, `0` disables).

## 1. Create the database

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup

turso db create 9router --location sin   # pick the region closest to your users
turso db show 9router --url              # -> TURSO_DATABASE_URL
turso db tokens create 9router           # -> TURSO_AUTH_TOKEN
```

The schema is created automatically on first boot by `src/lib/db/migrate.js`.

## 2. Configure environment variables

Add these in **Vercel → Project → Settings → Environment Variables**.

| Variable | Value | Why |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | `libsql://...` | Enables the Turso driver |
| `TURSO_AUTH_TOKEN` | token from step 1 | Auth |
| `HOME` | `/tmp` | **Required.** `src/lib/usageDb.js` writes to `~/.9router` and ignores `DATA_DIR`; without this the app crashes on a read-only home directory |
| `DATA_DIR` | `/tmp/9router` | Keeps the replica cache in the only writable path |
| `ENABLE_REQUEST_LOGS` | `false` | Avoids unbounded writes to ephemeral disk |
| `JWT_SECRET` | `openssl rand -hex 32` | Otherwise regenerated per cold start, logging everyone out |
| `API_KEY_SECRET` | `openssl rand -hex 32` | Stable API key encryption |
| `MACHINE_ID_SALT` | `openssl rand -hex 32` | Stable machine identity |
| `INITIAL_PASSWORD` | your password | Default is `123456` — change it |
| `NODE_ENV` | `production` | |
| `AUTH_COOKIE_SECURE` | `true` | Vercel is HTTPS-only |
| `REQUIRE_API_KEY` | `true` | Your endpoint is public |
| `BASE_URL` | `https://<project>.vercel.app` | |
| `NEXT_PUBLIC_BASE_URL` | `https://<project>.vercel.app` | |

## 3. Streaming timeouts

Serverless functions time out long before a long LLM stream finishes. Add this to
the route handlers under `src/app/api/v1/` that stream:

```js
export const runtime = "nodejs";
export const maxDuration = 300; // 60 on the Hobby plan
```

## 4. Verify locally first

```bash
npm install
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run dev
```

The boot log must show:

```
[DB] Driver: turso(replica) | file: /...
```

If you see `[DB] Turso unavailable: ...` instead, read the message — it is almost
always a missing `libsql` prebuilt binary for your platform.

## Caveats

- `libsql` is a native module. It ships prebuilt binaries for `linux-x64-gnu`, but
  if Vercel's build rejects it, set `TURSO_MODE=remote`, or fall back to
  self-hosting via Docker.
- `src/lib/usageDb.js` (`usage.json`, `log.txt`) is **not** stored in Turso. Those
  files still live on ephemeral disk and are lost on cold start.
- Vercel's free plan has no persistent background process, so scheduled work and
  long-lived connections behave differently than on a VPS.
- For a stateful app like 9Router, Docker on a VPS / Fly.io remains the simpler
  and more reliable deployment target.
