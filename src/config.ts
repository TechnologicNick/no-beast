import { DEFAULT_DB_PATH } from "./constants.js";
import type { AppConfig } from "./types.js";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const discordToken = env.DISCORD_TOKEN;
  const clientId = env.CLIENT_ID;

  if (!discordToken) {
    throw new Error("Missing DISCORD_TOKEN environment variable.");
  }

  if (!clientId) {
    throw new Error("Missing CLIENT_ID environment variable.");
  }

  return {
    discordToken,
    clientId,
    devGuildId: env.DEV_GUILD_ID,
    databasePath: env.DATABASE_PATH ?? DEFAULT_DB_PATH,
    datasetRoot: env.DATASET_ROOT ?? "./datasets",
  };
}
