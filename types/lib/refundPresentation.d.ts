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
import type { RefundRequest, RefundReceipt } from './subscriptionStore.js';
export declare function refundButton(requestId: string, disabled: boolean): ActionRowBuilder<ButtonBuilder>;
export declare function refundRequestEmbed(request: RefundRequest, amounts: {
    gross: number;
    tax: number;
    net: number;
    currency: SubscriptionCurrency;
}, receipt?: RefundReceipt): EmbedBuilder;
