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
  MEMBER: { id: process.env.ROLE_MEMBER as string, weight: 0 },
  DONATUR: { id: process.env.ROLE_DONATUR as string, weight: 1 },
  BILLION: { id: process.env.ROLE_BILLION as string, weight: 2 },
  RICHMAN: { id: process.env.ROLE_RICHMAN as string, weight: 3 },
  STAFF: { id: process.env.ROLE_STAFF as string, weight: 4 },
  DEPUTY_GROWTH_OUTREACH: {
    id: process.env.ROLE_DEPUTY_GROWTH_OUTREACH as string,
    weight: 5,
  },
  DEPUTY_SUBSCRIPTION: {
    id: process.env.ROLE_DEPUTY_SUBSCRIPTION as string,
    weight: 6,
  },
  DEPUTY_MODERATION: {
    id: process.env.ROLE_DEPUTY_MODERATION as string,
    weight: 7,
  },
  HONORARY_DEPUTY: {
    id: process.env.ROLE_HONORARY_DEPUTY as string,
    weight: 8,
  },
  FOUNDER: { id: process.env.ROLE_FOUNDER as string, weight: 9 },
} as const;
