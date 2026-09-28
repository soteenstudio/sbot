/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
export declare const HONEYPOT_APPEAL_TITLE = "\uD83D\uDEA8 Honeypot Appeal";
export declare const LEGACY_HONEYPOT_APPEAL_TITLE = "\uD83D\uDEA8 Honeypot Ban Appeal (Passed Captcha)";
export declare function isHoneypotAppealTitle(title: string | null | undefined): title is "🚨 Honeypot Appeal" | "🚨 Honeypot Ban Appeal (Passed Captcha)";
