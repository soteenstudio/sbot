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

function getCPUInfo() {
  const cpus = os.cpus();
  let idleMs = 0;
  let totalMs = 0;

  for (const cpu of cpus) {
    totalMs += Object.values(cpu.times).reduce((acc, val) => acc + val, 0);
    idleMs += cpu.times.idle;
  }

  return { idle: idleMs, total: totalMs };
}

export function getCPUUsage() {
  return new Promise((resolve) => {
    const start = getCPUInfo();

    setTimeout(() => {
      const end = getCPUInfo();

      const idleDifference = end.idle - start.idle;
      const totalDifference = end.total - start.total;

      if (totalDifference <= 0) {
        resolve('N/A');
        return;
      }

      const cpuPercentage = 100 - (100 * idleDifference) / totalDifference;
      resolve(cpuPercentage.toFixed(1) + '%');
    }, 1000);
  });
}
