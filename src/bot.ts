import {
  Client,
  Events,
  GatewayIntentBits,
  OAuth2Scopes,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { handleCommand, resolveLogChannel } from "./commands.js";
import { moderateMessage } from "./moderation.js";
import type { AppConfig, ModerationDependencies } from "./types.js";

export function createBot(
  config: AppConfig,
  dependencies: ModerationDependencies & {
    commandContext: Parameters<typeof handleCommand>[1];
  },
): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  client.once(Events.ClientReady, (readyClient) => {
    dependencies.logger.info(`Logged in as ${readyClient.user.tag}`);
    const inviteUrl = readyClient.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions: new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.KickMembers,
      ]),
    });
    dependencies.logger.info(`Invite URL: ${inviteUrl}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    await handleCommand(interaction as ChatInputCommandInteraction, dependencies.commandContext);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guildId) {
      return;
    }
    const settings = dependencies.settingsStore.getGuildSettings(message.guildId);
    const logChannel = resolveLogChannel(client, message.guildId, settings.moderationLogChannelId);
    await moderateMessage(message, dependencies, logChannel);
  });

  void client.login(config.discordToken);
  return client;
}
