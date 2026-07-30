import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

// Native SQLite/libSQL bindings and the SSE handlers need the Node runtime.
export const runtime = "nodejs";
// Serverless platforms (Vercel) default to ~10s, which cuts LLM streams short.
// 60 is the Hobby plan ceiling; raise to 300 on Pro.
export const maxDuration = 60;

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

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
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}
