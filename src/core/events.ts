import { monthOf } from './calendar';
import { clamp, round2, type EventDef, type EventFx, type EventOption, type GameConfig } from './config';
import { say } from './feed';
import { spend } from './finance';
import { triggerUnplanned } from './inspections';
import { expectedDailyUsage } from './inventory';
import { nextRandom } from './rng';
import { baristas, demandView, machineOrdersPerHour } from './shop';
import { loyaltyOf, traitOf } from './staff';
import type { Employee, GameState, Pending } from './state';

type EventPending = Extract<Pending, { kind: 'event' }>;

export function eventById(cfg: GameConfig, id: string): EventDef {
  const e = cfg.events.find((x) => x.id === id);
  if (!e) throw new Error(`Нет события ${id}`);
  return e;
}

export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function pickReview(state: GameState, cfg: GameConfig, kind: string): string {
  const list = cfg.reviews[kind];
  return list[Math.floor(nextRandom(state) * list.length)];
}

/** Подходящий сотрудник для события; undefined – условие не выполнено. */
function findTarget(state: GameState, cfg: GameConfig, w: EventDef['when']): Employee | undefined {
  return state.employees.find(
    (e) =>
      (w.role === undefined || e.role === w.role) &&
      (w.fatigueAbove === undefined || e.fatigue >= w.fatigueAbove) &&
      (w.loyaltyBelow === undefined || loyaltyOf(e, cfg) < w.loyaltyBelow) &&
      (w.loyaltyAbove === undefined || loyaltyOf(e, cfg) > w.loyaltyAbove) &&
      (w.minTenure === undefined || state.day - e.hiredDay >= w.minTenure) &&
      (w.trait === undefined || traitOf(e, cfg).id === w.trait) &&
      (!w.promiseDue || (e.promiseDay !== undefined && state.day >= e.promiseDay)) &&
      (w.envelopeStaff === undefined || !e.official),
  );
}

function conditionOk(state: GameState, cfg: GameConfig, e: EventDef): boolean {
  const w = e.when;
  const b = cfg.balance;
  const last = state.eventLog[e.id];
  if (w.trigger) return false;
  if (w.once && last !== undefined) return false;
  if (w.cooldown !== undefined && last !== undefined && state.day - last < w.cooldown) return false;
  if (w.minMonth !== undefined && monthOf(Math.min(state.day, 360), b) < w.minMonth) return false;
  if (w.form !== undefined && state.options.form !== w.form) return false;
  if (w.hasMachine && (machineOrdersPerHour(state, cfg) === 0 || state.day <= state.machineDownUntilDay)) return false;
  if (w.cleanBelow !== undefined && state.cleanliness >= w.cleanBelow) return false;
  if (w.repBelow !== undefined && state.reputation >= w.repBelow) return false;
  if (w.announced && !state.inspections.some((i) => i.noticeDay <= state.day)) return false;
  if (w.lateWriteOff && !state.lateWriteOff) return false;
  if (w.shareAbove === 'dirty' && demandView(state, cfg).share < b.competition.dirtyFrom[state.options.difficulty]) return false;
  return true;
}

function dailyChance(state: GameState, cfg: GameConfig, e: EventDef): number {
  const w = e.when;
  let p = w.dailyChance ?? (w.weeklyChance !== undefined ? 1 - Math.pow(1 - w.weeklyChance, 1 / 7) : 0);
  if (e.id === 'machine_break') {
    if (state.equipment.includes('machinePro')) p /= 2;
    if (state.serviceContract) p *= cfg.balance.marketing.serviceContract.breakFactor;
  }
  return p;
}

function push(state: GameState, e: EventDef, target: Employee | undefined, vars: Record<string, string> = {}): void {
  state.eventLog[e.id] = state.day;
  state.lastEventDay = state.day;
  state.pending.push({ kind: 'event', eventId: e.id, targetId: target?.id ?? null, vars: { ...vars, name: target?.name ?? '' } });
}

/** Внешний повод, например, срыв поставки. */
export function fireTriggered(state: GameState, cfg: GameConfig, trigger: string): void {
  const e = cfg.events.find((x) => x.when.trigger === trigger);
  if (e) push(state, e, undefined);
}

/** Утро: бросок на случайное событие. Не чаще одного за minGapDays. */
export function rollEvents(state: GameState, cfg: GameConfig): void {
  if (state.pending.some((p) => p.kind === 'event')) return;
  if (state.day - state.lastEventDay < cfg.balance.eventRules.minGapDays && state.lastEventDay > 0) return;
  for (const e of cfg.events) {
    if (!conditionOk(state, cfg, e)) continue;
    let target: Employee | undefined;
    if (e.when.target) {
      target = findTarget(state, cfg, e.when);
      if (!target) continue;
    }
    if (nextRandom(state) >= dailyChance(state, cfg, e)) continue;
    const vars: Record<string, string> = {};
    if (e.id === 'bad_review') vars.review = pickReview(state, cfg, weakestPart(state, cfg));
    push(state, e, target, vars);
    return;
  }
}

function applyFx(state: GameState, cfg: GameConfig, fx: EventFx, target: Employee | undefined): void {
  const day = state.day;
  if (fx.cash) {
    if (fx.cash < 0) spend(state, 'services', -fx.cash);
    else state.cash = round2(state.cash + fx.cash);
  }
  if (fx.awareness) state.awareness = clamp(round2(state.awareness + fx.awareness), 0, cfg.balance.awareness.max);
  if (fx.reputation) state.reputation = clamp(round2(state.reputation + fx.reputation), 1, 5);
  if (fx.cleanliness) state.cleanliness = clamp(state.cleanliness + fx.cleanliness, 0, 100);
  if (fx.closeDays) state.closedUntilDay = Math.max(state.closedUntilDay, day + fx.closeDays - 1);
  if (fx.machineDownDays) state.machineDownUntilDay = Math.max(state.machineDownUntilDay, day + (state.serviceContract ? 1 : fx.machineDownDays) - 1);
  if (fx.flow) state.flowMods.push({ factor: fx.flow.factor, untilDay: day + fx.flow.days - 1 });
  if (fx.materialCost) state.costMods.push({ factor: fx.materialCost.factor, untilDay: day + fx.materialCost.days - 1 });
  if (fx.rentFactor) state.rentFactor = round2(state.rentFactor * fx.rentFactor);
  if (fx.taxRateDelta) state.tax.rateDelta = round2(state.tax.rateDelta + fx.taxRateDelta);
  if (fx.contractWeeks) state.contractWeeks = fx.contractWeeks;
  if (fx.fatigueAll) for (const e of baristas(state)) e.fatigue = clamp(e.fatigue + fx.fatigueAll, 0, 100);
  if (fx.loyaltyAll) for (const e of state.employees) e.loyaltyBonus += fx.loyaltyAll;
  if (fx.skipInspection) {
    const i = state.inspections.find((x) => x.noticeDay <= day);
    if (i) i.visitDay += 30;
  }
  if (fx.inspect) triggerUnplanned(state, cfg, fx.inspect, 'Жалоба клиента');
  if (fx.retailMilk) {
    const m = cfg.materials.find((x) => x.id === 'milk')!;
    const qty = Math.ceil(expectedDailyUsage(state, cfg).milk * m.deliveryEveryDays);
    const unitCost = round2(m.cost * 1.8);
    state.inventory.milk.push({ qty, expiresDay: day + m.shelfLifeDays - 1, unitCost });
    spend(state, 'purchases', qty * unitCost, 0);
  }
  if (target) {
    if (fx.fatigueTarget) target.fatigue = clamp(target.fatigue + fx.fatigueTarget, 0, 100);
    if (fx.loyaltyTarget) target.loyaltyBonus += fx.loyaltyTarget;
    if (fx.raiseTarget) {
      target.salary = Math.round(target.salary * (1 + fx.raiseTarget));
      delete target.promiseDay;
    }
    if (fx.promiseTarget) target.promiseDay = day + fx.promiseTarget;
    if (fx.clearPromise) delete target.promiseDay;
    if (fx.rivalTarget) {
      const rival = state.competitors.find((c) => c.id !== 'coffeemarket' && c.closedUntilDay === 0) ?? state.competitors[0];
      rival.quality = clamp(round2(rival.quality + 0.05), 0, cfg.balance.competition.qualityMax);
      say(state, cfg, 'joinedRival', 'warn', { name: target.name, rival: rival.name });
    }
    if (fx.officializeTarget) target.official = true;
    if (fx.leaveTarget) state.employees = state.employees.filter((e) => e.id !== target.id);
  }
}

export function optionCost(state: GameState, o: EventOption): number {
  return (o.cost ?? 0) + (o.costPerHead ?? 0) * state.employees.length;
}

/** Выбор игрока в карточке события. */
export function chooseOption(state: GameState, cfg: GameConfig, index: number): boolean {
  const p = state.pending[0];
  if (!p || p.kind !== 'event') return false;
  const e = eventById(cfg, p.eventId);
  const o = e.options[index];
  if (!o) return false;
  state.pending.shift();
  const target = state.employees.find((x) => x.id === (p as EventPending).targetId);
  spend(state, 'services', optionCost(state, o));
  let fx = o.fx;
  if (o.chance !== undefined) {
    const g = cfg.balance.loans.grades;
    const chance = o.chance === 'grade' ? 0.8 - g.indexOf(state.grade) * 0.15 : o.chance;
    const ok = nextRandom(state) < chance;
    if (!ok) fx = o.fxFail ?? {};
    say(state, cfg, 'eventResult', ok ? 'ok' : 'bad', { title: fillVars(e.title, p.vars), text: (ok ? o.okText : o.failText) ?? '' });
  }
  applyFx(state, cfg, fx, target);
  return true;
}

/** Какая часть впечатления сейчас самая слабая – о ней и пишут. */
export function weakestPart(state: GameState, cfg: GameConfig): string {
  const b = cfg.balance;
  const last = state.history[state.history.length - 1];
  const v = demandView(state, cfg);
  const parts: [string, number][] = [
    ['queue', last && last.demand > 0 ? 1 - (last.lostQueue + last.lostStock) / last.demand : 1],
    ['price', clamp(1.5 - v.check / b.demand.marketCheck, 0, 1)],
    ['quality', (v.quality - b.quality.min) / (b.quality.max - b.quality.min)],
    ['cleanliness', state.cleanliness / 100],
  ];
  parts.sort((x, y) => x[1] - y[1]);
  return parts[0][1] >= 0.75 ? 'good' : parts[0][0];
}

/** Раз в неделю – новый отзыв по самой слабой части. */
export function writeReview(state: GameState, cfg: GameConfig): void {
  const kind = weakestPart(state, cfg);
  state.reviews.push({ day: state.day, stars: kind === 'good' ? 5 : Math.max(1, Math.round(state.reputation) - 1), text: pickReview(state, cfg, kind) });
  if (state.reviews.length > 12) state.reviews.shift();
}
