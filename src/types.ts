import type { ChatInputCommandInteraction } from "discord.js";

export type HeuristicStage = "exact-raw" | "exact-normalized" | "near-duplicate" | "template-nearest";

export interface AppConfig {
  discordToken: string;
  clientId: string;
  devGuildId?: string;
  databasePath: string;
  datasetRoot: string;
}

export interface GuildSettings {
  guildId: string;
  scannerEnabled: boolean;
  dryRun: boolean;
  kickMessageOverride: string | null;
  rejoinInviteUrl: string | null;
  moderationLogChannelId: string | null;
  updatedAt: string | null;
}

export interface DatasetFingerprint {
  id: string;
  relativePath: string;
  rawSha256: string;
  normalizedSha256: string;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  templateVector: Uint8Array;
}

export interface MatchDetail {
  reference: DatasetFingerprint;
  stage: HeuristicStage;
  aspectRatioDelta: number;
  pHashDistance: number;
  dHashDistance: number;
  templateMae: number;
}

export interface MatchResult {
  matched: true;
  stage: HeuristicStage;
  details: MatchDetail[];
}

export interface MatchEvaluation {
  rawMatches: MatchDetail[];
  normalizedMatches: MatchDetail[];
  nearDuplicateCandidates: MatchDetail[];
  templateNearestCandidates: MatchDetail[];
}

export interface NoMatchResult extends MatchEvaluation {
  matched: false;
}

export type AttachmentMatchResult = (MatchResult & MatchEvaluation) | NoMatchResult;

export interface RenderedKickMessage {
  content: string;
  usedOverride: boolean;
}

export interface ModerationLogContext {
  guildName: string;
  dryRun: boolean;
  memberTag: string;
  userId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  messageId: string;
  attachmentName: string;
  attachmentUrl: string;
  contentType: string | null;
  match: MatchResult | null;
  evaluation: AttachmentMatchResult;
  deleteRequested: boolean;
  deleteSucceeded: boolean | null;
  dmAttempted: boolean;
  dmSucceeded: boolean | null;
  kickAttempted: boolean;
  kickSucceeded: boolean | null;
  kickReason: string;
}

export interface LogChannelLike {
  send(payload: { content: string }): Promise<unknown>;
}

export interface LoggerLike {
  error(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  info(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface ModerationDependencies {
  fetchAttachmentBytes(url: string): Promise<Uint8Array>;
  matcher: {
    matchBuffer(buffer: Uint8Array): Promise<AttachmentMatchResult>;
  };
  settingsStore: {
    getGuildSettings(guildId: string): GuildSettings;
  };
  renderKickMessage(args: {
    guildName: string;
    override: string | null;
    inviteUrl: string | null;
  }): RenderedKickMessage;
  sendModerationLog(channel: LogChannelLike | null, context: ModerationLogContext): Promise<void>;
  logger: LoggerLike;
}

export interface ModerationExecutionResult {
  matched: boolean;
  action: "ignored" | "dry-run" | "enforced" | "kick-failed";
}

export interface CommandHandlerContext {
  settingsStore: {
    getGuildSettings(guildId: string): GuildSettings;
    setScannerEnabled(guildId: string, enabled: boolean): void;
    setDryRun(guildId: string, dryRun: boolean): void;
    setKickMessageOverride(guildId: string, message: string | null): void;
    setRejoinInviteUrl(guildId: string, inviteUrl: string | null): void;
    setModerationLogChannelId(guildId: string, channelId: string | null): void;
  };
  reply(interaction: ChatInputCommandInteraction, content: string): Promise<void>;
  logger: Pick<LoggerLike, "warn">;
}

export interface CommandSyncResult {
  body: unknown[];
  scope: "global" | "guild";
  targetId: string | null;
  changed: boolean;
}

export interface AttachmentCandidate {
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface NormalizedImageData {
  normalizedBytes: Buffer;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  templateVector: Uint8Array;
}

export interface MessageLike {
  id: string;
  author: {
    id: string;
    tag: string;
    send(content: string): Promise<unknown>;
    bot?: boolean;
  };
  webhookId: string | null;
  guild: {
    id: string;
    name: string;
  } | null;
  guildId: string | null;
  channel: {
    id: string;
    toString?(): string;
    name?: string;
  };
  attachments: {
    values(): IterableIterator<AttachmentCandidate>;
  };
  member: {
    kick(reason?: string): Promise<unknown>;
  } | null;
  delete(): Promise<unknown>;
}
