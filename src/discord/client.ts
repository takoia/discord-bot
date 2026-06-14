import { Client, Events, GatewayIntentBits, type Interaction } from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { handleCommand } from "./commands.ts";
import { handleButton } from "./interactions.ts";
import { handleChatMessage } from "../chat.ts";

/**
 * The Discord client. Guilds covers slash commands + buttons. GuildMessages +
 * MessageContent are needed for chat mode (reading what the user types in a
 * bound thread). MessageContent is a PRIVILEGED intent — it must be enabled in
 * the Developer Portal (Bot > Message Content Intent) or login will fail.
 */
const intents = [GatewayIntentBits.Guilds];
if (config.CHAT_ENABLED) {
  // Privileged — only request once enabled in the Developer Portal.
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
}

export const client = new Client({ intents });

client.once(Events.ClientReady, (c) => {
  logger.info(`Bot online as ${c.user.tag}`, { guilds: c.guilds.cache.size });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    await reportInteractionError(interaction, err);
  }
});

// Chat mode: react to messages typed in channels/threads bound to an agent.
client.on(Events.MessageCreate, async (message) => {
  try {
    await handleChatMessage(client, message);
  } catch (err) {
    logger.error("Chat message handler crashed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Best-effort: tell the user something went wrong without crashing the bot. */
async function reportInteractionError(interaction: Interaction, err: unknown) {
  logger.error("Interaction handler crashed", {
    error: err instanceof Error ? err.message : String(err),
  });
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

export async function startBot() {
  await client.login(config.DISCORD_TOKEN);
}
