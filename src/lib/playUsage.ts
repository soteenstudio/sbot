export type PlayUsage = { count: number; lastReset: number };

export function consumePlay(usage: PlayUsage, limit: number, save: () => void): boolean {
  if (usage.count >= limit) return false;
  usage.count++;
  try {
    save();
  } catch (error) {
    usage.count--;
    throw error;
  }
  return true;
}

export function refundPlay(usage: PlayUsage, save: () => void): void {
  usage.count--;
  save();
}
