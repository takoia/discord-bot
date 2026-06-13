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
  type ApprovalRequest,
  type Job,
  type JobStatus,
  type Report,
  type StepStatus,
} from "../types.ts";
import type { TrackedJob } from "../store.ts";

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "◻️",
  running: "⏳",
  done: "✅",
  waiting_approval: "⏸️",
  failed: "❌",
};

const JOB_COLOR: Record<JobStatus, number> = {
  queued: 0x95a5a6,
  running: 0x3498db,
  waiting_approval: 0xe67e22,
  done: 0x2ecc71,
  failed: 0xe74c3c,
};

const JOB_BADGE: Record<JobStatus, string> = {
  queued: "🕓 en file",
  running: "🔵 en cours",
  waiting_approval: "🟠 attente validation",
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
    const icon = STATUS_ICON[s.status];
    const label = `${icon} ${i + 1}. ${STEP_LABELS[step]}`;
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
export function approvalMessage(req: ApprovalRequest): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setAuthor({ name: "Takoia · Validation requise" })
    .setTitle("⏸️ L'agent demande votre accord")
    .setDescription(`**Action proposée**\n${truncate(req.action, 1000)}`)
    .setFooter({ text: `job ${req.jobId}` });

  if (req.reason) embed.addFields({ name: "Pourquoi", value: truncate(req.reason, 1000) });
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
export function decisionEmbed(req: ApprovalRequest, approved: boolean, by: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(approved ? 0x2ecc71 : 0xe74c3c)
    .setAuthor({ name: "Takoia · Validation requise" })
    .setTitle(approved ? "✅ Action validée" : "❌ Action refusée")
    .setDescription(truncate(req.action, 1000))
    .addFields({ name: "Décision par", value: by, inline: true })
    .setFooter({ text: `job ${req.jobId}` });
}

/** Summary embed for the final deliverable. */
export function reportEmbed(report: Report): EmbedBuilder {
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
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🤖 Agents disponibles");

  if (agents.length === 0) {
    embed.setDescription("Aucun agent disponible.");
    return embed;
  }

  for (const a of agents.slice(0, 25)) {
    const autonomy = a.autonomy === "full" ? "🟢 autonomie totale" : "🟠 validation humaine";
    embed.addFields({
      name: `${a.name}  (\`${a.id}\`)`,
      value: `${a.description ? truncate(a.description, 200) + "\n" : ""}${autonomy}`,
    });
  }
  return embed;
}

export function jobsListEmbed(jobs: Job[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("🗂️ Jobs récents");

  if (jobs.length === 0) {
    embed.setDescription("Aucun job pour le moment.");
    return embed;
  }

  const lines = jobs.slice(0, 15).map((j) => {
    return `${JOB_BADGE[j.status]} \`${j.id}\` — ${truncate(j.objective, 80)}`;
  });
  embed.setDescription(lines.join("\n"));
  return embed;
}

/** Detailed view for /status — built from a full Job (REST), not the local store. */
export function jobDetailEmbed(job: Job): EmbedBuilder {
  const byName = new Map(job.steps.map((s) => [s.name, s]));
  const lines = STEP_ORDER.map((step, i) => {
    const s = byName.get(step);
    const status = s?.status ?? "pending";
    const icon = STATUS_ICON[status];
    const out = s?.output ? `\n     ↳ ${truncate(s.output, 180)}` : "";
    return `${icon} ${i + 1}. ${STEP_LABELS[step]}${out}`;
  });

  return new EmbedBuilder()
    .setColor(JOB_COLOR[job.status])
    .setAuthor({ name: "Takoia · Détail du job" })
    .setTitle(`🎯 ${truncate(job.objective, 240)}`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `job ${job.id} · ${JOB_BADGE[job.status]}` });
}
