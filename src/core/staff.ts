import { clamp, round2, type GameConfig } from './config';
import { say } from './feed';
import { nextRandom } from './rng';
import { baristas, hoursOf, syncShifts, weekdayOf, worksOn } from './shop';
import type { Employee, GameState } from './state';

/** Лояльность 0–100: оформление, зарплата против рынка, усталость, события. */
export function loyaltyOf(e: Employee, cfg: GameConfig): number {
  const s = cfg.balance.staff;
  return Math.round(
    clamp(
      s.loyaltyBase + (e.official ? s.loyaltyOfficial : s.loyaltyEnvelope) + (e.salary - s.marketSalary) * s.loyaltyPerSalary - e.fatigue * s.loyaltyPerFatigue + e.loyaltyBonus,
      0,
      100,
    ),
  );
}

/** Характер сотрудника: постоянен и не требует хранения. */
export function traitOf(e: Employee, cfg: GameConfig): { id: string; name: string; text: string } {
  const list = cfg.balance.staffStories.traits;
  return list[e.id % list.length];
}

/** Утро: готовые медкнижки. */
export function finishMedBooks(state: GameState, cfg: GameConfig): void {
  for (const e of state.employees) {
    if (e.medBookReadyDay !== null && state.day >= e.medBookReadyDay) {
      e.hasMedBook = true;
      e.medBookReadyDay = null;
      say(state, cfg, 'medBookReady', 'ok', { name: e.name });
    }
  }
}

/** Вечер: усталость, сверхурочные, увольнения по собственному. */
export function updateStaffDay(state: GameState, cfg: GameConfig, open: boolean): void {
  const s = cfg.balance.staff;
  const f = s.fatigue;
  const t = cfg.balance.time;
  const hourly = 1 / (s.shiftsPerMonthNorm * (t.closeHour - t.openHour));
  const weekday = weekdayOf(state.day);
  const quitters: number[] = [];
  for (const e of baristas(state)) {
    // смена по графику оплачивается, даже если кофейня сегодня стояла
    if (worksOn(e, weekday)) e.shiftsWorked = (e.shiftsWorked ?? 0) + 1;
    const overtime = open ? Math.max(0, hoursOf(e, cfg) - s.weeklyNormHours) : 0;
    if (overtime > 0) {
      e.fatigue = clamp(round2(e.fatigue + overtime * f.perOvertimeHour), 0, 100);
      // сама смена уже оплачена по ставке, сверху – доплата за переработку
      state.overtimeAccrued = round2(state.overtimeAccrued + (overtime / 7) * e.salary * hourly * (s.overtimeMultiplier - 1));
    } else {
      e.fatigue = clamp(round2(e.fatigue - f.restPerDay), 0, 100);
    }
    if (e.fatigue >= f.exhausted && nextRandom(state) < f.quitChance) quitters.push(e.id);
  }
  for (const id of quitters) {
    const e = state.employees.find((x) => x.id === id)!;
    state.employees = state.employees.filter((x) => x.id !== id);
    say(state, cfg, 'quit', 'bad', { name: e.name });
  }
  if (quitters.length) syncShifts(state);
}

/** Сколько сотрудник заработал за смены с начала месяца (уборщица – на окладе). */
export function earnedSoFar(e: Employee, cfg: GameConfig): number {
  if (e.role !== 'barista') return e.salary;
  return round2((e.salary * (e.shiftsWorked ?? 0)) / cfg.balance.staff.shiftsPerMonthNorm);
}

/** Ставка за одну смену. */
export function shiftRate(e: Employee, cfg: GameConfig): number {
  return round2(e.salary / cfg.balance.staff.shiftsPerMonthNorm);
}

export type Mood = 'happy' | 'ok' | 'unhappy' | 'leaving';

/** Настроение одним словом: из лояльности, в которой уже учтены зарплата, оформление и усталость. */
export function moodOf(e: Employee, cfg: GameConfig): Mood {
  const l = loyaltyOf(e, cfg);
  if (l >= 70) return 'happy';
  if (l >= 45) return 'ok';
  if (l >= cfg.balance.staff.poachBelow) return 'unhappy';
  return 'leaving';
}
