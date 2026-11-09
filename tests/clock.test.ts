import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/core/clock';
import balance from '../src/data/balance.json';

describe('GameClock', () => {
  it('в balance.json день длится 24 секунды', () => {
    expect(balance.time.dayLengthSec).toBe(24);
  });

  it('1×: 24 секунды = 1 день, 1 секунда = 1 игровой час', () => {
    const c = new GameClock(24);
    let days = 0;
    for (let i = 0; i < 23; i++) days += c.tick(1);
    expect(days).toBe(0);
    expect(c.hour).toBeCloseTo(23);
    days += c.tick(1);
    expect(days).toBe(1);
    expect(c.hour).toBeCloseTo(0);
  });

  it('2× – 12 секунд на день, 3× – 8 секунд', () => {
    const c2 = new GameClock(24);
    c2.setSpeed(2);
    expect(c2.tick(11.9)).toBe(0);
    expect(c2.tick(0.1)).toBe(1);

    const c3 = new GameClock(24);
    c3.setSpeed(3);
    expect(c3.tick(7.9)).toBe(0);
    expect(c3.tick(0.1)).toBe(1);
  });

  it('на паузе время стоит, togglePause возвращает прежнюю скорость', () => {
    const c = new GameClock(24);
    c.setSpeed(3);
    c.tick(4);
    const hour = c.hour;
    c.togglePause();
    expect(c.paused).toBe(true);
    expect(c.tick(100)).toBe(0);
    expect(c.hour).toBe(hour);
    c.togglePause();
    expect(c.speed).toBe(3);
  });

  it('мелкие кадры по 1/60 с не теряют и не добавляют дни', () => {
    const c = new GameClock(24);
    let days = 0;
    for (let i = 0; i < 60 * 24 * 10; i++) days += c.tick(1 / 60);
    expect(days).toBe(10);
  });

  it('большой шаг даёт сразу несколько дней', () => {
    const c = new GameClock(24);
    expect(c.tick(24 * 5 + 6)).toBe(5);
    expect(c.hour).toBeCloseTo(6);
  });

  it('стартовый час сдвигает первый день', () => {
    const c = new GameClock(24, 6);
    expect(c.hour).toBeCloseTo(6);
    expect(c.tick(17.9)).toBe(0);
    expect(c.tick(0.1)).toBe(1);
  });
});
