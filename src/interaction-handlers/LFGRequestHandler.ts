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
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import {
  activeLFG,
  pendingLFGInitialSaves,
  recordLFGDecline,
} from '../lib/lfg-data.js';
import { saveLFGAcceptance } from '../lib/lfgSession.js';

const pendingAccepts = new Set<string>();
const pendingDecisions = new Set<string>();
const completedDecisions = new Set<string>();

function decisionRows(interaction: ButtonInteraction, disabled: boolean) {
  return interaction.message.components
    .filter((row) => row.type === ComponentType.ActionRow)
    .map((row) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.components
          .filter((component) => component.type === ComponentType.Button)
          .map((component) =>
            ButtonBuilder.from(component).setDisabled(disabled),
          ),
      ),
    );
}

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
    const hostId = parts[parts.length - 1];

    if (interaction.user.id !== hostId) {
      return interaction.reply({
        content: '❌ Only the session host can answer join requests.',
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

    if (pendingLFGInitialSaves.has(session))
      return interaction.reply({
        content: '❌ This session is still being created. Please try again.',
        ephemeral: true,
      });

    const requestId = interaction.message.id;
    if (pendingDecisions.has(requestId) || completedDecisions.has(requestId))
      return interaction.reply({
        content: '❌ This join request has already been handled.',
        ephemeral: true,
      });

    pendingDecisions.add(requestId);
    let disabled = false;
    let settled = false;
    try {
      await interaction.update({ components: decisionRows(interaction, true) });
      disabled = true;

      if (session.kickedIds.has(joinerId)) {
        return interaction.followUp({
          content: '❌ This participant has been removed from this session.',
          ephemeral: true,
        });
      }

      if (joinerId === hostId || session.participantIds.has(joinerId)) {
        return interaction.followUp({
          content: '❌ This participant is already in the session.',
          ephemeral: true,
        });
      }

      if (action === 'decline') {
        if (activeLFG.get(hostId) !== session) {
          settled = true;
          return interaction.followUp({
            content: '❌ This join request is no longer valid.',
            ephemeral: true,
          });
        }
        recordLFGDecline(session, joinerId);
        settled = true;
        completedDecisions.add(requestId);
        let notified = true;
        try {
          const joiner = await interaction.client.users.fetch(joinerId);
          await joiner.send(
            `Your request to join ${session.game} was declined. You can try again in 60 seconds.`,
          );
        } catch {
          notified = false;
        }
        return interaction.followUp({
          content: notified
            ? 'Your join request has been declined. The participant was notified.'
            : 'Your join request has been declined, but the participant could not be notified by DM.',
          ephemeral: true,
        });
      }

      if (
        session.participantIds.size + 1 >= session.maxPlayers ||
        pendingAccepts.has(hostId)
      ) {
        return interaction.followUp({
          content:
            '❌ This session is full or another request is being processed.',
          ephemeral: true,
        });
      }

      pendingAccepts.add(hostId);
      try {
        const channelOrigin = await interaction.client.channels
          .fetch(session.channelId)
          .catch(() => null);
        const guild =
          channelOrigin && 'guild' in channelOrigin
            ? channelOrigin.guild
            : null;

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
          if (activeLFG.get(hostId) !== session) settled = true;
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
        if (activeLFG.get(hostId) !== session) {
          settled = true;
          return interaction.followUp({
            content: '❌ This join request is no longer valid.',
            ephemeral: true,
          });
        }
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
        }
        const participantIds = new Set(session.participantIds).add(joinerId);
        const saved = await saveLFGAcceptance(session, {
          ...session,
          vcId: vc.id,
          participantIds,
        });
        if (!saved || activeLFG.get(hostId) !== session) {
          settled = true;
          return interaction.followUp({
            content: '❌ This join request is no longer valid.',
            ephemeral: true,
          });
        }
        session.vcId = vc.id;
        session.participantIds = participantIds;
        settled = true;
        completedDecisions.add(requestId);

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
                /\*\*Players:\*\* \d+\/\d+/,
                `**Players:** ${currentCount}/${session.maxPlayers}`,
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

        let notified = true;
        try {
          await joiner.user.send(
            `✅ Your request to join ${session.game} (${session.rank}) with ${session.author} was accepted. Join the voice channel: ${vc.toString()}`,
          );
        } catch {
          notified = false;
        }
        return interaction.followUp({
          content: notified
            ? `✅ Join request accepted. Your voice channel is ${vc.toString()}.`
            : `✅ Join request accepted. Your voice channel is ${vc.toString()}, but the participant could not be notified by DM.`,
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
    } catch (error) {
      console.error('Could not handle LFG join request:', error);
      return disabled
        ? interaction.followUp({
            content: '❌ Could not handle this request. Please try again.',
            ephemeral: true,
          })
        : interaction.reply({
            content: '❌ Could not handle this request. Please try again.',
            ephemeral: true,
          });
    } finally {
      if (disabled && !settled) {
        try {
          await interaction.message.edit({
            components: decisionRows(interaction, false),
          });
        } catch (error) {
          console.error('Could not restore LFG request buttons:', error);
        }
      }
      pendingDecisions.delete(requestId);
    }
  }
}
