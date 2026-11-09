import { clamp, round2, type GameConfig } from './config';
import { say } from './feed';
import { nextRandom } from './rng';
import { baristas, hoursPerWeek } from './shop';
import type { GameState } from './state';

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
  const hours = open ? hoursPerWeek(state, cfg) : 0;
  const overtime = Math.max(0, hours - s.weeklyNormHours);
  const normHoursPerMonth = (s.weeklyNormHours * t.daysPerMonth) / 7;
  const quitters: number[] = [];
  for (const e of baristas(state)) {
    if (overtime > 0) {
      e.fatigue = clamp(round2(e.fatigue + overtime * f.perOvertimeHour), 0, 100);
      state.overtimeAccrued = round2(state.overtimeAccrued + (overtime / 7) * (e.salary / normHoursPerMonth) * s.overtimeMultiplier);
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
}
