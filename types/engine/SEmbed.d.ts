/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
import { EmbedBuilder, EmbedField } from 'discord.js';
export declare class EmbedFactory {
    private static readonly COLOR;
    private static readonly FOOTER;
    static create(): EmbedBuilder;
    static createFlexible(data: {
        title?: string;
        description?: string;
        thumbnail?: string;
        image?: string;
        url?: string;
        author?: {
            name: string;
            iconURL?: string;
        };
        fields?: EmbedField[];
        color?: number;
    }): EmbedBuilder;
}
