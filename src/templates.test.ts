import { describe, expect, test } from "bun:test";
import { renderKickMessage } from "./templates.js";

describe("renderKickMessage", () => {
  test("uses the default message when no override exists", () => {
    const rendered = renderKickMessage({
      guildName: "Guild",
      override: null,
      inviteUrl: null,
    });

    expect(rendered.content).toContain("Guild");
    expect(rendered.usedOverride).toBe(false);
  });

  test("appends the invite URL when configured", () => {
    const rendered = renderKickMessage({
      guildName: "Guild",
      override: "Removed from {serverName}.",
      inviteUrl: "https://discord.gg/example",
    });

    expect(rendered.content).toContain("Removed from Guild.");
    expect(rendered.content).toContain("https://discord.gg/example");
    expect(rendered.usedOverride).toBe(true);
  });
});
