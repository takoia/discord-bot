import {
  AttachmentBuilder,
  type Client,
  type SendableChannels,
} from "discord.js";
import { backend } from "./backend.ts";
import { logger } from "./logger.ts";
import { approvalStore, store, type TrackedJob } from "./store.ts";
import { JobStatus, type JobEvent, type StepName } from "./types.ts";
import { approvalMessage, jobEmbed, reportEmbed } from "./discord/embeds.ts";

/**
 * Live job tracking. After /objectif creates a job we subscribe to its SSE
 * stream and translate each event into Discord side-effects: edit the living
 * timeline embed, post approval buttons, and deliver the final report.
 *
 * This replaces an inbound HTTP server — core-backend pushes nothing; it
 * exposes SSE and the bot consumes it.
 */
const streams = new Map<string, AbortController>();

export function subscribeJob(client: Client, jobId: string): void {
  if (streams.has(jobId)) return;
  const ac = new AbortController();
  streams.set(jobId, ac);
  logger.info("Subscribing to job events", { jobId });

  void backend
    .streamJobEvents(jobId, (ev) => handleEvent(client, ev), ac.signal)
    .catch((err) => logger.warn("SSE subscription ended with error", { jobId, error: String(err) }))
    .finally(() => streams.delete(jobId));
}

function endStream(jobId: string): void {
  streams.get(jobId)?.abort();
  streams.delete(jobId);
}

function mapJobStatus(status?: string) {
  const parsed = JobStatus.safeParse(status);
  return parsed.success ? parsed.data : undefined;
}

/** Best-effort short string out of a step-output JSON value. */
function extractOutput(data: unknown): string | undefined {
  if (data == null) return undefined;
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["summary", "text", "result", "output"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
    try {
      return JSON.stringify(data);
    } catch {
      return undefined;
    }
  }
  return String(data);
}

async function handleEvent(client: Client, ev: JobEvent): Promise<void> {
  const job = store.get(ev.job_id);
  if (!job) return;

  switch (ev.kind) {
    case "job_status": {
      const s = mapJobStatus(ev.status);
      if (s) store.setJobStatus(ev.job_id, s);
      if (s === "done" || s === "failed") endStream(ev.job_id);
      break;
    }
    case "step_started":
      if (ev.step_type) store.applyEvent(ev.job_id, ev.step_type, "running", undefined, "running");
      break;
    case "step_completed":
      if (ev.step_type) store.applyEvent(ev.job_id, ev.step_type, "done", extractOutput(ev.data));
      break;
    case "approval_required": {
      const approvalId = readApprovalId(ev.data);
      const step: StepName | undefined = ev.step_type ?? "action";
      store.applyEvent(ev.job_id, step, "awaiting_approval", undefined, "awaiting_approval");
      if (approvalId) {
        await postApproval(client, job, {
          approvalId,
          jobId: ev.job_id,
          action: ev.message || "Action sensible à valider",
          step,
        });
      } else {
        logger.warn("approval_required without approval_id", { jobId: ev.job_id });
      }
      break;
    }
    case "report": {
      const markdown = readMarkdown(ev.data) ?? ev.message;
      store.applyEvent(ev.job_id, "restitution", "done", "Rapport livré ✅", "done");
      await deliverReport(client, job, markdown);
      endStream(ev.job_id);
      break;
    }
    case "log":
      // Logs are informational; we keep the timeline clean and skip them.
      return;
  }

  await updateJobMessage(client, job);
}

function readApprovalId(data: unknown): string | undefined {
  if (data && typeof data === "object" && "approval_id" in data) {
    const v = (data as Record<string, unknown>).approval_id;
    if (typeof v === "string") return v;
  }
  return undefined;
}

function readMarkdown(data: unknown): string | undefined {
  if (data && typeof data === "object" && "markdown" in data) {
    const v = (data as Record<string, unknown>).markdown;
    if (typeof v === "string") return v;
  }
  return undefined;
}

async function channelOf(client: Client, job: TrackedJob): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(job.channelId);
    if (channel?.isSendable()) return channel;
  } catch (err) {
    logger.warn("Could not fetch channel", { channelId: job.channelId, error: String(err) });
  }
  return null;
}

async function updateJobMessage(client: Client, job: TrackedJob): Promise<void> {
  if (!job.messageId) return;
  try {
    const channel = await channelOf(client, job);
    if (!channel) return;
    const message = await channel.messages.fetch(job.messageId);
    await message.edit({ embeds: [jobEmbed(job)] });
  } catch (err) {
    logger.error("Failed to update job message", { jobId: job.jobId, error: String(err) });
  }
}

async function postApproval(
  client: Client,
  job: TrackedJob,
  info: { approvalId: string; jobId: string; action: string; step?: StepName },
): Promise<void> {
  const channel = await channelOf(client, job);
  if (!channel) return;
  approvalStore.add(info);
  await channel.send(approvalMessage(info));
  logger.info("Approval posted", { approvalId: info.approvalId, jobId: info.jobId });
}

async function deliverReport(client: Client, job: TrackedJob, markdown: string): Promise<void> {
  const channel = await channelOf(client, job);
  if (!channel) return;

  // Long markdown goes out as a .md attachment; short ones inline in the embed.
  const long = markdown.length > 3500;
  const files = long
    ? [new AttachmentBuilder(Buffer.from(markdown, "utf-8"), { name: `rapport-${job.jobId}.md` })]
    : undefined;
  const summary = long ? "Rapport complet en pièce jointe 📎" : markdown;

  await channel.send({
    embeds: [reportEmbed({ jobId: job.jobId, title: `Rapport — ${job.objective}`, summary })],
    files,
  });
  logger.info("Report delivered", { jobId: job.jobId, attached: long });
}
