export interface PointPackage {
  id: string;
  name: string;
  points: number;
  amountCents: number;
}

export const POINT_PACKAGES: readonly PointPackage[] = [
  { id: 'starter', name: 'Starter Pack', points: 100, amountCents: 500 },
  { id: 'growth', name: 'Growth Pack', points: 500, amountCents: 2000 },
  { id: 'pro', name: 'Pro Pack', points: 1500, amountCents: 5000 },
  { id: 'elite', name: 'Elite Pack', points: 5000, amountCents: 15000 },
];
