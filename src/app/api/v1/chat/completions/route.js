import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

// Native SQLite/libSQL bindings and the SSE handlers need the Node runtime.
export const runtime = "nodejs";
// Serverless platforms (Vercel) default to ~10s, which cuts LLM streams short.
// 60 is the Hobby plan ceiling; raise to 300 on Pro.
export const maxDuration = 60;

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

export async function POST(request) {  
  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

