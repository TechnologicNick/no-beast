import { describe, expect, test } from "bun:test";
import { formatEvaluationReport, formatModerationLog, sendModerationLog, splitModerationLog } from "./moderation-log.js";
import type { ModerationLogContext } from "./types.js";

const detail = {
  stage: "family-consensus" as const,
  aspectRatioDelta: 0.0123,
  pHashDistance: 4,
  dHashDistance: 5,
  edgeHashDistance: 3,
  lumaMae: 7.25,
  templateMae: 7.25,
  memberScore: 15.4,
  roiMae: [2, 3, 4, 5],
  roiVotes: 3,
  reference: {
    id: "a",
    relativePath: "scam/test.jpg",
    familyId: "family-a",
    archetype: "x-post" as const,
    rawSha256: "raw",
    aspectRatio: 1,
    pHash: 1n,
    dHash: 2n,
    edgeHash: 3n,
    lumaGrid: new Uint8Array([1, 2, 3]),
    roiSignatures: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), new Uint8Array([4])],
  },
};

const evaluation = {
  classification: "scam" as const,
  stage: "family-consensus" as const,
  details: [detail],
  matchedFamilyId: "family-a",
  confidence: 0.94,
  roiVotes: 3,
  rawMatches: [] as typeof detail[],
  familyCandidates: [detail],
  shortlistedFamilies: ["family-a"],
  archetype: "x-post" as const,
};

const context: ModerationLogContext = {
  guildName: "Guild",
  dryRun: false,
  includeDebugDetails: true,
  memberTag: "user#0001",
  userId: "1",
  moderationAction: "kick",
  memberRoleSnapshot: ["Member (1)", "Muted (2)"],
  sourceChannelId: "2",
  sourceChannelName: "general",
  messageId: "3",
  attachmentName: "image.jpg",
  attachmentUrl: "https://example.com/image.jpg",
  contentType: "image/jpeg",
  match: evaluation,
  evaluation,
  deleteRequested: true,
  deleteSucceeded: true,
  dmAttempted: true,
  dmSucceeded: true,
  enforcementAttempted: true,
  enforcementSucceeded: true,
  enforcementReason: "reason",
};

describe("formatModerationLog", () => {
  test("includes classification metrics", () => {
    const message = formatModerationLog(context);
    expect(message).toContain("Classification");
    expect(message).toContain("Matched family");
    expect(message).toContain("edgeHashDistance=3");
    expect(message).toContain("roiVotes=3/4");
    expect(message).toContain("scam/test.jpg");
    expect(message).toContain("Member roles at action time");
    expect(message).toContain("Enforcement attempted");
  });

  test("formats evaluation reports", () => {
    const message = formatEvaluationReport(evaluation);
    expect(message).toContain("Rule Results");
    expect(message).toContain("Family consensus rule");
  });

  test("uses summary logs for dry-run mode", () => {
    const message = formatModerationLog({
      ...context,
      dryRun: true,
      includeDebugDetails: false,
    });
    expect(message).toContain("Dry-run enforcement would have triggered");
    expect(message).not.toContain("Rule Results");
  });

  test("escapes user-controlled text", () => {
    const message = formatModerationLog({
      ...context,
      guildName: "@everyone *Guild*",
      memberTag: "user_*`name`",
      sourceChannelName: "chan_[x]",
      attachmentName: "file_[x].png",
      attachmentUrl: "https://example.com/a`b`",
      enforcementReason: "@here *(reason)*",
    });

    expect(message).toContain("Guild: @​everyone \\*Guild\\*");
    expect(message).toContain("<@1> (**user\\_\\*`name`**, `1`)");
    expect(message).toContain("<#2> (**chan\\_\\[x\\]**, `2`)");
    expect(message).toContain("Attachment: file\\_\\[x\\].png");
    expect(message).toContain("Attachment URL: ``https://example.com/a`​b`​``");
    expect(message).toContain("Enforcement reason: @​here \\*\\(reason\\)\\*");
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
        enforcementReason: "x".repeat(4000),
      },
    );

    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((chunk) => chunk.length <= 2000)).toBe(true);
  });

  test("does not crash on malformed match detail entries", () => {
    const message = formatModerationLog({
      ...context,
      evaluation: {
        ...context.evaluation,
        familyCandidates: [undefined as never, detail],
      },
    });

    expect(message).toContain("malformed match detail");
    expect(message).toContain("scam/test.jpg");
  });
});
