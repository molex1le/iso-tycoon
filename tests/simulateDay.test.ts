import { describe, expect, it } from 'vitest';
import { applyCommand, replay } from '../src/core/commands';
import { defaultConfig, type GameConfig } from '../src/core/config';
import { Game } from '../src/core/game';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState } from '../src/core/state';

const b = defaultConfig.balance;
/** конфиг без случайного шума спроса – для точных проверок формулы */
const quiet: GameConfig = { ...defaultConfig, balance: { ...b, demand: { ...b.demand, noise: 0 } } };

describe('стартовое состояние', () => {
  it('пресет из плана: Реализм, у метро, ИП, $5 450', () => {
    const s = createInitialState(1);
    expect(s.cash).toBe(5450);
    expect(s.startCapital).toBe(20000);
    expect(s.footTraffic).toBe(420);
    expect(s.awareness).toBe(0.3);
    expect(s.reputation).toBe(3);
    expect(s.quality).toBeCloseTo(1.1);
    expect(s.prices.cappuccino).toBe(3.0);
    expect(s.competitors).toHaveLength(2);
  });
});

describe('simulateDay', () => {
  it('первый день без шума совпадает с формулой из плана', () => {
    const s = createInitialState(7, quiet);
    const r = simulateDay(s, quiet);
    // S: игрок 1,1·(3/3,4956)^1,5·1,1; КофеМаркет 0,8·(3/2,4)^1,5·1,1; Зёрна 1,3·(3/3,8)^1,5·1,1
    const check = 2.44 / 0.85 + 0.625;
    const own = 1.1 * Math.pow(3 / check, 1.5) * 1.1;
    const r1 = 0.8 * Math.pow(3 / 2.4, 1.5) * 1.1;
    const r2 = 1.3 * Math.pow(3 / 3.8, 1.5) * 1.1;
    const share = own / (own + r1 + r2 + 1);
    expect(r.share).toBeCloseTo(share, 10);
    expect(r.demand).toBe(Math.round(420 * 1.15 * 0.35 * 0.3 * share));
    expect(r.served).toBe(r.demand);
    expect(r.lost).toBe(0);
  });

  it('деньги растут ровно на выручку минус себестоимость', () => {
    const s = createInitialState(3);
    const before = s.cash;
    const r = simulateDay(s);
    expect(r.profit).toBeCloseTo(r.revenue - r.cogs, 2);
    expect(s.cash).toBeCloseTo(before + r.profit, 2);
    expect(r.revenue).toBeGreaterThan(0);
    // каждому клиенту – ровно один напиток
    const drinks = defaultConfig.items.filter((i) => i.kind === 'drink').reduce((a, i) => a + r.sold[i.id], 0);
    expect(drinks).toBe(r.served);
    expect(r.sold.croissant).toBeLessThanOrEqual(r.served);
  });

  it('день и узнаваемость сдвигаются, строка телеметрии пишется', () => {
    const s = createInitialState(3);
    simulateDay(s);
    expect(s.day).toBe(2);
    expect(s.awareness).toBeCloseTo(0.31);
    expect(s.history).toHaveLength(1);
    expect(s.history[0].day).toBe(1);
  });

  it('узнаваемость не превышает 1,0', () => {
    const s = createInitialState(3);
    for (let i = 0; i < 100; i++) simulateDay(s);
    expect(s.awareness).toBe(1);
  });

  it('детерминированность: один сид – одна партия, другой сид – другая', () => {
    const a = createInitialState(123);
    const c = createInitialState(123);
    const other = createInitialState(124);
    for (let i = 0; i < 60; i++) {
      simulateDay(a);
      simulateDay(c);
      simulateDay(other);
    }
    expect(a).toEqual(c);
    expect(a.cash).not.toBe(other.cash);
  });

  it('сохранение в JSON и загрузка продолжают ту же партию', () => {
    const a = createInitialState(55);
    for (let i = 0; i < 20; i++) simulateDay(a);
    const loaded = JSON.parse(JSON.stringify(a));
    for (let i = 0; i < 20; i++) {
      simulateDay(a);
      simulateDay(loaded);
    }
    expect(loaded).toEqual(a);
  });

  it('цена выше – клиентов меньше, цена ниже – больше', () => {
    const base = simulateDay(createInitialState(1, quiet), quiet);
    const pricey = createInitialState(1, quiet);
    for (const id of Object.keys(pricey.prices)) pricey.prices[id] *= 1.5;
    const cheap = createInitialState(1, quiet);
    for (const id of Object.keys(cheap.prices)) cheap.prices[id] *= 0.7;
    expect(simulateDay(pricey, quiet).demand).toBeLessThan(base.demand);
    expect(simulateDay(cheap, quiet).demand).toBeGreaterThan(base.demand);
  });

  it('продажи ограничены мощностью: лишние клиенты уходят', () => {
    const s = createInitialState(1, quiet);
    s.footTraffic = 20000;
    s.awareness = 1;
    const r = simulateDay(s, quiet);
    // 1 бариста: min(30, 60) · 4 ч = 120 заказов за период, 360 за день
    expect(r.capacity).toBe(360);
    expect(r.served).toBe(360);
    expect(r.lost).toBe(r.demand - 360);
    expect(r.lost).toBeGreaterThan(0);
  });

  it('утренний пик – узкое место: день с запасом по мощности всё равно теряет клиентов', () => {
    const s = createInitialState(1, quiet);
    s.awareness = 1;
    s.footTraffic = 3600; // спрос ниже дневной мощности, но утро (40%) переполнено
    const r = simulateDay(s, quiet);
    expect(r.demand).toBeLessThan(r.capacity);
    expect(r.lost).toBeGreaterThan(0);
  });

  it('без бариста продаж нет', () => {
    const s = createInitialState(1);
    s.baristas = 0;
    const r = simulateDay(s);
    expect(r.served).toBe(0);
    expect(r.revenue).toBe(0);
  });

  it('зимой клиентов больше, чем летом', () => {
    const winter = createInitialState(1, quiet);
    const summer = createInitialState(1, quiet);
    summer.day = 181; // июль
    expect(simulateDay(winter, quiet).demand).toBeGreaterThan(simulateDay(summer, quiet).demand);
  });

  it('партия заканчивается после 360-го дня', () => {
    const s = createInitialState(9);
    for (let i = 0; i < 360; i++) simulateDay(s);
    expect(s.finished).toBe(true);
    expect(s.history).toHaveLength(360);
    expect(() => simulateDay(s)).toThrow();
  });
});

describe('команды', () => {
  it('SetPrice меняет цену, округляет до шага и пишется в лог', () => {
    const s = createInitialState(1);
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'cappuccino', price: 3.26 })).toBe(true);
    expect(s.prices.cappuccino).toBe(3.3);
    expect(s.commandLog).toEqual([{ day: 1, command: { type: 'SetPrice', itemId: 'cappuccino', price: 3.26 } }]);
  });

  it('SetPrice держит цену в границах и отвергает мусор', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'SetPrice', itemId: 'tea', price: 0 });
    expect(s.prices.tea).toBe(b.prices.min);
    applyCommand(s, { type: 'SetPrice', itemId: 'tea', price: 999 });
    expect(s.prices.tea).toBe(b.prices.max);
    const logged = s.commandLog.length;
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'beer', price: 5 })).toBe(false);
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'tea', price: NaN })).toBe(false);
    expect(s.commandLog).toHaveLength(logged);
  });

  it('сид + лог команд = точный повтор партии', () => {
    const s = createInitialState(777);
    for (let i = 0; i < 10; i++) simulateDay(s);
    applyCommand(s, { type: 'SetPrice', itemId: 'cappuccino', price: 2.5 });
    applyCommand(s, { type: 'DebugAddMoney', amount: 1000 });
    for (let i = 0; i < 25; i++) simulateDay(s);
    applyCommand(s, { type: 'SetPrice', itemId: 'raf', price: 4.5 });
    for (let i = 0; i < 15; i++) simulateDay(s);

    expect(replay(s.seed, s.commandLog, s.day)).toEqual(s);
  });
});

describe('Game: часы + ядро', () => {
  it('24 реальные секунды на 1× = один посчитанный день', () => {
    const g = new Game(1);
    g.clock.resetDay(0);
    expect(g.update(23.5)).toBe(0);
    expect(g.state.day).toBe(1);
    expect(g.update(0.5)).toBe(1);
    expect(g.state.day).toBe(2);
  });

  it('на паузе дни не идут, на 3× идут втрое быстрее', () => {
    const g = new Game(1);
    g.clock.resetDay(0);
    g.clock.pause();
    expect(g.update(1000)).toBe(0);
    g.clock.setSpeed(3);
    expect(g.update(24)).toBe(3);
    expect(g.state.history).toHaveLength(3);
  });

  it('в конце года партия останавливается и ставит паузу', () => {
    const g = new Game(1);
    expect(g.skipDays(1000)).toBe(360);
    expect(g.state.finished).toBe(true);
    expect(g.clock.paused).toBe(true);
    expect(g.update(100)).toBe(0);
    expect(g.dispatch({ type: 'SetPrice', itemId: 'tea', price: 2 })).toBe(false);
  });
});
