/**
 * Единственный источник случайности в игре: mulberry32.
 * Состояние генератора лежит в GameState (rngState), поэтому сид + лог команд
 * дают точный повтор партии, а сохранение в JSON продолжает ту же последовательность.
 */
export interface RngHolder {
  rngState: number;
}

export function seedToState(seed: number): number {
  return seed | 0;
}

/** Следующее число в [0, 1). Сдвигает rngState. */
export function nextRandom(holder: RngHolder): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) | 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
