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
} from '@sapphire/framework';
import { ButtonInteraction, MessageFlags } from 'discord.js';
import { announceSavedApproval } from '../lib/approvalAnnouncement.js';
import { canVerifySubscription } from '../lib/subscriptionAuthorization.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { calculateProportionalRefund } from '../lib/proportionalRefund.js';
import { notifyBuyerOfRefund } from '../lib/refundNotification.js';
import { refundButton, refundRequestEmbed } from '../lib/refundPresentation.js';

export class RefundVerifyHandler extends InteractionHandler {
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
    return interaction.customId.startsWith('refund_verify_')
      ? this.some()
      : this.none();
  }
  public async run(interaction: ButtonInteraction): Promise<void> {
    const reject = async (content: string) => {
      await interaction.reply({
        content: '❌ ' + content,
        flags: MessageFlags.Ephemeral,
      });
    };
    if (!interaction.inCachedGuild()) {
      await reject('Use refund verification in a server.');
      return;
    }
    const allowed = canVerifySubscription(interaction.member);
    if (!allowed) {
      await reject('You do not have permission to verify this refund.');
      return;
    }
    const payload =
      /^refund_verify_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(
        interaction.customId,
      );
    if (
      !payload ||
      !process.env.BUY_LOG_CHANNEL ||
      interaction.channelId !== process.env.BUY_LOG_CHANNEL
    ) {
      await reject('Invalid refund request or purchase-log channel.');
      return;
    }
    let initial;
    try {
      initial = await subscriptionStore.getRefundRequest(payload[1]);
    } catch (error) {
      await reject('Failed to load refund request. Restore storage and retry.');
      return;
    }
    if (
      !initial ||
      initial.guildId !== interaction.guild.id ||
      initial.logChannelId !== interaction.channelId ||
      !initial.logMessageId ||
      initial.logMessageId !== interaction.message.id ||
      initial.status === 'logging'
    ) {
      await reject(
        'Refund request is unlogged, stale, or bound to another message.',
      );
      return;
    }
    await interaction.deferUpdate();
    const fail = async (content: string) => {
      await interaction.followUp({
        content: '❌ ' + content,
        flags: MessageFlags.Ephemeral,
      });
    };
    await coordinateSubscriptionChange(
      interaction.guild.id,
      initial.userId,
      async () => {
        try {
          let request = await subscriptionStore.getRefundRequest(payload[1]);
          if (
            !request ||
            request.logMessageId !== interaction.message.id ||
            request.logChannelId !== interaction.channelId ||
            request.guildId !== interaction.guild.id ||
            request.status === 'logging'
          )
            throw new Error('Invalid refund request binding');
          let receipt = request.refundId
            ? await subscriptionStore.getRefund(request.refundId)
            : undefined;
          if (request.refundId && !receipt)
            throw new Error('Refund receipt missing; repair storage');
          if (
            receipt &&
            (receipt.guildId !== request.guildId ||
              receipt.userId !== request.userId ||
              receipt.subscriptionId !== request.subscriptionId ||
              receipt.roleId !== request.roleId)
          )
            throw new Error('Refund receipt identity mismatch; repair storage');
          if (receipt?.status !== 'completed') {
            const record = await subscriptionStore.get(
              request.guildId,
              request.userId,
            );
            if (
              !record ||
              record.subscriptionId !== request.subscriptionId ||
              record.roleId !== request.roleId
            )
              throw new Error(
                'Subscription changed or expired; this request cannot cancel it',
              );
            if (
              record.pendingRefundId &&
              record.pendingRefundId !== request.refundId
            )
              throw new Error('Another cancellation is pending');
            const member = await interaction.guild.members
              .fetch(request.userId)
              .catch((error: unknown) => {
                if (
                  typeof error !== 'object' ||
                  error === null ||
                  !('code' in error) ||
                  error.code !== 10007
                )
                  throw error;
                return undefined;
              });
            if (request.status === 'logged') {
              const verifiedAt = Date.now();
              const proposed = receipt ?? {
                ...calculateProportionalRefund(record, verifiedAt),
                refundId: request.requestId,
                subscriptionId: request.subscriptionId,
                guildId: request.guildId,
                userId: request.userId,
                roleId: request.roleId,
                refundAt: verifiedAt,
                staffId: interaction.user.id,
                staffTag: interaction.user.tag,
                status: 'pending' as const,
              };
              receipt = await subscriptionStore.verifyRefundRequest(
                request.requestId,
                {
                  ...proposed,
                  staffId: interaction.user.id,
                  staffTag: interaction.user.tag,
                },
                verifiedAt,
              );
              request = (await subscriptionStore.getRefundRequest(
                request.requestId,
              ))!;
            }
            const cancelling = await subscriptionStore.get(
              request.guildId,
              request.userId,
            );
            if (
              !receipt ||
              cancelling?.subscriptionId !== request.subscriptionId ||
              cancelling?.pendingRefundId !== receipt.refundId
            )
              throw new Error('Invalid cancellation recovery state');
            try {
              await interaction.editReply({
                embeds: [refundRequestEmbed(request, receipt, receipt)],
                components: [refundButton(request.requestId, false)],
              });
            } catch (error) {
              throw new Error(
                'Verification saved, but final calculation could not be logged. Cancellation is pending; retry verification',
              );
            }

            if (member?.roles.cache.has(receipt.roleId)) {
              try {
                await member.roles.remove(
                  receipt.roleId,
                  'Subscription cancelled for unused-time refund',
                );
              } catch (error) {
                throw new Error(
                  'Refund calculation saved, but role removal failed. Cancellation is pending; retry verification on this message.',
                );
              }
            }
            try {
              receipt = await subscriptionStore.completeRefund(
                receipt.refundId,
              );
            } catch (error) {
              throw new Error(
                'Subscription role is absent, but cancellation could not be saved. Repair storage and retry verification on this message.',
              );
            }
            if (member) await notifyBuyerOfRefund(member, receipt);
            await announceSavedApproval(
              interaction.guild,
              request.requestId,
              request.verifiedBy ?? interaction.user.id,
              'Refund',
            );
          }
          try {
            await interaction.editReply({
              embeds: [refundRequestEmbed(request, receipt, receipt)],
              components: [refundButton(request.requestId, true)],
            });
          } catch (error) {
            await fail(
              'Refund completed, but the log could not be updated. Retry verification to repair the log; cancellation and notification will not repeat.',
            );
          }
        } catch (error) {
          console.error('Failed to verify refund:', error);
          await fail(
            (error instanceof Error
              ? error.message
              : 'Refund verification failed') + '. No payment was transferred.',
          );
        }
      },
    );
  }
}
