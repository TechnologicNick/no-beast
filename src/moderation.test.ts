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

function buildEvaluation(classification: AttachmentMatchResult["classification"]): AttachmentMatchResult {
  const detail = {
    stage: "family-consensus" as const,
    aspectRatioDelta: 0.01,
    pHashDistance: 4,
    dHashDistance: 5,
    edgeHashDistance: 4,
    lumaMae: 8,
    templateMae: 8,
    memberScore: 14,
    roiMae: [3, 4, 5, 6],
    roiVotes: classification === "safe" ? 1 : 3,
    reference: {
      id: "1",
      relativePath: "scam/a.jpg",
      familyId: "family-a",
      archetype: "x-post" as const,
      rawSha256: "raw",
      aspectRatio: 1,
      pHash: 1n,
      dHash: 1n,
      edgeHash: 1n,
      lumaGrid: new Uint8Array([1, 2, 3]),
      roiSignatures: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), new Uint8Array([4])],
    },
  };

  return {
    classification,
    stage: classification === "safe" ? null : "family-consensus",
    details: classification === "safe" ? [] : [detail],
    matchedFamilyId: classification === "safe" ? null : "family-a",
    confidence: classification === "safe" ? 0.2 : 0.91,
    roiVotes: detail.roiVotes,
    rawMatches: [],
    familyCandidates: [detail],
    shortlistedFamilies: ["family-a"],
    archetype: "x-post",
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
    const results = [buildEvaluation("safe"), buildEvaluation("scam")];

    const result = await moderateMessage(
      message,
      {
        fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
        matcher: { matchBuffer: async () => results.shift() ?? buildEvaluation("safe") },
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
    expect(contexts[0]?.evaluation.classification).toBe("safe");
    expect(contexts[1]?.evaluation.classification).toBe("scam");
  });

  test("does not enforce borderline classifications but still logs them", async () => {
    const message = buildMessage();
    let loggedContext: ModerationLogContext | undefined;

    const result = await moderateMessage(
      message,
      {
        fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
        matcher: { matchBuffer: async () => buildEvaluation("borderline") },
        settingsStore: { getGuildSettings: () => buildSettings() },
        renderKickMessage: () => ({ content: "test", usedOverride: false }),
        sendModerationLog: async (_channel, context) => {
          loggedContext = context;
        },
        logger: console,
      },
      { send: async () => undefined },
    );

    expect(result.action).toBe("ignored");
    expect(message.delete).not.toHaveBeenCalled();
    expect(message.author.send).not.toHaveBeenCalled();
    expect(message.member?.kick).not.toHaveBeenCalled();
    expect(loggedContext?.evaluation.classification).toBe("borderline");
    expect(loggedContext?.kickAttempted).toBe(false);
  });

  test("enforces on a scam classification and logs outcomes", async () => {
    const message = buildMessage();
    let loggedContext: ModerationLogContext | undefined;

    const result = await moderateMessage(
      message,
      {
        fetchAttachmentBytes: async () => new Uint8Array([1, 2, 3]),
        matcher: { matchBuffer: async () => buildEvaluation("scam") },
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
    expect(loggedContext?.evaluation.classification).toBe("scam");
    expect(loggedContext?.kickSucceeded).toBe(true);
  });
});
