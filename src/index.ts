import { MessageFlags } from "discord.js";
import { createBot } from "./bot.js";
import { syncCommandsIfNeeded } from "./commands.js";
import { loadConfig } from "./config.js";
import { loadDatasetFingerprints } from "./dataset.js";
import { openDatabase } from "./database.js";
import { logger } from "./logger.js";
import { AttachmentMatcher } from "./matcher.js";
import { sendModerationLog } from "./moderation-log.js";
import { SettingsStore } from "./settings-store.js";
import { renderKickMessage } from "./templates.js";

logger.info("Bootstrapping no-beast");
const config = loadConfig();
logger.info(
  "Configuration loaded", { datasetRoot: config.datasetRoot, databasePath: config.databasePath, devGuildId: config.devGuildId },
);
const database = openDatabase(config.databasePath);
logger.info("SQLite database opened");
const settingsStore = new SettingsStore(database);
logger.info("Loading dataset fingerprints");
const dataset = await loadDatasetFingerprints(`${config.datasetRoot}/scam`);
logger.info("Loaded", dataset.length, "dataset fingerprint(s)");
const matcher = new AttachmentMatcher(dataset);
logger.info("Attachment matcher initialized");

async function fetchAttachmentBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

logger.info(
  config.devGuildId
    ? `DEV_GUILD_ID is set; checking whether commands for ${config.devGuildId} need syncing`
    : "DEV_GUILD_ID is not set; checking whether global commands need syncing",
);
const syncResult = await syncCommandsIfNeeded(config, logger);
logger.info(
  syncResult.changed
    ? `Applied command updates for ${syncResult.scope} scope${syncResult.targetId ? ` (${syncResult.targetId})` : ""}`
    : `No command changes required for ${syncResult.scope} scope${syncResult.targetId ? ` (${syncResult.targetId})` : ""}`,
);

logger.info("Creating Discord client");
createBot(config, {
  fetchAttachmentBytes,
  matcher,
  settingsStore,
  renderKickMessage,
  sendModerationLog,
  logger,
  commandContext: {
    settingsStore,
    reply: async (interaction, content) => {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    },
    logger,
  },
});
logger.info("Discord client startup initiated");
