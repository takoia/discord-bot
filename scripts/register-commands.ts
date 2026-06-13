import { REST, Routes } from "discord.js";
import { config } from "../src/config.ts";
import { commandData } from "../src/discord/commands.ts";
import { logger } from "../src/logger.ts";

/**
 * Registers slash commands. If GUILD_ID is set, registers to that guild
 * (instant — ideal for the demo). Otherwise registers globally (can take ~1h).
 */
async function main() {
  const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

  const route = config.GUILD_ID
    ? Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.GUILD_ID)
    : Routes.applicationCommands(config.DISCORD_CLIENT_ID);

  const scope = config.GUILD_ID ? `guild ${config.GUILD_ID}` : "global";
  logger.info(`Registering ${commandData.length} commands (${scope})…`);

  await rest.put(route, { body: commandData });

  logger.info(`✅ Commands registered (${scope}).`, {
    commands: commandData.map((c) => c.name),
  });
}

main().catch((err) => {
  logger.error("Failed to register commands", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
