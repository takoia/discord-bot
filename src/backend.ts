import { config } from "./config.ts";
import { logger } from "./logger.ts";
import {
  AgentsResponse,
  CreateObjectiveResponse,
  JobDetailResponse,
  JobEventSchema,
  JobsResponse,
  type Agent,
  type ApprovalDecision,
  type CreateObjectiveRequest,
  type JobDetailResponse as JobDetail,
  type JobEvent,
  type JobRow,
} from "./types.ts";
import { z } from "zod";

/**
 * Typed client for core-backend. REST calls return a discriminated Result
 * (never throw), so commands degrade gracefully. The SSE consumer turns the
 * live job-event stream into callback invocations.
 *
 * The MVP backend is unauthenticated; we still send the bearer if a shared
 * secret is configured (forward-compatible, harmless otherwise).
 */
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const TIMEOUT_MS = 10_000;

function authHeaders(): Record<string, string> {
  return config.SHARED_SECRET ? { Authorization: `Bearer ${config.SHARED_SECRET}` } : {};
}

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
      headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
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
    const res = await request("/api/agents", AgentsResponse, { method: "GET" });
    return res.ok ? { ok: true, data: res.data.agents } : res;
  },

  async listJobs(): Promise<Result<JobRow[]>> {
    const res = await request("/api/jobs", JobsResponse, { method: "GET" });
    return res.ok ? { ok: true, data: res.data.jobs } : res;
  },

  async getJob(id: string): Promise<Result<JobDetail>> {
    return request(`/api/jobs/${encodeURIComponent(id)}`, JobDetailResponse, { method: "GET" });
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

  /**
   * Consume the live SSE stream for a job, invoking `onEvent` per parsed event.
   * Resolves when the stream closes (or is aborted). Never throws.
   */
  async streamJobEvents(
    jobId: string,
    onEvent: (ev: JobEvent) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const url = `${config.BACKEND_URL}/api/jobs/${encodeURIComponent(jobId)}/events`;
    try {
      const res = await fetch(url, {
        method: "GET",
        signal,
        headers: { Accept: "text/event-stream", ...authHeaders() },
      });
      if (!res.ok || !res.body) {
        logger.warn("SSE connect failed", { jobId, status: res.status });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line.
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;

          const payload = dataLines.join("\n");
          if (payload === "keep-alive" || payload === "") continue;

          try {
            const parsed = JobEventSchema.safeParse(JSON.parse(payload));
            if (parsed.success) await onEvent(parsed.data);
            else logger.debug("Unparseable SSE event", { jobId, issues: parsed.error.issues });
          } catch {
            /* non-JSON line (e.g. keep-alive text) — ignore */
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return; // expected on teardown
      logger.warn("SSE stream error", { jobId, error: err instanceof Error ? err.message : String(err) });
    }
  },
};
