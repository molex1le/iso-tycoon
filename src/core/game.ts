import { GameClock } from './clock';
import { applyCommand, type Command } from './commands';
import { defaultConfig, type GameConfig } from './config';
import { nextQuestion } from './inspections';
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

  /** Перемотка разработчика: доходит до дня day, сама закрывая отчёты, события (первый вариант) и проверки (признать и принять). */
  skipTo(day: number): number {
    let done = 0;
    let guard = 0;
    while (this.state.day < day && !this.state.finished && guard++ < 5000) {
      this.autoResolve();
      if (this.state.finished) break;
      done += this.runDays(1);
    }
    return done;
  }

  private autoResolve(): void {
    const s = this.state;
    let guard = 0;
    while (s.pending.length && !s.finished && guard++ < 200) {
      const p = s.pending[0];
      let ok: boolean;
      if (p.kind === 'event') ok = this.dispatch({ type: 'ChooseEventOption', index: 0 });
      else if (p.kind === 'inspectionVisit' && p.totalFine > 0) {
        let q = 0;
        while (nextQuestion(p) >= 0 && q++ < 20) this.dispatch({ type: 'AnswerInspector', reply: 'admit' });
        ok = this.dispatch(p.totalFine > 0 ? { type: 'ResolveInspection', choice: 'accept' } : { type: 'Acknowledge' });
      } else ok = this.dispatch({ type: 'Acknowledge' });
      if (!ok) break;
    }
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
