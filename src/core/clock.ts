export type Speed = 0 | 1 | 2 | 3;

/**
 * Игровые часы: переводят реальные секунды в игровые дни.
 * На 1× один день = dayLengthSec реальных секунд (24 с, 1 с = 1 игровой час).
 * Ядро считает дни – часы только сообщают, сколько дней прошло.
 */
export class GameClock {
  readonly dayLengthSec: number;
  private elapsed: number;
  private _speed: Speed = 1;
  private lastRunning: Exclude<Speed, 0> = 1;

  constructor(dayLengthSec: number, startHour = 0) {
    if (dayLengthSec <= 0) throw new Error('dayLengthSec должен быть больше нуля');
    this.dayLengthSec = dayLengthSec;
    this.elapsed = (startHour / 24) * dayLengthSec;
  }

  get speed(): Speed {
    return this._speed;
  }

  get paused(): boolean {
    return this._speed === 0;
  }

  setSpeed(speed: Speed): void {
    this._speed = speed;
    if (speed !== 0) this.lastRunning = speed;
  }

  pause(): void {
    this.setSpeed(0);
  }

  /** Пауза ↔ последняя рабочая скорость. */
  togglePause(): void {
    this.setSpeed(this.paused ? this.lastRunning : 0);
  }

  /** Продвигает часы на realDtSec реальных секунд. Возвращает число закончившихся дней. */
  tick(realDtSec: number): number {
    if (this.paused || realDtSec <= 0) return 0;
    this.elapsed += realDtSec * this._speed;
    const days = Math.floor(this.elapsed / this.dayLengthSec + 1e-9);
    if (days > 0) this.elapsed = Math.max(0, this.elapsed - days * this.dayLengthSec);
    return days;
  }

  /** Доля текущего дня, 0..1. */
  get dayProgress(): number {
    return Math.min(this.elapsed / this.dayLengthSec, 0.999999);
  }

  /** Игровой час текущего дня, 0..24 (дробный). */
  get hour(): number {
    return this.dayProgress * 24;
  }

  /** Начать день заново с указанного часа. */
  resetDay(startHour = 0): void {
    this.elapsed = (startHour / 24) * this.dayLengthSec;
  }
}
