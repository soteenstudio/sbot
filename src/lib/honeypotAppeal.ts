/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export const HONEYPOT_APPEAL_TITLE = '🚨 Honeypot Appeal';
export const LEGACY_HONEYPOT_APPEAL_TITLE =
  '🚨 Honeypot Ban Appeal (Passed Captcha)';

export function isHoneypotAppealTitle(title: string | null | undefined) {
  return (
    title === HONEYPOT_APPEAL_TITLE || title === LEGACY_HONEYPOT_APPEAL_TITLE
  );
}

export const handledAppeals = new Set<string>();
export const modalOpenTimes = new Map<string, number>();
export const activeCaptchas = new Map<
  string,
  { answer: number; stringCode: string }
>();
