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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import {
  activeLFG,
  declineCooldownRemaining,
  finishLFGRequestSend,
  formatLFGCooldown,
  pendingLFGInitialSaves,
  pendingRequestCooldownRemaining,
  startLFGRequestSend,
} from '../lib/lfgData.js';

function cooldownNotice(remainingMs: number): string {
  return `❌ Please wait ${formatLFGCooldown(remainingMs)} before requesting to join this session again.`;
}

export class LFGProJoinButtonHandler extends InteractionHandler {
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
    if (!interaction.customId.startsWith('lfg_pro_join_')) return this.none();
    return this.some();
  }

  public async run(interaction: ButtonInteraction) {
    if (interaction.deferred || interaction.replied) {
      console.warn('LFG join interaction already acknowledged:', {
        interactionId: interaction.id,
        deferred: interaction.deferred,
        replied: interaction.replied,
      });
      return;
    }

    const acknowledgementStarted = Date.now();
    const createdTimestamp =
      interaction.createdTimestamp ?? acknowledgementStarted;
    try {
      await interaction.deferUpdate();
    } catch (error) {
      console.error('Could not acknowledge LFG join interaction:', {
        interactionId: interaction.id,
        dispatchAgeMs: acknowledgementStarted - createdTimestamp,
        ageMs: Date.now() - createdTimestamp,
        acknowledgementMs: Date.now() - acknowledgementStarted,
        error,
      });
      return;
    }
    console.debug('LFG join interaction acknowledged:', {
      interactionId: interaction.id,
      dispatchAgeMs: acknowledgementStarted - createdTimestamp,
      ageMs: Date.now() - createdTimestamp,
      acknowledgementMs: Date.now() - acknowledgementStarted,
    });

    const parts = interaction.customId.split('_');
    const hostId = parts[parts.length - 1];

    const session = activeLFG.get(hostId);

    if (!session || interaction.message.id !== session.messageId)
      return interaction.followUp({
        content: '❌ This session is no longer active.',
        ephemeral: true,
      });

    if (pendingLFGInitialSaves.has(session))
      return interaction.followUp({
        content: '❌ This session is still being created. Please try again.',
        ephemeral: true,
      });

    if (session.kickedIds.has(interaction.user.id))
      return interaction.followUp({
        content: '❌ You have been removed from this session.',
        ephemeral: true,
      });

    if (
      interaction.user.id === hostId ||
      session.participantIds.has(interaction.user.id)
    )
      return interaction.followUp({
        content: '❌ You are already in this session.',
        ephemeral: true,
      });

    if (session.participantIds.size + 1 >= session.maxPlayers)
      return interaction.followUp({
        content: '❌ This session is full.',
        ephemeral: true,
      });

    const remaining = declineCooldownRemaining(session, interaction.user.id);
    if (remaining)
      return interaction.followUp({
        content: cooldownNotice(remaining),
        ephemeral: true,
      });

    const pendingRemaining = pendingRequestCooldownRemaining(
      session,
      interaction.user.id,
    );
    if (pendingRemaining)
      return interaction.followUp({
        content: cooldownNotice(pendingRemaining),
        ephemeral: true,
      });

    const host = await interaction.client.users.fetch(hostId);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `lfg_pro_accept_${interaction.user.id}_${session.channelId}_${session.messageId}_${hostId}`,
        )
        .setLabel('Accept Request')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          `lfg_pro_decline_${interaction.user.id}_${session.channelId}_${session.messageId}_${hostId}`,
        )
        .setLabel('Decline Request')
        .setStyle(ButtonStyle.Danger),
    );

    const notificationEmbed = new EmbedBuilder()
      .setTitle('🔔 Session Join Request')
      .setColor(0x0099ff)
      .setDescription(
        `${interaction.user} has requested to join your looking-for-group session.`,
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp()
      .setFooter({ text: 'SoTeen Studio • Looking for group' });

    if (activeLFG.get(hostId) !== session)
      return interaction.followUp({
        content: '❌ This session is no longer active.',
        ephemeral: true,
      });

    const latestRemaining = declineCooldownRemaining(
      session,
      interaction.user.id,
    );
    if (latestRemaining)
      return interaction.followUp({
        content: cooldownNotice(latestRemaining),
        ephemeral: true,
      });

    const latestPending = pendingRequestCooldownRemaining(
      session,
      interaction.user.id,
    );
    if (latestPending || !startLFGRequestSend(session, interaction.user.id))
      return interaction.followUp({
        content: latestPending
          ? cooldownNotice(latestPending)
          : '❌ Your join request is already being sent. Please try again shortly.',
        ephemeral: true,
      });

    try {
      await host.send({
        embeds: [notificationEmbed],
        components: [row],
      });
    } catch {
      finishLFGRequestSend(session, interaction.user.id, false);
      return interaction.followUp({
        content:
          '❌ The host could not receive your request by direct message.',
        ephemeral: true,
      });
    }

    finishLFGRequestSend(session, interaction.user.id, true);
    return interaction.followUp({
      content: '✅ Your join request has been sent to the host.',
      ephemeral: true,
    });
  }
}
