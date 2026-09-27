/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const deliveryDirectory = () =>
  resolve(process.env.REPORT_DELIVERY_DIR ?? 'data/report-deliveries');

/** The delivery directory must be shared by every process handling commands. */
export async function deliverReportOnce(
  interactionId: string,
  send: () => Promise<void>,
): Promise<boolean> {
  const directory = deliveryDirectory();
  const entry = join(
    directory,
    createHash('sha256').update(interactionId).digest('hex'),
  );
  const delivered = join(entry, 'delivered');
  await mkdir(directory, { recursive: true });

  const started = Date.now();
  while (true) {
    try {
      await mkdir(entry);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        await readFile(delivered);
        return false;
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code !== 'ENOENT')
          throw readError;
      }
      if (Date.now() - started > 10_000)
        throw new Error('Report delivery is still in progress');
      await new Promise((done) => setTimeout(done, 25));
    }
  }

  try {
    await send();
  } catch (error) {
    await rmdir(entry).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }

  try {
    await writeFile(delivered, interactionId);
  } catch (error) {
    console.error(
      `[Report] Delivered interaction ${interactionId}, but could not record delivery:`,
      error,
    );
  }
  return true;
}
