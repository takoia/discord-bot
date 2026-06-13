/**
 * Mock core-backend — DEMO SAFETY NET.
 *
 * Implements just enough of the contract to drive the bot end-to-end without
 * the real backend: it accepts an objective, then plays the 4 steps on a timer,
 * pushing events to the bot, requesting one human approval, and delivering a
 * final report. Lets you rehearse / fall back during the live demo.
 *
 * Run:  BOT_URL=http://localhost:3000 SHARED_SECRET=... PORT=8080 bun run scripts/mock-backend.ts
 * Then point the bot's BACKEND_URL at this server.
 */
const PORT = Number(process.env.PORT ?? 8080);
const BOT_URL = process.env.BOT_URL ?? "http://localhost:3000";
const SECRET = process.env.SHARED_SECRET ?? "change-me";

type StepName = "analyse" | "decision" | "action" | "restitution";
type Job = {
  id: string;
  objective: string;
  channelId: string;
  status: string;
  steps: { name: StepName; status: string; output?: string }[];
};

const jobs = new Map<string, Job>();
let seq = 0;

function freshSteps(): Job["steps"] {
  return (["analyse", "decision", "action", "restitution"] as StepName[]).map((name) => ({
    name,
    status: "pending",
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function push(path: string, body: unknown) {
  try {
    const res = await fetch(`${BOT_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(body),
    });
    console.log(`→ POST ${path} [${res.status}]`);
  } catch (err) {
    console.error(`→ POST ${path} FAILED:`, String(err));
  }
}

function setStep(job: Job, name: StepName, status: string, output?: string) {
  const s = job.steps.find((x) => x.name === name)!;
  s.status = status;
  if (output) s.output = output;
}

// Resolves when the bot calls back POST /api/approvals/:id
const pendingApprovals = new Map<string, (approved: boolean) => void>();

async function runJob(job: Job) {
  // 1. Analyse
  setStep(job, "analyse", "running");
  await push("/events", { jobId: job.id, step: "analyse", status: "running", jobStatus: "running" });
  await wait(2500);
  setStep(job, "analyse", "done", "12 sources collectées, 3 retenues");
  await push("/events", { jobId: job.id, step: "analyse", status: "done", output: "12 sources collectées, 3 retenues" });

  // 2. Décision
  setStep(job, "decision", "running");
  await push("/events", { jobId: job.id, step: "decision", status: "running" });
  await wait(2500);
  setStep(job, "decision", "done", "Plan: synthèse comparative + tableau des tendances");
  await push("/events", { jobId: job.id, step: "decision", status: "done", output: "Plan: synthèse comparative + tableau des tendances" });

  // 3. Action — human-in-the-loop approval
  setStep(job, "action", "waiting_approval");
  job.status = "waiting_approval";
  const approvalId = `appr_${++seq}`;
  await push("/approvals", {
    approvalId,
    jobId: job.id,
    action: "Publier le rapport de veille et notifier l'équipe sur #veille",
    reason: "L'action est externe (publication) — validation requise.",
    step: "action",
  });

  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(approvalId, resolve);
  });

  if (!approved) {
    setStep(job, "action", "failed", "Action refusée par l'utilisateur");
    job.status = "failed";
    await push("/events", { jobId: job.id, step: "action", status: "failed", output: "Refusé par l'utilisateur", jobStatus: "failed" });
    return;
  }

  setStep(job, "action", "running");
  await push("/events", { jobId: job.id, step: "action", status: "running", jobStatus: "running" });
  await wait(2500);
  setStep(job, "action", "done", "Rapport généré et publié");
  await push("/events", { jobId: job.id, step: "action", status: "done", output: "Rapport généré et publié" });

  // 4. Restitution + report
  setStep(job, "restitution", "running");
  await push("/events", { jobId: job.id, step: "restitution", status: "running" });
  await wait(1500);

  const markdown = `# Veille — Agents IA autonomes\n\n## Synthèse\nLes frameworks d'agents convergent vers le pattern planifier → agir → observer.\n\n## Tendances clés\n- **Autonomie graduée** : human-in-the-loop sur les actions à effet de bord.\n- **Outillage** : explosion des intégrations (MCP, function calling).\n- **Éval** : passage de benchmarks statiques à des tâches multi-étapes.\n\n## Sources\n1. ...\n2. ...\n3. ...\n\n_Rapport généré automatiquement par un agent Takoia._`;

  setStep(job, "restitution", "done", "Rapport livré");
  job.status = "done";
  await push("/reports", {
    jobId: job.id,
    title: "Veille agents IA — rapport",
    summary: "Synthèse de 3 sources : autonomie graduée, outillage en expansion, nouvelles méthodes d'éval.",
    markdown,
  });
}

const MOCK_AGENTS = [
  { id: "researcher", name: "Veilleur", description: "Veille web et synthèse", autonomy: "human_in_the_loop" },
  { id: "writer", name: "Rédacteur", description: "Production de contenus", autonomy: "full" },
];

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const json = (b: unknown, s = 200) =>
      new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/api/health") return json({ ok: true, mock: true });
    if (url.pathname === "/api/agents") return json(MOCK_AGENTS);

    if (url.pathname === "/api/jobs" && req.method === "GET") {
      return json([...jobs.values()].map(({ channelId: _c, ...j }) => j).reverse());
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/(.+)$/);
    if (jobMatch && req.method === "GET") {
      const job = jobs.get(jobMatch[1]!);
      if (!job) return json({ error: "not found" }, 404);
      const { channelId: _c, ...rest } = job;
      return json(rest);
    }

    if (url.pathname === "/api/objectives" && req.method === "POST") {
      const body = (await req.json()) as { objective: string; channelId: string };
      const id = `job_${++seq}`;
      const job: Job = { id, objective: body.objective, channelId: body.channelId, status: "running", steps: freshSteps() };
      jobs.set(id, job);
      console.log(`✚ Job ${id}: "${body.objective}"`);
      void runJob(job); // fire the timeline asynchronously
      return json({ id, objective: body.objective, status: "running" });
    }

    const apprMatch = url.pathname.match(/^\/api\/approvals\/(.+)$/);
    if (apprMatch && req.method === "POST") {
      const body = (await req.json()) as { decision: string; by?: string };
      const resolve = pendingApprovals.get(apprMatch[1]!);
      if (resolve) {
        pendingApprovals.delete(apprMatch[1]!);
        resolve(body.decision === "approve");
        console.log(`✔ Approval ${apprMatch[1]} → ${body.decision} by ${body.by ?? "?"}`);
      }
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`🧪 Mock backend on :${PORT} — pushing events to ${BOT_URL}`);
