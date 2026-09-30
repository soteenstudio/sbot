/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'fs';
import os from 'os';

export function getDiskUsage() {
  try {
    const targetPath = os.platform() === 'win32' ? 'C:\\' : '/';

    const stats = fs.statfsSync(targetPath);

    const totalSpace = stats.blocks * stats.bsize;
    const freeSpace = stats.bfree * stats.bsize;
    const usedSpace = totalSpace - freeSpace;

    const formatGB = (bytes) => (bytes / (1024 * 1024 * 1024)).toFixed(2);

    return {
      path: targetPath,
      total: `${formatGB(totalSpace)} GB`,
      used: `${formatGB(usedSpace)} GB`,
      free: `${formatGB(freeSpace)} GB`,
      percentage: ((usedSpace / totalSpace) * 100).toFixed(1) + '%',
    };
  } catch (e) {
    console.error('Gagal ngecek disk space:', e.message);
    return null;
  }
}

const disk = getDiskUsage();
if (disk) {
  console.log(`--- Disk Space (${disk.path}) ---`);
  console.log(`Total : ${disk.total}`);
  console.log(`Terpakai : ${disk.used} (${disk.percentage})`);
  console.log(`Sisa : ${disk.free}`);
}
