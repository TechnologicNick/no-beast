import { DEFAULT_KICK_MESSAGE } from "./constants.js";
import type { RenderedKickMessage } from "./types.js";

export function renderKickMessage(input: {
  guildName: string;
  override: string | null;
  inviteUrl: string | null;
}): RenderedKickMessage {
  const template = input.override ?? DEFAULT_KICK_MESSAGE;
  const content = template.replaceAll("{serverName}", input.guildName);
  const inviteSuffix = input.inviteUrl ? `\n\nRejoin: ${input.inviteUrl}` : "";
  return {
    content: `${content}${inviteSuffix}`,
    usedOverride: input.override !== null,
  };
}
