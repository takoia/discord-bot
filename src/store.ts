import type { StepName, StepStatus, JobStatus, ApprovalInfo } from "./types.ts";
import { STEP_ORDER } from "./types.ts";

/**
 * In-memory link between a backend jobId and the live Discord message that
 * tracks it, plus the locally-known step state (events are partial updates).
 *
 * Hackathon scope: single process, no persistence. If the bot restarts the
 * mapping is lost and old messages stop updating — acceptable for the demo,
 * documented in the README.
 */
export type TrackedJob = {
  jobId: string;
  objective: string;
  channelId: string;
  messageId: string;
  jobStatus: JobStatus;
  steps: Record<StepName, { status: StepStatus; output?: string }>;
};

function freshSteps(): TrackedJob["steps"] {
  return Object.fromEntries(
    STEP_ORDER.map((s) => [s, { status: "pending" as StepStatus }]),
  ) as TrackedJob["steps"];
}

const jobs = new Map<string, TrackedJob>();

export const store = {
  create(jobId: string, objective: string, channelId: string, messageId: string): TrackedJob {
    const job: TrackedJob = {
      jobId,
      objective,
      channelId,
      messageId,
      jobStatus: "running",
      steps: freshSteps(),
    };
    jobs.set(jobId, job);
    return job;
  },

  get(jobId: string): TrackedJob | undefined {
    return jobs.get(jobId);
  },

  /** Apply a partial step update and return the job (or undefined if unknown). */
  applyEvent(
    jobId: string,
    step: StepName,
    status: StepStatus,
    output?: string,
    jobStatus?: JobStatus,
  ): TrackedJob | undefined {
    const job = jobs.get(jobId);
    if (!job) return undefined;
    job.steps[step] = { status, output: output ?? job.steps[step]?.output };
    if (jobStatus) job.jobStatus = jobStatus;
    return job;
  },

  setJobStatus(jobId: string, status: JobStatus): TrackedJob | undefined {
    const job = jobs.get(jobId);
    if (job) job.jobStatus = status;
    return job;
  },
};

// --- Pending approvals: keep the original info so the button handler can
// rebuild the decision recap, and guard against double-clicks. ---
const approvals = new Map<string, ApprovalInfo>();

export const approvalStore = {
  add(req: ApprovalInfo) {
    approvals.set(req.approvalId, req);
  },
  /** Consume once: returns the info and removes it (prevents double-decide). */
  take(approvalId: string): ApprovalInfo | undefined {
    const req = approvals.get(approvalId);
    if (req) approvals.delete(approvalId);
    return req;
  },
};

// --- Pending objective: set by /objectif, consumed when the user clicks an
// agent button to launch. One in-flight objective per user. ---
const pendingObjectives = new Map<string, { text: string; channelId: string }>();

export const pendingObjective = {
  set(userId: string, p: { text: string; channelId: string }) {
    pendingObjectives.set(userId, p);
  },
  /** Consume once: returns the pending objective and clears it. */
  take(userId: string): { text: string; channelId: string } | undefined {
    const p = pendingObjectives.get(userId);
    if (p) pendingObjectives.delete(userId);
    return p;
  },
};

// --- Chat bindings: a channel/thread bound to an agent. Every (non-bot)
// message there is sent to that agent as an objective. ---
const chatBindings = new Map<string, { agentId: string; name: string }>();

export const chatBinding = {
  bind(channelId: string, agent: { agentId: string; name: string }) {
    chatBindings.set(channelId, agent);
  },
  get(channelId: string): { agentId: string; name: string } | undefined {
    return chatBindings.get(channelId);
  },
  unbind(channelId: string) {
    chatBindings.delete(channelId);
  },
};
