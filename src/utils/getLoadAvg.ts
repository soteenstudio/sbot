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

export function getLoadAvg() {
  const load = os.loadavg();
  const cpus = os.cpus().length;

  if (load[0] === 0 && load[1] === 0 && load[2] === 0) {
    return null;
  }

  return {
    oneMin: load[0].toFixed(2),
    fiveMin: load[1].toFixed(2),
    fifteenMin: load[2].toFixed(2),
    cpuCount: cpus,
    percentage: ((load[0] / cpus) * 100).toFixed(1) + '%',
  };
}
