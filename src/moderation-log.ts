import type { LogChannelLike, ModerationLogContext } from "./types.js";

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

function formatDetail(detail: ModerationLogContext["evaluation"]["rawMatches"][number]): string {
  return `${escapeDiscordText(detail.reference.relativePath)} | stage=${detail.stage} | aspectRatioDelta=${detail.aspectRatioDelta.toFixed(4)} | pHashDistance=${detail.pHashDistance} | dHashDistance=${detail.dHashDistance} | templateMae=${detail.templateMae.toFixed(4)}`;
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

export function formatModerationLog(context: ModerationLogContext): string {
  const title = context.dryRun
    ? context.match
      ? "Dry-run scam match detected"
      : "Dry-run attachment analysis"
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
    formatMetric("Delete requested", context.deleteRequested),
    formatMetric("Delete succeeded", context.deleteSucceeded),
    formatMetric("DM attempted", context.dmAttempted),
    formatMetric("DM succeeded", context.dmSucceeded),
    formatMetric("Kick attempted", context.kickAttempted),
    formatMetric("Kick succeeded", context.kickSucceeded),
    formatMetric("Kick reason", escapeDiscordText(context.kickReason)),
    "",
    "**Heuristics**",
    formatMetric("Matched", context.evaluation.matched),
    formatMetric("Winning stage", context.match?.stage ?? "none"),
    formatMetric("Exact raw matches", context.evaluation.rawMatches.length),
    formatMetric("Exact normalized matches", context.evaluation.normalizedMatches.length),
    formatMetric("Near-duplicate candidates", context.evaluation.nearDuplicateCandidates.length),
    formatMetric("Template-nearest candidates", context.evaluation.templateNearestCandidates.length),
  ];

  if (context.dryRun) {
    lines.push(
      "",
      "**Rule Results**",
      formatRuleStatus(
        "Exact raw rule",
        context.evaluation.rawMatches.length > 0,
        `${context.evaluation.rawMatches.length} match(es)`,
      ),
      formatRuleStatus(
        "Exact normalized rule",
        context.evaluation.normalizedMatches.length > 0,
        `${context.evaluation.normalizedMatches.length} match(es)`,
      ),
      formatRuleStatus(
        "Near-duplicate rule",
        context.evaluation.nearDuplicateCandidates.length > 0,
        `${context.evaluation.nearDuplicateCandidates.length} candidate(s)`,
      ),
      formatRuleStatus(
        "Template-nearest rule",
        context.evaluation.templateNearestCandidates.length > 0,
        `${context.evaluation.templateNearestCandidates.length} candidate(s)`,
      ),
    );
  }

  for (const detail of context.evaluation.rawMatches) {
    lines.push(formatMetric("Exact raw", formatDetail(detail)));
  }

  for (const detail of context.evaluation.normalizedMatches) {
    lines.push(formatMetric("Exact normalized", formatDetail(detail)));
  }

  for (const detail of context.evaluation.nearDuplicateCandidates) {
    lines.push(formatMetric("Near-duplicate candidate", formatDetail(detail)));
  }

  for (const detail of context.evaluation.templateNearestCandidates) {
    lines.push(formatMetric("Template-nearest candidate", formatDetail(detail)));
  }

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
