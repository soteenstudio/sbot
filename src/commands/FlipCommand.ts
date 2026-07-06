import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChatInputCommandInteraction } from 'discord.js';

export class FlipCommand extends Subcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, { ...options, name: 'flip' });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder.setName('flip').setDescription('Flip a coin'),
    );
  }

  public async chatInputRun(interaction: ChatInputCommandInteraction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';

    return interaction.reply({
      content: `🪙 **${interaction.user.username}** flipped a coin and got **${result}**!`,
    });
  }
}
