import { clamp, round2, type GameConfig } from './config';
import { say } from './feed';
import { triggerUnplanned } from './inspections';
import { nextRandom } from './rng';
import type { GameState } from './state';

/** Ход конкурентов: реакция на потерю доли, грязные приёмы, закрытие. day – посчитанный день. */
export function competitorsTurn(state: GameState, cfg: GameConfig, share: number, rivalShares: number[]): void {
  const c = cfg.balance.competition;
  const difficulty = state.options.difficulty;
  state.shareLog.push(share);
  if (state.shareLog.length > c.lookbackDays + 1) state.shareLog.shift();

  // закрытие и повторное открытие
  state.competitors.forEach((r, i) => {
    if (r.closedUntilDay > 0) {
      if (state.day >= r.closedUntilDay) {
        r.closedUntilDay = 0;
        r.lowShareDays = 0;
        say(state, cfg, 'rivalOpened', 'warn', { name: r.name });
      }
      return;
    }
    r.lowShareDays = rivalShares[i] < c.closeBelow ? r.lowShareDays + 1 : 0;
    if (r.lowShareDays >= c.closeAfterDays) {
      r.closedUntilDay = state.day + c.closedDays;
      say(state, cfg, 'rivalClosed', 'ok', { name: r.name });
    }
  });

  if (state.day % c.reactionDays[difficulty] !== 0) return;

  // доля игрока выросла за две недели, или он запустил акцию – конкуренты отвечают
  const gained = state.shareLog.length > c.lookbackDays && share - state.shareLog[0] > c.lossThreshold;
  if (gained || state.promo) {
    for (const r of state.competitors) {
      if (r.closedUntilDay > 0) continue;
      if (r.id === 'coffeemarket') {
        const next = Math.max(c.chainMinCheck, round2(r.avgCheck * c.priceCut));
        if (next < r.avgCheck) {
          r.avgCheck = next;
          say(state, cfg, 'rivalMove', 'warn', { name: r.name, move: 'снизили цены' }, 21);
        }
      } else if (r.quality < c.qualityMax) {
        r.quality = clamp(round2(r.quality + c.qualityStep), 0, c.qualityMax);
        say(state, cfg, 'rivalMove', 'warn', { name: r.name, move: 'вложились в качество' }, 21);
      }
    }
  }

  // грязные приёмы при большой доле
  if (share >= c.dirtyFrom[difficulty] && nextRandom(state) < c.denounceChance) triggerUnplanned(state, cfg, 'ses', 'Донос конкурента');
}
