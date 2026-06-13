import { config } from "./config.ts";
import { logger } from "./logger.ts";
import {
  AgentSchema,
  CreateObjectiveResponse,
  JobSchema,
  type Agent,
  type ApprovalDecision,
  type CreateObjectiveRequest,
  type Job,
} from "./types.ts";
import { z } from "zod";

/**
 * Typed REST client for core-backend. Every call returns a discriminated
 * Result instead of throwing, so callers (slash commands, button handlers)
 * can degrade gracefully and never crash the bot mid-demo.
 */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const TIMEOUT_MS = 10_000;

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<Result<z.infer<S>>> {
  const url = `${config.BACKEND_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.SHARED_SECRET}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("Backend returned non-2xx", { path, status: res.status, body: body.slice(0, 200) });
      return { ok: false, error: `Backend ${res.status}` };
    }

    const json = await res.json().catch(() => null);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      logger.error("Backend response failed validation", { path, issues: parsed.error.issues });
      return { ok: false, error: "Réponse backend invalide" };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Backend request failed", { path, error: msg });
    return { ok: false, error: "Backend injoignable" };
  }
}

export const backend = {
  async createObjective(body: CreateObjectiveRequest): Promise<Result<CreateObjectiveResponse>> {
    return request("/api/objectives", CreateObjectiveResponse, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  async listAgents(): Promise<Result<Agent[]>> {
    return request("/api/agents", z.array(AgentSchema), { method: "GET" });
  },

  async listJobs(status?: string): Promise<Result<Job[]>> {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request(`/api/jobs${q}`, z.array(JobSchema), { method: "GET" });
  },

  async getJob(id: string): Promise<Result<Job>> {
    return request(`/api/jobs/${encodeURIComponent(id)}`, JobSchema, { method: "GET" });
  },

  async sendApproval(approvalId: string, decision: ApprovalDecision): Promise<Result<unknown>> {
    return request(`/api/approvals/${encodeURIComponent(approvalId)}`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(decision),
    });
  },

  /** Lightweight health probe for /ping. */
  async health(): Promise<Result<unknown>> {
    return request("/api/health", z.unknown(), { method: "GET" });
  },
};
