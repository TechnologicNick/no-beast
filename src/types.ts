import type { ChatInputCommandInteraction } from "discord.js";

export type HeuristicStage = "exact-raw" | "family-consensus";
export type MatchClassification = "safe" | "borderline" | "scam";
export type Archetype = "x-post" | "withdrawal-proof";
export type ModerationAction = "timeout-24h" | "kick" | "ban";

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
  moderationAction: ModerationAction;
  kickMessageOverride: string | null;
  rejoinInviteUrl: string | null;
  moderationLogChannelId: string | null;
  updatedAt: string | null;
}

export interface RoiWindow {
  x: number;
  y: number;
  size: number;
}

export interface DatasetFingerprint {
  id: string;
  relativePath: string;
  familyId: string;
  archetype: Archetype;
  rawSha256: string;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  edgeHash: bigint;
  lumaGrid: Uint8Array;
  roiSignatures: Uint8Array[];
}

export interface ScamFamilyModel {
  familyId: string;
  archetype: Archetype;
  memberIds: string[];
  roiWindows: RoiWindow[];
  centroidAspectRatio: number;
  centroidPHash: bigint;
  centroidDHash: bigint;
  centroidEdgeHash: bigint;
  centroidLumaGrid: Uint8Array;
  centroidRoiSignatures: Uint8Array[];
  thresholds: {
    globalScore: number;
    borderlineScore: number;
    memberScore: number;
    aspectRatioDelta: number;
    pHashDistance: number;
    dHashDistance: number;
    edgeHashDistance: number;
    lumaMae: number;
    roiMae: number[];
    borderlineOnly: boolean;
  };
}

export interface ScamDataset {
  fingerprints: DatasetFingerprint[];
  familyModels: ScamFamilyModel[];
  roiWindowsByArchetype: Record<Archetype, RoiWindow[]>;
}

export interface MatchDetail {
  reference: DatasetFingerprint;
  stage: HeuristicStage;
  aspectRatioDelta: number;
  pHashDistance: number;
  dHashDistance: number;
  edgeHashDistance: number;
  lumaMae: number;
  templateMae: number;
  memberScore: number;
  roiMae: number[];
  roiVotes: number;
}

export interface MatchEvaluation {
  rawMatches: MatchDetail[];
  familyCandidates: MatchDetail[];
  shortlistedFamilies: string[];
  archetype: Archetype | null;
}

export interface AttachmentMatchResult extends MatchEvaluation {
  classification: MatchClassification;
  stage: HeuristicStage | null;
  details: MatchDetail[];
  matchedFamilyId: string | null;
  confidence: number;
  roiVotes: number;
}

export interface RenderedKickMessage {
  content: string;
  usedOverride: boolean;
}

export interface ModerationLogContext {
  guildName: string;
  dryRun: boolean;
  includeDebugDetails: boolean;
  memberTag: string;
  userId: string;
  moderationAction: ModerationAction;
  memberRoleSnapshot: string[];
  sourceChannelId: string;
  sourceChannelName: string;
  messageId: string;
  attachmentName: string;
  attachmentUrl: string;
  contentType: string | null;
  match: AttachmentMatchResult | null;
  evaluation: AttachmentMatchResult;
  deleteRequested: boolean;
  deleteSucceeded: boolean | null;
  dmAttempted: boolean;
  dmSucceeded: boolean | null;
  enforcementAttempted: boolean;
  enforcementSucceeded: boolean | null;
  enforcementReason: string;
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
  action: "ignored" | "dry-run" | "enforced" | "enforcement-failed";
}

export interface CommandHandlerContext {
  settingsStore: {
    getGuildSettings(guildId: string): GuildSettings;
    setScannerEnabled(guildId: string, enabled: boolean): void;
    setDryRun(guildId: string, dryRun: boolean): void;
    setModerationAction(guildId: string, action: ModerationAction): void;
    setKickMessageOverride(guildId: string, message: string | null): void;
    setRejoinInviteUrl(guildId: string, inviteUrl: string | null): void;
    setModerationLogChannelId(guildId: string, channelId: string | null): void;
  };
  matcher: {
    matchBuffer(buffer: Uint8Array): Promise<AttachmentMatchResult>;
  };
  fetchAttachmentBytes(url: string): Promise<Uint8Array>;
  reply(interaction: ChatInputCommandInteraction, content: string): Promise<void>;
  logger: Pick<LoggerLike, "warn" | "error">;
}

export interface CommandSyncResult {
  body: unknown[];
  scope: "global" | "guild" | "both";
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
  grayscale256: Uint8Array;
  aspectRatio: number;
  pHash: bigint;
  dHash: bigint;
  edgeHash: bigint;
  lumaGrid: Uint8Array;
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
    ban(options?: { reason?: string; deleteMessageSeconds?: number }): Promise<unknown>;
    timeout(milliseconds: number | null, reason?: string): Promise<unknown>;
    roles: {
      cache: {
        values(): IterableIterator<{
          id: string;
          name: string;
        }>;
      };
    };
  } | null;
  delete(): Promise<unknown>;
}
