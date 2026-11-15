import { Game } from '../src/core/game';
import { describe, expect, it } from 'vitest';
import { branchOffer } from '../src/core/branch';
import { applyCommand } from '../src/core/commands';
import { defaultConfig as cfg } from '../src/core/config';
import { flowSources } from '../src/core/shop';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState, defaultOptions } from '../src/core/state';

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
    expect(s.inspections.some((i) => i.visitDay > 365)).toBe(true);
  });
});

describe('режим разработчика', () => {
  it('перемотка сама закрывает события и доходит до нужного дня', () => {
    const game = new Game(7, defaultOptions(cfg), cfg);
    game.skipTo(120);
    expect(game.state.finished || game.state.day === 120).toBe(true);
    expect(game.state.finished || game.state.pending.length === 0 || game.state.day === 120).toBe(true);
  });

  it('сценарная перемотка доводит партию до конца года без банкротства', () => {
    const game = new Game(7, defaultOptions(cfg), cfg);
    game.skipTo(358, true);
    expect(game.state.finished).toBe(false);
    expect(game.state.day).toBe(358);
    expect(game.state.pending.length).toBe(0);
  });

  it('команды отладки: репутация, погода, новый конкурент', () => {
    const game = new Game(7, defaultOptions(cfg), cfg);
    expect(game.dispatch({ type: 'DebugReputation', value: 9 })).toBe(true);
    expect(game.state.reputation).toBe(5);
    expect(game.dispatch({ type: 'DebugWeather', weather: 'rain' })).toBe(true);
    expect(game.state.weather).toBe('rain');
    const before = game.state.competitors.length;
    expect(game.dispatch({ type: 'DebugRival' })).toBe(true);
    expect(game.state.competitors.length).toBe(before + 1);
    expect(game.state.competitors[before].opening).toBe(true);
  });
});

describe('сеть: аренда или покупка', () => {
  const ready = () => {
    const s = createInitialState(4);
    s.day = 120;
    s.reputation = 4;
    s.cash = 200000;
    return s;
  };

  it('во дворе дешевле и людей меньше; купленное помещение не платит аренду', async () => {
    const { branchOffer, branchDay, branchRefund, branchBuyPrice } = await import('../src/core/branch');
    const s = ready();
    const corner = branchOffer(s, cfg, 'center', 'corner');
    const yard = branchOffer(s, cfg, 'center', 'yard');
    expect(yard.cost).toBeLessThan(corner.cost);
    expect(yard.rent).toBeLessThan(corner.rent);
    expect(branchOffer(s, cfg, 'center', 'corner', true).rent).toBe(0);
    expect(applyCommand(s, { type: 'OpenBranch', location: 'center', site: 'corner', buy: true })).toBe(true);
    expect(s.branch).toMatchObject({ site: 'corner', owned: true, pricePaid: branchBuyPrice(cfg, 'center', 'corner') });
    s.ledger = {};
    branchDay(s, cfg);
    expect(s.ledger.rent ?? 0).toBe(0);
    expect(branchRefund(s, cfg)).toBeGreaterThan(branchBuyPrice(cfg, 'center', 'corner') * 0.6);
  });

  it('место конкурента доступно, только пока он закрыт', async () => {
    const { branchOffer } = await import('../src/core/branch');
    const s = ready();
    expect(branchOffer(s, cfg, 'center', 'rival').available).toBe(false);
    s.competitors[0].closedUntilDay = s.day + 10;
    expect(branchOffer(s, cfg, 'center', 'rival').available).toBe(true);
  });
});
