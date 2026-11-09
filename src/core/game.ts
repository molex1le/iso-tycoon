import { GameClock } from './clock';
import { applyCommand, type Command } from './commands';
import { defaultConfig, type GameConfig } from './config';
import { simulateDay } from './simulateDay';
import { createInitialState, type DayRecord, type GameState, type NewGameOptions } from './state';

/** Партия: состояние + часы. Единственная точка входа для UI. */
export class Game {
  readonly cfg: GameConfig;
  readonly state: GameState;
  readonly clock: GameClock;
  /** вызывается после каждого посчитанного дня */
  onDay: ((record: DayRecord) => void) | null = null;

  constructor(seed: number, options?: NewGameOptions, cfg: GameConfig = defaultConfig, saved?: GameState) {
    this.cfg = cfg;
    this.state = saved ?? createInitialState(seed, options, cfg);
    this.clock = new GameClock(cfg.balance.time.dayLengthSec, cfg.balance.time.startHour);
    if (this.blocked) this.clock.pause();
  }

  /** Игра ждёт решения игрока или закончилась – время стоит. */
  get blocked(): boolean {
    return this.state.finished || this.state.pending.length > 0;
  }

  dispatch(command: Command): boolean {
    return applyCommand(this.state, command, this.cfg);
  }

  /** Вызывается каждый кадр. Возвращает число посчитанных дней. */
  update(realDtSec: number): number {
    if (this.blocked) return 0;
    return this.runDays(this.clock.tick(realDtSec));
  }

  /** Перемотка для отладки: считает до n дней, останавливается на событии. */
  skipDays(n: number): number {
    return this.runDays(n);
  }

  private runDays(n: number): number {
    let done = 0;
    while (done < n && !this.blocked) {
      const record = simulateDay(this.state, this.cfg);
      done++;
      this.onDay?.(record);
    }
    // автопауза на событии: день начинается заново с утра
    if (done > 0 && this.blocked) this.clock.resetDay(this.cfg.balance.time.startHour);
    return done;
  }
}
