import { z } from "zod";

/**
 * Shared types matching the REAL core-backend contract (branch feat/core-mvp).
 * Zod schemas are the single source of truth: REST responses and the SSE event
 * stream are parsed through them, and TS types are inferred so they can't drift.
 *
 * Key facts about the backend:
 *  - Events are delivered over SSE (GET /api/jobs/:id/events, event "progress"),
 *    NOT pushed to the bot. The bot is a client.
 *  - /api is single-tenant and unauthenticated in the MVP.
 *  - snake_case field names throughout.
 */

// --- The 4 steps (snake_case wire values) ---
export const StepName = z.enum(["analyse", "decision", "action", "restitution"]);
export type StepName = z.infer<typeof StepName>;

export const STEP_ORDER: StepName[] = ["analyse", "decision", "action", "restitution"];

export const STEP_LABELS: Record<StepName, string> = {
  analyse: "Analyse",
  decision: "Décision",
  action: "Action",
  restitution: "Restitution",
};

// Step status seen on the wire: running | done | awaiting_approval; plus the
// local-only "pending" (not started yet) and "failed".
export const StepStatus = z.enum(["pending", "running", "done", "awaiting_approval", "failed"]);
export type StepStatus = z.infer<typeof StepStatus>;

// Job lifecycle (domain.rs JobStatus).
export const JobStatus = z.enum(["queued", "running", "awaiting_approval", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

// Agent autonomy (domain.rs AutonomyLevel).
export const AutonomyLevel = z.enum(["full_auto", "confirm_before_action"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

// --- Agents: GET /api/agents -> { agents: [...] } ---
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish().transform((v) => v ?? ""),
  autonomy_level: AutonomyLevel.catch("confirm_before_action"),
  expertise_domain: z.string().nullish().transform((v) => v ?? ""),
  // Per-agent emoji set in the builder (migration 0006). Empty if unset.
  icon: z.string().nullish().transform((v) => v ?? ""),
});
export type Agent = z.infer<typeof AgentSchema>;

export const AgentsResponse = z.object({ agents: z.array(AgentSchema).default([]) });

// --- Objectives: POST /api/objectives ---
export const CreateObjectiveRequest = z.object({
  agent_id: z.string(),
  title: z.string(),
  prompt: z.string(),
});
export type CreateObjectiveRequest = z.infer<typeof CreateObjectiveRequest>;

export const CreateObjectiveResponse = z.object({
  objective_id: z.string(),
  job_id: z.string(),
});
export type CreateObjectiveResponse = z.infer<typeof CreateObjectiveResponse>;

// --- Jobs: GET /api/jobs -> { jobs: [...] } ---
export const JobRow = z.object({
  id: z.string(),
  agent_id: z.string().nullish().transform((v) => v ?? ""),
  status: JobStatus.catch("running"),
  error: z.string().nullish(),
  created_at: z.string().nullish(),
  title: z.string().nullish().transform((v) => v ?? "(sans titre)"),
});
export type JobRow = z.infer<typeof JobRow>;

export const JobsResponse = z.object({ jobs: z.array(JobRow).default([]) });

// --- Job detail: GET /api/jobs/:id -> { job, steps, approvals, report } ---
export const JobStepRow = z.object({
  step_type: StepName,
  status: z.string(),
  input: z.string().nullish(),
  output: z.string().nullish(),
  position: z.number().nullish(),
  finished_at: z.string().nullish(),
});
export type JobStepRow = z.infer<typeof JobStepRow>;

export const JobDetailResponse = z.object({
  job: JobRow,
  steps: z.array(JobStepRow).default([]),
  report: z.string().nullish(),
});
export type JobDetailResponse = z.infer<typeof JobDetailResponse>;

// ===================================================================
// SSE event stream: GET /api/jobs/:id/events (event "progress")
// Shape from src/agent/events.rs (JobEvent).
// ===================================================================
export const EventKind = z.enum([
  "job_status",
  "step_started",
  "step_completed",
  "log",
  "approval_required",
  "report",
]);
export type EventKind = z.infer<typeof EventKind>;

export const JobEventSchema = z.object({
  job_id: z.string(),
  kind: EventKind,
  step_type: StepName.optional(),
  status: z.string().optional(),
  message: z.string().default(""),
  data: z.unknown().optional(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

// --- Approval (button click): POST /api/approvals/:id ---
export type ApprovalDecision = { decision: "approve" | "reject" };

/** Bot-internal record of a pending approval (built from the SSE event). */
export type ApprovalInfo = {
  approvalId: string;
  jobId: string;
  action: string;
  step?: StepName;
};
