import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { agentSelection, store } from "../store.ts";
import { logger } from "../logger.ts";
import { subscribeJob } from "../jobstream.ts";
import { JobStatus, type Agent } from "../types.ts";
import {
  agentPickerComponents,
  agentsEmbed,
  jobDetailEmbed,
  jobEmbed,
  jobsListEmbed,
} from "./embeds.ts";

/** Slash command definitions — exported as JSON for the register script. */
export const commandData = [
  new SlashCommandBuilder()
    .setName("agent")
    .setDescription("Choisis l'agent à utiliser (boutons)"),
  new SlashCommandBuilder()
    .setName("objectif")
    .setDescription("Lance un objectif avec l'agent choisi (via /agent)")
    .addStringOption((o) =>
      o.setName("texte").setDescription("Ce que tu veux que l'agent fasse").setRequired(true),
    ),
  new SlashCommandBuilder().setName("agents").setDescription("Liste les agents disponibles"),
  new SlashCommandBuilder()
    .setName("jobs")
    .setDescription("Liste les jobs récents")
    .addStringOption((o) =>
      o
        .setName("statut")
        .setDescription("Filtrer par statut")
        .setRequired(false)
        .addChoices(
          { name: "en cours", value: "running" },
          { name: "attente validation", value: "awaiting_approval" },
          { name: "terminé", value: "done" },
          { name: "échec", value: "failed" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Détail d'un job et de ses 4 étapes")
    .addStringOption((o) =>
      o.setName("job_id").setDescription("ID du job").setRequired(true),
    ),
  new SlashCommandBuilder().setName("ping").setDescription("Santé du bot + ping backend"),
].map((c) => c.toJSON());

// Short-lived agent cache so /agent renders fast without hammering the backend.
let agentsCache: { at: number; agents: Agent[] } | null = null;
const AGENTS_TTL_MS = 30_000;

async function getAgents(): Promise<Agent[]> {
  const now = performance.now();
  if (agentsCache && now - agentsCache.at < AGENTS_TTL_MS) return agentsCache.agents;
  const res = await backend.listAgents();
  if (!res.ok) return agentsCache?.agents ?? [];
  agentsCache = { at: now, agents: res.data };
  return res.data;
}

/** Dispatch a chat-input command. Each handler degrades gracefully on error. */
export async function handleCommand(interaction: ChatInputCommandInteraction) {
  switch (interaction.commandName) {
    case "ping":
      return handlePing(interaction);
    case "agent":
      return handleAgent(interaction);
    case "objectif":
      return handleObjectif(interaction);
    case "agents":
      return handleAgents(interaction);
    case "jobs":
      return handleJobs(interaction);
    case "status":
      return handleStatus(interaction);
    default:
      return interaction.reply({ content: "Commande inconnue.", ephemeral: true });
  }
}

async function handlePing(interaction: ChatInputCommandInteraction) {
  const wsPing = Math.round(interaction.client.ws.ping);
  const start = performance.now();
  const health = await backend.health();
  const backendMs = Math.round(performance.now() - start);

  const backendLine = health.ok
    ? `🟢 backend OK (${backendMs} ms)`
    : `🔴 backend KO — ${health.error}`;

  await interaction.reply({
    content: `🏓 **Pong !**\n🤖 bot en ligne (gateway ${wsPing} ms)\n${backendLine}`,
    ephemeral: true,
  });
}

/** /agent — posts one button per agent; the click sets the user's selection. */
async function handleAgent(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const agents = await getAgents();
  if (agents.length === 0) {
    await interaction.editReply("⚠️ Aucun agent disponible côté backend.");
    return;
  }
  const current = agentSelection.get(interaction.user.id);
  await interaction.editReply({
    content:
      `🤖 **Choisis l'agent** à utiliser, puis lance \`/objectif\`.` +
      (current ? `\n_Agent actuel : **${current.name}**_` : ""),
    components: agentPickerComponents(agents),
  });
}

async function handleObjectif(interaction: ChatInputCommandInteraction) {
  const objective = interaction.options.getString("texte", true);
  const channelId = interaction.channelId;

  const selected = agentSelection.get(interaction.user.id);
  if (!selected) {
    await interaction.reply({
      content: "⚠️ Choisis d'abord un agent avec **/agent**, puis relance `/objectif`.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const res = await backend.createObjective({
    agent_id: selected.id,
    title: objective.slice(0, 80),
    prompt: objective,
  });
  if (!res.ok) {
    await interaction.editReply(
      `⚠️ Impossible de lancer l'objectif : ${res.error}. Le backend est peut-être indisponible.`,
    );
    return;
  }

  const jobId = res.data.job_id;
  // Seed the local timeline, post the living message, then record its id.
  const job = store.create(jobId, objective, channelId, "");
  const message = await interaction.editReply({
    content: `🚀 Lancé avec l'agent **${selected.name}**`,
    embeds: [jobEmbed(job)],
  });
  job.messageId = message.id;

  // Subscribe to the SSE stream: events will edit this message, post approval
  // buttons, and deliver the final report.
  subscribeJob(interaction.client, jobId);
  logger.info("Objective created", { jobId, agentId: selected.id });
}

async function handleAgents(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const res = await backend.listAgents();
  if (!res.ok) {
    await interaction.editReply(`⚠️ Impossible de récupérer les agents : ${res.error}`);
    return;
  }
  await interaction.editReply({ embeds: [agentsEmbed(res.data)] });
}

async function handleJobs(interaction: ChatInputCommandInteraction) {
  const statut = interaction.options.getString("statut") ?? undefined;
  await interaction.deferReply();
  const res = await backend.listJobs();
  if (!res.ok) {
    await interaction.editReply(`⚠️ Impossible de récupérer les jobs : ${res.error}`);
    return;
  }
  // The backend has no status filter param, so filter client-side.
  const filtered =
    statut && JobStatus.safeParse(statut).success
      ? res.data.filter((j) => j.status === statut)
      : res.data;
  await interaction.editReply({ embeds: [jobsListEmbed(filtered)] });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const jobId = interaction.options.getString("job_id", true);
  await interaction.deferReply();
  const res = await backend.getJob(jobId);
  if (!res.ok) {
    await interaction.editReply(`⚠️ Job introuvable ou backend indisponible : ${res.error}`);
    return;
  }
  await interaction.editReply({ embeds: [jobDetailEmbed(res.data)] });
}
