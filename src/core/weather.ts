import { monthOf, seasonOf } from './calendar';
import type { GameConfig } from './config';
import { nextRandom } from './rng';
import type { GameState } from './state';

export type WeatherId = 'clear' | 'rain' | 'snow' | 'heat';

/** Погода на день state.day. Бросается одним генератором партии, как и всё остальное. */
export function rollWeather(state: GameState, cfg: GameConfig): void {
  const w = cfg.balance.weather;
  const season = seasonOf(monthOf(state.day, cfg.balance), cfg.balance).id as keyof typeof w.chances;
  const chances = w.chances[season] as Partial<Record<WeatherId, number>>;
  let r = nextRandom(state);
  state.weather = 'clear';
  for (const [id, p] of Object.entries(chances) as [WeatherId, number][]) {
    if (r < p) {
      state.weather = id;
      return;
    }
    r -= p;
  }
}

export function weatherOf(state: GameState): WeatherId {
  return (state.weather ?? 'clear') as WeatherId;
}

export function weatherFactor(state: GameState, cfg: GameConfig): number {
  return cfg.balance.weather.kinds[weatherOf(state)].demand;
}
