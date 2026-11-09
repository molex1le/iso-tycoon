import { clamp, defaultConfig, round2, type EquipmentId, type GameConfig, type SupplierId } from './config';
import { say, usd } from './feed';
import { spend } from './finance';
import { checklist, itemScore, resolveVisit, scheduleInspection } from './inspections';
import { simulateDay } from './simulateDay';
import { createInitialState, type GameState, type LoggedCommand, type NewGameOptions } from './state';

/** Любое действие игрока – объект-команда. UI ничего не меняет в состоянии сам. */
export type Command =
  | { type: 'SetPrice'; itemId: string; price: number }
  | { type: 'Hire'; candidateId: number }
  | { type: 'Fire'; employeeId: number }
  | { type: 'SetPosts'; posts: number }
  | { type: 'IssueMedBook'; employeeId: number }
  | { type: 'SetSupplier'; supplier: SupplierId }
  | { type: 'SetSafety'; factor: number }
  | { type: 'BuyEquipment'; id: EquipmentId }
  | { type: 'Clean' }
  | { type: 'HireConsultant' }
  | { type: 'FixDefect' }
  | { type: 'Acknowledge' }
  | { type: 'ResolveInspection'; choice: 'accept' | 'contest' | 'bribe' }
  | { type: 'DebugAddMoney'; amount: number }
  | { type: 'DebugInspection' };

/** Объявленная проверка, к которой можно готовиться. */
export function announcedInspection(state: GameState) {
  return state.inspections.find((i) => i.noticeDay <= state.day) ?? null;
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
      if (c.role === 'cleaner' && state.employees.some((e) => e.role === 'cleaner')) return false;
      state.candidates = state.candidates.filter((x) => x.id !== c.id);
      state.employees.push({ ...c, medBookReadyDay: null, fatigue: 0, hiredDay: state.day });
      say(state, cfg, 'hired', 'ok', { name: c.name, role: c.role === 'cleaner' ? 'уборщица' : 'бариста', amount: usd(c.salary) });
      return true;
    }
    case 'Fire': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e) return false;
      state.employees = state.employees.filter((x) => x.id !== e.id);
      spend(state, 'payroll', e.salary);
      say(state, cfg, 'fired', 'info', { name: e.name, amount: usd(e.salary) });
      return true;
    }
    case 'SetPosts': {
      if (!Number.isInteger(command.posts) || command.posts < 1 || command.posts > b.staff.maxPosts || command.posts === state.posts) return false;
      state.posts = command.posts;
      return true;
    }
    case 'IssueMedBook': {
      const e = state.employees.find((x) => x.id === command.employeeId);
      if (!e || e.hasMedBook || e.medBookReadyDay !== null) return false;
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
    case 'BuyEquipment': {
      const e = b.equipment[command.id];
      if (!e || state.equipment.includes(command.id)) return false;
      state.equipment.push(command.id);
      spend(state, 'equipment', e.price);
      state.awareness = clamp(round2(state.awareness + e.awareness), 0, b.awareness.max);
      say(state, cfg, 'bought', 'ok', { name: e.name });
      return true;
    }
    case 'Clean': {
      if (state.cleanliness >= 100) return false;
      spend(state, 'services', b.costs.cleaning);
      state.cleanliness = 100;
      say(state, cfg, 'cleaned', 'ok');
      return true;
    }
    case 'HireConsultant': {
      const insp = announcedInspection(state);
      if (!insp || insp.consultant) return false;
      insp.consultant = true;
      spend(state, 'services', b.costs.consultant);
      state.cleanliness = clamp(state.cleanliness + b.compliance.consultantBoost, 0, 100);
      state.defectKnown = state.defect;
      const bad = checklist(cfg).filter((i) => itemScore(state, cfg, i.id) < 100 && i.id !== 'cleanliness');
      if (bad.length) say(state, cfg, 'consultantFound', 'warn', { items: bad.map((i) => i.name).join('; ') });
      else say(state, cfg, 'consultantOk', 'ok');
      return true;
    }
    case 'FixDefect': {
      if (!state.defect || !state.defectKnown) return false;
      spend(state, 'services', b.costs.defectFix);
      state.defect = false;
      state.defectKnown = false;
      say(state, cfg, 'defectFixed', 'ok');
      return true;
    }
    case 'Acknowledge': {
      const p = state.pending[0];
      if (!p) return false;
      if (p.kind === 'inspectionVisit') {
        if (p.totalFine > 0) return false;
        say(state, cfg, 'inspectionClean', 'ok');
      }
      state.pending.shift();
      return true;
    }
    case 'ResolveInspection':
      return resolveVisit(state, cfg, command.choice);
    case 'DebugAddMoney': {
      if (!Number.isFinite(command.amount)) return false;
      state.cash = round2(state.cash + command.amount);
      return true;
    }
    case 'DebugInspection': {
      if (state.inspections.some((i) => i.reason === 'unplanned')) return false;
      scheduleInspection(state, cfg, 'unplanned', state.day + 1, 1);
      return true;
    }
  }
}

/**
 * Применяет команду и пишет её в лог (с номером дня).
 * Возвращает false и ничего не пишет, если команда некорректна.
 */
export function applyCommand(state: GameState, command: Command, cfg: GameConfig = defaultConfig): boolean {
  if (state.finished) return false;
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
  while (!state.finished && state.day <= untilDay) {
    while (i < log.length && log[i].day === state.day) applyCommand(state, log[i++].command, cfg);
    if (state.day === untilDay || state.pending.length > 0) break;
    simulateDay(state, cfg);
  }
  return state;
}
