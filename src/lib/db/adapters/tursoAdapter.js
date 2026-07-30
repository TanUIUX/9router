import { PRAGMA_SQL } from "../schema.js";

// How often the embedded replica pulls changes from Turso.
const SYNC_INTERVAL_MS = Number(process.env.TURSO_SYNC_INTERVAL_MS || 30 * 1000);

function fireAndForget(maybePromise) {
  if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
}

/**
 * Turso / libSQL adapter.
 *
 * Modes:
 *   "replica" (default) — keeps a local SQLite file at `filePath` that is kept in
 *     sync with Turso. Reads hit the local file, writes go straight to the remote
 *     primary. Best fit for serverless: the local file may vanish between cold
 *     starts, it is only a cache.
 *   "remote" (TURSO_MODE=remote) — every statement goes to Turso over the network.
 *     No local file is used. Slower, but works on fully read-only filesystems.
 *
 * Returns null when TURSO_DATABASE_URL is not configured, so driver.js falls back
 * to the existing bun:sqlite / better-sqlite3 / node:sqlite / sql.js chain.
 *
 * The `libsql` package exposes a synchronous better-sqlite3 compatible API, which
 * is why no repo under src/lib/db/repos needs to change.
 */
export async function createTursoAdapter(filePath) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;

  const { default: Database } = await import("libsql");

  const mode = process.env.TURSO_MODE === "remote" ? "remote" : "replica";

  const db =
    mode === "remote"
      ? new Database(url, { authToken })
      : new Database(filePath, { syncUrl: url, authToken });

  if (mode === "replica") {
    // Pull the current state before migrations run.
    try {
      await db.sync();
    } catch (e) {
      console.warn(`[DB] Turso initial sync failed: ${e.message}`);
    }
  }

  // Embedded replicas and remote connections reject some local-only pragmas
  // (WAL in particular). Failing here must not take the app down.
  try {
    db.exec(PRAGMA_SQL);
  } catch (e) {
    console.warn(`[DB] Turso: pragma skipped (${e.message})`);
  }

  const stmtCache = new Map();

  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  let syncTimer = null;
  if (mode === "replica" && SYNC_INTERVAL_MS > 0) {
    syncTimer = setInterval(() => {
      try { fireAndForget(db.sync()); } catch {}
    }, SYNC_INTERVAL_MS);
    if (typeof syncTimer.unref === "function") syncTimer.unref();
  }

  function gracefulClose() {
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: `turso(${mode})`,
    run(sql, params = []) { return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { return db.exec(sql); },
    transaction(fn) {
      if (typeof db.transaction === "function") {
        try {
          return db.transaction(fn)();
        } catch (e) {
          // Remote-only connections may not support interactive transactions.
          if (!/not supported|unsupported/i.test(e?.message || "")) throw e;
        }
      }
      return fn();
    },
    // There is no WAL to truncate; the useful equivalent is pushing/pulling.
    checkpoint() {
      if (mode === "replica") {
        try { fireAndForget(db.sync()); } catch {}
      }
    },
    close() {
      if (syncTimer) clearInterval(syncTimer);
      gracefulClose();
    },
    raw: db,
  };
}
