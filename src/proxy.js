import { proxy as dashboardProxy } from "./dashboardGuard";

export default async function proxy(request) {
  return dashboardProxy(request);
}

// The LLM API prefixes are deliberately excluded below. They authenticate
// themselves inside handleChat, and keeping them out of the middleware avoids
// loading the whole DB layer a second time in the middleware bundle on every
// cold start.
//
// This is only safe while settings.requireApiKey is enabled — handleChat skips
// the API key check when it is off, and nothing else guards these paths.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|v1/|v1$|v1beta/|v1beta$|codex/|codex$|api/v1/|api/v1beta/).*)",
  ],
};
