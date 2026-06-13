/**
 * Mock core-backend — DEMO SAFETY NET.
 *
 * Mirrors the REAL core-backend contract (branch feat/core-mvp) closely enough
 * to drive the bot end-to-end without the Rust backend:
 *   - GET  /api/health
 *   - GET  /api/agents                              -> { agents: [...] }
 *   - POST /api/objectives {agent_id,title,prompt}  -> { objective_id, job_id }
 *   - GET  /api/jobs                                -> { jobs: [...] }
 *   - GET  /api/jobs/:id                            -> { job, steps, report }
 *   - GET  /api/jobs/:id/events                     -> SSE stream (event "progress")
 *   - POST /api/approvals/:id {decision}            -> { status, job_id }
 *
 * It plays the 4 steps on timers and pauses for one human approval.
 *
 * Run:  PORT=8080 bun run scripts/mock-backend.ts
 * Then point the bot's BACKEND_URL at http://localhost:8080
 */
const PORT = Number(process.env.PORT ?? 8080);

type StepName = "analyse" | "decision" | "action" | "restitution";
type JobEvent = {
  job_id: string;
  kind: "job_status" | "step_started" | "step_completed" | "log" | "approval_required" | "report";
  step_type?: StepName;
  status?: string;
  message: string;
  data?: unknown;
};
type Job = {
  id: string;
  agent_id: string;
  title: string;
  prompt: string;
  status: string;
  steps: { step_type: StepName; status: string; output: string }[];
  report: string | null;
};

const STEPS: StepName[] = ["analyse", "decision", "action", "restitution"];
const jobs = new Map<string, Job>();
const eventLog = new Map<string, JobEvent[]>();
const subscribers = new Map<string, Set<(ev: JobEvent) => void>>();
const pendingApprovals = new Map<string, { jobId: string; resolve: (ok: boolean) => void }>();

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function publish(jobId: string, ev: JobEvent) {
  (eventLog.get(jobId) ?? eventLog.set(jobId, []).get(jobId)!).push(ev);
  for (const sub of subscribers.get(jobId) ?? []) sub(ev);
  console.log(`  · event ${ev.kind}${ev.step_type ? `/${ev.step_type}` : ""} (${jobId.slice(0, 8)})`);
}

function setStep(job: Job, step: StepName, status: string, output = "") {
  const s = job.steps.find((x) => x.step_type === step)!;
  s.status = status;
  if (output) s.output = output;
}

async function runJob(job: Job) {
  publish(job.id, { job_id: job.id, kind: "job_status", status: "running", message: "job started" });

  // 1. Analyse
  setStep(job, "analyse", "running");
  publish(job.id, { job_id: job.id, kind: "step_started", step_type: "analyse", status: "running", message: "analyse started" });
  await wait(2200);
  setStep(job, "analyse", "done", "12 sources collectées, 3 retenues");
  publish(job.id, { job_id: job.id, kind: "step_completed", step_type: "analyse", status: "done", message: "analyse completed", data: { summary: "12 sources collectées, 3 retenues" } });

  // 2. Décision
  setStep(job, "decision", "running");
  publish(job.id, { job_id: job.id, kind: "step_started", step_type: "decision", status: "running", message: "decision started" });
  await wait(2200);
  setStep(job, "decision", "done", "Plan: synthèse comparative + tableau des tendances");
  publish(job.id, { job_id: job.id, kind: "step_completed", step_type: "decision", status: "done", message: "decision completed", data: { summary: "Plan: synthèse comparative + tableau des tendances" } });

  // 3. Action — human-in-the-loop approval
  const approvalId = crypto.randomUUID();
  setStep(job, "action", "awaiting_approval");
  job.status = "awaiting_approval";
  publish(job.id, { job_id: job.id, kind: "job_status", status: "awaiting_approval", message: "awaiting approval" });
  publish(job.id, {
    job_id: job.id,
    kind: "approval_required",
    step_type: "action",
    status: "awaiting_approval",
    message: "Publier le rapport de veille et notifier l'équipe sur #veille",
    data: { approval_id: approvalId },
  });

  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(approvalId, { jobId: job.id, resolve });
  });

  if (!approved) {
    setStep(job, "action", "failed", "Action refusée par l'utilisateur");
    job.status = "failed";
    publish(job.id, { job_id: job.id, kind: "job_status", status: "failed", message: "rejected by user" });
    return;
  }

  setStep(job, "action", "running");
  publish(job.id, { job_id: job.id, kind: "job_status", status: "running", message: "resuming" });
  publish(job.id, { job_id: job.id, kind: "step_started", step_type: "action", status: "running", message: "action started" });
  await wait(2200);
  setStep(job, "action", "done", "Rapport généré et publié");
  publish(job.id, { job_id: job.id, kind: "step_completed", step_type: "action", status: "done", message: "action completed", data: { summary: "Rapport généré et publié" } });

  // 4. Restitution + report
  setStep(job, "restitution", "running");
  publish(job.id, { job_id: job.id, kind: "step_started", step_type: "restitution", status: "running", message: "restitution started" });
  await wait(1500);

  const markdown = `# Veille — Agents IA autonomes\n\n## Synthèse\nLes frameworks d'agents convergent vers le pattern planifier → agir → observer.\n\n## Tendances clés\n- **Autonomie graduée** : human-in-the-loop sur les actions à effet de bord.\n- **Outillage** : explosion des intégrations (MCP, function calling).\n- **Éval** : passage de benchmarks statiques à des tâches multi-étapes.\n\n_Rapport généré automatiquement par un agent Takoia._`;

  setStep(job, "restitution", "done", "Rapport livré");
  job.status = "done";
  job.report = markdown;
  publish(job.id, { job_id: job.id, kind: "report", step_type: "restitution", status: "done", message: "final report ready", data: { markdown } });
  publish(job.id, { job_id: job.id, kind: "job_status", status: "done", message: "done" });
}

const MOCK_AGENTS = [
  { id: "researcher", name: "Veilleur", description: "Veille web et synthèse", autonomy_level: "confirm_before_action", expertise_domain: "veille" },
  { id: "writer", name: "Rédacteur", description: "Production de contenus", autonomy_level: "full_auto", expertise_domain: "rédaction" },
];

function sseResponse(jobId: string): Response {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: JobEvent) =>
        controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(ev)}\n\n`));
      // Replay any events emitted before this client connected, then go live.
      for (const ev of eventLog.get(jobId) ?? []) send(ev);
      const set = subscribers.get(jobId) ?? subscribers.set(jobId, new Set()).get(jobId)!;
      set.add(send);
      unsub = () => set.delete(send);
    },
    cancel() {
      unsub?.();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/api/health") return json({ status: "ok", service: "takoia-core-mock" });
    if (url.pathname === "/api/agents") return json({ agents: MOCK_AGENTS });

    if (url.pathname === "/api/jobs" && req.method === "GET") {
      return json({
        jobs: [...jobs.values()].reverse().map((j) => ({
          id: j.id,
          agent_id: j.agent_id,
          status: j.status,
          error: null,
          created_at: new Date().toISOString(),
          title: j.title,
        })),
      });
    }

    const eventsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === "GET") return sseResponse(eventsMatch[1]!);

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const job = jobs.get(jobMatch[1]!);
      if (!job) return json({ error: "not found" }, 404);
      return json({
        job: { id: job.id, agent_id: job.agent_id, status: job.status, error: null, created_at: new Date().toISOString(), title: job.title },
        steps: job.steps.map((s, i) => ({ ...s, input: "", position: i, finished_at: null })),
        report: job.report,
      });
    }

    if (url.pathname === "/api/objectives" && req.method === "POST") {
      const body = (await req.json()) as { agent_id: string; title: string; prompt: string };
      const job_id = crypto.randomUUID();
      const objective_id = crypto.randomUUID();
      const job: Job = {
        id: job_id,
        agent_id: body.agent_id ?? "researcher",
        title: body.title ?? body.prompt?.slice(0, 80) ?? "(sans titre)",
        prompt: body.prompt ?? "",
        status: "queued",
        steps: STEPS.map((step_type) => ({ step_type, status: "pending", output: "" })),
        report: null,
      };
      jobs.set(job_id, job);
      eventLog.set(job_id, []);
      console.log(`✚ Job ${job_id.slice(0, 8)}: "${job.title}" (agent ${job.agent_id})`);
      void runJob(job);
      return json({ objective_id, job_id });
    }

    const apprMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (apprMatch && req.method === "POST") {
      const id = apprMatch[1]!;
      const body = (await req.json()) as { decision: string };
      const pending = pendingApprovals.get(id);
      if (!pending) return json({ error: "approval not found" }, 404);
      pendingApprovals.delete(id);
      const approved = body.decision === "approve";
      pending.resolve(approved);
      console.log(`✔ Approval ${id.slice(0, 8)} → ${body.decision}`);
      return json({ status: approved ? "approved" : "rejected", job_id: pending.jobId });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`🧪 Mock core-backend (SSE) on :${PORT}`);
