import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      scanner_enabled INTEGER NOT NULL DEFAULT 1,
      dry_run INTEGER NOT NULL DEFAULT 0,
      kick_message_override TEXT NULL,
      rejoin_invite_url TEXT NULL,
      moderation_log_channel_id TEXT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}
