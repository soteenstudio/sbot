import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChatInputCommandInteraction } from 'discord.js';

export class RollCommand extends Subcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, { ...options, name: 'roll' });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('roll')
        .setDescription('Roll a random number')
        .addIntegerOption((o) =>
          o
            .setName('max')
            .setDescription('Max number (default 100)')
            .setMinValue(1),
        ),
    );
  }

  public async chatInputRun(interaction: ChatInputCommandInteraction) {
    const max = interaction.options.getInteger('max') || 100;
    const result = Math.floor(Math.random() * max) + 1;

    return interaction.reply({
      content: `🎲 **${interaction.user.username}** rolled a **${result}** (1-${max})`,
    });
  }
}
