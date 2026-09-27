/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { COMMON } from './common.js';

export const RARITY_TIERS = [
  { tier: 'Common', weight: 5000, chars: COMMON },
  {
    tier: 'Uncommon',
    weight: 3000,
    chars: [{ name: 'Siti', desc: 'Biasa aja.' }],
  },
  {
    tier: 'Rare',
    weight: 1500,
    chars: [{ name: 'Dewi', desc: 'Wow.' }],
  },
];
