import 'dotenv/config';
export const Roles = {
    MEMBER: { id: process.env.ROLE_MEMBER, weight: 0 },
    DONATUR: { id: process.env.ROLE_DONATUR, weight: 1 },
    BILLION: { id: process.env.ROLE_BILLION, weight: 2 },
    RICHMAN: { id: process.env.ROLE_RICHMAN, weight: 3 },
    DEPUTY: { id: process.env.ROLE_DEPUTY, weight: 4 },
    FOUNDER: { id: process.env.ROLE_FOUNDER, weight: 5 }
} as const;
