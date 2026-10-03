/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { type SubscriptionCurrency } from './subscriptionPrices.js';
import type { PlanChangeQuote } from './proratedPlanChange.js';
import type { PlanChangeRequest } from './subscriptionStore.js';
export declare function planChangeButton(requestId: string, disabled?: boolean): ActionRowBuilder<ButtonBuilder>;
export declare function planChangeRequestEmbed(request: PlanChangeRequest, quote: PlanChangeQuote, currency: SubscriptionCurrency, completed?: boolean): EmbedBuilder;
export declare function planChangeConfirmationEmbed(request: PlanChangeRequest, quote: PlanChangeQuote, currency: SubscriptionCurrency): EmbedBuilder;
