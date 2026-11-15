import { monthOf, seasonOf } from './calendar';
import type { GameConfig, LocationId } from './config';
import { customersPerDay } from './demand';
import { say, usd } from './feed';
import { spend } from './finance';
import { demandView } from './shop';
import type { GameState } from './state';
import { weatherFactor } from './weather';

export interface Branch {
  location: LocationId;
  /** тип помещения; у старых сохранений – «на первой линии» */
  site?: SiteId;
  /** помещение куплено: аренды нет */
  owned?: boolean;
  pricePaid?: number;
  openedDay: number;
  awareness: number;
  /** доля продаж, которая доходит до кассы: падает от недостач */
  efficiency: number;
  /** итог последнего дня – для интерфейса */
  lastRevenue: number;
  lastProfit: number;
}

export type SiteId = keyof GameConfig['balance']['branch']['sites'];

export interface BranchDeal {
  available: boolean;
  /** всё, что нужно заплатить сразу */
  cost: number;
  /** аренда в месяц; 0 – помещение куплено */
  rent: number;
  reason: string;
}

function siteOf(cfg: GameConfig, site: SiteId | undefined) {
  return cfg.balance.branch.sites[site ?? 'corner'];
}

/** Цена покупки помещения: аренда за buyMonths месяцев. */
export function branchBuyPrice(cfg: GameConfig, location: LocationId, site: SiteId = 'corner'): number {
  const c = cfg.balance.branch;
  return Math.round(cfg.balance.locations[location].rent * siteOf(cfg, site).rentFactor * c.buyMonths);
}

export function branchSetupCost(cfg: GameConfig, location: LocationId, site: SiteId = 'corner', buy = false): number {
  const c = cfg.balance.branch;
  const s = siteOf(cfg, site);
  const premises = buy ? branchBuyPrice(cfg, location, site) : cfg.balance.locations[location].rent * s.rentFactor * c.depositMonths;
  return Math.round(c.repair + c.equipment * s.equipmentFactor + premises);
}

/** Есть ли сейчас закрывшийся конкурент, чьё помещение можно занять. */
export function closedRival(state: GameState): string | null {
  const r = state.competitors.find((c) => !c.opening && state.day <= c.closedUntilDay);
  return r ? r.name : null;
}

/** Можно ли открыть вторую точку в этом месте и на этих условиях, и почему нет. */
export function branchOffer(state: GameState, cfg: GameConfig, location: LocationId, site: SiteId = 'corner', buy = false): BranchDeal {
  const c = cfg.balance.branch;
  const s = siteOf(cfg, site);
  const cost = branchSetupCost(cfg, location, site, buy);
  const rent = buy ? 0 : Math.round(cfg.balance.locations[location].rent * s.rentFactor);
  let reason = '';
  if (state.branch) reason = 'Филиал уже работает';
  else if (location === state.options.location) reason = 'Здесь уже ваша кофейня';
  else if (state.day < c.minDay) reason = `Нужно ${c.minDay} дней работы`;
  else if (state.reputation < c.minReputation) reason = `Нужна репутация от ${String(c.minReputation).replace('.', ',')}`;
  else if (s.needsClosedRival && !closedRival(state)) reason = 'Сейчас никто из конкурентов не закрыт';
  else if (state.cash < cost) reason = 'Не хватает денег';
  return { available: reason === '', cost, rent, reason };
}

export function openBranch(state: GameState, cfg: GameConfig, location: LocationId, site: SiteId = 'corner', buy = false): boolean {
  const offer = branchOffer(state, cfg, location, site, buy);
  if (!offer.available) return false;
  const c = cfg.balance.branch;
  const s = siteOf(cfg, site);
  const premises = offer.cost - Math.round(c.repair + c.equipment * s.equipmentFactor);
  spend(state, 'equipment', c.repair + c.equipment * s.equipmentFactor);
  spend(state, buy ? 'equipment' : 'rent', premises);
  state.branch = { location, site, owned: buy, pricePaid: buy ? premises : 0, openedDay: state.day, awareness: c.startAwareness, efficiency: c.efficiency, lastRevenue: 0, lastProfit: 0 };
  say(state, cfg, 'branchOpened', 'ok', { place: `${cfg.balance.locations[location].name}, ${s.name.toLowerCase()}` });
  return true;
}

/** Сколько вернётся при закрытии: часть оборудования и, если помещение куплено, часть его цены. */
export function branchRefund(state: GameState, cfg: GameConfig): number {
  const br = state.branch;
  if (!br) return 0;
  const c = cfg.balance.branch;
  return Math.round(c.equipment * c.closeRefundShare + (br.owned ? (br.pricePaid ?? 0) * c.buyRefundShare : 0));
}

export function closeBranch(state: GameState, cfg: GameConfig): boolean {
  if (!state.branch) return false;
  const back = branchRefund(state, cfg);
  state.cash += back;
  state.branch = null;
  say(state, cfg, 'branchClosed', 'warn', { amount: usd(back) });
  return true;
}

/**
 * День филиала: та же формула спроса, своя узнаваемость, потолок мощности,
 * управляющий вместо директора. Деньги идут в общую кассу и общий налог.
 */
export function branchDay(state: GameState, cfg: GameConfig): number {
  const br = state.branch;
  if (!br) return 0;
  const c = cfg.balance.branch;
  const b = cfg.balance;
  const loc = b.locations[br.location];
  const site = siteOf(cfg, br.site);
  const v = demandView(state, cfg);
  const season = seasonOf(monthOf(state.day, b), b);
  const customers = Math.min(
    c.capacity,
    Math.round(customersPerDay({ footTraffic: loc.footTraffic * site.traffic * weatherFactor(state, cfg), season: season.demand, coffeeWantShare: b.demand.coffeeWantShare, awareness: br.awareness, share: v.share }) * br.efficiency),
  );
  const revenue = Math.round(customers * v.check * 100) / 100;
  state.cash = Math.round((state.cash + revenue) * 100) / 100;
  state.tax.quarterRevenue = Math.round((state.tax.quarterRevenue + revenue) * 100) / 100;
  const before = state.cash;
  const days = b.time.daysPerMonth;
  spend(state, 'purchases', revenue * c.cogsShare, b.suppliers[state.supplier].documents);
  if (!br.owned) spend(state, 'rent', (loc.rent * site.rentFactor * state.rentFactor) / days);
  spend(state, 'payroll', (c.managerSalary + c.staffMonthly) / days);
  spend(state, 'utilities', c.utilities / days);
  br.awareness = Math.min(b.awareness.max, Math.round((br.awareness + c.awarenessGrowth) * 1000) / 1000);
  br.lastRevenue = revenue;
  br.lastProfit = Math.round((revenue - (before - state.cash)) * 100) / 100;
  return br.lastProfit;
}
