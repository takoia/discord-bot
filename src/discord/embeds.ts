import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import {
  STEP_LABELS,
  STEP_ORDER,
  type Agent,
  type ApprovalInfo,
  type JobDetailResponse,
  type JobRow,
  type JobStatus,
} from "../types.ts";
import type { TrackedJob } from "../store.ts";

/** Icon for any step status string (tolerant to unknown values). */
function stepIcon(status: string): string {
  switch (status) {
    case "running":
      return "⏳";
    case "done":
      return "✅";
    case "awaiting_approval":
      return "⏸️";
    case "failed":
      return "❌";
    default:
      return "◻️"; // pending / unknown
  }
}

const JOB_COLOR: Record<JobStatus, number> = {
  queued: 0x95a5a6,
  running: 0x3498db,
  awaiting_approval: 0xe67e22,
  done: 0x2ecc71,
  failed: 0xe74c3c,
};

const JOB_BADGE: Record<JobStatus, string> = {
  queued: "🕓 en file",
  running: "🔵 en cours",
  awaiting_approval: "🟠 attente validation",
  done: "🟢 terminé",
  failed: "🔴 échec",
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** The "living" timeline embed for a job, rebuilt from local step state. */
export function jobEmbed(job: TrackedJob): EmbedBuilder {
  const lines = STEP_ORDER.map((step, i) => {
    const s = job.steps[step];
    const label = `${stepIcon(s.status)} ${i + 1}. ${STEP_LABELS[step]}`;
    const out = s.output ? `\n     ↳ ${truncate(s.output, 180)}` : "";
    return label + out;
  });

  return new EmbedBuilder()
    .setColor(JOB_COLOR[job.jobStatus])
    .setAuthor({ name: "Takoia · Agent autonome" })
    .setTitle(`🎯 ${truncate(job.objective, 240)}`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `job ${job.jobId} · ${JOB_BADGE[job.jobStatus]}` })
    .setTimestamp(new Date());
}

/** Embed + buttons for a human-in-the-loop approval request. */
export function approvalMessage(req: ApprovalInfo): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: "Takoia · Validation requise" })
    .setTitle("⏸️ L'agent demande votre accord")
    .setDescription(`**Action proposée**\n${truncate(req.action, 1500)}`)
    .setFooter({ text: `job ${req.jobId}` });

  if (req.step) embed.addFields({ name: "Étape", value: STEP_LABELS[req.step], inline: true });

  // approvalId is encoded in the customId so the click handler knows the target.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${req.approvalId}`)
      .setLabel("Valider")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject:${req.approvalId}`)
      .setLabel("Refuser")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

/** Decision recap embed shown after a button is clicked (buttons disabled). */
export function decisionEmbed(req: ApprovalInfo, approved: boolean, by: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(approved ? 0x2ecc71 : 0xe74c3c)
    .setAuthor({ name: "Takoia · Validation requise" })
    .setTitle(approved ? "✅ Action validée" : "❌ Action refusée")
    .setDescription(truncate(req.action, 1000))
    .addFields({ name: "Décision par", value: by, inline: true })
    .setFooter({ text: `job ${req.jobId}` });
}

/** Summary embed for the final deliverable. */
export function reportEmbed(report: { jobId: string; title?: string; summary?: string }): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: "Takoia · Livrable" })
    .setTitle(`📄 ${truncate(report.title ?? "Rapport final", 240)}`)
    .setFooter({ text: `job ${report.jobId}` })
    .setTimestamp(new Date());

  if (report.summary) embed.setDescription(truncate(report.summary, 3500));
  return embed;
}

export function agentsEmbed(agents: Agent[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🤖 Agents disponibles");

  if (agents.length === 0) {
    embed.setDescription("Aucun agent disponible.");
    return embed;
  }

  for (const a of agents.slice(0, 25)) {
    const autonomy =
      a.autonomy_level === "full_auto" ? "🟢 autonomie totale" : "🟠 validation humaine";
    const domain = a.expertise_domain ? ` · ${a.expertise_domain}` : "";
    embed.addFields({
      name: `${a.name}  (\`${a.id}\`)`,
      value: `${a.description ? truncate(a.description, 180) + "\n" : ""}${autonomy}${domain}`,
    });
  }
  return embed;
}

export function jobsListEmbed(jobs: JobRow[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("🗂️ Jobs récents");

  if (jobs.length === 0) {
    embed.setDescription("Aucun job pour le moment.");
    return embed;
  }

  const lines = jobs.slice(0, 15).map((j) => {
    const badge = JOB_BADGE[j.status] ?? j.status;
    return `${badge} \`${j.id.slice(0, 8)}\` — ${truncate(j.title, 80)}`;
  });
  embed.setDescription(lines.join("\n"));
  return embed;
}

/** Detailed view for /status — built from GET /api/jobs/:id. */
export function jobDetailEmbed(detail: JobDetailResponse): EmbedBuilder {
  const byType = new Map(detail.steps.map((s) => [s.step_type, s]));
  const lines = STEP_ORDER.map((step, i) => {
    const s = byType.get(step);
    const status = s?.status ?? "pending";
    const out = s?.output ? `\n     ↳ ${truncate(s.output, 180)}` : "";
    return `${stepIcon(status)} ${i + 1}. ${STEP_LABELS[step]}${out}`;
  });

  const embed = new EmbedBuilder()
    .setColor(JOB_COLOR[detail.job.status])
    .setAuthor({ name: "Takoia · Détail du job" })
    .setTitle(`🎯 ${truncate(detail.job.title, 240)}`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `job ${detail.job.id} · ${JOB_BADGE[detail.job.status] ?? detail.job.status}` });

  if (detail.report) {
    embed.addFields({ name: "Rapport", value: truncate(detail.report, 1000) });
  }
  return embed;
}
