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
import { Roles } from '../config.js';
import { subscriptionStore } from '../lib/subscriptionStore.js';
import { coordinateSubscriptionChange } from '../lib/subscriptionCoordinator.js';
import { canVerifySubscription } from '../lib/subscriptionAuthorization.js';
import { calculatePlanChange } from '../lib/proratedPlanChange.js';
import { snapshotPaidPeriod } from '../lib/subscriptionPrices.js';
import {
  planChangeButton,
  planChangeRequestEmbed,
} from '../lib/planChangePresentation.js';
import { notifyBuyerOfPlanChange } from '../lib/planChangeNotification.js';
import { announceSavedApproval } from '../lib/approvalAnnouncement.js';
const pattern = /^plan_change_verify_([0-9a-f-]{36})$/;
export class PlanChangeVerifyHandler extends InteractionHandler {
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
    return pattern.test(interaction.customId) ? this.some() : this.none();
  }
  public async run(interaction: ButtonInteraction): Promise<void> {
    const reject = async (content: string) => {
      await interaction.reply({
        content: '❌ ' + content,
        flags: MessageFlags.Ephemeral,
      });
    };
    if (!interaction.inCachedGuild()) {
      await reject('Use plan change verification in a server.');
      return;
    }
    if (!canVerifySubscription(interaction.member)) {
      await reject('You do not have permission to verify this plan change.');
      return;
    }
    const id = pattern.exec(interaction.customId)?.[1];
    if (!id || interaction.channelId !== process.env.BUY_LOG_CHANNEL) {
      await reject('Invalid plan change request or purchase-log channel.');
      return;
    }
    let initial;
    try {
      initial = await subscriptionStore.getPlanChangeRequest(id);
    } catch {
      await reject(
        'Failed to load plan change request. Restore storage and retry.',
      );
      return;
    }
    if (
      !initial ||
      initial.guildId !== interaction.guild.id ||
      initial.logChannelId !== interaction.channelId ||
      initial.logMessageId !== interaction.message.id ||
      !['logged', 'verified', 'completed'].includes(initial.status)
    ) {
      await reject(
        'Plan change request is stale, unlogged, or bound to another message.',
      );
      return;
    }
    await interaction.deferUpdate();
    await coordinateSubscriptionChange(
      initial.guildId,
      initial.userId,
      async () => {
        const fail = async (content: string) => {
          await interaction.followUp({
            content: '❌ ' + content,
            flags: MessageFlags.Ephemeral,
          });
        };
        try {
          let request = await subscriptionStore.getPlanChangeRequest(id);
          if (
            !request ||
            request.guildId !== interaction.guild.id ||
            request.logChannelId !== interaction.channelId ||
            request.logMessageId !== interaction.message.id ||
            !['logged', 'verified', 'completed'].includes(request.status)
          )
            throw new Error('Invalid plan change binding');
          let receipt = await subscriptionStore.getPlanChangeReceipt(id);
          if (request.status !== 'completed') {
            const record = await subscriptionStore.get(
              request.guildId,
              request.userId,
            );
            if (
              !record ||
              record.subscriptionId !== request.subscriptionId ||
              record.roleId !== request.fromRoleId
            ) {
              await subscriptionStore.abortPlanChange(id);
              throw new Error(
                'Subscription changed or expired; stale request rejected',
              );
            }
            if (record.pendingRefundId)
              throw new Error(
                'Cancellation is pending; retry /subscription refund',
              );
            const member = await interaction.guild.members.fetch(
              request.userId,
            );
            if (request.status === 'logged') {
              let quote;
              try {
                quote = calculatePlanChange(
                  record,
                  request.toRoleId,
                  request.durationMonths,
                  request.direction,
                  Date.now(),
                );
              } catch (error) {
                await subscriptionStore.abortPlanChange(id);
                throw error;
              }
              const targetRoleId = request.toRoleId;
              const tier =
                Object.entries(Roles).find(
                  ([, r]) => r.id === targetRoleId,
                )?.[0] ?? '';
              receipt = await subscriptionStore.beginPlanChange(id, {
                ...quote,
                id,
                subscriptionId: request.subscriptionId,
                guildId: request.guildId,
                userId: request.userId,
                oldRoleId: record.roleId,
                oldPaidPeriods: record.paidPeriods!,
                newPaidPeriod: snapshotPaidPeriod(
                  tier,
                  request.durationMonths,
                  quote.at,
                  quote.newExpiresAt,
                ),
                verifiedAt: quote.at,
                verifiedBy: interaction.user.id,
              });
            }
            const pending = await subscriptionStore.get(
              request.guildId,
              request.userId,
            );
            if (
              !receipt ||
              pending?.pendingPlanChangeId !== id ||
              receipt.id !== id ||
              receipt.subscriptionId !== request.subscriptionId ||
              receipt.guildId !== request.guildId ||
              receipt.userId !== request.userId ||
              receipt.fromRoleId !== request.fromRoleId ||
              receipt.toRoleId !== request.toRoleId ||
              receipt.toDurationMonths !== request.durationMonths ||
              receipt.direction !== request.direction
            )
              throw new Error(
                'Plan change receipt missing or mismatched; repair storage',
              );
            try {
              await member.roles.add(
                request.toRoleId,
                'Verified subscription plan change',
              );
            } catch {
              await subscriptionStore.abortPlanChange(id);
              throw new Error(
                'Failed to add new role; plan change aborted. Restore permissions and submit a new request.',
              );
            }
            try {
              await member.roles.remove(
                request.fromRoleId,
                'Verified subscription plan change',
              );
            } catch {
              throw new Error(
                'New role added, but old role removal failed. Plan change is pending; click ✅ again.',
              );
            }
            receipt = await subscriptionStore.completePlanChange(id);
            request = (await subscriptionStore.getPlanChangeRequest(id))!;
            await notifyBuyerOfPlanChange(member, request, receipt);
            await announceSavedApproval(
              interaction.guild,
              id,
              receipt.verifiedBy,
              request.direction === 'upgrade' ? 'Upgrade' : 'Downgrade',
            );
          }
          if (!receipt)
            throw new Error('Plan change receipt missing; repair storage');
          try {
            await interaction.editReply({
              embeds: [
                planChangeRequestEmbed(
                  request,
                  receipt,
                  receipt.newPaidPeriod.currency,
                  true,
                ),
              ],
              components: [planChangeButton(id, true)],
            });
          } catch {
            await fail(
              'Plan change completed, but log update failed. Click ✅ again to repair the log.',
            );
          }
        } catch (error) {
          console.error('Failed to verify plan change:', error);
          await fail(
            error instanceof Error
              ? error.message
              : 'Plan change failed; restore storage and retry.',
          );
        }
      },
    );
  }
}
