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
import { UNCOMMON } from './uncommon.js';
import { RARE } from './rare.js';
import { EPIC } from './epic.js';
import { MYTHIC } from './mythic.js';
import { LEGENDARY } from './legendary.js';

export const RARITY_TIERS = [
  { tier: 'Common', weight: 55, chars: COMMON },
  { tier: 'Uncommon', weight: 25, chars: UNCOMMON },
  { tier: 'Rare', weight: 12, chars: RARE },
  { tier: 'Epic', weight: 6, chars: EPIC },
  { tier: 'Mythic', weight: 1.8, chars: MYTHIC },
  { tier: 'Legendary', weight: 0.2, chars: LEGENDARY },
];
