import { MAX_ATTACHMENT_BYTES } from "./constants.js";
import type {
  AttachmentCandidate,
  AttachmentMatchResult,
  GuildSettings,
  MessageLike,
  ModerationAction,
  ModerationDependencies,
  ModerationExecutionResult,
  ModerationLogContext,
} from "./types.js";

const TIMEOUT_24_HOURS_MS = 24 * 60 * 60 * 1000;

function extractImageAttachments(message: MessageLike): AttachmentCandidate[] {
  return Array.from(message.attachments.values()).filter(
    (attachment) =>
      attachment.contentType?.startsWith("image/") &&
      attachment.size > 0 &&
      attachment.size <= MAX_ATTACHMENT_BYTES,
  );
}

function getChannelName(message: MessageLike): string {
  return message.channel.name ?? message.channel.toString?.() ?? message.channel.id;
}

function getMemberRoleSnapshot(message: MessageLike): string[] {
  return message.member
    ? Array.from(message.member.roles.cache.values()).map((role) => `${role.name} (${role.id})`)
    : [];
}

function buildEnforcementReason(match: AttachmentMatchResult): string {
  return `Matched known scam image dataset entries: ${match.details
    .map((detail) => detail.reference.relativePath)
    .join(", ")}`;
}

async function applyModerationAction(
  message: MessageLike,
  action: ModerationAction,
  reason: string,
): Promise<boolean> {
  if (!message.member) {
    return false;
  }
  if (action === "timeout-24h") {
    await message.member.timeout(TIMEOUT_24_HOURS_MS, reason);
    return true;
  }
  if (action === "kick") {
    await message.member.kick(reason);
    return true;
  }
  await message.member.ban({ reason, deleteMessageSeconds: 0 });
  return true;
}

function buildBaseContext(
  message: MessageLike,
  attachment: AttachmentCandidate,
  settings: GuildSettings,
  evaluation: AttachmentMatchResult,
  enforcementReason: string,
): Omit<
  ModerationLogContext,
  "deleteRequested" | "deleteSucceeded" | "dmAttempted" | "dmSucceeded" | "enforcementAttempted" | "enforcementSucceeded"
> {
  return {
    guildName: message.guild?.name ?? "Unknown Guild",
    dryRun: settings.dryRun,
    includeDebugDetails: !settings.dryRun,
    memberTag: message.author.tag,
    userId: message.author.id,
    moderationAction: settings.moderationAction,
    memberRoleSnapshot: getMemberRoleSnapshot(message),
    sourceChannelId: message.channel.id,
    sourceChannelName: getChannelName(message),
    messageId: message.id,
    attachmentName: attachment.name,
    attachmentUrl: attachment.url,
    contentType: attachment.contentType,
    evaluation,
    match: evaluation.classification === "safe" ? null : evaluation,
    enforcementReason,
  };
}

export async function moderateMessage(
  message: MessageLike,
  dependencies: ModerationDependencies,
  logChannel: Parameters<ModerationDependencies["sendModerationLog"]>[0],
): Promise<ModerationExecutionResult> {
  if (!message.guildId || !message.guild || !message.member) {
    return { matched: false, action: "ignored" };
  }

  if (message.author.bot || message.webhookId) {
    return { matched: false, action: "ignored" };
  }

  const settings = dependencies.settingsStore.getGuildSettings(message.guildId);
  if (!settings.scannerEnabled) {
    return { matched: false, action: "ignored" };
  }

  const attachments = extractImageAttachments(message);
  let dryRunMatched = false;

  for (const attachment of attachments) {
    let bytes: Uint8Array;
    try {
      bytes = await dependencies.fetchAttachmentBytes(attachment.url);
    } catch (error) {
      dependencies.logger.error(`Failed to download attachment ${attachment.url}: ${String(error)}`);
      continue;
    }

    const evaluation = await dependencies.matcher.matchBuffer(bytes);
    const enforceable = evaluation.classification === "scam";
    const enforcementReason = enforceable ? buildEnforcementReason(evaluation) : "No moderation action taken.";
    const baseContext = buildBaseContext(message, attachment, settings, evaluation, enforcementReason);

    if (settings.dryRun) {
      if (!enforceable) {
        continue;
      }
      dryRunMatched = true;
      await dependencies.sendModerationLog(logChannel, {
        ...baseContext,
        includeDebugDetails: false,
        deleteRequested: true,
        deleteSucceeded: null,
        dmAttempted: true,
        dmSucceeded: null,
        enforcementAttempted: true,
        enforcementSucceeded: null,
      });
      return { matched: true, action: "dry-run" };
    }

    if (evaluation.classification === "borderline") {
      await dependencies.sendModerationLog(logChannel, {
        ...baseContext,
        includeDebugDetails: true,
        deleteRequested: false,
        deleteSucceeded: null,
        dmAttempted: false,
        dmSucceeded: null,
        enforcementAttempted: false,
        enforcementSucceeded: null,
      });
      continue;
    }

    if (!enforceable) {
      continue;
    }

    const deletePromise = message.delete();
    let deleteSucceeded: boolean | null = null;
    let dmSucceeded: boolean | null = null;
    let enforcementSucceeded: boolean | null = null;

    const renderedMessage = dependencies.renderKickMessage({
      guildName: message.guild.name,
      override: settings.kickMessageOverride,
      inviteUrl: settings.rejoinInviteUrl,
    });

    try {
      await message.author.send(renderedMessage.content);
      dmSucceeded = true;
    } catch (error) {
      dependencies.logger.warn(`Failed to send DM to ${message.author.id}: ${String(error)}`);
      dmSucceeded = false;
    }

    try {
      await applyModerationAction(message, settings.moderationAction, enforcementReason);
      enforcementSucceeded = true;
    } catch (error) {
      dependencies.logger.error(`Failed to ${settings.moderationAction} ${message.author.id}: ${String(error)}`);
      enforcementSucceeded = false;
    }

    try {
      await deletePromise;
      deleteSucceeded = true;
    } catch (error) {
      dependencies.logger.warn(`Failed to delete message ${message.id}: ${String(error)}`);
      deleteSucceeded = false;
    }

    await dependencies.sendModerationLog(logChannel, {
      ...baseContext,
      includeDebugDetails: true,
      deleteRequested: true,
      deleteSucceeded,
      dmAttempted: true,
      dmSucceeded,
      enforcementAttempted: true,
      enforcementSucceeded,
    });

    return { matched: true, action: enforcementSucceeded ? "enforced" : "enforcement-failed" };
  }

  if (settings.dryRun && attachments.length > 0) {
    return { matched: dryRunMatched, action: "dry-run" };
  }

  return { matched: false, action: "ignored" };
}
