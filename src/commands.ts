import {
  ChannelType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildTextBasedChannel,
} from "discord.js";
import { COMMAND_NAME, MAX_CUSTOM_MESSAGE_LENGTH } from "./constants.js";
import type {
  AppConfig,
  CommandHandlerContext,
  CommandSyncResult,
  LoggerLike,
} from "./types.js";

function isDiscordInviteUrl(value: string): boolean {
  return /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/i.test(value);
}

export function buildCommands() {
  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Manage no-beast scam detection settings.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show current moderation settings."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("enable").setDescription("Enable scam image scanning."),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("disable").setDescription("Disable scam image scanning."),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("dryrun")
        .setDescription("Manage dry-run mode.")
        .addSubcommand((subcommand) => subcommand.setName("view").setDescription("Show dry-run status."))
        .addSubcommand((subcommand) => subcommand.setName("enable").setDescription("Enable dry-run mode."))
        .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Disable dry-run mode.")),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("message")
        .setDescription("Manage the pre-kick DM template.")
        .addSubcommand((subcommand) =>
          subcommand.setName("view").setDescription("View the current DM template."),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Set the DM template.")
            .addStringOption((option) =>
              option.setName("text").setDescription("Template text containing {serverName}.").setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("reset").setDescription("Reset to the default DM template."),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("invite")
        .setDescription("Manage the rejoin invite URL.")
        .addSubcommand((subcommand) =>
          subcommand.setName("view").setDescription("View the current invite URL."),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Set the rejoin invite URL.")
            .addStringOption((option) =>
              option.setName("url").setDescription("Discord invite URL.").setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("clear").setDescription("Clear the rejoin invite URL."),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("logchannel")
        .setDescription("Manage the moderation log channel.")
        .addSubcommand((subcommand) =>
          subcommand.setName("view").setDescription("View the current log channel."),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Set the moderation log channel.")
            .addChannelOption((option) =>
              option
                .setName("channel")
                .setDescription("Guild text channel for moderation logs.")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("clear").setDescription("Clear the moderation log channel."),
        ),
    );

  return [command];
}

export function buildCommandRegistrationBody(): unknown[] {
  return buildCommands().map((command) => command.toJSON());
}

type RestLike = Pick<REST, "get" | "put">;

const COMMAND_FIELDS_TO_STRIP = new Set([
  "id",
  "application_id",
  "version",
  "guild_id",
  "integration_types",
  "contexts",
  "nsfw",
]);

function normalizeCommandValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCommandValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !COMMAND_FIELDS_TO_STRIP.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeCommandValue(nestedValue)] as const);
    return Object.fromEntries(entries);
  }

  return value;
}

export function commandsMatch(current: unknown[], expected: unknown[]): boolean {
  return JSON.stringify(normalizeCommandValue(current)) === JSON.stringify(normalizeCommandValue(expected));
}

function createRestClient(token: string): REST {
  return new REST({ version: "10" }).setToken(token);
}

export async function syncCommandsIfNeeded(
  config: AppConfig,
  logger?: Pick<LoggerLike, "info">,
  rest: RestLike = createRestClient(config.discordToken),
): Promise<CommandSyncResult> {
  const body = buildCommandRegistrationBody();
  const commandNames = buildCommands().map((command) => command.name);

  if (config.devGuildId) {
    const route = Routes.applicationGuildCommands(config.clientId, config.devGuildId);
    logger?.info(`Fetching currently registered commands for dev guild ${config.devGuildId}`);
    const current = (await rest.get(route)) as unknown[];
    logger?.info(
      `Fetched ${current.length} current command(s) for dev guild ${config.devGuildId}; expected ${body.length}: ${commandNames.join(", ")}`,
    );

    if (commandsMatch(current, body)) {
      logger?.info(`Dev guild ${config.devGuildId} commands already match expected definition`);
      return {
        body,
        scope: "guild",
        targetId: config.devGuildId,
        changed: false,
      };
    }

    logger?.info(`Detected command drift for dev guild ${config.devGuildId}; updating commands`);
    await rest.put(route, { body });
    logger?.info(`Finished syncing commands to dev guild ${config.devGuildId}`);
    return {
      body,
      scope: "guild",
      targetId: config.devGuildId,
      changed: true,
    };
  }

  const route = Routes.applicationCommands(config.clientId);
  logger?.info("Fetching currently registered global commands");
  const current = (await rest.get(route)) as unknown[];
  logger?.info(`Fetched ${current.length} current global command(s); expected ${body.length}: ${commandNames.join(", ")}`);

  if (commandsMatch(current, body)) {
    logger?.info("Global commands already match expected definition");
    return {
      body,
      scope: "global",
      targetId: null,
      changed: false,
    };
  }

  logger?.info("Detected global command drift; updating commands");
  await rest.put(route, { body });
  logger?.info("Finished syncing commands globally");
  return {
    body,
    scope: "global",
    targetId: null,
    changed: true,
  };
}

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandHandlerContext,
): Promise<void> {
  if (!interaction.guildId || interaction.commandName !== COMMAND_NAME) {
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const settings = context.settingsStore.getGuildSettings(guildId);
  const respond = async (content: string): Promise<void> => context.reply(interaction, content);

  if (!group && subcommand === "status") {
    await respond(
      [
        `Scanner enabled: ${settings.scannerEnabled}`,
        `Dry run: ${settings.dryRun}`,
        `Log channel: ${settings.moderationLogChannelId ? `<#${settings.moderationLogChannelId}>` : "not set"}`,
        `Invite URL: ${settings.rejoinInviteUrl ?? "not set"}`,
        `Custom message: ${settings.kickMessageOverride ? "set" : "default"}`,
      ].join("\n"),
    );
    return;
  }

  if (!group && (subcommand === "enable" || subcommand === "disable")) {
    const enabled = subcommand === "enable";
    context.settingsStore.setScannerEnabled(guildId, enabled);
    await respond(`Scam image scanning ${enabled ? "enabled" : "disabled"}.`);
    return;
  }

  if (group === "dryrun") {
    if (subcommand === "view") {
      await respond(`Dry run is ${settings.dryRun ? "enabled" : "disabled"}.`);
      return;
    }
    const enabled = subcommand === "enable";
    context.settingsStore.setDryRun(guildId, enabled);
    await respond(`Dry run ${enabled ? "enabled" : "disabled"}.`);
    return;
  }

  if (group === "message") {
    if (subcommand === "view") {
      await respond(settings.kickMessageOverride ?? "Using the default kick message.");
      return;
    }
    if (subcommand === "reset") {
      context.settingsStore.setKickMessageOverride(guildId, null);
      await respond("Kick message reset to the default.");
      return;
    }

    const text = interaction.options.getString("text", true);
    if (!text.includes("{serverName}")) {
      await respond("The custom message must include {serverName}.");
      return;
    }
    if (text.length > MAX_CUSTOM_MESSAGE_LENGTH) {
      await respond(`The custom message must be at most ${MAX_CUSTOM_MESSAGE_LENGTH} characters.`);
      return;
    }
    context.settingsStore.setKickMessageOverride(guildId, text);
    await respond("Kick message updated.");
    return;
  }

  if (group === "invite") {
    if (subcommand === "view") {
      await respond(settings.rejoinInviteUrl ?? "No invite URL configured.");
      return;
    }
    if (subcommand === "clear") {
      context.settingsStore.setRejoinInviteUrl(guildId, null);
      await respond("Invite URL cleared.");
      return;
    }
    const url = interaction.options.getString("url", true);
    if (!isDiscordInviteUrl(url)) {
      await respond("Invite URL must be a Discord invite link.");
      return;
    }
    context.settingsStore.setRejoinInviteUrl(guildId, url);
    await respond("Invite URL updated.");
    return;
  }

  if (group === "logchannel") {
    if (subcommand === "view") {
      await respond(
        settings.moderationLogChannelId
          ? `Log channel: <#${settings.moderationLogChannelId}>`
          : "No log channel configured.",
      );
      return;
    }
    if (subcommand === "clear") {
      context.settingsStore.setModerationLogChannelId(guildId, null);
      await respond("Log channel cleared.");
      return;
    }
    const channel = interaction.options.getChannel("channel", true);
    if (channel.type !== ChannelType.GuildText) {
      await respond("Log channel must be a guild text channel.");
      return;
    }
    context.settingsStore.setModerationLogChannelId(guildId, channel.id);
    await respond(`Log channel set to <#${channel.id}>.`);
    return;
  }

  context.logger.warn(`Unhandled command path: ${group ?? "root"}/${subcommand}`);
  await respond("Unsupported command.");
}

export function resolveLogChannel(
  client: Client,
  guildId: string,
  channelId: string | null,
): GuildTextBasedChannel | null {
  if (!channelId) {
    return null;
  }
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }
  return channel;
}
