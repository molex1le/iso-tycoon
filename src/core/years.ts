import { AGENCIES, round2, totalDays, type GameConfig } from './config';
import { say } from './feed';
import { computeScore } from './finance';
import { scheduleInspection } from './inspections';
import type { GameState } from './state';

/** После прожитого года можно играть дальше: аренда дорожает, плановые проверки идут по новому кругу. */
export function continueYear(state: GameState, cfg: GameConfig): boolean {
  if (!state.finished || state.outcome !== 'year') return false;
  const b = cfg.balance;
  (state.yearScores ??= []).push(computeScore(state, cfg).total);
  state.years = (state.years ?? 1) + 1;
  state.finished = false;
  state.outcome = null;
  state.rentFactor = round2(state.rentFactor * b.years.rentGrowth);
  const offset = totalDays(b) * (state.years - 1);
  for (const agency of AGENCIES) {
    const a = cfg.inspections[agency];
    scheduleInspection(state, cfg, agency, 'planned', offset + a.plannedDay, a.noticeDays, 1, 'План по графику');
  }
  say(state, cfg, 'newYear', 'info', { n: state.years, pct: `${Math.round((b.years.rentGrowth - 1) * 100)}%` });
  return true;
}
