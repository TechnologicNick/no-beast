import { describe, expect, mock, test } from "bun:test";
import { ChannelType } from "discord.js";
import { buildCommandRegistrationBody, commandsMatch, handleCommand, syncCommandsIfNeeded } from "./commands.js";
import type { CommandHandlerContext, GuildSettings } from "./types.js";

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
}) {
  return {
    guildId: "guild-1",
    commandName: "nobeast",
    replied: false,
    deferred: false,
    reply: mock(async () => undefined),
    followUp: mock(async () => undefined),
    options: {
      getSubcommandGroup: () => overrides.group ?? null,
      getSubcommand: () => overrides.subcommand,
      getString: (name: string) => overrides.strings?.[name],
      getChannel: () => overrides.channel,
      getAttachment: () => overrides.attachment,
    },
  } as never;
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
      },
    ];

    expect(commandsMatch(current, expected)).toBe(true);
  });

  test("syncCommandsIfNeeded skips registration when dev-guild commands already match", async () => {
    const expected = buildCommandRegistrationBody();
    const get = mock(async () => [
      {
        ...(expected[0] as Record<string, unknown>),
        id: "123",
        application_id: "456",
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

    expect(result.scope).toBe("guild");
    expect(result.targetId).toBe("guild");
    expect(result.changed).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
  });

  test("syncCommandsIfNeeded updates dev-guild commands when they drift", async () => {
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

    expect(result.scope).toBe("guild");
    expect(result.changed).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("rejects custom messages without {serverName}", async () => {
    const replies: string[] = [];

    await handleCommand(
      createInteraction({
        group: "message",
        subcommand: "set",
        strings: { text: "hello" },
      }),
      createContext(replies),
    );

    expect(replies[0]).toContain("{serverName}");
  });

  test("rejects invalid log channel types", async () => {
    const replies: string[] = [];
    const setChannel = mock(() => undefined);
    const context = createContext(replies);
    context.settingsStore.setModerationLogChannelId = setChannel;

    await handleCommand(
      createInteraction({
        group: "logchannel",
        subcommand: "set",
        channel: { id: "1", type: ChannelType.GuildVoice },
      }),
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

    await handleCommand(
      createInteraction({
        group: "action",
        subcommand: "set",
        strings: { mode: "ban" },
      }),
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

    await handleCommand(interaction, context);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply.mock.calls[0]?.[0]?.content).toContain("Evaluation for image.png");
  });
});
