/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  InteractionHandler,
  InteractionHandlerTypes,
  PieceContext,
} from '@sapphire/framework';
import {
  ButtonInteraction,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { activeLFG } from '../lib/lfg-data.js';

export class RequestHandler extends InteractionHandler {
  public constructor(
    context: PieceContext,
    options: InteractionHandler.Options,
  ) {
    super(context, {
      ...options,
      interactionHandlerType: InteractionHandlerTypes.Button,
    });
  }

  public override parse(interaction: ButtonInteraction) {
    if (
      interaction.customId.startsWith('lfg_pro_accept_') ||
      interaction.customId.startsWith('lfg_pro_decline_')
    ) {
      return this.some();
    }
    return this.none();
  }

  public async run(interaction: ButtonInteraction) {
    const parts = interaction.customId.split('_');
    const action = parts[2];
    const joinerId = parts[3];
    const channelId = parts[4];
    const hostId = parts[5];

    if (action === 'decline') {
      return interaction.followUp({
        content: '🚫 Request declined.',
        ephemeral: true,
      });
    }

    try {
      await interaction.deferUpdate();
    } catch (e) {}

    const session = activeLFG.get(hostId);
    if (!session)
      return interaction.followUp({
        content: '❌ Session not found.',
        ephemeral: true,
      });

    const channelOrigin = await interaction.client.channels
      .fetch(channelId)
      .catch(() => null);
    const guild = (channelOrigin as any)?.guild;

    if (!guild) {
      return interaction.followUp({
        content: '❌ Gagal akses server asal.',
        ephemeral: true,
      });
    }

    const host = await interaction.client.users.fetch(hostId).catch(() => null);
    if (!host)
      return interaction.followUp({
        content: '❌ Host tidak ditemukan.',
        ephemeral: true,
      });
    const vc = await guild.channels.create({
      name: `LFG-${host.username}`,
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: host.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
          ],
        },
        {
          id: joinerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
          ],
        },
      ],
    });

    activeLFG.set(hostId, { ...session, vcId: vc.id });

    const channel = await interaction.client.channels
      .fetch(session.channelId)
      .catch(() => null);
    if (channel && channel.isTextBased()) {
      const message = await channel.messages
        .fetch(session.messageId)
        .catch(() => null);
      if (message) {
        const oldEmbed = EmbedBuilder.from(message.embeds[0]);

        const newDescription = oldEmbed.data.description?.replace(
          /(\d+)\/(\d+)/,
          (match, current) => {
            return `${parseInt(current) + 1}/${session.maxPlayers}`;
          },
        );

        const currentCount = parseInt(
          newDescription?.match(/(\d+)\//)?.[1] || '0',
        );

        if (currentCount >= session.maxPlayers) {
          const fullRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId('lfg_pro_full')
              .setLabel('Session Full')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
          );

          await message.edit({
            embeds: [oldEmbed.setDescription(newDescription || null)],
            components: [fullRow],
          });
        } else {
          await message.edit({
            embeds: [oldEmbed.setDescription(newDescription || null)],
          });
        }
      }
    }

    const endRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lfg_pro_end_${vc.id}`)
        .setLabel('End Session')
        .setStyle(ButtonStyle.Danger),
    );

    await vc.send({
      content: `✅ Match created! <@${host.id}> & <@${joinerId}>.`,
      components: [endRow],
    });
    return interaction.followUp({
      content: `✅ Match accepted! Join here: ${vc.toString()}`,
      ephemeral: true,
    });
  }
}
