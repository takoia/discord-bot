import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { config } from "../config.ts";
import { pendingObjective } from "../store.ts";
import { logger } from "../logger.ts";
import { JobStatus, type Agent } from "../types.ts";
import {
  agentPickerComponents,
  agentsEmbed,
  jobDetailEmbed,
  jobsListEmbed,
} from "./embeds.ts";

/** Slash command definitions — exported as JSON for the register script. */
export const commandData = [
  new SlashCommandBuilder()
    .setName("objectif")
    .setDescription("Lance un objectif : tu écris, puis tu choisis l'agent (boutons)")
    .addStringOption((o) =>
      o.setName("texte").setDescription("Ce que tu veux que l'agent fasse").setRequired(true),
    ),
  // /chat is only registered when chat mode is enabled (needs MessageContent).
  ...(config.CHAT_ENABLED
    ? [
        new SlashCommandBuilder()
          .setName("chat")
          .setDescription("Ouvre un chat continu avec un agent (tu écris, il répond)"),
      ]
    : []),
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

// Short-lived agent cache so /objectif renders the picker fast.
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
  logger.info("Command received", { command: interaction.commandName, user: interaction.user.tag });
  switch (interaction.commandName) {
    case "ping":
      return handlePing(interaction);
    case "objectif":
      return handleObjectif(interaction);
    case "chat":
      return handleChat(interaction);
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

/**
 * /objectif <texte> — store the objective, then show one button per agent.
 * Clicking a button launches the job with that agent (see interactions.ts).
 */
async function handleObjectif(interaction: ChatInputCommandInteraction) {
  const objective = interaction.options.getString("texte", true);
  await interaction.deferReply();

  const agents = await getAgents();
  logger.info("Objectif: agents fetched", { count: agents.length });
  if (agents.length === 0) {
    await interaction.editReply("⚠️ Aucun agent disponible côté backend. Crée-en un d'abord.");
    return;
  }

  pendingObjective.set(interaction.user.id, { text: objective, channelId: interaction.channelId });

  await interaction.editReply({
    content: `🎯 **${objective.slice(0, 200)}**\n\nChoisis l'agent qui va s'en charger 👇`,
    components: agentPickerComponents(agents, "launch"),
  });
}

/** /chat — pick an agent; the click opens a thread bound to it (interactions.ts). */
async function handleChat(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const agents = await getAgents();
  if (agents.length === 0) {
    await interaction.editReply("⚠️ Aucun agent disponible côté backend.");
    return;
  }
  await interaction.editReply({
    content: "💬 Choisis l'agent avec qui discuter :",
    components: agentPickerComponents(agents, "chat"),
  });
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
