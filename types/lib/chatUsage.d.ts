/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export type ChatUsage = {
    count: number;
    lastReset: number;
};
export declare function getChatUsage(userId: string, now: number): Promise<ChatUsage>;
export declare function consumeChatUsage(userId: string, now: number, limit: number): Promise<{
    usage: ChatUsage;
    consumed: boolean;
}>;
export declare function refundChatUsage(userId: string, lastReset: number): Promise<void>;
