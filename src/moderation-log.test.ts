import { describe, expect, test } from "bun:test";
import { formatModerationLog, sendModerationLog, splitModerationLog } from "./moderation-log.js";
import type { ModerationLogContext } from "./types.js";

const context: ModerationLogContext = {
  guildName: "Guild",
  dryRun: false,
  memberTag: "user#0001",
  userId: "1",
  sourceChannelId: "2",
  sourceChannelName: "general",
  messageId: "3",
  attachmentName: "image.jpg",
  attachmentUrl: "https://example.com/image.jpg",
  contentType: "image/jpeg",
  match: {
    matched: true,
    stage: "near-duplicate",
    details: [
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.0123,
        pHashDistance: 4,
        dHashDistance: 5,
        reference: {
          id: "a",
          relativePath: "scam/test.jpg",
          rawSha256: "raw",
          normalizedSha256: "norm",
          aspectRatio: 1,
          pHash: 1n,
          dHash: 2n,
          templateVector: new Uint8Array([1, 2, 3]),
        },
        templateMae: 4.25,
      },
    ],
  },
  evaluation: {
    matched: true,
    stage: "near-duplicate",
    details: [
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.0123,
        pHashDistance: 4,
        dHashDistance: 5,
        reference: {
          id: "a",
          relativePath: "scam/test.jpg",
          rawSha256: "raw",
          normalizedSha256: "norm",
          aspectRatio: 1,
          pHash: 1n,
          dHash: 2n,
          templateVector: new Uint8Array([1, 2, 3]),
        },
        templateMae: 4.25,
      },
    ],
    rawMatches: [],
    normalizedMatches: [],
    nearDuplicateCandidates: [
      {
        stage: "near-duplicate",
        aspectRatioDelta: 0.0123,
        pHashDistance: 4,
        dHashDistance: 5,
        reference: {
          id: "a",
          relativePath: "scam/test.jpg",
          rawSha256: "raw",
          normalizedSha256: "norm",
          aspectRatio: 1,
          pHash: 1n,
          dHash: 2n,
          templateVector: new Uint8Array([1, 2, 3]),
        },
        templateMae: 4.25,
      },
    ],
    templateNearestCandidates: [],
  },
  deleteRequested: true,
  deleteSucceeded: true,
  dmAttempted: true,
  dmSucceeded: true,
  kickAttempted: true,
  kickSucceeded: true,
  kickReason: "reason",
};

describe("formatModerationLog", () => {
  test("includes heuristic metrics", () => {
    const message = formatModerationLog({ ...context, dryRun: true });
    expect(message).toContain("Winning stage");
    expect(message).toContain("pHashDistance=4");
    expect(message).toContain("scam/test.jpg");
    expect(message).toContain("Near-duplicate candidates");
    expect(message).toContain("<@1> (**user#0001**, `1`)");
    expect(message).toContain("<#2> (**general**, `2`)");
    expect(message).toContain("Attachment URL: `https://example.com/image.jpg`");
    expect(message).toContain("✅ Near-duplicate rule");
    expect(message).toContain("❌ Exact raw rule");
  });

  test("escapes user-controlled text", () => {
    const message = formatModerationLog({
      ...context,
      dryRun: true,
      guildName: "@everyone *Guild*",
      memberTag: "user_*`name`",
      sourceChannelName: "chan_[x]",
      attachmentName: "file_[x].png",
      attachmentUrl: "https://example.com/a`b`",
      kickReason: "@here *(reason)*",
    });

    expect(message).toContain("Guild: @​everyone \\*Guild\\*");
    expect(message).toContain("<@1> (**user\\_\\*`name`**, `1`)");
    expect(message).toContain("<#2> (**chan\\_\\[x\\]**, `2`)");
    expect(message).toContain("Attachment: file\\_\\[x\\].png");
    expect(message).toContain("Attachment URL: ``https://example.com/a`​b`​``");
    expect(message).toContain("Kick reason: @​here \\*\\(reason\\)\\*");
  });

  test("splits oversized logs into Discord-safe chunks", async () => {
    const oversized = `${"A".repeat(1500)}\n${"B".repeat(1500)}`;
    const chunks = splitModerationLog(oversized, 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);

    const sent: string[] = [];
    await sendModerationLog(
      {
        send: async ({ content }) => {
          sent.push(content);
        },
      },
      {
        ...context,
        kickReason: "x".repeat(4000),
      },
    );

    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((chunk) => chunk.length <= 2000)).toBe(true);
  });
});
