export const Badge = {
  BRONZE: 'BRONZE',
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
} as const;

export type Badge = (typeof Badge)[keyof typeof Badge];

// Ordered highest-to-lowest so the first tier a user's total qualifies for wins.
const BADGE_THRESHOLDS: { badge: Badge; minPoints: number }[] = [
  { badge: Badge.PLATINUM, minPoints: 5000 },
  { badge: Badge.GOLD, minPoints: 2000 },
  { badge: Badge.SILVER, minPoints: 500 },
  { badge: Badge.BRONZE, minPoints: 0 },
];

export function calculateBadge(totalPoints: number): Badge {
  const tier = BADGE_THRESHOLDS.find((t) => totalPoints >= t.minPoints);
  return tier?.badge ?? Badge.BRONZE;
}
