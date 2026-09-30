/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import os from 'os';

export function getRAMUsage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  const formatGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2);

  return {
    total: `${formatGB(totalMemory)} GB`,
    used: `${formatGB(usedMemory)} GB`,
    free: `${formatGB(freeMemory)} GB`,
    percentage: ((usedMemory / totalMemory) * 100).toFixed(1) + '%',
  };
}
