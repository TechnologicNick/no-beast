import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SettingsStore } from "./settings-store.js";

const databases: Database[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close(false);
  }
});

function createStore(): SettingsStore {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      scanner_enabled INTEGER NOT NULL DEFAULT 1,
      dry_run INTEGER NOT NULL DEFAULT 0,
      moderation_action TEXT NOT NULL DEFAULT 'timeout-24h',
      kick_message_override TEXT NULL,
      rejoin_invite_url TEXT NULL,
      moderation_log_channel_id TEXT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  databases.push(db);
  return new SettingsStore(db);
}

describe("SettingsStore", () => {
  test("returns defaults when no row exists", () => {
    const store = createStore();
    const settings = store.getGuildSettings("guild-1");
    expect(settings.scannerEnabled).toBe(true);
    expect(settings.dryRun).toBe(false);
    expect(settings.moderationAction).toBe("timeout-24h");
    expect(settings.kickMessageOverride).toBeNull();
    expect(settings.rejoinInviteUrl).toBeNull();
  });

  test("persists updates", () => {
    const store = createStore();
    store.setDryRun("guild-1", true);
    store.setModerationAction("guild-1", "ban");
    store.setKickMessageOverride("guild-1", "Hello {serverName}");
    store.setModerationLogChannelId("guild-1", "123");

    const settings = store.getGuildSettings("guild-1");
    expect(settings.dryRun).toBe(true);
    expect(settings.moderationAction).toBe("ban");
    expect(settings.kickMessageOverride).toBe("Hello {serverName}");
    expect(settings.moderationLogChannelId).toBe("123");
  });
});
