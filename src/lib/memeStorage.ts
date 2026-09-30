/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export interface MemeData {
  title: string;
  imageUrl: string;
  postLink: string;
  author: string;
  subreddit: string;
}

export const memeHistory = new Map<
  string,
  { history: MemeData[]; currentIndex: number }
>();

export function cleanupMemeHistory(messageId: string) {
  if (memeHistory.has(messageId)) {
    memeHistory.delete(messageId);
  }
}
