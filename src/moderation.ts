import { MAX_ATTACHMENT_BYTES } from "./constants.js";
import type {
  AttachmentCandidate,
  AttachmentMatchResult,
  MessageLike,
  ModerationDependencies,
  ModerationExecutionResult,
  ModerationLogContext,
} from "./types.js";

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

function buildKickReason(match: AttachmentMatchResult): string {
  return `Matched known scam image dataset entries: ${match.details
    .map((detail) => detail.reference.relativePath)
    .join(", ")}`;
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
    const match = evaluation.classification === "safe" ? null : evaluation;
    const enforceable = evaluation.classification === "scam";
    const kickReason = enforceable && match ? buildKickReason(match) : "No moderation action taken.";
    const baseContext: Omit<
      ModerationLogContext,
      "deleteRequested" | "deleteSucceeded" | "dmAttempted" | "dmSucceeded" | "kickAttempted" | "kickSucceeded"
    > = {
      guildName: message.guild.name,
      dryRun: settings.dryRun,
      memberTag: message.author.tag,
      userId: message.author.id,
      sourceChannelId: message.channel.id,
      sourceChannelName: getChannelName(message),
      messageId: message.id,
      attachmentName: attachment.name,
      attachmentUrl: attachment.url,
      contentType: attachment.contentType,
      evaluation,
      match,
      kickReason,
    };

    if (settings.dryRun) {
      dryRunMatched ||= enforceable;
      await dependencies.sendModerationLog(logChannel, {
        ...baseContext,
        deleteRequested: false,
        deleteSucceeded: null,
        dmAttempted: false,
        dmSucceeded: null,
        kickAttempted: false,
        kickSucceeded: null,
      });
      continue;
    }

    if (evaluation.classification === "borderline") {
      await dependencies.sendModerationLog(logChannel, {
        ...baseContext,
        deleteRequested: false,
        deleteSucceeded: null,
        dmAttempted: false,
        dmSucceeded: null,
        kickAttempted: false,
        kickSucceeded: null,
      });
      continue;
    }

    if (!enforceable) {
      continue;
    }

    const deletePromise = message.delete();
    let deleteSucceeded: boolean | null = null;
    let dmSucceeded: boolean | null = null;
    let kickSucceeded: boolean | null = null;

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
      await message.member.kick(kickReason);
      kickSucceeded = true;
    } catch (error) {
      dependencies.logger.error(`Failed to kick ${message.author.id}: ${String(error)}`);
      kickSucceeded = false;
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
      deleteRequested: true,
      deleteSucceeded,
      dmAttempted: true,
      dmSucceeded,
      kickAttempted: true,
      kickSucceeded,
    });

    return { matched: true, action: kickSucceeded ? "enforced" : "kick-failed" };
  }

  if (settings.dryRun && attachments.length > 0) {
    return { matched: dryRunMatched, action: "dry-run" };
  }

  return { matched: false, action: "ignored" };
}
