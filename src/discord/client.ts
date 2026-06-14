import { Client, Events, GatewayIntentBits, type Client as DClient, type Interaction } from "discord.js";
import { config } from "../config.ts";
import { logger } from "../logger.ts";
import { runtime } from "../store.ts";
import { handleCommand } from "./commands.ts";
import { handleButton } from "./interactions.ts";
import { handleChatMessage } from "../chat.ts";

/**
 * The Discord client is created in startBot(), AFTER probing whether the
 * privileged MessageContent intent is enabled in the Developer Portal. We only
 * request that intent when it's actually granted — so the bot can never crash
 * on login with "disallowed intents". Chat mode is enabled iff it's granted.
 */
export let client: DClient;

const MESSAGE_CONTENT = 1 << 18;
const MESSAGE_CONTENT_LIMITED = 1 << 19;

/** Ask Discord whether this app is allowed the MessageContent intent. */
async function messageContentAllowed(): Promise<boolean> {
  try {
    const res = await fetch("https://discord.com/api/v10/applications/@me", {
      headers: { Authorization: `Bot ${config.DISCORD_TOKEN}` },
    });
    if (!res.ok) return false;
    const app = (await res.json()) as { flags?: number };
    const flags = Number(app.flags ?? 0);
    return (flags & MESSAGE_CONTENT) !== 0 || (flags & MESSAGE_CONTENT_LIMITED) !== 0;
  } catch {
    return false;
  }
}

function bindHandlers(c: DClient) {
  c.once(Events.ClientReady, (ready) => {
    logger.info(`Bot online as ${ready.user.tag}`, {
      guilds: ready.guilds.cache.size,
      chatReady: runtime.chatReady,
    });
  });

  c.on(Events.InteractionCreate, async (interaction) => {
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
  c.on(Events.MessageCreate, async (message) => {
    try {
      await handleChatMessage(c, message);
    } catch (err) {
      logger.error("Chat message handler crashed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

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
  runtime.chatReady = await messageContentAllowed();
  const intents = [GatewayIntentBits.Guilds];
  if (runtime.chatReady) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    logger.info("Chat mode ENABLED (MessageContent intent granted).");
  } else {
    logger.warn(
      "Chat mode DORMANT — enable 'Message Content Intent' in the Developer Portal " +
        "(Bot > Privileged Gateway Intents), then restart the bot.",
    );
  }

  client = new Client({ intents });
  bindHandlers(client);
  await client.login(config.DISCORD_TOKEN);
}
