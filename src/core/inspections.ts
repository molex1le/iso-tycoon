import { AGENCIES, clamp, round2, totalDays, type AgencyId, type ChecklistItem, type GameConfig, type Inspector } from './config';
import { say, usd } from './feed';
import { spend } from './finance';
import { nextRandom } from './rng';
import { hasCleaner, hoursPerWeek } from './shop';
import { pickInspectorId, type GameState, type Inspection, type InspectorMemory, type Pending, type VisitResult } from './state';

export type Reply = 'explain' | 'admit' | 'argue';
type Visit = Extract<Pending, { kind: 'inspectionVisit' }>;

export function checklist(cfg: GameConfig, agency: AgencyId = 'ses'): ChecklistItem[] {
  return cfg.inspections[agency].items as ChecklistItem[];
}

export function inspectorById(cfg: GameConfig, id: string): Inspector {
  return cfg.inspectors.find((i) => i.id === id) ?? cfg.inspectors[0];
}

function withoutMedBook(state: GameState): number {
  return state.employees.filter((e) => !e.hasMedBook).length;
}

function envelopeCount(state: GameState): number {
  return state.employees.filter((e) => !e.official).length;
}

function belowMinWage(state: GameState, cfg: GameConfig): number {
  return state.employees.filter((e) => e.salary < cfg.balance.staff.minWage).length;
}

function defectScore(state: GameState, type: GameState['defectType'], known: boolean): number {
  return state.defect && state.defectType === type && (!known || state.defectKnown) ? 0 : 100;
}

/**
 * Шкала пункта 0–100. known = true – то, что видит игрок (скрытое не показывается, пока не найдено).
 */
export function itemScore(state: GameState, cfg: GameConfig, itemId: string, known = false): number {
  const c = cfg.balance.compliance;
  const has = (id: GameState['equipment'][number]) => state.equipment.includes(id);
  switch (itemId) {
    case 'cleanliness':
      return state.cleanliness;
    case 'fridge':
      return has('fridge') ? 100 : 0;
    case 'medbooks':
      return state.employees.length ? Math.round((1 - withoutMedBook(state) / state.employees.length) * 100) : 100;
    case 'expired':
      return Object.values(state.inventory).some((l) => l.some((x) => x.expiresDay < state.day && x.qty >= 1)) ? 0 : 100;
    case 'supplierDocs':
      return Math.round(cfg.balance.suppliers[state.supplier].documents * 100);
    case 'damp':
    case 'wiring':
    case 'exit':
      return defectScore(state, itemId, known);
    case 'extinguishers':
      return has('extinguishers') ? 100 : 0;
    case 'alarm':
      return has('alarm') ? 100 : 0;
    case 'evacPlan':
      return has('evacPlan') ? 100 : 0;
    case 'fireCondition':
      return clamp(c.fireBase + (has('extinguishers') ? c.fireExtinguishers : 0) + (has('alarm') ? c.fireAlarm : 0) + (state.options.repair === 'full' ? c.fireFullRepair : 0), 0, 100);
    case 'officialStaff':
      return clamp(100 - envelopeCount(state) * c.labourPerEnvelope, 0, 100);
    case 'overtime': {
      const norm = cfg.balance.staff.weeklyNormHours;
      return clamp(Math.round(100 - (Math.max(0, hoursPerWeek(state, cfg) - norm) / norm) * 200), 0, 100);
    }
    case 'minWage':
      return belowMinWage(state, cfg) ? 0 : 100;
    case 'register':
      return has('register') ? 100 : 0;
    case 'deadlines':
      return clamp(100 - state.tax.lateCount * cfg.balance.taxes.lateScorePenalty, 0, 100);
    case 'returns':
      return known ? 100 : state.tax.hiddenError > 0 ? 0 : 100;
    case 'offbook':
      return clamp(Math.round(100 - (state.offbookShare / cfg.balance.grey.offbookMax) * 90), 0, 100);
    case 'expenseDocs':
      return state.options.taxRegime === 'profit15' ? Math.round(cfg.balance.suppliers[state.supplier].documents * 100) : 100;
    default:
      return 100;
  }
}

/** Общая шкала ведомства – среднее по пунктам чек-листа. */
export function agencyScore(state: GameState, cfg: GameConfig, agency: AgencyId, known = false): number {
  const items = checklist(cfg, agency);
  return Math.round(items.reduce((a, i) => a + itemScore(state, cfg, i.id, known), 0) / items.length);
}

export function sesScore(state: GameState, cfg: GameConfig, known = false): number {
  return agencyScore(state, cfg, 'ses', known);
}

/** Вечер: чистота падает каждый день. */
export function decayCleanliness(state: GameState, cfg: GameConfig): void {
  const c = cfg.balance.compliance;
  let decay = c.decayPerDay + (state.defect && state.defectType === 'damp' ? c.dampExtraDecay : 0);
  if (hasCleaner(state)) decay /= c.cleanerDivider;
  state.cleanliness = clamp(round2(state.cleanliness - decay), 0, 100);
}

export function scheduleInspection(
  state: GameState,
  cfg: GameConfig,
  agency: AgencyId,
  reason: Inspection['reason'],
  visitDay: number,
  noticeDays: number,
  fineMultiplier = 1,
  cause = '',
): Inspection {
  const insp: Inspection = {
    id: state.nextId++,
    agency,
    inspectorId: reason === 'repeat' && state.lastInspector?.[agency] ? state.lastInspector[agency]! : pickInspectorId(state, cfg, agency),
    reason,
    cause,
    noticeDay: visitDay - noticeDays,
    visitDay,
    fineMultiplier,
    consultant: false,
  };
  state.inspections.push(insp);
  return insp;
}

/** Внеплановая по конкретной причине: жалоба, сигнал, донос. */
export function triggerUnplanned(state: GameState, cfg: GameConfig, agency: AgencyId, cause: string): boolean {
  if (state.inspections.some((i) => i.agency === agency && i.reason === 'unplanned')) return false;
  const d = cfg.balance.difficulties[state.options.difficulty];
  scheduleInspection(state, cfg, agency, 'unplanned', state.day + Math.max(1, d.unplannedNoticeDays), d.unplannedNoticeDays, 1, cause);
  if (d.unplannedNoticeDays > 0) say(state, cfg, 'inspectionScheduled', 'warn', { agency: cfg.inspections[agency].name, reason: cause });
  return true;
}

/** Вечер: фоновый шанс внеплановой проверки, если шкала ниже порога. */
export function rollUnplanned(state: GameState, cfg: GameConfig): void {
  const c = cfg.balance.compliance;
  const d = cfg.balance.difficulties[state.options.difficulty];
  for (const agency of AGENCIES) {
    if (agencyScore(state, cfg, agency) >= c.unplannedThreshold) continue;
    if (nextRandom(state) >= c.unplannedDailyChance * d.unplannedMultiplier) continue;
    triggerUnplanned(state, cfg, agency, 'Низкий уровень соответствия');
  }
}

/** Шанс нарушения по живому пункту: p = (100 − шкала) / 100 · k. */
export function violationChance(score: number, inspector: Inspector, item: ChecklistItem): number {
  let k = inspector.k;
  if ((inspector.focus === 'docs' && item.docs) || inspector.focus === item.id) k *= inspector.focusFactor;
  return clamp(((100 - score) / 100) * k, 0, 1);
}

/** Доначисление по пункту налоговой/трудовой сверх базового штрафа. */
function extraFine(state: GameState, cfg: GameConfig, itemId: string): number {
  const b = cfg.balance;
  if (itemId === 'returns') return round2(state.tax.hiddenError * (1 + b.taxes.errorFine));
  if (itemId === 'offbook') {
    const regime = b.taxes.regimes[state.options.taxRegime];
    return round2(state.offbookTotal * regime.rate);
  }
  if (itemId === 'officialStaff') {
    const months = b.staff.backPayMonthsCap;
    return round2(
      state.employees.filter((e) => !e.official).reduce((a, e) => a + e.salary * b.staff.contributions * Math.min(months, (state.day - e.hiredDay) / b.time.daysPerMonth), 0),
    );
  }
  return 0;
}

/** Визит: инспектор проходит чек-лист. Результат ждёт решения игрока. */
export function rollVisit(state: GameState, cfg: GameConfig, insp: Inspection): Pending {
  const inspector = inspectorById(cfg, insp.inspectorId);
  const results: VisitResult[] = [];
  let totalFine = 0;
  let suspensionDays = 0;
  for (const item of checklist(cfg, insp.agency)) {
    const score = itemScore(state, cfg, item.id);
    let violated: boolean;
    let count = 1;
    if (item.type === 'live') violated = nextRandom(state) < violationChance(score, inspector, item);
    else violated = score < 100;
    if (item.id === 'medbooks') count = Math.max(1, withoutMedBook(state));
    if (item.id === 'officialStaff') count = Math.max(1, envelopeCount(state));
    if (item.id === 'minWage') count = Math.max(1, belowMinWage(state, cfg));
    const fine = violated ? round2((item.fine * count + extraFine(state, cfg, item.id)) * insp.fineMultiplier) : 0;
    const susp = violated ? item.suspensionDays : 0;
    results.push({ itemId: item.id, violated, fine, suspensionDays: susp, count: violated ? count : 0 });
    totalFine += fine;
    suspensionDays = Math.max(suspensionDays, susp);
  }
  state.stats.inspections++;
  return { kind: 'inspectionVisit', agency: insp.agency, inspectorId: insp.inspectorId, reason: insp.reason, results, totalFine: round2(totalFine), suspensionDays };
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
export function contestChance(cfg: GameConfig, results: VisitResult[], agency: AgencyId = 'ses'): number {
  const c = cfg.inspections[agency].contest;
  const docsViolated = results.some((r) => r.violated && checklist(cfg, agency).find((i) => i.id === r.itemId)?.docs);
  return docsViolated ? c.baseChance : c.cleanDocsChance;
}

function endCriminal(state: GameState): void {
  state.finished = true;
  state.outcome = 'criminal';
  state.pending = [];
}

function applyAct(state: GameState, cfg: GameConfig, visit: Visit): void {
  const a = cfg.inspections[visit.agency];
  (state.lastInspector ??= {})[visit.agency] = visit.inspectorId;
  spend(state, 'fines', visit.totalFine);
  state.stats.fines = round2(state.stats.fines + visit.totalFine);
  if (visit.suspensionDays > 0) {
    state.suspendedUntilDay = Math.max(state.suspendedUntilDay, state.day + visit.suspensionDays - 1);
    say(state, cfg, 'suspended', 'bad', { n: visit.suspensionDays });
  }
  const violated = (id: string) => visit.results.some((r) => r.itemId === id && r.violated);
  if (violated('returns')) state.tax.hiddenError = 0;
  if (violated('officialStaff')) {
    triggerUnplanned(state, cfg, 'tax', 'Сигнал из инспекции труда');
    say(state, cfg, 'signal', 'warn', { agency: cfg.inspections.tax.name });
  }
  if (violated('offbook')) {
    state.stats.offbookCaught++;
    if (state.offbookTotal > cfg.balance.grey.criminalOffbook) return endCriminal(state);
    state.offbookTotal = 0;
  }
  const visitDay = state.day + a.reinspectAfterDays;
  if (visitDay <= totalDays(cfg.balance)) {
    scheduleInspection(state, cfg, visit.agency, 'repeat', visitDay, a.noticeDays, a.reinspectFineMultiplier, 'Проверка исполнения предписания');
  }
}

function memoryOf(state: GameState, inspectorId: string): InspectorMemory {
  const all = (state.inspectorMemory ??= {});
  return (all[inspectorId] ??= { bribes: 0, admits: 0, argues: 0 });
}

/** Индекс нарушения, по которому ещё не ответили; -1 – разговор окончен. */
export function nextQuestion(visit: Visit): number {
  return visit.results.findIndex((r) => r.violated && r.fine > 0 && !r.reply);
}

/** Чем инспектор встречает директора, если уже знаком. */
export function memoryLine(state: GameState, cfg: GameConfig, inspectorId: string): string {
  const m = state.inspectorMemory?.[inspectorId];
  if (!m) return '';
  if (m.bribes > 0) return cfg.dialogues.memory.bribe;
  if (m.argues > m.admits) return cfg.dialogues.memory.argue;
  return m.admits > 0 ? cfg.dialogues.memory.admit : '';
}

/** Шанс, что ответ сработает. Спор опирается на настоящую готовность по пункту. */
export function replyChance(state: GameState, cfg: GameConfig, visit: Visit, index: number, reply: Reply): number {
  const d = cfg.balance.dialogue;
  if (reply === 'admit') return 1;
  const inspector = inspectorById(cfg, visit.inspectorId);
  const trait = d.traits[inspector.trait as keyof typeof d.traits];
  const m = state.inspectorMemory?.[visit.inspectorId];
  if (reply === 'explain') return clamp(trait.explain + (m && m.admits > 0 ? d.memory.admitBonus : 0) - (m && m.argues > 0 ? d.memory.arguePenalty : 0), 0, 1);
  const score = itemScore(state, cfg, visit.results[index].itemId, true);
  return clamp(trait.argue + (score >= d.argueScoreHigh ? d.argueHighBonus : score <= d.argueScoreLow ? -d.argueLowPenalty : 0), 0, 1);
}

/** Ответ инспектору по одному нарушению. Меняет сумму акта. */
export function answerInspector(state: GameState, cfg: GameConfig, reply: Reply): boolean {
  const visit = state.pending[0];
  if (!visit || visit.kind !== 'inspectionVisit') return false;
  const i = nextQuestion(visit);
  if (i < 0) return false;
  const d = cfg.balance.dialogue;
  const r = visit.results[i];
  const memory = memoryOf(state, visit.inspectorId);
  const serious = (d.serious as string[]).includes(r.itemId);
  r.reply = reply;
  if (reply === 'admit') {
    r.fine = round2(r.fine * d.admitFactor);
    r.replyLine = 'admit';
    memory.admits++;
  } else {
    const ok = nextRandom(state) < replyChance(state, cfg, visit, i, reply);
    if (ok && serious) {
      r.fine = round2(r.fine * d.seriousFactor);
      r.replyLine = reply === 'explain' ? 'explainSoft' : 'argueSoft';
    } else if (ok) {
      r.fine = 0;
      r.violated = false;
      r.suspensionDays = 0;
      r.replyLine = reply === 'explain' ? 'explainOk' : 'argueOk';
    } else if (reply === 'explain') {
      r.replyLine = 'explainFail';
    } else {
      r.fine = round2(r.fine * d.argueFailFactor);
      r.replyLine = 'argueFail';
      memory.argues++;
    }
  }
  visit.totalFine = round2(visit.results.reduce((a, x) => a + x.fine, 0));
  visit.suspensionDays = Math.max(0, ...visit.results.map((x) => x.suspensionDays));
  return true;
}

/** Цена «договориться»: кто уже брал, тот берёт дороже. */
export function bribeCost(state: GameState, cfg: GameConfig, visit: Visit): number {
  const base = visit.totalFine * cfg.inspections[visit.agency].bribe.costShare;
  return round2(state.inspectorMemory?.[visit.inspectorId]?.bribes ? base * cfg.balance.dialogue.memory.bribeCostFactor : base);
}

/** Решение игрока по акту: принять, оспорить или «договориться». */
export function resolveVisit(state: GameState, cfg: GameConfig, choice: 'accept' | 'contest' | 'bribe'): boolean {
  const visit = state.pending[0];
  if (!visit || visit.kind !== 'inspectionVisit' || visit.totalFine <= 0) return false;
  const a = cfg.inspections[visit.agency];
  state.pending.shift();
  if (choice === 'accept') {
    applyAct(state, cfg, visit);
    say(state, cfg, 'inspectionAccepted', 'bad', { amount: usd(visit.totalFine) });
  } else if (choice === 'contest') {
    state.stats.contests++;
    spend(state, 'services', cfg.balance.costs.lawyer);
    if (nextRandom(state) < contestChance(cfg, visit.results, visit.agency)) {
      say(state, cfg, 'contestWon', 'ok');
    } else {
      applyAct(state, cfg, visit);
      say(state, cfg, 'contestLost', 'bad', { amount: usd(visit.totalFine) });
    }
  } else {
    state.stats.bribes++;
    if (nextRandom(state) < a.bribe.caughtChance) {
      endCriminal(state);
    } else {
      const cost = bribeCost(state, cfg, visit);
      spend(state, 'fines', cost);
      memoryOf(state, visit.inspectorId).bribes++;
      say(state, cfg, 'bribeOk', 'warn', { amount: usd(cost) });
    }
  }
  return true;
}
