import { describe, expect, it } from 'vitest';
import { branchOffer } from '../src/core/branch';
import { applyCommand } from '../src/core/commands';
import { defaultConfig as cfg } from '../src/core/config';
import { flowSources } from '../src/core/shop';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState } from '../src/core/state';

describe('погода и потоки', () => {
  it('погода меняет спрос и пишется в телеметрию', () => {
    const a = createInitialState(4);
    const b = createInitialState(4);
    b.weather = 'rain';
    const ra = simulateDay(a);
    const rb = simulateDay(b);
    expect(rb.weather).toBe('rain');
    expect(rb.demand).toBeLessThan(ra.demand);
  });

  it('источники людей настоящие: школа летом пустеет', () => {
    const s = createInitialState(4, { ...createInitialState(4).options, location: 'suburb' });
    const school = (day: number) => flowSources(s, cfg, day).find((x) => x.id === 'school')!.people;
    expect(school(190)).toBeLessThan(school(250));
    const total = flowSources(s, cfg, 100).reduce((a, x) => a + x.people, 0);
    expect(Math.abs(total - s.footTraffic)).toBeLessThan(s.footTraffic * 0.1);
  });
});

describe('рост', () => {
  it('новый конкурент сначала строится, потом отбирает долю', () => {
    const s = createInitialState(6);
    s.day = 190;
    cfg.balance.competition.newRivals.weeklyChance.realism = 1;
    let built = false;
    for (let i = 0; i < 14 && !built; i++) {
      s.pending = [];
      simulateDay(s);
      built = s.competitors.length > 2;
    }
    cfg.balance.competition.newRivals.weeklyChance.realism = 0.06;
    expect(built).toBe(true);
    expect(s.competitors[2].opening).toBe(true);
  });

  it('филиал открывается по условиям и приносит выручку', () => {
    const s = createInitialState(8);
    expect(branchOffer(s, cfg, 'suburb').available).toBe(false);
    s.day = 120;
    s.reputation = 4;
    s.cash = 30000;
    expect(applyCommand(s, { type: 'OpenBranch', location: 'suburb' })).toBe(true);
    expect(applyCommand(s, { type: 'OpenBranch', location: 'center' })).toBe(false);
    s.pending = [];
    const r = simulateDay(s);
    expect(r.branchRevenue).toBeGreaterThan(0);
  });

  it('после года можно играть дальше', () => {
    const s = createInitialState(9);
    s.finished = true;
    s.outcome = 'year';
    s.day = 361;
    const rent = s.rentFactor;
    expect(applyCommand(s, { type: 'ContinueYear' })).toBe(true);
    expect(s.finished).toBe(false);
    expect(s.years).toBe(2);
    expect(s.rentFactor).toBeGreaterThan(rent);
    expect(s.inspections.some((i) => i.visitDay > 360)).toBe(true);
  });
});
