import { round2, type GameConfig, type LoanProductId } from './config';
import { say, usd } from './feed';
import { spend } from './finance';
import { baristas } from './shop';
import type { GameState, Loan } from './state';

/** Аннуитет: P = S · i / (1 − (1 + i)^−n). */
export function annuity(sum: number, annualRatePercent: number, months: number): number {
  const i = annualRatePercent / 100 / 12;
  if (i === 0) return round2(sum / months);
  return round2((sum * i) / (1 - Math.pow(1 + i, -months)));
}

export function loanRate(state: GameState, cfg: GameConfig, product: LoanProductId): number {
  const l = cfg.balance.loans;
  return l.products[product].rate + l.gradeRate[state.grade as keyof typeof l.gradeRate] + l.difficultyRate[state.options.difficulty];
}

export function makeLoan(state: GameState, cfg: GameConfig, product: LoanProductId, amount: number): Loan {
  const p = cfg.balance.loans.products[product];
  const annualRate = loanRate(state, cfg, product);
  return {
    id: state.nextId++,
    product,
    principal: amount,
    balance: amount,
    annualRate,
    months: p.months,
    payment: annuity(amount, annualRate, p.months),
    nextPayDay: state.day + cfg.balance.time.daysPerMonth - 1,
    overdue: 0,
    overdueSince: null,
    collectors: false,
  };
}

export interface LoanOffer {
  available: boolean;
  limit: number;
  rate: number;
  payment: number;
  reason: string;
}

export function hasOverdue(state: GameState): boolean {
  return state.loans.some((l) => l.overdue > 0);
}

export function loanOffer(state: GameState, cfg: GameConfig, product: LoanProductId): LoanOffer {
  const l = cfg.balance.loans;
  const p = l.products[product];
  const rate = loanRate(state, cfg, product);
  let limit = 0;
  if (product === 'start') limit = state.options.form === 'ooo' ? l.products.start.oooLimit : l.products.start.limit;
  else if (product === 'micro') limit = l.products.micro.limit;
  else {
    const months = state.history.slice(-90);
    limit = Math.floor(months.reduce((a, r) => a + r.revenue, 0) / Math.max(1, months.length / cfg.balance.time.daysPerMonth) / l.step) * l.step;
  }
  let reason = '';
  if (state.grade === 'E') reason = 'Кредитная история E – банки отказывают';
  else if (state.loans.some((x) => x.product === product)) reason = 'Этот кредит уже взят';
  else if (product === 'working' && state.day <= l.products.working.minDays) reason = 'Нужно 3 месяца работы';
  else if (product === 'working' && hasOverdue(state)) reason = 'Есть просрочка';
  else if (limit < l.minAmount) reason = 'Слишком маленькая выручка';
  return { available: reason === '', limit, rate, payment: annuity(limit, rate, p.months), reason };
}

export function changeGrade(state: GameState, cfg: GameConfig, delta: number): void {
  const g = cfg.balance.loans.grades;
  const i = Math.min(g.length - 1, Math.max(0, g.indexOf(state.grade) - delta));
  state.grade = g[i];
}

export function takeLoan(state: GameState, cfg: GameConfig, product: LoanProductId, amount: number): boolean {
  const offer = loanOffer(state, cfg, product);
  const l = cfg.balance.loans;
  if (!offer.available || !Number.isFinite(amount) || amount < l.minAmount || amount > offer.limit) return false;
  const loan = makeLoan(state, cfg, product, Math.round(amount));
  state.loans.push(loan);
  state.cash = round2(state.cash + loan.principal);
  if (product === 'micro') changeGrade(state, cfg, -1);
  say(state, cfg, 'loanTaken', product === 'micro' ? 'warn' : 'info', { name: l.products[product].name, amount: usd(loan.principal), payment: usd(loan.payment) });
  return true;
}

export function repayLoan(state: GameState, cfg: GameConfig, id: number): boolean {
  const loan = state.loans.find((l) => l.id === id);
  if (!loan) return false;
  const total = round2(loan.balance + loan.overdue);
  if (state.cash < total) return false;
  spend(state, 'loans', total);
  state.loans = state.loans.filter((l) => l.id !== id);
  say(state, cfg, 'loanClosed', 'ok', { name: cfg.balance.loans.products[loan.product].name });
  return true;
}

/** Реструктуризация: срок +12 мес, ставка +3 п.п. */
export function restructure(state: GameState, cfg: GameConfig, id: number): boolean {
  const l = cfg.balance.loans;
  const loan = state.loans.find((x) => x.id === id);
  if (!loan || loan.overdueSince === null || state.day - loan.overdueSince < l.restructureAfterDays) return false;
  const debt = round2(loan.balance + loan.overdue);
  loan.balance = debt;
  loan.overdue = 0;
  loan.overdueSince = null;
  loan.collectors = false;
  loan.annualRate += l.restructureRate;
  loan.months += l.restructureMonths;
  loan.payment = annuity(debt, loan.annualRate, loan.months);
  return true;
}

/** Конец дня: списания по графику, лестница просрочки. */
export function processLoans(state: GameState, cfg: GameConfig): void {
  const l = cfg.balance.loans;
  for (const loan of [...state.loans]) {
    const name = l.products[loan.product].name;
    if (state.day >= loan.nextPayDay) {
      const interest = round2((loan.balance * loan.annualRate) / 100 / 12);
      const payment = Math.min(loan.payment, round2(loan.balance + interest));
      loan.balance = round2(Math.max(0, loan.balance - (payment - interest)));
      loan.overdue = round2(loan.overdue + payment);
      loan.nextPayDay += cfg.balance.time.daysPerMonth;
    }
    if (loan.overdue <= 0) {
      if (loan.balance <= 0.005) state.loans = state.loans.filter((x) => x.id !== loan.id);
      continue;
    }
    if (state.cash >= loan.overdue) {
      const paid = loan.overdue;
      spend(state, 'loans', paid);
      loan.overdue = 0;
      const wasLate = loan.overdueSince !== null;
      loan.overdueSince = null;
      loan.collectors = false;
      say(state, cfg, 'loanPaid', 'info', { amount: usd(paid) }, 5);
      if (!wasLate && ++state.onTimeStreak >= l.onTimeForUpgrade) {
        state.onTimeStreak = 0;
        changeGrade(state, cfg, 1);
      }
      if (loan.balance <= 0.005) {
        state.loans = state.loans.filter((x) => x.id !== loan.id);
        say(state, cfg, 'loanClosed', 'ok', { name });
      }
      continue;
    }
    // денег не хватило
    if (loan.overdueSince === null) {
      loan.overdueSince = state.day;
      state.onTimeStreak = 0;
      loan.overdue = round2(loan.overdue + l.lateFine);
      changeGrade(state, cfg, -1);
      say(state, cfg, 'loanLate', 'bad', { amount: usd(l.lateFine), grade: state.grade });
    }
    loan.overdue = round2(loan.overdue + loan.overdue * l.penaltyPerDay);
    const days = state.day - loan.overdueSince;
    if (days === l.restructureAfterDays) say(state, cfg, 'loanOffer', 'warn');
    if (!loan.collectors && (days >= l.collectorsAfterDays || loan.product === 'micro')) {
      loan.collectors = true;
      state.reputation = Math.max(1, round2(state.reputation - l.collectorsReputation));
      for (const e of baristas(state)) e.fatigue = Math.min(100, e.fatigue + l.collectorsFatigue);
      say(state, cfg, 'collectors', 'bad');
    }
    if (days >= l.seizeAfterDays) {
      state.equipment = state.equipment.filter((id) => cfg.balance.equipment[id].ordersPerHour === 0);
      state.loans = state.loans.filter((x) => x.id !== loan.id);
      say(state, cfg, 'seized', 'bad');
    }
  }
}

export function loansDebt(state: GameState): number {
  return round2(state.loans.reduce((a, l) => a + l.balance + l.overdue, 0));
}

export function monthlyLoanPayments(state: GameState): number {
  return round2(state.loans.reduce((a, l) => a + l.payment, 0));
}

/** Есть ли кредит, который закрыл бы минус на счёте. */
export function rescueAvailable(state: GameState, cfg: GameConfig): boolean {
  const need = -state.cash;
  return (Object.keys(cfg.balance.loans.products) as LoanProductId[]).some((p) => {
    const o = loanOffer(state, cfg, p);
    return o.available && o.limit >= need;
  });
}
