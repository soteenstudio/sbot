/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { Subcommand } from '@sapphire/plugin-subcommands';
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

export class RefundCommand extends Subcommand {
  public static commandName = 'refund';
  public static commandDescription =
    'Record a subscription refund (Admin Only).';

  public constructor(
    context: Subcommand.LoaderContext,
    options: Subcommand.Options,
  ) {
    super(context, {
      ...options,
      name: RefundCommand.commandName,
      description: RefundCommand.commandDescription,
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName(this.name)
        .setDescription(this.description)
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
          option
            .setName('buyer')
            .setDescription('The buyer whose subscription to refund')
            .setRequired(true),
        ),
    );
  }

  public async chatInputRun(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      await interaction.reply({
        content: '❌ Use /refund in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      await interaction.reply({
        content:
          '❌ Administrator permission is required to refund subscriptions.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Do not infer historical payments or cancellation policy from subscriptions.
    await interaction.editReply({
      content:
        '❌ Refunds are unavailable until the owner supplies the currency, subscription prices, refund basis, and subscription cancellation policy. No refund was recorded or subscription changed.',
    });
  }
}
