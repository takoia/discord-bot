import {
  AttachmentBuilder,
  type Client,
  type SendableChannels,
} from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { approvalStore, store } from "../store.ts";
import {
  ApprovalRequestSchema,
  JobEventSchema,
  ReportSchema,
} from "../types.ts";
import { approvalMessage, jobEmbed, reportEmbed } from "../discord/embeds.ts";

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

async function handleApproval(client: Client, raw: unknown): Promise<Response> {
  const parsed = ApprovalRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid payload" }, 400);
  const req = parsed.data;

  // Post in the same channel as the job if we know it, else fail clearly.
  const job = store.get(req.jobId);
  if (!job) {
    logger.warn("Approval for unknown job", { jobId: req.jobId });
    return json({ ok: false, error: "unknown job" }, 404);
  }

  const channel = await fetchSendableChannel(client, job.channelId);
  if (!channel) return json({ ok: false, error: "channel unavailable" }, 500);

  // Reflect the waiting state on the live timeline too.
  if (req.step) {
    store.applyEvent(req.jobId, req.step, "waiting_approval", undefined, "waiting_approval");
    try {
      const msg = await channel.messages.fetch(job.messageId);
      await msg.edit({ embeds: [jobEmbed(job)] });
    } catch {
      /* non-fatal */
    }
  }

  approvalStore.add(req);
  await channel.send(approvalMessage(req));
  logger.info("Approval posted", { approvalId: req.approvalId, jobId: req.jobId });
  return json({ ok: true });
}

async function handleReport(client: Client, raw: unknown): Promise<Response> {
  const parsed = ReportSchema.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid payload" }, 400);
  const report = parsed.data;

  const job = store.get(report.jobId);
  if (!job) {
    logger.warn("Report for unknown job", { jobId: report.jobId });
    return json({ ok: false, error: "unknown job" }, 404);
  }

  const channel = await fetchSendableChannel(client, job.channelId);
  if (!channel) return json({ ok: false, error: "channel unavailable" }, 500);

  // Mark restitution done + job done on the timeline.
  store.applyEvent(report.jobId, "restitution", "done", "Rapport livré ✅", "done");
  try {
    const msg = await channel.messages.fetch(job.messageId);
    await msg.edit({ embeds: [jobEmbed(job)] });
  } catch {
    /* non-fatal */
  }

  // Markdown over ~3500 chars goes out as a .md attachment; short ones inline.
  const files =
    report.markdown.length > 3500
      ? [
          new AttachmentBuilder(Buffer.from(report.markdown, "utf-8"), {
            name: `rapport-${report.jobId}.md`,
          }),
        ]
      : undefined;

  const summary = report.summary ?? (report.markdown.length <= 3500 ? report.markdown : undefined);
  await channel.send({
    embeds: [reportEmbed({ ...report, summary })],
    files,
  });

  logger.info("Report delivered", { jobId: report.jobId, attached: Boolean(files) });
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
          case "/approvals":
            return await handleApproval(client, body);
          case "/reports":
            return await handleReport(client, body);
          default:
            return json({ ok: false, error: "not found" }, 404);
        }
      } catch (err) {
        logger.error("HTTP handler crashed", { path: url.pathname, error: String(err) });
        return json({ ok: false, error: "internal error" }, 500);
      }
    },
  });

  logger.info(`HTTP server listening on :${server.port}`, {
    endpoints: ["/events", "/approvals", "/reports", "/health"],
  });
  return server;
}
