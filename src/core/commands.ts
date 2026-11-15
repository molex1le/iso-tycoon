import type { LocationId } from './config';
import { closeBranch, openBranch } from './branch';
import { continueYear } from './years';
import { clamp, defaultConfig, round2, type AccountingId, type AgencyId, type EquipmentId, type GameConfig, type LoanProductId, type SupplierId } from './config';
import { chooseOption } from './events';
import { say, usd } from './feed';
import { roleName } from './text';
import { autoOrderOn, suggestedStanding } from './inventory';
import { bonus, chatReact, praise } from './chat';
import { syncShifts } from './shop';
import { earnedSoFar } from './staff';
import { fileDeclaration, payTax, spend } from './finance';
import { answerInspector, checklist, itemScore, resolveVisit, triggerUnplanned, type Reply } from './inspections';
import { repayLoan, restructure, takeLoan } from './loans';
import { nextRandom } from './rng';
import type { WeatherId } from './weather';
import { simulateDay } from './simulateDay';
import { createInitialState, refreshCandidates, type GameState, type LoggedCommand, type NewGameOptions } from './state';

/** Любое действие игрока – объект-команда. UI ничего не меняет в состоянии сам. */
export type Command =
  | { type: 'SetPrice'; itemId: string; price: number }
  | { type: 'Hire'; candidateId: number; official?: boolean }
  | { type: 'Fire'; employeeId: number; severance?: boolean }
  | { type: 'Officialize'; employeeId: number }
  | { type: 'SetPosts'; posts: number }
  | { type: 'PostVacancy' }
  | { type: 'SetSalary'; employeeId: number; salary: number }
  | { type: 'SetShift'; employeeId: number; weekday: number; on: boolean }
  | { type: 'AutoShifts' }
  | { type: 'Praise' }
  | { type: 'Bonus' }
  | { type: 'IssueMedBook'; employeeId: number }
  | { type: 'SetSupplier'; supplier: SupplierId }
  | { type: 'SetSafety'; factor: number }
  | { type: 'SetAutoOrder'; on: boolean }
  | { type: 'SetStanding'; materialId: string; qty: number }
  | { type: 'StandingBySuggestion' }
  | { type: 'UrgentOrder'; materialId: string; qty: number }
  | { type: 'SetLateWriteOff'; on: boolean }
  | { type: 'BuyEquipment'; id: EquipmentId }
  | { type: 'Clean' }
  | { type: 'HireConsultant'; agency?: AgencyId }
  | { type: 'FixDefect' }
  | { type: 'SetAccounting'; accounting: AccountingId }
  | { type: 'FileDeclaration' }
  | { type: 'PayTax' }
  | { type: 'SetOffbook'; share: number }
  | { type: 'TakeLoan'; product: LoanProductId; amount: number }
  | { type: 'RepayLoan'; loanId: number }
  | { type: 'Restructure'; loanId: number }
  | { type: 'BuyFlyers' }
  | { type: 'SetSocial'; on: boolean }
  | { type: 'SetPromo'; on: boolean }
  | { type: 'SetServiceContract'; on: boolean }
  | { type: 'Acknowledge' }
  | { type: 'ResolveInspection'; choice: 'accept' | 'contest' | 'bribe' }
  | { type: 'AnswerInspector'; reply: Reply }
  | { type: 'OpenBranch'; location: LocationId }
  | { type: 'CloseBranch' }
  | { type: 'ContinueYear' }
  | { type: 'ChooseEventOption'; index: number }
  | { type: 'DebugAddMoney'; amount: number }
  | { type: 'DebugInspection'; agency?: AgencyId }
  | { type: 'DebugEvent'; eventId: string }
  | { type: 'DebugReputation'; value: number }
  | { type: 'DebugWeather'; weather: WeatherId }
  | { type: 'DebugRival' };

/** Ближайшая объявленная проверка, к которой можно готовиться. */
export function announcedInspection(state: GameState, agency?: AgencyId) {
  return state.inspections.filter((i) => i.noticeDay <= state.day && (!agency || i.agency === agency)).sort((a, b) => a.visitDay - b.visitDay)[0] ?? null;
}

function pay(state: GameState, amount: number): boolean {
  return state.cash >= amount;
}

function run(state: GameState, command: Command, cfg: GameConfig): boolean {
  const b = cfg.balance;
  switch (command.type) {
    case 'SetPrice': {
      const p = b.prices;
      if (!(command.itemId in state.prices) || !Number.isFinite(command.price)) return false;
      const stepped = Math.round(command.price / p.step) * p.step;
      const price = round2(clamp(stepped, p.min, p.max));
      if (price === state.prices[command.itemId]) return false;
      state.prices[command.itemId] = price;
      return true;
    }
    case 'Hire': {
      const c = state.candidates.find((x) => x.id === command.candidateId);
      if (!c || state.employees.length >= b.staff.maxStaff) return false;
      if (c.role === 'cleaner' && state.employees.filter((e) => e.role === 'cleaner').length >= b.staff.maxCleaners) return false;
      state.candidates = state.candidates.filter((x) => x.id !== c.id);
      state.employees.push({ ...c, medBookReadyDay: null, fatigue: 0, hiredDay: state.day, official: command.official !== false, loyaltyBonus: 0 });
      syncShifts(state);
      chatReact(state, state.employees[state.employees.length - 1], 'hired');
      say(state, cfg, 'hired', 'ok', { name: c.name, role: roleName(c.role, c.name), amount: usd(c.salary) });
      return true;
    }
    case 'Fire': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e) return false;
      const severance = command.severance !== false;
      state.employees = state.employees.filter((x) => x.id !== e.id);
      syncShifts(state);
      // отработанные в этом месяце смены оплачиваются при расчёте
      if (e.role === 'barista') spend(state, 'payroll', earnedSoFar(e, cfg) * (e.official ? 1 + b.staff.contributions : 1));
      if (severance) spend(state, 'payroll', e.salary * b.costs.severanceSalaries);
      else if (nextRandom(state) < (e.official ? b.staff.complaintNoSeverance : b.staff.complaintEnvelope)) {
        say(state, cfg, 'complaint', 'bad', { name: e.name });
        triggerUnplanned(state, cfg, 'labour', 'Жалоба уволенного сотрудника');
        if (!e.official) triggerUnplanned(state, cfg, 'tax', 'Жалоба уволенного сотрудника');
      }
      chatReact(state, e, 'fired');
      say(state, cfg, 'fired', 'info', { name: e.name, amount: usd(severance ? e.salary : 0) });
      return true;
    }
    case 'Officialize': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e || e.official) return false;
      e.official = true;
      return true;
    }
    case 'PostVacancy': {
      // платное объявление: новые кандидаты сразу, среди них точно есть опытный бариста
      if (state.cash < b.staff.vacancyCost) return false;
      spend(state, 'services', b.staff.vacancyCost);
      refreshCandidates(state, cfg, b.staff.vacancyMinExperience);
      say(state, cfg, 'vacancy', 'info', { amount: usd(b.staff.vacancyCost), n: state.candidates.length });
      return true;
    }
    case 'SetSalary': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      const st = b.staff;
      if (!e || !Number.isFinite(command.salary)) return false;
      const salary = clamp(Math.round(command.salary / st.salaryStep) * st.salaryStep, st.salaryMin, st.salaryMax);
      if (salary === e.salary) return false;
      // снижение зарплаты люди запоминают, прибавка работает через лояльность сама
      if (salary < e.salary) e.loyaltyBonus += st.salaryCutLoyalty * Math.ceil((e.salary - salary) / st.salaryStep);
      say(state, cfg, salary > e.salary ? 'salaryUp' : 'salaryDown', salary > e.salary ? 'ok' : 'warn', { name: e.name, amount: usd(salary) }, 0);
      chatReact(state, e, salary > e.salary ? 'raise' : 'cut');
      if (salary > e.salary) delete e.promiseDay;
      e.salary = salary;
      return true;
    }
    case 'SetShift': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e || e.role !== 'barista' || !Number.isInteger(command.weekday) || command.weekday < 0 || command.weekday > 6) return false;
      syncShifts(state);
      if (!!e.shifts![command.weekday] === command.on) return false;
      state.autoShifts = false;
      e.shifts![command.weekday] = command.on;
      return true;
    }
    case 'Praise':
      return praise(state);
    case 'Bonus':
      return bonus(state);
    case 'AutoShifts': {
      state.autoShifts = true;
      syncShifts(state);
      return true;
    }
    case 'SetAutoOrder': {
      if (autoOrderOn(state) === command.on) return false;
      state.autoOrder = command.on;
      // переходя на ручные закупки, начинаем с разумных количеств
      if (!command.on) for (const m of cfg.materials) (state.standing ??= {})[m.id] = suggestedStanding(state, m, cfg);
      return true;
    }
    case 'SetStanding': {
      const inv = b.inventory;
      if (!cfg.materials.some((m) => m.id === command.materialId) || !Number.isFinite(command.qty)) return false;
      const qty = clamp(Math.round(command.qty / inv.standingStep) * inv.standingStep, 0, inv.standingMax);
      if (qty === (state.standing?.[command.materialId] ?? 0)) return false;
      (state.standing ??= {})[command.materialId] = qty;
      return true;
    }
    case 'StandingBySuggestion': {
      for (const m of cfg.materials) (state.standing ??= {})[m.id] = suggestedStanding(state, m, cfg);
      return true;
    }
    case 'UrgentOrder': {
      const inv = b.inventory;
      if (!cfg.materials.some((m) => m.id === command.materialId) || !Number.isFinite(command.qty) || command.qty <= 0) return false;
      const now = state.urgent?.[command.materialId] ?? 0;
      const qty = clamp(Math.round(now + command.qty), 0, inv.urgentMax);
      if (qty === now) return false;
      (state.urgent ??= {})[command.materialId] = qty;
      return true;
    }
    case 'SetPosts': {
      if (!Number.isInteger(command.posts) || command.posts < 1 || command.posts > b.staff.maxPosts || command.posts === state.posts) return false;
      state.posts = command.posts;
      syncShifts(state);
      return true;
    }
    case 'IssueMedBook': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e || e.hasMedBook || e.medBookReadyDay !== null || !pay(state, b.costs.medBook)) return false;
      spend(state, 'services', b.costs.medBook);
      e.medBookReadyDay = state.day + b.costs.medBookDays;
      return true;
    }
    case 'SetSupplier': {
      if (!(command.supplier in b.suppliers) || command.supplier === state.supplier) return false;
      state.supplier = command.supplier;
      return true;
    }
    case 'SetSafety': {
      const i = b.inventory;
      if (!Number.isFinite(command.factor)) return false;
      const factor = round2(clamp(Math.round(command.factor / i.safetyStep) * i.safetyStep, i.safetyMin, i.safetyMax));
      if (factor === state.safetyFactor) return false;
      state.safetyFactor = factor;
      return true;
    }
    case 'SetLateWriteOff':
      if (state.lateWriteOff === command.on) return false;
      state.lateWriteOff = command.on;
      return true;
    case 'BuyEquipment': {
      const e = b.equipment[command.id];
      if (!e || state.equipment.includes(command.id) || !pay(state, e.price)) return false;
      state.equipment.push(command.id);
      spend(state, 'equipment', e.price);
      state.awareness = clamp(round2(state.awareness + e.awareness), 0, b.awareness.max);
      say(state, cfg, 'bought', 'ok', { name: e.name });
      return true;
    }
    case 'Clean': {
      if (state.cleanliness >= 100 || !pay(state, b.costs.cleaning)) return false;
      spend(state, 'services', b.costs.cleaning);
      state.cleanliness = 100;
      say(state, cfg, 'cleaned', 'ok');
      return true;
    }
    case 'HireConsultant': {
      const insp = announcedInspection(state, command.agency);
      if (!insp || insp.consultant || !pay(state, b.costs.consultant)) return false;
      insp.consultant = true;
      spend(state, 'services', b.costs.consultant);
      if (insp.agency === 'ses') state.cleanliness = clamp(state.cleanliness + b.compliance.consultantBoost, 0, 100);
      state.defectKnown = state.defect;
      const bad = checklist(cfg, insp.agency).filter((i) => itemScore(state, cfg, i.id) < 100 && i.id !== 'cleanliness');
      if (bad.length) say(state, cfg, 'consultantFound', 'warn', { items: bad.map((i) => i.name).join('; ') });
      else say(state, cfg, 'consultantOk', 'ok');
      return true;
    }
    case 'FixDefect': {
      const cost = b.costs.defectFix[state.defectType];
      if (!state.defect || !state.defectKnown || !pay(state, cost)) return false;
      const name = { damp: 'Сырость', wiring: 'Проводка', exit: 'Запасной выход' }[state.defectType];
      spend(state, 'services', cost);
      state.defect = false;
      state.defectKnown = false;
      say(state, cfg, 'defectFixed', 'ok', { name });
      return true;
    }
    case 'SetAccounting': {
      if (command.accounting === state.accounting) return false;
      if (command.accounting === 'self' && state.options.form === 'ooo') return false;
      state.accounting = command.accounting;
      return true;
    }
    case 'FileDeclaration':
      return fileDeclaration(state, cfg, () => nextRandom(state));
    case 'PayTax': {
      if (!state.tax.due || !pay(state, state.tax.due.amount + state.tax.due.penalty)) return false;
      return payTax(state, cfg);
    }
    case 'SetOffbook': {
      const g = b.grey;
      if (!Number.isFinite(command.share)) return false;
      const share = round2(clamp(Math.round(command.share / g.offbookStep) * g.offbookStep, 0, g.offbookMax));
      if (share === state.offbookShare) return false;
      state.offbookShare = share;
      return true;
    }
    case 'TakeLoan':
      return takeLoan(state, cfg, command.product, command.amount);
    case 'RepayLoan':
      return repayLoan(state, cfg, command.loanId);
    case 'Restructure':
      return restructure(state, cfg, command.loanId);
    case 'BuyFlyers': {
      const f = b.marketing.flyers;
      if (state.day <= state.flyersUntilDay || !pay(state, f.price)) return false;
      spend(state, 'marketing', f.price);
      state.flyersUntilDay = state.day + f.days - 1;
      say(state, cfg, 'flyers', 'ok');
      return true;
    }
    case 'SetSocial':
      if (state.social === command.on) return false;
      state.social = command.on;
      return true;
    case 'SetPromo':
      if (state.promo === command.on) return false;
      state.promo = command.on;
      return true;
    case 'SetServiceContract':
      if (state.serviceContract === command.on) return false;
      state.serviceContract = command.on;
      return true;
    case 'Acknowledge': {
      const p = state.pending[0];
      if (!p || p.kind === 'event') return false;
      if (p.kind === 'inspectionVisit') {
        if (p.totalFine > 0) return false;
        say(state, cfg, 'inspectionClean', 'ok', { agency: cfg.inspections[p.agency].name });
      }
      state.pending.shift();
      return true;
    }
    case 'ResolveInspection':
      return resolveVisit(state, cfg, command.choice);
    case 'AnswerInspector':
      return answerInspector(state, cfg, command.reply);
    case 'OpenBranch':
      return openBranch(state, cfg, command.location);
    case 'CloseBranch':
      return closeBranch(state, cfg);
    case 'ContinueYear':
      return continueYear(state, cfg);
    case 'ChooseEventOption':
      return chooseOption(state, cfg, command.index);
    case 'DebugAddMoney': {
      if (!Number.isFinite(command.amount)) return false;
      state.cash = round2(state.cash + command.amount);
      return true;
    }
    case 'DebugInspection':
      return triggerUnplanned(state, cfg, command.agency ?? 'ses', 'Отладка');
    case 'DebugEvent': {
      const e = cfg.events.find((x) => x.id === command.eventId);
      if (!e) return false;
      const target = state.employees[0];
      state.pending.push({ kind: 'event', eventId: e.id, targetId: target?.id ?? null, vars: { name: target?.name ?? '', review: 'Тестовый отзыв.' } });
      return true;
    }
    case 'DebugReputation': {
      if (!Number.isFinite(command.value)) return false;
      state.reputation = clamp(command.value, 1, 5);
      return true;
    }
    case 'DebugWeather': {
      if (!(command.weather in cfg.balance.weather.kinds)) return false;
      state.weather = command.weather;
      return true;
    }
    case 'DebugRival': {
      const n = cfg.balance.competition.newRivals;
      const next = n.list.find((x) => !state.competitors.some((r) => r.id === x.id));
      if (!next) return false;
      state.competitors.push({ ...next, lowShareDays: 0, closedUntilDay: state.day + n.buildDays, opening: true });
      say(state, cfg, 'rivalBuilding', 'warn', { name: next.name, n: n.buildDays });
      return true;
    }
  }
}

/**
 * Применяет команду и пишет её в лог (с номером дня).
 * Возвращает false и ничего не пишет, если команда некорректна.
 */
export function applyCommand(state: GameState, command: Command, cfg: GameConfig = defaultConfig): boolean {
  if (state.finished && command.type !== 'ContinueYear') return false;
  if (!run(state, command, cfg)) return false;
  state.commandLog.push({ day: state.day, command });
  return true;
}

/** Точный повтор партии: сид + настройки старта + лог команд, до начала дня untilDay. */
export function replay(
  seed: number,
  options: NewGameOptions,
  log: LoggedCommand[],
  untilDay: number,
  cfg: GameConfig = defaultConfig,
): GameState {
  const state = createInitialState(seed, options, cfg);
  let i = 0;
  while (state.day <= untilDay) {
    while (i < log.length && log[i].day === state.day) applyCommand(state, log[i++].command, cfg);
    if (state.finished || state.day === untilDay || state.pending.length > 0) break;
    simulateDay(state, cfg);
  }
  return state;
}
