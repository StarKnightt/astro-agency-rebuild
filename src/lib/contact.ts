export const PROJECT_TYPES = ['New home', 'Cabin', 'Public building', 'Renovation', 'Interior', 'Something else'] as const;

export const BUDGETS = ['Not sure yet', 'Under 3 MNOK', '3 to 8 MNOK', '8 to 20 MNOK', 'Over 20 MNOK'] as const;

export const LIMITS = {
  name: { min: 2, max: 100 },
  email: { max: 200 },
  location: { max: 120 },
  message: { min: 20, max: 4000 },
} as const;

export const HONEYPOT_FIELD = 'website';

export type ContactResponse =
  | { ok: true; mode: 'sent' | 'demo' }
  | { ok: false; error: string; fields?: Record<string, string> };
