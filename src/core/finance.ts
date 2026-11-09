import { dayOfMonth } from './calendar';
import { round2, totalDays, type GameConfig } from './config';
import { usd, say } from './feed';
import { demandView } from './shop';
import type { ExpenseCategory, GameState } from './state';

/** Списывает деньги и записывает расход в статьи дня. documented – доля, подтверждённая документами. */
export function spend(state: GameState, category: ExpenseCategory, amount: number, documented = 1): void {
  amount = round2(amount);
  if (amount <= 0) return;
  state.cash = round2(state.cash - amount);
  state.ledger[category] = round2((state.ledger[category] ?? 0) + amount);
  if (category !== 'tax' && category !== 'fines') state.tax.quarterDeductible = round2(state.tax.quarterDeductible + amount * documented);
}

/** Зарплаты за месяц вместе со взносами (без сверхурочных). */
export function payrollMonthly(state: GameState, cfg: GameConfig): number {
  const salaries = state.employees.reduce((a, e) => a + e.salary, 0);
  return round2(salaries * (1 + cfg.balance.staff.contributions));
}

export function accountantMonthly(state: GameState, cfg: GameConfig): number {
  return state.options.form === 'ooo' ? cfg.balance.costs.accountantOoo : 0;
}

export function rentMonthly(state: GameState, cfg: GameConfig): number {
  return cfg.balance.locations[state.options.location].rent;
}

/** Постоянные расходы за месяц: аренда, коммуналка, зарплаты со взносами, бухгалтер. */
export function monthlyFixed(state: GameState, cfg: GameConfig): number {
  return round2(rentMonthly(state, cfg) + cfg.balance.costs.utilities + payrollMonthly(state, cfg) + accountantMonthly(state, cfg));
}

export function dailyFixed(state: GameState, cfg: GameConfig): number {
  return monthlyFixed(state, cfg) / cfg.balance.time.daysPerMonth;
}

/** Платежи конца месяца. */
export function payMonthEnd(state: GameState, cfg: GameConfig): number {
  const before = state.cash;
  spend(state, 'rent', rentMonthly(state, cfg));
  spend(state, 'utilities', cfg.balance.costs.utilities);
  spend(state, 'payroll', payrollMonthly(state, cfg) + state.overtimeAccrued * (1 + cfg.balance.staff.contributions));
  spend(state, 'services', accountantMonthly(state, cfg));
  state.overtimeAccrued = 0;
  const paid = round2(before - state.cash);
  say(state, cfg, 'monthPaid', 'info', { amount: usd(paid) });
  return paid;
}

/** Налог за квартал по накопленным выручке и расходам. */
export function quarterTax(state: GameState, cfg: GameConfig): number {
  const regime = cfg.balance.taxes.regimes[state.options.taxRegime];
  const rev = state.tax.quarterRevenue;
  const base = regime.onProfit ? Math.max(0, rev - state.tax.quarterDeductible) : rev;
  return round2(Math.max(base * regime.rate, rev * regime.minRate));
}

/** Конец дня: начисление налога в конце квартала и списание в срок. */
export function processTaxes(state: GameState, cfg: GameConfig): void {
  const t = cfg.balance.taxes;
  if (state.tax.due && state.day >= state.tax.due.payDay) {
    spend(state, 'tax', state.tax.due.amount);
    state.tax.paidTotal = round2(state.tax.paidTotal + state.tax.due.amount);
    say(state, cfg, 'taxPaid', 'info', { amount: usd(state.tax.due.amount) });
    state.tax.due = null;
  }
  if (state.day % t.quarterDays === 0) {
    const amount = quarterTax(state, cfg);
    state.tax.quarterRevenue = 0;
    state.tax.quarterDeductible = 0;
    if (amount > 0) {
      state.tax.due = { amount, payDay: state.day + t.payAfterDays };
      say(state, cfg, 'taxDue', 'warn', { amount: usd(amount), n: state.day + t.payAfterDays });
    }
  }
}

/**
 * «Подушка»: на сколько дней хватит денег при текущем темпе.
 * Infinity – кофейня в плюсе.
 */
export function cushionDays(state: GameState, cfg: GameConfig): number {
  const week = state.history.slice(-7);
  let gross: number;
  if (week.length > 0) gross = week.reduce((a, r) => a + r.revenue - r.cogs - r.waste, 0) / week.length;
  else {
    const v = demandView(state, cfg);
    gross = v.expected * v.check * 0.7;
  }
  const net = gross - dailyFixed(state, cfg);
  if (net >= 0) return Infinity;
  if (state.cash <= 0) return 0;
  return Math.floor(state.cash / -net);
}

export interface Upcoming {
  day: number;
  kind: 'month' | 'tax' | 'inspection' | 'yearEnd';
  title: string;
  amount: number | null;
}

/** Ближайшие сроки для календаря. */
export function upcoming(state: GameState, cfg: GameConfig): Upcoming[] {
  const b = cfg.balance;
  const out: Upcoming[] = [];
  const last = totalDays(b);
  const today = Math.min(state.day, last);
  const monthEnd = today + (b.time.daysPerMonth - dayOfMonth(today, b));
  out.push({ day: monthEnd, kind: 'month', title: 'Аренда, зарплаты, коммуналка', amount: monthlyFixed(state, cfg) + state.overtimeAccrued * (1 + b.staff.contributions) });
  if (state.tax.due) out.push({ day: state.tax.due.payDay, kind: 'tax', title: 'Налог за прошлый квартал', amount: state.tax.due.amount });
  const quarterEnd = Math.ceil(today / b.taxes.quarterDays) * b.taxes.quarterDays;
  out.push({ day: quarterEnd + b.taxes.payAfterDays, kind: 'tax', title: 'Налог за текущий квартал (оценка на сегодня)', amount: quarterTax(state, cfg) });
  for (const i of state.inspections) {
    // плановые видны всегда, остальные – после уведомления
    if (i.reason === 'planned' || i.noticeDay <= state.day) {
      const what = i.reason === 'planned' ? 'Плановая проверка СЭС' : i.reason === 'repeat' ? 'Повторная проверка СЭС' : 'Внеплановая проверка СЭС';
      out.push({ day: i.visitDay, kind: 'inspection', title: what, amount: null });
    }
  }
  out.push({ day: last, kind: 'yearEnd', title: 'Конец года – итоги', amount: null });
  return out.filter((u) => u.day >= today && u.day <= last + b.taxes.payAfterDays).sort((a, c) => a.day - c.day);
}

export interface Score {
  cash: number;
  equipment: number;
  deposit: number;
  taxDebt: number;
  startCapital: number;
  total: number;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

/** Очки = деньги + остаточная стоимость оборудования + депозит − долги − стартовый капитал. */
export function computeScore(state: GameState, cfg: GameConfig): Score {
  const b = cfg.balance;
  const equipment = round2(state.equipment.reduce((a, id) => a + b.equipment[id].price, 0) * b.score.equipmentResidual);
  const deposit = state.outcome === 'year' || state.outcome === null ? rentMonthly(state, cfg) * b.costs.depositMonths : 0;
  const taxDebt = round2((state.tax.due?.amount ?? 0) + quarterTax(state, cfg));
  const total = round2(state.cash + equipment + deposit - taxDebt - state.startCapital);
  const m = b.score.medals;
  const medal = state.outcome !== 'year' ? null : total >= m.gold ? 'gold' : total >= m.silver ? 'silver' : total >= m.bronze ? 'bronze' : null;
  return { cash: state.cash, equipment, deposit, taxDebt, startCapital: state.startCapital, total, medal };
}
