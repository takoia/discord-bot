import {
  AttachmentBuilder,
  type Client,
  type Message,
  type SendableChannels,
} from "discord.js";
import { backend } from "./backend.ts";
import { approvalStore, chatBinding } from "./store.ts";
import { logger } from "./logger.ts";
import { approvalMessage } from "./discord/embeds.ts";
import { STEP_LABELS, type JobEvent, type StepName } from "./types.ts";

/**
 * Conversational mode. A channel/thread is bound to an agent (via /chat); every
 * non-bot message there becomes an objective for that agent, and the agent's
 * report is posted back as the reply. Human-in-the-loop still works: an
 * approval_required event posts ✅/❌ buttons in the thread.
 */
const chatStreams = new Map<string, AbortController>();

/** Called on every message; acts only in channels bound to an agent. */
export async function handleChatMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot) return;
  const bind = chatBinding.get(message.channelId);
  if (!bind) return;

  const text = message.content?.trim();
  if (!text) return;

  const channel = message.channel;
  if (channel.isSendable()) await channel.sendTyping().catch(() => {});

  const res = await backend.createObjective({
    agent_id: bind.agentId,
    title: text.slice(0, 80),
    prompt: text,
  });
  if (!res.ok) {
    await message.reply(`⚠️ ${res.error}`).catch(() => {});
    return;
  }

  const jobId = res.data.job_id;
  const placeholder = await message.reply("🤔 *réfléchit…*").catch(() => null);
  logger.info("Chat message -> objective", { jobId, agentId: bind.agentId, channelId: message.channelId });
  subscribeChat(client, jobId, message.channelId, placeholder?.id);
}

function subscribeChat(client: Client, jobId: string, channelId: string, placeholderId?: string) {
  if (chatStreams.has(jobId)) return;
  const ac = new AbortController();
  chatStreams.set(jobId, ac);
  void backend
    .streamJobEvents(jobId, (ev) => handleChatEvent(client, jobId, channelId, placeholderId, ev), ac.signal)
    .catch((err) => logger.warn("Chat SSE ended", { jobId, error: String(err) }))
    .finally(() => chatStreams.delete(jobId));
}

function endChat(jobId: string) {
  chatStreams.get(jobId)?.abort();
  chatStreams.delete(jobId);
}

async function channelOf(client: Client, channelId: string): Promise<SendableChannels | null> {
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch?.isSendable() ? ch : null;
}

async function editPlaceholder(channel: SendableChannels, id: string | undefined, content: string) {
  if (!id) return;
  try {
    const msg = await channel.messages.fetch(id);
    await msg.edit({ content });
  } catch {
    /* placeholder gone — ignore */
  }
}

async function handleChatEvent(
  client: Client,
  jobId: string,
  channelId: string,
  placeholderId: string | undefined,
  ev: JobEvent,
): Promise<void> {
  const channel = await channelOf(client, channelId);
  if (!channel) return;

  switch (ev.kind) {
    case "step_started":
      if (ev.step_type) {
        await editPlaceholder(channel, placeholderId, `🤔 *${STEP_LABELS[ev.step_type]}…*`);
      }
      break;
    case "approval_required": {
      const approvalId = readApprovalId(ev.data);
      const step: StepName = ev.step_type ?? "action";
      if (approvalId) {
        approvalStore.add({ approvalId, jobId, action: ev.message || "Action à valider", step });
        await channel.send(approvalMessage({ approvalId, jobId, action: ev.message || "Action à valider", step }));
      }
      break;
    }
    case "report": {
      const answer = readMarkdown(ev.data) ?? ev.message;
      await postAnswer(channel, placeholderId, jobId, answer);
      endChat(jobId);
      break;
    }
    case "job_status":
      if (ev.status === "failed") {
        await editPlaceholder(channel, placeholderId, "⚠️ L'agent a échoué sur ce message.");
        endChat(jobId);
      }
      break;
  }
}

async function postAnswer(
  channel: SendableChannels,
  placeholderId: string | undefined,
  jobId: string,
  answer: string,
): Promise<void> {
  // Discord messages cap at 2000 chars; long answers go out as a .md file.
  if (answer.length <= 1900) {
    if (placeholderId) {
      await editPlaceholder(channel, placeholderId, answer || "_(réponse vide)_");
      return;
    }
    await channel.send(answer || "_(réponse vide)_");
    return;
  }
  await editPlaceholder(channel, placeholderId, "📄 Réponse complète en pièce jointe :");
  await channel.send({
    files: [new AttachmentBuilder(Buffer.from(answer, "utf-8"), { name: `reponse-${jobId}.md` })],
  });
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
