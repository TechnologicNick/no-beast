import type { Database } from "bun:sqlite";
import type { GuildSettings, ModerationAction } from "./types.js";

interface SettingsRow {
  guild_id: string;
  scanner_enabled: number;
  dry_run: number;
  moderation_action: string;
  kick_message_override: string | null;
  rejoin_invite_url: string | null;
  moderation_log_channel_id: string | null;
  updated_at: string;
}

function parseModerationAction(value: string | null | undefined): ModerationAction {
  return value === "kick" || value === "ban" || value === "timeout-24h" ? value : "timeout-24h";
}

export class SettingsStore {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public getGuildSettings(guildId: string): GuildSettings {
    const row = this.db
      .query<SettingsRow, [string]>("SELECT * FROM guild_settings WHERE guild_id = ?1")
      .get(guildId);

    if (!row) {
      return {
        guildId,
        scannerEnabled: true,
        dryRun: false,
        moderationAction: "timeout-24h",
        kickMessageOverride: null,
        rejoinInviteUrl: null,
        moderationLogChannelId: null,
        updatedAt: null,
      };
    }

    return {
      guildId: row.guild_id,
      scannerEnabled: row.scanner_enabled === 1,
      dryRun: row.dry_run === 1,
      moderationAction: parseModerationAction(row.moderation_action),
      kickMessageOverride: row.kick_message_override,
      rejoinInviteUrl: row.rejoin_invite_url,
      moderationLogChannelId: row.moderation_log_channel_id,
      updatedAt: row.updated_at,
    };
  }

  public setScannerEnabled(guildId: string, enabled: boolean): void {
    this.upsert(guildId, { scannerEnabled: enabled });
  }

  public setDryRun(guildId: string, dryRun: boolean): void {
    this.upsert(guildId, { dryRun });
  }

  public setModerationAction(guildId: string, action: ModerationAction): void {
    this.upsert(guildId, { moderationAction: action });
  }

  public setKickMessageOverride(guildId: string, message: string | null): void {
    this.upsert(guildId, { kickMessageOverride: message });
  }

  public setRejoinInviteUrl(guildId: string, inviteUrl: string | null): void {
    this.upsert(guildId, { rejoinInviteUrl: inviteUrl });
  }

  public setModerationLogChannelId(guildId: string, channelId: string | null): void {
    this.upsert(guildId, { moderationLogChannelId: channelId });
  }

  private upsert(
    guildId: string,
    updates: Partial<
      Pick<
        GuildSettings,
        "scannerEnabled" | "dryRun" | "moderationAction" | "kickMessageOverride" | "rejoinInviteUrl" | "moderationLogChannelId"
      >
    >,
  ): void {
    const current = this.getGuildSettings(guildId);
    const next: GuildSettings = {
      guildId,
      scannerEnabled: updates.scannerEnabled ?? current.scannerEnabled,
      dryRun: updates.dryRun ?? current.dryRun,
      moderationAction: updates.moderationAction ?? current.moderationAction,
      kickMessageOverride:
        updates.kickMessageOverride === undefined
          ? current.kickMessageOverride
          : updates.kickMessageOverride,
      rejoinInviteUrl:
        updates.rejoinInviteUrl === undefined ? current.rejoinInviteUrl : updates.rejoinInviteUrl,
      moderationLogChannelId:
        updates.moderationLogChannelId === undefined
          ? current.moderationLogChannelId
          : updates.moderationLogChannelId,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .query(
        `INSERT INTO guild_settings (
          guild_id,
          scanner_enabled,
          dry_run,
          moderation_action,
          kick_message_override,
          rejoin_invite_url,
          moderation_log_channel_id,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(guild_id) DO UPDATE SET
          scanner_enabled = excluded.scanner_enabled,
          dry_run = excluded.dry_run,
          moderation_action = excluded.moderation_action,
          kick_message_override = excluded.kick_message_override,
          rejoin_invite_url = excluded.rejoin_invite_url,
          moderation_log_channel_id = excluded.moderation_log_channel_id,
          updated_at = excluded.updated_at`,
      )
      .run(
        next.guildId,
        next.scannerEnabled ? 1 : 0,
        next.dryRun ? 1 : 0,
        next.moderationAction,
        next.kickMessageOverride,
        next.rejoinInviteUrl,
        next.moderationLogChannelId,
        next.updatedAt,
      );
  }
}
