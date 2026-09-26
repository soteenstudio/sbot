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

const pendingAccepts = new Set<string>();

export class RequestHandler extends InteractionHandler {
  public constructor(
    context: InteractionHandler.LoaderContext,
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
    const hostId = action === 'decline' ? parts[4] : parts[6];

    if (interaction.user.id !== hostId) {
      return interaction.reply({
        content: '❌ Only the session host can answer join requests.',
        ephemeral: true,
      });
    }

    if (action === 'decline') {
      return interaction.reply({
        content: 'Your join request has been declined.',
        ephemeral: true,
      });
    }

    const session = activeLFG.get(hostId);
    if (
      !session ||
      parts[4] !== session.channelId ||
      parts[5] !== session.messageId
    )
      return interaction.reply({
        content: '❌ This session is no longer active.',
        ephemeral: true,
      });

    if (session.kickedIds.has(joinerId)) {
      return interaction.reply({
        content: '❌ This participant has been removed from this session.',
        ephemeral: true,
      });
    }

    if (joinerId === hostId || session.participantIds.has(joinerId)) {
      return interaction.reply({
        content: '❌ This participant is already in the session.',
        ephemeral: true,
      });
    }

    if (
      session.participantIds.size + 1 >= session.maxPlayers ||
      pendingAccepts.has(hostId)
    ) {
      return interaction.reply({
        content:
          '❌ This session is full or another request is being processed.',
        ephemeral: true,
      });
    }

    pendingAccepts.add(hostId);
    try {
      await interaction.deferUpdate();

      const channelOrigin = await interaction.client.channels
        .fetch(session.channelId)
        .catch(() => null);
      const guild = (channelOrigin as any)?.guild;

      if (!guild) {
        return interaction.followUp({
          content: '❌ The original server could not be accessed.',
          ephemeral: true,
        });
      }

      const joiner = await guild.members.fetch(joinerId).catch(() => null);
      if (!joiner || joiner.user.bot) {
        return interaction.followUp({
          content: '❌ This participant is no longer eligible to join.',
          ephemeral: true,
        });
      }

      if (
        activeLFG.get(hostId) !== session ||
        session.kickedIds.has(joinerId)
      ) {
        return interaction.followUp({
          content: '❌ This join request is no longer valid.',
          ephemeral: true,
        });
      }

      const host = await interaction.client.users
        .fetch(hostId)
        .catch(() => null);
      if (!host)
        return interaction.followUp({
          content: '❌ The session host could not be found.',
          ephemeral: true,
        });
      let vc;
      if (session.vcId) {
        vc = await guild.channels.fetch(session.vcId);
        if (vc?.type !== ChannelType.GuildVoice) {
          return interaction.followUp({
            content: '❌ The session voice channel is unavailable.',
            ephemeral: true,
          });
        }
        await vc.permissionOverwrites.edit(joinerId, {
          ViewChannel: true,
          Connect: true,
        });
      } else {
        vc = await guild.channels.create({
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
        session.vcId = vc.id;
      }
      session.participantIds.add(joinerId);

      try {
        const channel = await interaction.client.channels
          .fetch(session.channelId)
          .catch(() => null);
        if (channel && channel.isTextBased()) {
          const message = await channel.messages
            .fetch(session.messageId)
            .catch(() => null);
          if (message?.embeds[0]) {
            const oldEmbed = EmbedBuilder.from(message.embeds[0]);

            const currentCount = session.participantIds.size + 1;
            const newDescription = oldEmbed.data.description?.replace(
              /\d+\/\d+/,
              `${currentCount}/${session.maxPlayers}`,
            );

            if (currentCount >= session.maxPlayers) {
              const fullRow =
                new ActionRowBuilder<ButtonBuilder>().addComponents(
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
          content: `✅ A voice channel is ready for <@${host.id}> and <@${joinerId}>.`,
          components: [endRow],
        });
      } catch (error) {
        console.error('Could not update LFG session announcement:', error);
      }

      return interaction.followUp({
        content: `✅ Join request accepted. Your voice channel is ${vc.toString()}.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Could not accept LFG participant:', error);
      return interaction.followUp({
        content: '❌ Could not add this participant. Please try again.',
        ephemeral: true,
      });
    } finally {
      pendingAccepts.delete(hostId);
    }
  }
}
