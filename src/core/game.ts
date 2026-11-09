import { GameClock } from './clock';
import { applyCommand, type Command } from './commands';
import { defaultConfig, type GameConfig } from './config';
import { simulateDay } from './simulateDay';
import { createInitialState, type GameState } from './state';

/** Партия: состояние + часы. Единственная точка входа для UI. */
export class Game {
  readonly cfg: GameConfig;
  readonly state: GameState;
  readonly clock: GameClock;

  constructor(seed: number, cfg: GameConfig = defaultConfig) {
    this.cfg = cfg;
    this.state = createInitialState(seed, cfg);
    this.clock = new GameClock(cfg.balance.time.dayLengthSec, cfg.balance.time.startHour);
  }

  dispatch(command: Command): boolean {
    return applyCommand(this.state, command, this.cfg);
  }

  /** Вызывается каждый кадр. Возвращает число посчитанных дней. */
  update(realDtSec: number): number {
    if (this.state.finished) return 0;
    return this.runDays(this.clock.tick(realDtSec));
  }

  /** Перемотка для отладки: сразу считает n дней. */
  skipDays(n: number): number {
    return this.runDays(n);
  }

  private runDays(n: number): number {
    let done = 0;
    while (done < n && !this.state.finished) {
      simulateDay(this.state, this.cfg);
      done++;
    }
    if (this.state.finished) this.clock.pause();
    return done;
  }
}
