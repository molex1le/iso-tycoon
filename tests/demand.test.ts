import { describe, expect, it } from 'vitest';
import { monthOf, dayOfMonth, seasonOf } from '../src/core/calendar';
import { defaultConfig } from '../src/core/config';
import { attractiveness, averageCheck, customersPerDay, marketShare } from '../src/core/demand';
import { nextRandom } from '../src/core/rng';

const b = defaultConfig.balance;
const d = b.demand;

describe('формула спроса', () => {
  it('3 звезды дают множитель 1,1 при рыночной цене', () => {
    expect(attractiveness(1, d.marketCheck, 3, d)).toBeCloseTo(1.1);
  });

  it('+10% к цене – около −13% привлекательности', () => {
    const base = attractiveness(1, 3.0, 3, d);
    const pricey = attractiveness(1, 3.3, 3, d);
    expect(pricey / base).toBeCloseTo(0.867, 2);
  });

  it('качество и репутация повышают привлекательность', () => {
    expect(attractiveness(1.3, 3, 3, d)).toBeGreaterThan(attractiveness(1, 3, 3, d));
    expect(attractiveness(1, 3, 5, d)).toBeCloseTo(1.5);
    expect(attractiveness(1, 3, 1, d)).toBeCloseTo(0.7);
  });

  it('доля рынка: S / (S + ΣSконк + 1)', () => {
    expect(marketShare(1, [1, 1], 1)).toBeCloseTo(0.25);
    expect(marketShare(2, [], 1)).toBeCloseTo(2 / 3);
    expect(marketShare(0, [1], 1)).toBe(0);
  });

  it('K = V · s · 0,35 · A · доля', () => {
    const k = customersPerDay({ footTraffic: 420, season: 1.15, coffeeWantShare: 0.35, awareness: 0.3, share: 0.25 });
    expect(k).toBeCloseTo(420 * 1.15 * 0.35 * 0.3 * 0.25);
  });

  it('средний чек по ценам по умолчанию', () => {
    const prices = Object.fromEntries(defaultConfig.items.map((i) => [i.id, i.defaultPrice]));
    // напитки (доли нормированы к 100%): 2,44 / 0,85 + круассан 0,25 · 2,5
    expect(averageCheck(prices, defaultConfig.items)).toBeCloseTo(2.44 / 0.85 + 0.625, 5);
  });
});

describe('календарь', () => {
  it('месяц = 30 дней, год = 360', () => {
    expect(monthOf(1, b)).toBe(1);
    expect(monthOf(30, b)).toBe(1);
    expect(monthOf(31, b)).toBe(2);
    expect(monthOf(360, b)).toBe(12);
    expect(dayOfMonth(31, b)).toBe(1);
    expect(dayOfMonth(360, b)).toBe(30);
  });

  it('сезоны: зима 1,15, весна 1,0, лето 0,8, осень 1,05', () => {
    expect(seasonOf(1, b).demand).toBe(1.15);
    expect(seasonOf(12, b).demand).toBe(1.15);
    expect(seasonOf(4, b).demand).toBe(1.0);
    expect(seasonOf(7, b).demand).toBe(0.8);
    expect(seasonOf(10, b).demand).toBe(1.05);
  });
});

describe('генератор случайных чисел', () => {
  it('один сид – одна последовательность, значения в [0, 1)', () => {
    const a = { rngState: 42 };
    const c = { rngState: 42 };
    for (let i = 0; i < 1000; i++) {
      const v = nextRandom(a);
      expect(v).toBe(nextRandom(c));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('разные сиды дают разные последовательности', () => {
    expect(nextRandom({ rngState: 1 })).not.toBe(nextRandom({ rngState: 2 }));
  });
});
