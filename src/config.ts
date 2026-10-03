/**
 * Copyright 2026 SoTeen Studio
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import 'dotenv/config';
export const Roles = {
  MEMBER: { id: process.env.ROLE_MEMBER, weight: 0 },
  DONATUR: { id: process.env.ROLE_DONATUR, weight: 1 },
  BILLION: { id: process.env.ROLE_BILLION, weight: 2 },
  RICHMAN: { id: process.env.ROLE_RICHMAN, weight: 3 },
  DEPUTY_GROWTH_OUTREACH: {
    id: process.env.ROLE_DEPUTY_GROWTH_OUTREACH,
    weight: 4,
  },
  DEPUTY_SUBSCRIPTION: { id: process.env.ROLE_DEPUTY_SUBSCRIPTION, weight: 5 },
  DEPUTY_MODERATION: { id: process.env.ROLE_DEPUTY_MODERATION, weight: 6 },
  HONORARY_DEPUTY: { id: process.env.ROLE_HONORARY_DEPUTY, weight: 7 },
  FOUNDER: { id: process.env.ROLE_FOUNDER, weight: 8 },
} as const;
