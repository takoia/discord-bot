import { type Client } from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";

/**
 * Incoming events: core-backend -> bot. All endpoints require
 * `Authorization: Bearer <SHARED_SECRET>`. The bot owns Discord interactions,
 * so approvals (button messages) MUST be posted from here.
 *
 * P0: auth + health only. Event routes are added in later phases.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${config.SHARED_SECRET}`;
}

export function startHttpServer(_client: Client) {
  const server = Bun.serve({
    port: config.PORT,
    async fetch(req) {
      const url = new URL(req.url);

      // Public health check (no auth) — handy for the demo and uptime probes.
      if (req.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "takoia-discord-bot" });
      }

      if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
      if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);

      return json({ ok: false, error: "not found" }, 404);
    },
  });

  logger.info(`HTTP server listening on :${server.port}`, { endpoints: ["/health"] });
  return server;
}
