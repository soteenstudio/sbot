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
/** Contextual embed border colours shared by every response embed. */
export declare const EMBED_COLORS: {
    /** Green/teal used for successful and branded result embeds. */
    readonly SUCCESS: 65437;
    /** Solid green used to confirm an action completed. */
    readonly CONFIRMED: 65280;
    /** Yellow/orange reserved for warnings and pending states. */
    readonly WARNING: 16753920;
    /** Red reserved for failures, rejections and destructive outcomes. */
    readonly ERROR: 16711680;
    /** Blurple used for neutral informational notices. */
    readonly INFO: 5793266;
    /** Discord surface grey used for plain listings. */
    readonly NEUTRAL: 3092790;
};
/** Standard footer applied to informational and result embeds. */
export declare const EMBED_FOOTER = "SoTeen Studio";
/** Status prefixes every response message must start with. */
export declare const STATUS_EMOJI: {
    readonly SUCCESS: "✅";
    readonly ERROR: "❌";
    readonly WARNING: "⚠️";
    readonly LOADING: "⏳";
};
export declare class EmbedFactory {
    private static readonly COLOR;
    private static readonly FOOTER;
    static create(color?: number): EmbedBuilder;
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
