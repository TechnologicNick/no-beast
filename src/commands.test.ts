import { describe, expect, mock, test } from "bun:test";
import { ChannelType } from "discord.js";
import { buildCommandRegistrationBody, commandsMatch, handleCommand, syncCommandsIfNeeded } from "./commands.js";
import type { CommandHandlerContext, GuildSettings } from "./types.js";

function buildSettings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildId: "guild-1",
    scannerEnabled: true,
    dryRun: false,
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
}) {
  return {
    guildId: "guild-1",
    commandName: "nobeast",
    replied: false,
    deferred: false,
    options: {
      getSubcommandGroup: () => overrides.group ?? null,
      getSubcommand: () => overrides.subcommand,
      getString: (name: string) => overrides.strings?.[name],
      getChannel: () => overrides.channel,
    },
  } as never;
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
    const context: CommandHandlerContext = {
      settingsStore: {
        getGuildSettings: () => buildSettings(),
        setScannerEnabled: () => undefined,
        setDryRun: () => undefined,
        setKickMessageOverride: () => undefined,
        setRejoinInviteUrl: () => undefined,
        setModerationLogChannelId: () => undefined,
      },
      reply: async (_interaction, content) => {
        replies.push(content);
      },
      logger: console,
    };

    await handleCommand(
      createInteraction({
        group: "message",
        subcommand: "set",
        strings: { text: "hello" },
      }),
      context,
    );

    expect(replies[0]).toContain("{serverName}");
  });

  test("rejects invalid log channel types", async () => {
    const replies: string[] = [];
    const setChannel = mock(() => undefined);
    const context: CommandHandlerContext = {
      settingsStore: {
        getGuildSettings: () => buildSettings(),
        setScannerEnabled: () => undefined,
        setDryRun: () => undefined,
        setKickMessageOverride: () => undefined,
        setRejoinInviteUrl: () => undefined,
        setModerationLogChannelId: setChannel,
      },
      reply: async (_interaction, content) => {
        replies.push(content);
      },
      logger: console,
    };

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
});
