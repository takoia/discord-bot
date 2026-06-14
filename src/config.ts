import { z } from "zod";

/**
 * Typed environment config, validated at boot (fail-fast).
 * If something is missing the process exits with a clear message instead of
 * crashing later mid-demo.
 */
const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  GUILD_ID: z.string().optional().default(""),
  BACKEND_URL: z.string().url("BACKEND_URL must be a valid URL"),
  // Optional: the MVP backend is unauthenticated. If set, the bot sends it as a
  // Bearer on REST + SSE calls (forward-compatible).
  SHARED_SECRET: z.string().optional().default(""),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`❌ Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
