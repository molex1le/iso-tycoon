import { weatherFactor } from './weather';
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

/** Почему кофейня не работает сегодня; null – работает. */
export function closedReason(state: GameState, cfg: GameConfig, day = state.day): string | null {
  if (day <= state.suspendedUntilDay) return 'опечатана';
  if (day <= state.closedUntilDay) return 'закрыта на день';
  if (day <= state.machineDownUntilDay) return 'кофемашина в ремонте';
  if (machineOrdersPerHour(state, cfg) === 0) return 'нет кофемашины';
  if (baristas(state).length === 0) return 'нет бариста';
  return null;
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

export function flowFactor(state: GameState, day = state.day): number {
  return state.flowMods.filter((m) => day <= m.untilDay).reduce((a, m) => a * m.factor, 1);
}

export function costFactor(state: GameState, day = state.day): number {
  return state.costMods.filter((m) => day <= m.untilDay).reduce((a, m) => a * m.factor, 1);
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
/** Откуда идут люди мимо двери: источники района плюс просто прохожие. */
export function flowSources(state: GameState, cfg: GameConfig, day = state.day): { id: string; name: string; people: number }[] {
  const b = cfg.balance;
  const loc = b.locations[state.options.location];
  const season = seasonOf(monthOf(day, b), b).id;
  const out = loc.sources.map((s) => ({ id: s.id, name: s.name, people: Math.round(state.footTraffic * s.share * ((s.season as Record<string, number>)[season] ?? 1)) }));
  const rest = 1 - loc.sources.reduce((a, s) => a + s.share, 0);
  out.push({ id: 'walk', name: 'Прохожие', people: Math.round(state.footTraffic * rest) });
  return out;
}

export function demandView(state: GameState, cfg: GameConfig, day = state.day): DemandView {
  const b = cfg.balance;
  const quality = currentQuality(state, cfg);
  const check = averageCheck(state.prices, cfg.items);
  const own = attractiveness(quality, check, state.reputation, b.demand) * (state.social ? b.marketing.social.attractiveness : 1);
  const rivals = state.competitors.map((c) => (day <= c.closedUntilDay ? 0 : attractiveness(c.quality, c.avgCheck, c.reputation, b.demand)));
  const share = marketShare(own, rivals, b.demand.stayHomeWeight);
  const total = own + rivals.reduce((a, s) => a + s, 0) + b.demand.stayHomeWeight;
  const season = seasonOf(monthOf(day, b), b);
  const traffic = flowSources(state, cfg, day).reduce((a, s) => a + s.people, 0) * weatherFactor(state, cfg);
  const expected =
    customersPerDay({
      footTraffic: traffic,
      season: season.demand,
      coffeeWantShare: b.demand.coffeeWantShare,
      awareness: state.awareness,
      share,
    }) *
    flowFactor(state, day) *
    (state.promo ? b.marketing.promo.clientsFactor : 1);
  return { quality, check, share, rivalShares: rivals.map((s) => s / total), expected };
}
