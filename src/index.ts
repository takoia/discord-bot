import { config } from "./config.ts";
import { logger } from "./logger.ts";
import { client, startBot } from "./discord/client.ts";
import { startHttpServer } from "./server/http.ts";

/**
 * Entrypoint: log the bot in, then start the HTTP server that receives
 * backend events. Order matters — the HTTP handlers need a ready client.
 */
async function main() {
  logger.info("Starting Takoia Discord bot…", { backend: config.BACKEND_URL, port: config.PORT });

  await startBot();
  startHttpServer(client);

  logger.info("Bot is up. Waiting for commands and backend events.");
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

// Don't let an unhandled rejection take down the bot mid-demo.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});
