import type { Balance, Item } from './config';

type DemandBalance = Balance['demand'];

/**
 * Привлекательность кофейни: S = Q · (Pрын / P)^1.5 · (0.5 + 0.2 · R).
 * Та же формула у игрока и у конкурентов.
 */
export function attractiveness(quality: number, avgCheck: number, reputation: number, d: DemandBalance): number {
  if (avgCheck <= 0) return 0;
  return quality * Math.pow(d.marketCheck / avgCheck, d.priceElasticity) * (d.reputationBase + d.reputationPerStar * reputation);
}

/** Доля игрока: S / (S + ΣSконк + 1). Единица – люди, которые никуда не пойдут. */
export function marketShare(own: number, rivals: number[], stayHomeWeight: number): number {
  const total = own + rivals.reduce((a, s) => a + s, 0) + stayHomeWeight;
  return total > 0 ? own / total : 0;
}

/** Клиентов за день: K = V · s · 0.35 · A · доля. */
export function customersPerDay(p: {
  footTraffic: number;
  season: number;
  coffeeWantShare: number;
  awareness: number;
  share: number;
}): number {
  return p.footTraffic * p.season * p.coffeeWantShare * p.awareness * p.share;
}

/**
 * Средний чек: один напиток (доли из меню нормируются к 100%) плюс добавки
 * с их шансом («+25% к заказу» у круассана).
 */
export function averageCheck(prices: Record<string, number>, items: Item[]): number {
  const drinks = items.filter((i) => i.kind === 'drink');
  const shareSum = drinks.reduce((a, i) => a + i.share, 0);
  let check = 0;
  for (const i of drinks) check += (i.share / shareSum) * prices[i.id];
  for (const i of items) if (i.kind === 'addon') check += i.share * prices[i.id];
  return check;
}
