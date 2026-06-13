import { type Client, type SendableChannels } from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { store } from "../store.ts";
import { JobEventSchema } from "../types.ts";
import { jobEmbed } from "../discord/embeds.ts";

/**
 * Incoming events: core-backend -> bot. All endpoints require
 * `Authorization: Bearer <SHARED_SECRET>`. The bot owns Discord interactions,
 * so approvals (button messages) MUST be posted from here.
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

/** Resolve a sendable text channel by id, or null. */
async function fetchSendableChannel(
  client: Client,
  channelId: string,
): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isSendable()) return channel;
  } catch (err) {
    logger.warn("Could not fetch channel", { channelId, error: String(err) });
  }
  return null;
}

async function handleEvent(client: Client, raw: unknown): Promise<Response> {
  const parsed = JobEventSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid payload" }, 400);
  const ev = parsed.data;

  const job = store.applyEvent(ev.jobId, ev.step, ev.status, ev.output, ev.jobStatus);
  if (!job) {
    logger.warn("Event for unknown job (bot may have restarted)", { jobId: ev.jobId });
    return json({ ok: false, error: "unknown job" }, 404);
  }

  // Edit the living message in place.
  try {
    const channel = await fetchSendableChannel(client, job.channelId);
    if (channel) {
      const message = await channel.messages.fetch(job.messageId);
      await message.edit({ embeds: [jobEmbed(job)] });
    }
  } catch (err) {
    logger.error("Failed to update job message", { jobId: ev.jobId, error: String(err) });
  }

  return json({ ok: true });
}

export function startHttpServer(client: Client) {
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

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: "invalid json" }, 400);
      }

      try {
        switch (url.pathname) {
          case "/events":
            return await handleEvent(client, body);
          default:
            return json({ ok: false, error: "not found" }, 404);
        }
      } catch (err) {
        logger.error("HTTP handler crashed", { path: url.pathname, error: String(err) });
        return json({ ok: false, error: "internal error" }, 500);
      }
    },
  });

  logger.info(`HTTP server listening on :${server.port}`, { endpoints: ["/events", "/health"] });
  return server;
}
