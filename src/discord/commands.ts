import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { backend } from "../backend.ts";
import { store } from "../store.ts";
import { logger } from "../logger.ts";
import { jobEmbed } from "./embeds.ts";

/** Slash command definitions — exported as JSON for the register script. */
export const commandData = [
  new SlashCommandBuilder()
    .setName("objectif")
    .setDescription("Lance un objectif confié à un agent autonome")
    .addStringOption((o) =>
      o.setName("texte").setDescription("L'objectif à atteindre").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("agent").setDescription("ID de l'agent (optionnel)").setRequired(false),
    ),
  new SlashCommandBuilder().setName("ping").setDescription("Santé du bot + ping backend"),
].map((c) => c.toJSON());

/** Dispatch a chat-input command. Each handler degrades gracefully on error. */
export async function handleCommand(interaction: ChatInputCommandInteraction) {
  switch (interaction.commandName) {
    case "ping":
      return handlePing(interaction);
    case "objectif":
      return handleObjectif(interaction);
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

async function handleObjectif(interaction: ChatInputCommandInteraction) {
  const objective = interaction.options.getString("texte", true);
  const agentId = interaction.options.getString("agent") ?? undefined;
  const channelId = interaction.channelId;

  await interaction.deferReply();

  const res = await backend.createObjective({ objective, agentId, channelId });
  if (!res.ok) {
    await interaction.editReply(
      `⚠️ Impossible de lancer l'objectif : ${res.error}. Le backend est peut-être indisponible.`,
    );
    return;
  }

  const jobId = res.data.id;
  // Seed the local timeline, post the living message, then record its id.
  // store.create returns the live object held in the map, so mutating it here
  // is what the incoming /events handler will later update.
  const job = store.create(jobId, objective, channelId, "");
  const message = await interaction.editReply({ embeds: [jobEmbed(job)] });
  job.messageId = message.id;
  logger.info("Objective created", { jobId, agentId });
}
