import { monthOf, seasonOf } from './calendar';
import { clamp, type GameConfig } from './config';
import { attractiveness, averageCheck, customersPerDay, marketShare } from './demand';
import type { GameState } from './state';

export function baristas(state: GameState) {
  return state.employees.filter((e) => e.role === 'barista');
}

export function hasCleaner(state: GameState): boolean {
  return state.employees.some((e) => e.role === 'cleaner');
}

export function machineOrdersPerHour(state: GameState, cfg: GameConfig): number {
  return Math.max(0, ...state.equipment.map((id) => cfg.balance.equipment[id].ordersPerHour));
}

/** Бариста, реально стоящих за стойкой одновременно. */
export function staffedPosts(state: GameState): number {
  return Math.min(state.posts, baristas(state).length);
}

/** Мощность за один период дня: минимум из бариста на смене и кофемашины. */
export function periodCapacity(state: GameState, cfg: GameConfig): number {
  const c = cfg.balance.capacity;
  return Math.min(staffedPosts(state) * c.ordersPerBaristaHour, machineOrdersPerHour(state, cfg)) * c.hoursPerPeriod;
}

/** Часов в неделю на одного бариста при текущем графике. */
export function hoursPerWeek(state: GameState, cfg: GameConfig): number {
  const n = baristas(state).length;
  if (n === 0) return 0;
  const t = cfg.balance.time;
  return (staffedPosts(state) * (t.closeHour - t.openHour) * 7) / n;
}

/**
 * Качество Q (0,5–1,5): оборудование, поставщик, опыт и усталость бариста, чистота.
 */
export function currentQuality(state: GameState, cfg: GameConfig): number {
  const b = cfg.balance;
  let q = b.quality.base + b.suppliers[state.supplier].quality;
  // кофемашины не складываются – работает лучшая
  q += Math.max(0, ...state.equipment.filter((id) => b.equipment[id].ordersPerHour > 0).map((id) => b.equipment[id].quality));
  for (const id of state.equipment) if (b.equipment[id].ordersPerHour === 0) q += b.equipment[id].quality;
  const team = baristas(state);
  if (team.length > 0) {
    const exp = team.reduce((a, e) => a + e.experience, 0) / team.length;
    q += (exp - 3) * b.staff.experienceQuality;
    const fatigue = team.reduce((a, e) => a + e.fatigue, 0) / team.length;
    if (fatigue >= b.staff.fatigue.tired) q -= b.staff.fatigue.qualityPenalty;
  }
  if (state.cleanliness < b.quality.dirtyBelow) q -= b.quality.dirtyPenalty;
  else if (state.cleanliness >= b.quality.cleanAbove) q += b.quality.cleanBonus;
  return clamp(q, b.quality.min, b.quality.max);
}

export interface DemandView {
  quality: number;
  check: number;
  share: number;
  rivalShares: number[];
  /** ожидаемое число клиентов за день без случайного шума */
  expected: number;
}

/** Спрос на указанный день при текущем состоянии кофейни. */
export function demandView(state: GameState, cfg: GameConfig, day = state.day): DemandView {
  const b = cfg.balance;
  const quality = currentQuality(state, cfg);
  const check = averageCheck(state.prices, cfg.items);
  const own = attractiveness(quality, check, state.reputation, b.demand);
  const rivals = state.competitors.map((c) => attractiveness(c.quality, c.avgCheck, c.reputation, b.demand));
  const share = marketShare(own, rivals, b.demand.stayHomeWeight);
  const total = own + rivals.reduce((a, s) => a + s, 0) + b.demand.stayHomeWeight;
  const season = seasonOf(monthOf(Math.min(day, b.time.daysPerMonth * b.time.monthsPerYear), b), b);
  const expected = customersPerDay({
    footTraffic: state.footTraffic,
    season: season.demand,
    coffeeWantShare: b.demand.coffeeWantShare,
    awareness: state.awareness,
    share,
  });
  return { quality, check, share, rivalShares: rivals.map((s) => s / total), expected };
}
