import type { StepName, StepStatus, JobStatus } from "./types.ts";
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
