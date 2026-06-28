import { describe, expect, mock, test } from "bun:test";
import { moderateMessage } from "./moderation.js";
import type { AttachmentMatchResult, GuildSettings, MessageLike, ModerationLogContext } from "./types.js";

function buildSettings(overrides: Partial<GuildSettings> = {}): GuildSettings {
  return {
    guildId: "guild-1",
    scannerEnabled: true,
    dryRun: false,
    kickMessageOverride: null,
    rejoinInviteUrl: null,
    moderationLogChannelId: "log-1",
    updatedAt: null,
    ...overrides,
  };
}

function buildMatch(): AttachmentMatchResult {
  return {
    matched: true,
    stage: "near-duplicate",
    details: [
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.01,
        pHashDistance: 4,
        dHashDistance: 5,
        reference: {
          id: "1",
          relativePath: "scam/a.jpg",
          rawSha256: "raw",
          normalizedSha256: "norm",
          aspectRatio: 1,
          pHash: 1n,
          dHash: 1n,
          templateVector: new Uint8Array([1, 2, 3]),
        },
        templateMae: 5,
      },
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.02,
        pHashDistance: 5,
        dHashDistance: 4,
        reference: {
          id: "2",
          relativePath: "scam/b.jpg",
          rawSha256: "raw2",
          normalizedSha256: "norm2",
          aspectRatio: 1,
          pHash: 2n,
          dHash: 2n,
          templateVector: new Uint8Array([4, 5, 6]),
        },
        templateMae: 6,
      },
    ],
    rawMatches: [],
    normalizedMatches: [],
    nearDuplicateCandidates: [
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.01,
        pHashDistance: 4,
        dHashDistance: 5,
        reference: {
          id: "1",
          relativePath: "scam/a.jpg",
          rawSha256: "raw",
          normalizedSha256: "norm",
          aspectRatio: 1,
          pHash: 1n,
          dHash: 1n,
          templateVector: new Uint8Array([1, 2, 3]),
        },
        templateMae: 5,
      },
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.02,
        pHashDistance: 5,
        dHashDistance: 4,
        reference: {
          id: "2",
          relativePath: "scam/b.jpg",
          rawSha256: "raw2",
          normalizedSha256: "norm2",
          aspectRatio: 1,
          pHash: 2n,
          dHash: 2n,
          templateVector: new Uint8Array([4, 5, 6]),
        },
        templateMae: 6,
      },
    ],
    templateNearestCandidates: [],
  };
}

function buildNoMatch(): AttachmentMatchResult {
  return {
    matched: false,
    rawMatches: [],
    normalizedMatches: [],
    nearDuplicateCandidates: [],
    templateNearestCandidates: [],
  };
}

function buildMessage(attachmentCount = 1): MessageLike {
  const attachments = new Map();
  for (let index = 1; index <= attachmentCount; index += 1) {
    attachments.set(String(index), {
      name: `scam-${index}.jpg`,
      url: `https://example.com/scam-${index}.jpg`,
      contentType: "image/jpeg",
      size: 1024,
    });
  }

  return {
    id: "message-1",
    author: {
      id: "user-1",
      tag: "user#0001",
      send: mock(async () => undefined),
      bot: false,
    },
    webhookId: null,
    guild: {
      id: "guild-1",
      name: "Guild",
    },
    guildId: "guild-1",
    channel: {
      id: "channel-1",
      name: "general",
    },
    attachments,
    member: {
      kick: mock(async () => undefined),
    },
    delete: mock(async () => undefined),
  };
}

describe("moderateMessage", () => {
  test("dry-run logs all attachments without deleting, DMing, or kicking", async () => {
    const message = buildMessage(2);
    const contexts: ModerationLogContext[] = [];
    const results = [buildNoMatch(), buildMatch()];

    const result = await moderateMessage(
      message,
      {
        fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
        matcher: { matchBuffer: async () => results.shift() ?? buildNoMatch() },
        settingsStore: { getGuildSettings: () => buildSettings({ dryRun: true }) },
        renderKickMessage: () => ({ content: "test", usedOverride: false }),
        sendModerationLog: async (_channel, context) => {
          contexts.push(context);
        },
        logger: console,
      },
      { send: async () => undefined },
    );

    expect(result.action).toBe("dry-run");
    expect(result.matched).toBe(true);
    expect(contexts).toHaveLength(2);
    expect(message.delete).not.toHaveBeenCalled();
    expect(message.author.send).not.toHaveBeenCalled();
    expect(message.member?.kick).not.toHaveBeenCalled();

    const firstContext = contexts[0];
    const secondContext = contexts[1];
    expect(firstContext).toBeDefined();
    expect(secondContext).toBeDefined();
    if (!firstContext || !secondContext) {
      throw new Error("Expected dry-run log contexts");
    }
    expect(firstContext.evaluation.matched).toBe(false);
    expect(firstContext.match).toBeNull();
    expect(secondContext.evaluation.nearDuplicateCandidates.length).toBe(2);
  });

  test("enforces on a match and logs outcomes", async () => {
    const message = buildMessage();
    let loggedContext: ModerationLogContext | undefined;

    const result = await moderateMessage(
      message,
      {
        fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
        matcher: { matchBuffer: async () => buildMatch() },
        settingsStore: { getGuildSettings: () => buildSettings() },
        renderKickMessage: () => ({ content: "test", usedOverride: false }),
        sendModerationLog: async (_channel, context) => {
          loggedContext = context;
        },
        logger: console,
      },
      { send: async () => undefined },
    );

    expect(result.action).toBe("enforced");
    expect(message.delete).toHaveBeenCalledTimes(1);
    expect(message.author.send).toHaveBeenCalledTimes(1);
    expect(message.member?.kick).toHaveBeenCalledTimes(1);
    expect(loggedContext).toBeDefined();
    if (!loggedContext) {
      throw new Error("Expected moderation log context");
    }
    expect(loggedContext.kickSucceeded).toBe(true);
    expect(loggedContext.deleteRequested).toBe(true);
  });
});
