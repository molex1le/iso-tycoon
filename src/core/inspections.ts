import { clamp, round2, type ChecklistItem, type GameConfig, type Inspector } from './config';
import { say, usd } from './feed';
import { spend } from './finance';
import { nextRandom } from './rng';
import { hasCleaner } from './shop';
import { pickInspectorId, type GameState, type Inspection, type Pending, type VisitResult } from './state';

export function checklist(cfg: GameConfig): ChecklistItem[] {
  return cfg.inspections.ses.items as ChecklistItem[];
}

export function inspectorById(cfg: GameConfig, id: string): Inspector {
  return cfg.inspectors.find((i) => i.id === id) ?? cfg.inspectors[0];
}

function withoutMedBook(state: GameState): number {
  return state.employees.filter((e) => !e.hasMedBook).length;
}

/**
 * Шкала пункта 0–100. known = true – то, что видит игрок (скрытый дефект не виден, пока не найден).
 */
export function itemScore(state: GameState, cfg: GameConfig, itemId: string, known = false): number {
  switch (itemId) {
    case 'cleanliness':
      return state.cleanliness;
    case 'fridge':
      return state.equipment.includes('fridge') ? 100 : 0;
    case 'medbooks':
      return state.employees.length ? Math.round((1 - withoutMedBook(state) / state.employees.length) * 100) : 100;
    case 'supplierDocs':
      return Math.round(cfg.balance.suppliers[state.supplier].documents * 100);
    case 'damp':
      return state.defect && (!known || state.defectKnown) ? 0 : 100;
    default:
      return 100;
  }
}

/** Общая шкала СЭС – среднее по пунктам чек-листа. */
export function sesScore(state: GameState, cfg: GameConfig, known = false): number {
  const items = checklist(cfg);
  return Math.round(items.reduce((a, i) => a + itemScore(state, cfg, i.id, known), 0) / items.length);
}

/** Вечер: чистота падает каждый день. */
export function decayCleanliness(state: GameState, cfg: GameConfig): void {
  const c = cfg.balance.compliance;
  let decay = c.decayPerDay + (state.defect ? c.dampExtraDecay : 0);
  if (hasCleaner(state)) decay /= c.cleanerDivider;
  state.cleanliness = clamp(round2(state.cleanliness - decay), 0, 100);
}

export function scheduleInspection(
  state: GameState,
  cfg: GameConfig,
  reason: Inspection['reason'],
  visitDay: number,
  noticeDays: number,
  fineMultiplier = 1,
): Inspection {
  const insp: Inspection = {
    id: state.nextId++,
    agency: 'ses',
    inspectorId: pickInspectorId(state, cfg),
    reason,
    noticeDay: visitDay - noticeDays,
    visitDay,
    fineMultiplier,
    consultant: false,
  };
  state.inspections.push(insp);
  return insp;
}

/** Вечер: фоновый шанс внеплановой проверки, если шкала ниже порога. */
export function rollUnplanned(state: GameState, cfg: GameConfig): void {
  const c = cfg.balance.compliance;
  const d = cfg.balance.difficulties[state.options.difficulty];
  if (state.inspections.some((i) => i.reason !== 'planned')) return;
  if (sesScore(state, cfg) >= c.unplannedThreshold) return;
  if (nextRandom(state) >= c.unplannedDailyChance * d.unplannedMultiplier) return;
  // state.day уже указывает на завтра
  scheduleInspection(state, cfg, 'unplanned', state.day + d.unplannedNoticeDays, d.unplannedNoticeDays);
  if (d.unplannedNoticeDays > 0) say(state, cfg, 'inspectionScheduled', 'warn');
}

/** Шанс нарушения по живому пункту: p = (100 − шкала) / 100 · k. */
export function violationChance(score: number, inspector: Inspector, item: ChecklistItem): number {
  let k = inspector.k;
  if ((inspector.focus === 'docs' && item.docs) || inspector.focus === item.id) k *= inspector.focusFactor;
  return clamp(((100 - score) / 100) * k, 0, 1);
}

/** Визит: инспектор проходит чек-лист. Результат ждёт решения игрока. */
export function rollVisit(state: GameState, cfg: GameConfig, insp: Inspection): Pending {
  const inspector = inspectorById(cfg, insp.inspectorId);
  const results: VisitResult[] = [];
  let totalFine = 0;
  let suspensionDays = 0;
  for (const item of checklist(cfg)) {
    const score = itemScore(state, cfg, item.id);
    let violated: boolean;
    let count = 1;
    if (item.type === 'live') violated = nextRandom(state) < violationChance(score, inspector, item);
    else violated = score < 100;
    if (item.id === 'medbooks') count = Math.max(1, withoutMedBook(state));
    const fine = violated ? round2(item.fine * count * insp.fineMultiplier) : 0;
    const susp = violated ? item.suspensionDays : 0;
    results.push({ itemId: item.id, violated, fine, suspensionDays: susp, count: violated ? count : 0 });
    totalFine += fine;
    suspensionDays = Math.max(suspensionDays, susp);
  }
  state.stats.inspections++;
  return { kind: 'inspectionVisit', inspectorId: insp.inspectorId, reason: insp.reason, results, totalFine: round2(totalFine), suspensionDays };
}

/** Утро следующего дня: уведомления и визиты. state.day уже указывает на новый день. */
export function morningInspections(state: GameState, cfg: GameConfig): void {
  const today = state.day;
  const stay: Inspection[] = [];
  for (const insp of state.inspections) {
    if (insp.visitDay <= today) {
      state.pending.push(rollVisit(state, cfg, insp));
      continue;
    }
    if (insp.noticeDay === today) state.pending.push({ kind: 'inspectionNotice', inspectionId: insp.id });
    stay.push(insp);
  }
  state.inspections = stay;
}

/** Шанс отменить акт через юриста: выше, если по бумагам нарушений нет. */
export function contestChance(cfg: GameConfig, results: VisitResult[]): number {
  const c = cfg.inspections.ses.contest;
  const docsViolated = results.some((r) => r.violated && checklist(cfg).find((i) => i.id === r.itemId)?.docs);
  return docsViolated ? c.baseChance : c.cleanDocsChance;
}

function applyAct(state: GameState, cfg: GameConfig, visit: Extract<Pending, { kind: 'inspectionVisit' }>): void {
  const ses = cfg.inspections.ses;
  spend(state, 'fines', visit.totalFine);
  state.stats.fines = round2(state.stats.fines + visit.totalFine);
  if (visit.suspensionDays > 0) {
    state.suspendedUntilDay = Math.max(state.suspendedUntilDay, state.day + visit.suspensionDays - 1);
    say(state, cfg, 'suspended', 'bad', { n: visit.suspensionDays });
  }
  const visitDay = state.day + ses.reinspectAfterDays;
  if (visitDay <= cfg.balance.time.daysPerMonth * cfg.balance.time.monthsPerYear) {
    scheduleInspection(state, cfg, 'repeat', visitDay, ses.noticeDays, ses.reinspectFineMultiplier);
  }
}

/** Решение игрока по акту: принять, оспорить или «договориться». */
export function resolveVisit(state: GameState, cfg: GameConfig, choice: 'accept' | 'contest' | 'bribe'): boolean {
  const visit = state.pending[0];
  if (!visit || visit.kind !== 'inspectionVisit' || visit.totalFine <= 0) return false;
  const ses = cfg.inspections.ses;
  state.pending.shift();
  if (choice === 'accept') {
    applyAct(state, cfg, visit);
    say(state, cfg, 'inspectionAccepted', 'bad', { amount: usd(visit.totalFine) });
  } else if (choice === 'contest') {
    state.stats.contests++;
    spend(state, 'services', cfg.balance.costs.lawyer);
    if (nextRandom(state) < contestChance(cfg, visit.results)) {
      say(state, cfg, 'contestWon', 'ok');
    } else {
      applyAct(state, cfg, visit);
      say(state, cfg, 'contestLost', 'bad', { amount: usd(visit.totalFine) });
    }
  } else {
    state.stats.bribes++;
    if (nextRandom(state) < ses.bribe.caughtChance) {
      state.finished = true;
      state.outcome = 'criminal';
      state.pending = [];
    } else {
      const cost = round2(visit.totalFine * ses.bribe.costShare);
      spend(state, 'fines', cost);
      say(state, cfg, 'bribeOk', 'warn', { amount: usd(cost) });
    }
  }
  return true;
}
