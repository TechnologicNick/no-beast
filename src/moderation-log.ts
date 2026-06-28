import type { AttachmentMatchResult, LogChannelLike, ModerationLogContext } from "./types.js";

const DISCORD_MESSAGE_MAX_LENGTH = 2000;

function escapeDiscordText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("~", "\\~")
    .replaceAll("|", "\\|")
    .replaceAll(">", "\\>")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("@", "@\u200b");
}

function formatInlineCode(value: string): string {
  const escaped = value.replaceAll("`", "`\u200b");
  if (escaped.includes("`")) {
    return `\`\`${escaped}\`\``;
  }
  return `\`${escaped}\``;
}

function formatMetric(label: string, value: string | number | boolean | null): string {
  return `- ${label}: ${value === null ? "n/a" : String(value)}`;
}

function formatUserReference(userId: string, memberTag: string): string {
  return `<@${userId}> (**${escapeDiscordText(memberTag)}**, ${formatInlineCode(userId)})`;
}

function formatChannelReference(channelId: string, channelName: string): string {
  return `<#${channelId}> (**${escapeDiscordText(channelName)}**, ${formatInlineCode(channelId)})`;
}

function formatRuleStatus(label: string, matched: boolean, detail: string): string {
  return `${matched ? "✅" : "❌"} ${label}: ${detail}`;
}

function formatRoleList(roles: string[]): string {
  return roles.length > 0 ? roles.map((role) => escapeDiscordText(role)).join(", ") : "none";
}

function isMatchDetail(
  detail: unknown,
): detail is ModerationLogContext["evaluation"]["rawMatches"][number] {
  if (!detail || typeof detail !== "object") {
    return false;
  }

  const candidate = detail as {
    reference?: { relativePath?: unknown };
    memberScore?: unknown;
    aspectRatioDelta?: unknown;
    pHashDistance?: unknown;
    dHashDistance?: unknown;
    edgeHashDistance?: unknown;
    lumaMae?: unknown;
    roiVotes?: unknown;
  };

  return (
    !!candidate.reference &&
    typeof candidate.reference.relativePath === "string" &&
    typeof candidate.memberScore === "number" &&
    typeof candidate.aspectRatioDelta === "number" &&
    typeof candidate.pHashDistance === "number" &&
    typeof candidate.dHashDistance === "number" &&
    typeof candidate.edgeHashDistance === "number" &&
    typeof candidate.lumaMae === "number" &&
    typeof candidate.roiVotes === "number"
  );
}

function formatDetail(detail: unknown): string {
  if (!isMatchDetail(detail)) {
    return "malformed match detail";
  }
  return `${escapeDiscordText(detail.reference.relativePath)} | score=${detail.memberScore.toFixed(2)} | aspectRatioDelta=${detail.aspectRatioDelta.toFixed(4)} | pHashDistance=${detail.pHashDistance} | dHashDistance=${detail.dHashDistance} | edgeHashDistance=${detail.edgeHashDistance} | lumaMae=${detail.lumaMae.toFixed(2)} | roiVotes=${detail.roiVotes}/4`;
}

export function splitModerationLog(content: string, maxLength = DISCORD_MESSAGE_MAX_LENGTH): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let current = "";

  for (const line of content.split("\n")) {
    if (line.length > maxLength) {
      if (current.length > 0) {
        chunks.push(current);
        current = "";
      }

      for (let index = 0; index < line.length; index += maxLength) {
        chunks.push(line.slice(index, index + maxLength));
      }
      continue;
    }

    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length > maxLength) {
      chunks.push(current);
      current = line;
      continue;
    }

    current = next;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function formatEvaluationReport(evaluation: AttachmentMatchResult): string {
  const lines = [
    "**Classification**",
    formatMetric("Classification", evaluation.classification),
    formatMetric("Winning stage", evaluation.stage ?? "none"),
    formatMetric("Archetype", evaluation.archetype ?? "none"),
    formatMetric("Matched family", evaluation.matchedFamilyId ?? "none"),
    formatMetric("Confidence", evaluation.confidence.toFixed(3)),
    formatMetric("ROI votes", evaluation.roiVotes),
    formatMetric("Exact raw matches", evaluation.rawMatches.length),
    formatMetric("Family candidates", evaluation.familyCandidates.length),
    formatMetric("Shortlisted families", evaluation.shortlistedFamilies.join(", ") || "none"),
    "",
    "**Rule Results**",
    formatRuleStatus("Exact raw rule", evaluation.rawMatches.length > 0, `${evaluation.rawMatches.length} match(es)`),
    formatRuleStatus(
      "Family consensus rule",
      evaluation.classification === "scam",
      `${evaluation.familyCandidates.length} family candidate(s), ${evaluation.roiVotes} ROI vote(s)`,
    ),
    formatRuleStatus(
      "Borderline rule",
      evaluation.classification === "borderline",
      `${evaluation.familyCandidates.length} family candidate(s)`,
    ),
  ];

  for (const detail of evaluation.rawMatches) {
    lines.push(formatMetric("Exact raw", formatDetail(detail)));
  }

  for (const detail of evaluation.familyCandidates) {
    lines.push(formatMetric("Family candidate", formatDetail(detail)));
  }

  for (const detail of evaluation.details) {
    lines.push(formatMetric("Supporting reference", formatDetail(detail)));
  }

  return lines.join("\n");
}

export function formatModerationLog(context: ModerationLogContext): string {
  const title = context.dryRun
    ? "Dry-run enforcement would have triggered"
    : context.evaluation.classification === "borderline"
      ? "Borderline image classification"
      : "Scam match enforced";
  const lines = [
    `**${title}**`,
    formatMetric("Guild", escapeDiscordText(context.guildName)),
    formatMetric("User", formatUserReference(context.userId, context.memberTag)),
    formatMetric("Channel", formatChannelReference(context.sourceChannelId, context.sourceChannelName)),
    formatMetric("Message ID", formatInlineCode(context.messageId)),
    formatMetric("Attachment", `${escapeDiscordText(context.attachmentName)} (${escapeDiscordText(context.contentType ?? "unknown")})`),
    formatMetric("Attachment URL", formatInlineCode(context.attachmentUrl)),
    formatMetric("Dry run", context.dryRun),
    formatMetric("Moderation action", context.moderationAction),
    formatMetric("Delete requested", context.deleteRequested),
    formatMetric("Delete succeeded", context.deleteSucceeded),
    formatMetric("DM attempted", context.dmAttempted),
    formatMetric("DM succeeded", context.dmSucceeded),
    formatMetric("Enforcement attempted", context.enforcementAttempted),
    formatMetric("Enforcement succeeded", context.enforcementSucceeded),
    formatMetric("Enforcement reason", escapeDiscordText(context.enforcementReason)),
    formatMetric("Member roles at action time", formatRoleList(context.memberRoleSnapshot)),
  ];

  if (!context.includeDebugDetails) {
    lines.push("", formatMetric("Classification", context.evaluation.classification));
    lines.push(formatMetric("Matched family", context.evaluation.matchedFamilyId ?? "none"));
    return lines.join("\n");
  }

  lines.push("", formatEvaluationReport(context.evaluation));
  return lines.join("\n");
}

export async function sendModerationLog(channel: LogChannelLike | null, context: ModerationLogContext): Promise<void> {
  if (!channel) {
    return;
  }
  for (const chunk of splitModerationLog(formatModerationLog(context))) {
    await channel.send({ content: chunk });
  }
}
