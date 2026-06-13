import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { handleCommand } from "./commands.ts";

/**
 * The Discord client. Only the Guilds intent is needed — slash commands and
 * button interactions arrive over the interactions gateway, no message content.
 */
export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  logger.info(`Bot online as ${c.user.tag}`, { guilds: c.guilds.cache.size });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Interaction handler crashed", { error: msg });
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "⚠️ Une erreur est survenue.", ephemeral: true });
        } else {
          await interaction.reply({ content: "⚠️ Une erreur est survenue.", ephemeral: true });
        }
      }
    } catch {
      /* swallow — already logged */
    }
  }
});

export async function startBot() {
  await client.login(config.DISCORD_TOKEN);
}
