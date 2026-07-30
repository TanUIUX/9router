import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

// Native SQLite/libSQL bindings and the SSE handlers need the Node runtime.
export const runtime = "nodejs";
// Keep the function close to users in Vietnam. Mirrors regions in vercel.json.
export const preferredRegion = "sin1";
// Serverless platforms (Vercel) default to ~10s, which cuts LLM streams short.
// 60 is the Hobby plan ceiling; raise to 300 on Pro.
export const maxDuration = 60;
// Never cache or prerender: every call hits a live upstream model.
export const dynamic = "force-dynamic";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}

