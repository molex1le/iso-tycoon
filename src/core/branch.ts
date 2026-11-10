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
  openedDay: number;
  awareness: number;
  /** доля продаж, которая доходит до кассы: падает от недостач */
  efficiency: number;
  /** итог последнего дня – для интерфейса */
  lastRevenue: number;
  lastProfit: number;
}

export function branchSetupCost(cfg: GameConfig, location: LocationId): number {
  const c = cfg.balance.branch;
  return c.repair + c.equipment + cfg.balance.locations[location].rent * c.depositMonths;
}

/** Можно ли открыть вторую точку и почему нет. */
export function branchOffer(state: GameState, cfg: GameConfig, location: LocationId): { available: boolean; cost: number; reason: string } {
  const c = cfg.balance.branch;
  const cost = branchSetupCost(cfg, location);
  let reason = '';
  if (state.branch) reason = 'Филиал уже работает';
  else if (location === state.options.location) reason = 'Здесь уже ваша кофейня';
  else if (state.day < c.minDay) reason = `Нужно ${c.minDay} дней работы`;
  else if (state.reputation < c.minReputation) reason = `Нужна репутация от ${String(c.minReputation).replace('.', ',')}`;
  else if (state.cash < cost) reason = 'Не хватает денег';
  return { available: reason === '', cost, reason };
}

export function openBranch(state: GameState, cfg: GameConfig, location: LocationId): boolean {
  const offer = branchOffer(state, cfg, location);
  if (!offer.available) return false;
  const c = cfg.balance.branch;
  spend(state, 'equipment', c.repair + c.equipment);
  spend(state, 'rent', cfg.balance.locations[location].rent * c.depositMonths);
  state.branch = { location, openedDay: state.day, awareness: c.startAwareness, efficiency: c.efficiency, lastRevenue: 0, lastProfit: 0 };
  say(state, cfg, 'branchOpened', 'ok', { place: cfg.balance.locations[location].name });
  return true;
}

export function closeBranch(state: GameState, cfg: GameConfig): boolean {
  if (!state.branch) return false;
  const back = Math.round(cfg.balance.branch.equipment * cfg.balance.branch.closeRefundShare);
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
  const v = demandView(state, cfg);
  const season = seasonOf(monthOf(state.day, b), b);
  const customers = Math.min(
    c.capacity,
    Math.round(customersPerDay({ footTraffic: loc.footTraffic * weatherFactor(state, cfg), season: season.demand, coffeeWantShare: b.demand.coffeeWantShare, awareness: br.awareness, share: v.share }) * br.efficiency),
  );
  const revenue = Math.round(customers * v.check * 100) / 100;
  state.cash = Math.round((state.cash + revenue) * 100) / 100;
  state.tax.quarterRevenue = Math.round((state.tax.quarterRevenue + revenue) * 100) / 100;
  const before = state.cash;
  const days = b.time.daysPerMonth;
  spend(state, 'purchases', revenue * c.cogsShare, b.suppliers[state.supplier].documents);
  spend(state, 'rent', (loc.rent * state.rentFactor) / days);
  spend(state, 'payroll', (c.managerSalary + c.staffMonthly) / days);
  spend(state, 'utilities', c.utilities / days);
  br.awareness = Math.min(b.awareness.max, Math.round((br.awareness + c.awarenessGrowth) * 1000) / 1000);
  br.lastRevenue = revenue;
  br.lastProfit = Math.round((revenue - (before - state.cash)) * 100) / 100;
  return br.lastProfit;
}
