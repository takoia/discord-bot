import { z } from "zod";

/**
 * Shared types matching core-backend JSON payloads. Zod schemas are the single
 * source of truth: incoming HTTP events and command options are parsed through
 * them, and the TS types are inferred so they can never drift.
 *
 * NOTE (contract): these are the bot's assumptions. core-backend's `notify`
 * module aligns to this shape. The 4 steps and statuses are the load-bearing
 * enums — keep them in sync.
 */

// --- The 4 steps of an autonomous agent run ---
export const StepName = z.enum(["analyse", "decision", "action", "restitution"]);
export type StepName = z.infer<typeof StepName>;

export const STEP_ORDER: StepName[] = ["analyse", "decision", "action", "restitution"];

export const STEP_LABELS: Record<StepName, string> = {
  analyse: "Analyse",
  decision: "Décision",
  action: "Action",
  restitution: "Restitution",
};

export const StepStatus = z.enum(["pending", "running", "done", "waiting_approval", "failed"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const JobStatus = z.enum(["queued", "running", "waiting_approval", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const AutonomyLevel = z.enum(["full", "human_in_the_loop"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

// --- Core entities (REST responses) ---
export const StepSchema = z.object({
  name: StepName,
  status: StepStatus,
  output: z.string().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const JobSchema = z.object({
  id: z.string(),
  objective: z.string(),
  agentId: z.string().optional(),
  status: JobStatus,
  steps: z.array(StepSchema).default([]),
  createdAt: z.string().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  autonomy: AutonomyLevel.default("human_in_the_loop"),
});
export type Agent = z.infer<typeof AgentSchema>;

// --- Outgoing REST request bodies ---
export const CreateObjectiveRequest = z.object({
  objective: z.string(),
  agentId: z.string().optional(),
  // Where to push events back so the bot can update the live message.
  channelId: z.string(),
});
export type CreateObjectiveRequest = z.infer<typeof CreateObjectiveRequest>;

// core-backend returns the created job (or at least its id).
export const CreateObjectiveResponse = z.object({
  id: z.string(),
  objective: z.string().optional(),
  status: JobStatus.optional(),
});
export type CreateObjectiveResponse = z.infer<typeof CreateObjectiveResponse>;

// ===================================================================
// Incoming events: backend -> bot (POST /events, /approvals, /reports)
// ===================================================================

export const JobEventSchema = z.object({
  jobId: z.string(),
  objective: z.string().optional(),
  step: StepName,
  status: StepStatus,
  output: z.string().optional(),
  jobStatus: JobStatus.optional(),
  ts: z.string().optional(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const ApprovalRequestSchema = z.object({
  approvalId: z.string(),
  jobId: z.string(),
  action: z.string(),
  reason: z.string().optional(),
  step: StepName.optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ReportSchema = z.object({
  jobId: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  markdown: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;

// Decision sent back to backend on button click: POST /api/approvals/:id
export type ApprovalDecision = {
  decision: "approve" | "reject";
  by: string;
};
