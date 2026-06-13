import { config } from "./config.ts";
import { logger } from "./logger.ts";
import { startBot } from "./discord/client.ts";

/**
 * Entrypoint: log the bot in. Live job progress is consumed from core-backend's
 * SSE stream per job (see jobstream.ts), so the bot needs no inbound server.
 */
async function main() {
  logger.info("Starting Takoia Discord bot…", { backend: config.BACKEND_URL });
  await startBot();
  logger.info("Bot is up. Waiting for commands; job progress streamed via SSE.");
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

// Don't let an unhandled rejection take down the bot mid-demo.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});
