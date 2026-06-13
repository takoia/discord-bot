import { EmbedBuilder } from "discord.js";
import {
  STEP_LABELS,
  STEP_ORDER,
  type JobStatus,
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
