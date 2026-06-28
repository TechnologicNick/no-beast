import { describe, expect, mock, test } from "bun:test";
import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import { buildCommandRegistrationBody, commandsMatch, handleCommand, syncCommandsIfNeeded } from "./commands.js";
import type { CommandHandlerContext, GuildSettings } from "./types.js";

type ReplyPayload = {
  content: string;
  flags?: unknown;
};

type InteractionStub = {
  guildId: string;
  commandName: string;
  replied: boolean;
  deferred: boolean;
  memberPermissions: {
    has(permission: bigint): boolean;
  };
  reply: ReturnType<typeof mock<(payload: ReplyPayload) => Promise<void>>>;
  followUp: ReturnType<typeof mock<(payload: ReplyPayload) => Promise<void>>>;
  options: {
    getSubcommandGroup(optional?: boolean): string | null;
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | undefined;
    getChannel(name: string, required?: boolean): { id: string; type: ChannelType } | undefined;
    getAttachment(
      name: string,
      required?: boolean,
    ): { name: string; url: string; size: number; contentType: string | null } | undefined;
  };
};

function buildSettings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildId: "guild-1",
    scannerEnabled: true,
    dryRun: false,
    moderationAction: "timeout-24h",
    kickMessageOverride: null,
    rejoinInviteUrl: null,
    moderationLogChannelId: null,
    updatedAt: null,
    ...overrides,
  };
}

function createInteraction(overrides: {
  group?: string | null;
  subcommand: string;
  strings?: Record<string, string>;
  channel?: { id: string; type: ChannelType };
  attachment?: { name: string; url: string; size: number; contentType: string | null };
  permissions?: bigint[];
}): InteractionStub {
  const permissions = new Set(overrides.permissions ?? [PermissionFlagsBits.ManageGuild]);
  return {
    guildId: "guild-1",
    commandName: "nobeast",
    replied: false,
    deferred: false,
    memberPermissions: {
      has: (permission: bigint) => permissions.has(permission),
    },
    reply: mock<(payload: ReplyPayload) => Promise<void>>(async () => undefined),
    followUp: mock<(payload: ReplyPayload) => Promise<void>>(async () => undefined),
    options: {
      getSubcommandGroup: () => overrides.group ?? null,
      getSubcommand: () => overrides.subcommand,
      getString: (name: string) => overrides.strings?.[name],
      getChannel: () => overrides.channel,
      getAttachment: () => overrides.attachment,
    },
  };
}

function asInteraction(interaction: InteractionStub): ChatInputCommandInteraction {
  return interaction as unknown as ChatInputCommandInteraction;
}

function createContext(replies: string[]): CommandHandlerContext {
  return {
    settingsStore: {
      getGuildSettings: () => buildSettings(),
      setScannerEnabled: () => undefined,
      setDryRun: () => undefined,
      setModerationAction: () => undefined,
      setKickMessageOverride: () => undefined,
      setRejoinInviteUrl: () => undefined,
      setModerationLogChannelId: () => undefined,
    },
    matcher: {
      matchBuffer: async () => ({
        classification: "scam",
        stage: "family-consensus",
        details: [],
        matchedFamilyId: "family-a",
        confidence: 0.9,
        roiVotes: 4,
        rawMatches: [],
        familyCandidates: [],
        shortlistedFamilies: ["family-a"],
        archetype: "x-post",
      }),
    },
    fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
    reply: async (_interaction, content) => {
      replies.push(content);
    },
    logger: console,
  };
}

describe("commands", () => {
  test("builds the /nobeast payload", () => {
    const body = buildCommandRegistrationBody();
    expect(body).toHaveLength(1);
    expect((body[0] as { name: string }).name).toBe("nobeast");
  });

  test("matches equivalent command payloads while ignoring Discord-generated fields", () => {
    const expected = buildCommandRegistrationBody();
    const current = [
      {
        ...(expected[0] as Record<string, unknown>),
        id: "123",
        application_id: "456",
        version: "789",
        name_localizations: null,
        description_localizations: null,
      },
    ];

    expect(commandsMatch(current, expected)).toBe(true);
  });

  test("matches equivalent command payloads when Discord returns contexts instead of dm_permission", () => {
    const expected = buildCommandRegistrationBody();
    const currentCommand = { ...(expected[0] as Record<string, unknown>) };
    delete currentCommand["dm_permission"];
    currentCommand["contexts"] = [0, 1, 2];

    expect(commandsMatch([currentCommand], expected)).toBe(true);
  });

  test("syncCommandsIfNeeded skips registration when global and dev-guild commands already match", async () => {
    const expected = buildCommandRegistrationBody();
    const get = mock(async () => [
      {
        ...(expected[0] as Record<string, unknown>),
        id: "123",
        application_id: "456",
        name_localizations: null,
        description_localizations: null,
      },
    ]);
    const put = mock(async () => undefined);

    const result = await syncCommandsIfNeeded(
      {
        discordToken: "token",
        clientId: "client",
        devGuildId: "guild",
        databasePath: "./data/test.sqlite",
        datasetRoot: "./datasets",
      },
      undefined,
      { get, put },
    );

    expect(result.scope).toBe("both");
    expect(result.targetId).toBe("guild");
    expect(result.changed).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });

  test("syncCommandsIfNeeded updates global and dev-guild commands when they drift", async () => {
    const get = mock(async () => []);
    const put = mock(async () => undefined);

    const result = await syncCommandsIfNeeded(
      {
        discordToken: "token",
        clientId: "client",
        devGuildId: "guild",
        databasePath: "./data/test.sqlite",
        datasetRoot: "./datasets",
      },
      undefined,
      { get, put },
    );

    expect(result.scope).toBe("both");
    expect(result.changed).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(2);
  });

  test("rejects custom messages without {serverName}", async () => {
    const replies: string[] = [];
    const interaction = createInteraction({
      group: "message",
      subcommand: "set",
      strings: { text: "hello" },
    });

    await handleCommand(
      asInteraction(interaction),
      createContext(replies),
    );

    expect(replies[0]).toContain("{serverName}");
  });

  test("allows administrators to use the command", async () => {
    const replies: string[] = [];
    const interaction = createInteraction({
      subcommand: "status",
      permissions: [PermissionFlagsBits.Administrator],
    });

    await handleCommand(asInteraction(interaction), createContext(replies));

    expect(replies[0]).toContain("Scanner enabled");
  });

  test("rejects members without Manage Server or Administrator", async () => {
    const replies: string[] = [];
    const interaction = createInteraction({
      subcommand: "status",
      permissions: [],
    });

    await handleCommand(asInteraction(interaction), createContext(replies));

    expect(replies[0]).toContain("Manage Server or Administrator");
  });

  test("rejects invalid log channel types", async () => {
    const replies: string[] = [];
    const setChannel = mock(() => undefined);
    const context = createContext(replies);
    context.settingsStore.setModerationLogChannelId = setChannel;
    const interaction = createInteraction({
      group: "logchannel",
      subcommand: "set",
      channel: { id: "1", type: ChannelType.GuildVoice },
    });

    await handleCommand(
      asInteraction(interaction),
      context,
    );

    expect(replies[0]).toContain("guild text channel");
    expect(setChannel).not.toHaveBeenCalled();
  });

  test("updates moderation action", async () => {
    const replies: string[] = [];
    const setModerationAction = mock(() => undefined);
    const context = createContext(replies);
    context.settingsStore.setModerationAction = setModerationAction;
    const interaction = createInteraction({
      group: "action",
      subcommand: "set",
      strings: { mode: "ban" },
    });

    await handleCommand(
      asInteraction(interaction),
      context,
    );

    expect(setModerationAction).toHaveBeenCalledWith("guild-1", "ban");
    expect(replies[0]).toContain("ban");
  });

  test("evaluates an image attachment", async () => {
    const replies: string[] = [];
    const interaction = createInteraction({
      subcommand: "evaluate",
      attachment: {
        name: "image.png",
        url: "https://example.com/image.png",
        size: 1024,
        contentType: "image/png",
      },
    });
    const context = createContext(replies);

    await handleCommand(asInteraction(interaction), context);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0]?.[0].content).toContain("Evaluation for image.png");
  });
});
