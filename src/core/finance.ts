import { dayOfMonth } from './calendar';
import { round2, totalDays, type GameConfig } from './config';
import { say, usd } from './feed';
import { loansDebt, monthlyLoanPayments } from './loans';
import { demandView } from './shop';
import type { ExpenseCategory, GameState } from './state';

/** Списывает деньги и записывает расход в статьи дня. documented – доля, подтверждённая документами. */
export function spend(state: GameState, category: ExpenseCategory, amount: number, documented = 1): void {
  amount = round2(amount);
  if (amount <= 0) return;
  state.cash = round2(state.cash - amount);
  state.ledger[category] = round2((state.ledger[category] ?? 0) + amount);
  if (category !== 'tax' && category !== 'fines' && category !== 'loans') {
    state.tax.quarterDeductible = round2(state.tax.quarterDeductible + amount * documented);
  }
}

/** Зарплаты за месяц: взносы только за официальных. */
export function payrollMonthly(state: GameState, cfg: GameConfig): number {
  const c = cfg.balance.staff.contributions;
  return round2(state.employees.reduce((a, e) => a + e.salary * (e.official ? 1 + c : 1), 0));
}

export function accountantMonthly(state: GameState, cfg: GameConfig): number {
  const c = cfg.balance.costs;
  return state.accounting === 'outsource' ? c.accountantOutsource : state.accounting === 'staff' ? c.accountantStaff : 0;
}

export function rentMonthly(state: GameState, cfg: GameConfig): number {
  return round2(cfg.balance.locations[state.options.location].rent * state.rentFactor);
}

export function subscriptionsMonthly(state: GameState, cfg: GameConfig): number {
  const m = cfg.balance.marketing;
  return (state.social ? m.social.monthly : 0) + (state.serviceContract ? m.serviceContract.monthly : 0);
}

/** Постоянные расходы за месяц: аренда, коммуналка, зарплаты со взносами, бухгалтер, подписки. */
export function monthlyFixed(state: GameState, cfg: GameConfig): number {
  return round2(rentMonthly(state, cfg) + cfg.balance.costs.utilities + payrollMonthly(state, cfg) + accountantMonthly(state, cfg) + subscriptionsMonthly(state, cfg));
}

export function dailyFixed(state: GameState, cfg: GameConfig): number {
  return monthlyFixed(state, cfg) / cfg.balance.time.daysPerMonth;
}

/** Платежи конца месяца. */
export function payMonthEnd(state: GameState, cfg: GameConfig): number {
  const before = state.cash;
  const m = cfg.balance.marketing;
  spend(state, 'rent', rentMonthly(state, cfg));
  spend(state, 'utilities', cfg.balance.costs.utilities);
  spend(state, 'payroll', payrollMonthly(state, cfg) + state.overtimeAccrued * (1 + cfg.balance.staff.contributions));
  spend(state, 'services', accountantMonthly(state, cfg) + (state.serviceContract ? m.serviceContract.monthly : 0));
  spend(state, 'marketing', state.social ? m.social.monthly : 0);
  state.overtimeAccrued = 0;
  const paid = round2(before - state.cash);
  say(state, cfg, 'monthPaid', 'info', { amount: usd(paid) });
  return paid;
}

/** Налог за квартал по накопленным выручке и расходам. */
export function quarterTax(state: GameState, cfg: GameConfig): number {
  const regime = cfg.balance.taxes.regimes[state.options.taxRegime];
  const rev = state.tax.quarterRevenue;
  const rate = regime.rate + (regime.onProfit ? 0 : state.tax.rateDelta);
  const base = regime.onProfit ? Math.max(0, rev - state.tax.quarterDeductible) : rev;
  return round2(Math.max(base * rate, rev * regime.minRate));
}

/** Сколько всего сейчас причитается налоговой. */
export function taxOwed(state: GameState): number {
  const d = state.tax.due;
  return d ? round2(d.amount + d.penalty) : 0;
}

export function taxOverdueDays(state: GameState): number {
  const d = state.tax.due;
  return d && state.day > d.payBy ? state.day - d.payBy : 0;
}

/** Долг перед налоговой висит больше 30 дней – поставщикам платить нельзя. */
export function accountBlocked(state: GameState, cfg: GameConfig): boolean {
  return taxOverdueDays(state) > cfg.balance.taxes.blockAfterDays;
}

/** Подача декларации: ошибка не видна сразу, её находит налоговая. */
export function fileDeclaration(state: GameState, cfg: GameConfig, random: () => number): boolean {
  const d = state.tax.due;
  if (!d || d.filed) return false;
  const t = cfg.balance.taxes;
  d.filed = true;
  if (random() < t.errorChance[state.accounting]) {
    const share = t.errorShareMin + random() * (t.errorShareMax - t.errorShareMin);
    state.tax.hiddenError = round2(state.tax.hiddenError + d.amount * share);
  }
  say(state, cfg, 'taxFiled', 'ok');
  return true;
}

export function payTax(state: GameState, cfg: GameConfig): boolean {
  const d = state.tax.due;
  if (!d || !d.filed) return false;
  const owed = taxOwed(state);
  spend(state, 'tax', owed);
  state.tax.paidTotal = round2(state.tax.paidTotal + owed);
  say(state, cfg, 'taxPaid', 'info', { amount: usd(owed) });
  state.tax.due = null;
  return true;
}

/** Конец дня: начисление налога в конце квартала, сроки, пени. day – посчитанный день. */
export function processTaxes(state: GameState, cfg: GameConfig, random: () => number): void {
  const t = cfg.balance.taxes;
  const d = state.tax.due;
  if (d) {
    // бухгалтер всё делает сам, если на счёте есть деньги
    if (state.accounting !== 'self') {
      if (!d.filed && state.day >= d.declareBy - 2) fileDeclaration(state, cfg, random);
      if (d.filed && state.day >= d.payBy - 2 && state.cash >= taxOwed(state)) payTax(state, cfg);
    }
  }
  const cur = state.tax.due;
  if (cur) {
    if (state.day === cur.declareBy + 1 && !cur.filed) state.tax.lateCount++;
    if (!cur.filed && state.day > cur.declareBy && (state.day - cur.declareBy - 1) % cfg.balance.time.daysPerMonth === 0) {
      const fine = round2(t.undeclaredFine + cur.amount * t.undeclaredPerMonth);
      cur.penalty = round2(cur.penalty + fine);
      cur.undeclaredFines++;
      say(state, cfg, 'taxUndeclared', 'bad', { amount: usd(fine) });
    }
    if (state.day > cur.payBy) {
      if (state.day === cur.payBy + 1) {
        state.tax.lateCount++;
        say(state, cfg, 'taxLate', 'bad');
      }
      cur.penalty = round2(cur.penalty + cur.amount * t.latePenaltyPerDay);
      if (taxOverdueDays(state) === t.blockAfterDays + 1) say(state, cfg, 'accountBlocked', 'bad');
    }
  }
  if (state.day % t.quarterDays === 0) {
    const amount = quarterTax(state, cfg);
    state.tax.quarterRevenue = 0;
    state.tax.quarterDeductible = 0;
    if (amount > 0) {
      if (state.tax.due) {
        // новый налог прибавляется к неоплаченному, сроки – новые
        state.tax.due.amount = round2(state.tax.due.amount + amount);
        state.tax.due.declareBy = state.day + t.declareAfterDays;
        state.tax.due.payBy = state.day + t.payAfterDays;
        state.tax.due.filed = false;
      } else {
        state.tax.due = { amount, declareBy: state.day + t.declareAfterDays, payBy: state.day + t.payAfterDays, filed: false, penalty: 0, undeclaredFines: 0 };
      }
      say(state, cfg, 'taxDue', 'warn', { amount: usd(amount), declare: state.day + t.declareAfterDays, pay: state.day + t.payAfterDays });
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
  const net = gross - dailyFixed(state, cfg) - monthlyLoanPayments(state) / cfg.balance.time.daysPerMonth;
  if (net >= 0) return Infinity;
  if (state.cash <= 0) return 0;
  return Math.floor(state.cash / -net);
}

export interface Upcoming {
  day: number;
  kind: 'month' | 'tax' | 'declare' | 'inspection' | 'loan' | 'yearEnd';
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
  const d = state.tax.due;
  if (d) {
    if (!d.filed) out.push({ day: d.declareBy, kind: 'declare', title: 'Подать декларацию', amount: null });
    out.push({ day: d.payBy, kind: 'tax', title: 'Оплатить налог за квартал', amount: taxOwed(state) });
  }
  const quarterEnd = Math.ceil(today / b.taxes.quarterDays) * b.taxes.quarterDays;
  out.push({ day: quarterEnd + b.taxes.payAfterDays, kind: 'tax', title: 'Налог за текущий квартал (оценка на сегодня)', amount: quarterTax(state, cfg) });
  for (const l of state.loans) out.push({ day: l.nextPayDay, kind: 'loan', title: `Платёж по кредиту «${b.loans.products[l.product].name}»`, amount: l.payment });
  for (const i of state.inspections) {
    // плановые видны всегда, остальные – после уведомления
    if (i.reason === 'planned' || i.noticeDay <= state.day) {
      const kind = i.reason === 'planned' ? 'Плановая' : i.reason === 'repeat' ? 'Повторная' : 'Внеплановая';
      out.push({ day: i.visitDay, kind: 'inspection', title: `${kind} проверка: ${cfg.inspections[i.agency].name}`, amount: null });
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
  loans: number;
  startCapital: number;
  total: number;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

/** Очки = деньги + остаточная стоимость оборудования + депозит − долги − стартовый капитал. */
export function computeScore(state: GameState, cfg: GameConfig): Score {
  const b = cfg.balance;
  const equipment = round2(state.equipment.reduce((a, id) => a + b.equipment[id].price, 0) * b.score.equipmentResidual);
  const deposit = state.outcome === 'year' || state.outcome === null ? b.locations[state.options.location].rent * b.costs.depositMonths : 0;
  const taxDebt = round2(taxOwed(state) + quarterTax(state, cfg));
  const loans = loansDebt(state);
  const total = round2(state.cash + equipment + deposit - taxDebt - loans - state.startCapital);
  const m = b.score.medals;
  const medal = state.outcome !== 'year' ? null : total >= m.gold ? 'gold' : total >= m.silver ? 'silver' : total >= m.bronze ? 'bronze' : null;
  return { cash: state.cash, equipment, deposit, taxDebt, loans, startCapital: state.startCapital, total, medal };
}
