import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { backend } from "../backend.ts";

/** Slash command definitions — exported as JSON for the register script. */
export const commandData = [
  new SlashCommandBuilder().setName("ping").setDescription("Santé du bot + ping backend"),
].map((c) => c.toJSON());

/** Dispatch a chat-input command. Each handler degrades gracefully on error. */
export async function handleCommand(interaction: ChatInputCommandInteraction) {
  switch (interaction.commandName) {
    case "ping":
      return handlePing(interaction);
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
