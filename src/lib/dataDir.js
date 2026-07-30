import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

// Serverless platforms (Vercel, Lambda, Netlify) run on a read-only filesystem
// where only the OS temp dir is writable, and $HOME frequently points at a
// directory that does not exist and cannot be created (ENOENT on mkdir).
function isServerless() {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    process.env.NETLIFY
  );
}

function tmpDir() {
  return path.join(os.tmpdir(), APP_NAME);
}

function homeDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function defaultDir() {
  return isServerless() ? tmpDir() : homeDir();
}

// Create the directory if needed. Returns the path on success, null on any
// failure. Never throws — callers rely on that.
function tryDir(dir) {
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  const candidates = [];

  if (configured) {
    // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
    // from a Linux-targeted .env or Docker config — they are not valid here.
    if (process.platform === "win32" && /^\//.test(configured)) {
      console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    } else {
      candidates.push(configured);
    }
  }

  candidates.push(defaultDir());
  candidates.push(tmpDir());

  for (const dir of candidates) {
    const resolved = tryDir(dir);
    if (resolved) {
      if (configured && resolved !== configured) {
        console.warn(`[DATA_DIR] '${configured}' unusable → using '${resolved}'`);
      }
      return resolved;
    }
  }

  // Last resort: hand back the temp path without having created it.
  // Importing this module must never throw: src/proxy.js (the Next.js
  // middleware) imports it transitively, and a throw there fails the whole
  // site rather than a single route.
  console.warn(`[DATA_DIR] no writable data directory found → ${tmpDir()}`);
  return tmpDir();
}

export const DATA_DIR = getDataDir();
