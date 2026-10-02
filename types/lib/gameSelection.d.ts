/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export declare function isGameSelectionMessage(channelId: string, messageId: string): boolean;
export declare function loadGameSelectionMessage(channelId: string): Promise<string | undefined>;
export declare function saveGameSelectionMessage(channelId: string, messageId: string): Promise<void>;
export declare function enqueueGameRoleChange(key: string, change: () => Promise<void>): Promise<void>;
