import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type Client,
  type GuildTextBasedChannel,
} from "discord.js";
import { COMMAND_NAME, MAX_ATTACHMENT_BYTES, MAX_CUSTOM_MESSAGE_LENGTH } from "./constants.js";
import { formatEvaluationReport, splitModerationLog } from "./moderation-log.js";
import type {
  AppConfig,
  CommandHandlerContext,
  CommandSyncResult,
  LoggerLike,
  ModerationAction,
} from "./types.js";

function isDiscordInviteUrl(value: string): boolean {
  return /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/i.test(value);
}

function parseModerationAction(value: string): ModerationAction | null {
  return value === "timeout-24h" || value === "kick" || value === "ban" ? value : null;
}

async function replyInChunks(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  const chunks = splitModerationLog(content, 1900);
  if (chunks.length === 0) {
    return;
  }
  const [first, ...rest] = chunks;
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: first, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.followUp({ content: first, flags: MessageFlags.Ephemeral });
  }
  for (const chunk of rest) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

function validateEvaluationAttachment(attachment: Attachment): string | null {
  if (!attachment.contentType?.startsWith("image/")) {
    return "The attachment must be an image.";
  }
  if (attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) {
    return `The attachment must be between 1 byte and ${MAX_ATTACHMENT_BYTES} bytes.`;
  }
  return null;
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
    .addSubcommand((subcommand) =>
      subcommand
        .setName("evaluate")
        .setDescription("Evaluate an image attachment without taking action.")
        .addAttachmentOption((option) =>
          option.setName("image").setDescription("Image attachment to evaluate.").setRequired(true),
        ),
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
        .setName("action")
        .setDescription("Manage the enforcement action for scam detections.")
        .addSubcommand((subcommand) => subcommand.setName("view").setDescription("View the current action."))
        .addSubcommand((subcommand) =>
          subcommand
            .setName("set")
            .setDescription("Set the enforcement action.")
            .addStringOption((option) =>
              option
                .setName("mode")
                .setDescription("What to do when a scam is detected.")
                .setRequired(true)
                .addChoices(
                  { name: "24 hour timeout", value: "timeout-24h" },
                  { name: "kick", value: "kick" },
                  { name: "ban", value: "ban" },
                ),
            ),
        ),
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
  "dm_permission",
  "nsfw",
  "name_localizations",
  "description_localizations",
]);

function normalizeCommandValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCommandValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, nestedValue]) => !COMMAND_FIELDS_TO_STRIP.has(key) && nestedValue !== undefined && nestedValue !== null)
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

async function syncCommandScope(args: {
  body: unknown[];
  expectedNames: string[];
  logger?: Pick<LoggerLike, "info">;
  rest: RestLike;
  route: `/${string}`;
  scope: "global" | "guild";
  targetId: string | null;
}): Promise<boolean> {
  const label = args.scope === "guild" && args.targetId ? `dev guild ${args.targetId}` : "global scope";
  args.logger?.info(`Fetching currently registered commands for ${label}`);
  const current = (await args.rest.get(args.route)) as unknown[];
  args.logger?.info(
    `Fetched ${current.length} current command(s) for ${label}; expected ${args.body.length}: ${args.expectedNames.join(", ")}`,
  );

  if (commandsMatch(current, args.body)) {
    args.logger?.info(`Commands for ${label} already match expected definition`);
    return false;
  }

  args.logger?.info(`Detected command drift for ${label}; updating commands`);
  await args.rest.put(args.route, { body: args.body });
  args.logger?.info(`Finished syncing commands for ${label}`);
  return true;
}

export async function syncCommandsIfNeeded(
  config: AppConfig,
  logger?: Pick<LoggerLike, "info">,
  rest: RestLike = createRestClient(config.discordToken),
): Promise<CommandSyncResult> {
  const body = buildCommandRegistrationBody();
  const commandNames = buildCommands().map((command) => command.name);
  const globalRoute = Routes.applicationCommands(config.clientId);
  const globalChanged = await syncCommandScope({
    body,
    expectedNames: commandNames,
    logger,
    rest,
    route: globalRoute,
    scope: "global",
    targetId: null,
  });

  if (config.devGuildId) {
    const guildRoute = Routes.applicationGuildCommands(config.clientId, config.devGuildId);
    const guildChanged = await syncCommandScope({
      body,
      expectedNames: commandNames,
      logger,
      rest,
      route: guildRoute,
      scope: "guild",
      targetId: config.devGuildId,
    });
    return {
      body,
      scope: "both",
      targetId: config.devGuildId,
      changed: globalChanged || guildChanged,
    };
  }
  return {
    body,
    scope: "global",
    targetId: null,
    changed: globalChanged,
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
        `Moderation action: ${settings.moderationAction}`,
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

  if (!group && subcommand === "evaluate") {
    const attachment = interaction.options.getAttachment("image", true);
    const validationError = validateEvaluationAttachment(attachment);
    if (validationError) {
      await respond(validationError);
      return;
    }

    try {
      const bytes = await context.fetchAttachmentBytes(attachment.url);
      const evaluation = await context.matcher.matchBuffer(bytes);
      await replyInChunks(
        interaction,
        `**Evaluation for ${attachment.name}**\n${formatEvaluationReport(evaluation)}`,
      );
    } catch (error) {
      context.logger.error(`Failed to evaluate attachment ${attachment.url}: ${String(error)}`);
      await respond("Failed to evaluate the attachment.");
    }
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

  if (group === "action") {
    if (subcommand === "view") {
      await respond(`Moderation action is ${settings.moderationAction}.`);
      return;
    }
    const selected = interaction.options.getString("mode", true);
    const action = parseModerationAction(selected);
    if (!action) {
      await respond("Unsupported moderation action.");
      return;
    }
    context.settingsStore.setModerationAction(guildId, action);
    await respond(`Moderation action updated to ${action}.`);
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
