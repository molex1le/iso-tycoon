import { describe, expect, it } from 'vitest';
import { applyCommand, replay } from '../src/core/commands';
import { defaultConfig, itemCost, type GameConfig } from '../src/core/config';
import { Game } from '../src/core/game';
import { demandView, periodCapacity } from '../src/core/shop';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState, defaultOptions, rollDefects, type GameState, type NewGameOptions } from '../src/core/state';

const b = defaultConfig.balance;
/** конфиг без случайного шума спроса – для точных проверок формулы */
const quiet: GameConfig = { ...defaultConfig, balance: { ...b, demand: { ...b.demand, noise: 0 } } };
const opts = (over: Partial<NewGameOptions> = {}): NewGameOptions => ({ ...defaultOptions(), ...over });

/** закрывает все окна, которые ждут игрока (акты принимает) */
export function closePending(s: GameState, cfg = defaultConfig): void {
  while (s.pending.length && !s.finished) {
    const p = s.pending[0];
    if (p.kind === 'event') applyCommand(s, { type: 'ChooseEventOption', index: 0 }, cfg);
    else if (p.kind === 'inspectionVisit' && p.totalFine > 0) applyCommand(s, { type: 'ResolveInspection', choice: 'accept' }, cfg);
    else applyCommand(s, { type: 'Acknowledge' }, cfg);
  }
}

function advance(s: GameState, days: number, cfg = defaultConfig): void {
  for (let i = 0; i < days && !s.finished; i++) {
    closePending(s, cfg);
    if (!s.finished) simulateDay(s, cfg);
  }
}

describe('старт партии', () => {
  it('пресет: Реализм, у метро, ИП – деньги = капитал минус расходы на открытие', () => {
    const s = createInitialState(1);
    const total = s.setup.reduce((a, l) => a + l.amount, 0);
    expect(s.startCapital).toBe(20000);
    expect(s.cash).toBeCloseTo(20000 - total, 2);
    expect(s.setup.find((l) => l.id === 'deposit')!.amount).toBe(4800);
    expect(s.setup.find((l) => l.id === 'firstPurchase')!.amount).toBeGreaterThan(0);
    expect(s.footTraffic).toBe(b.locations.metro.footTraffic);
    expect(s.employees.filter((e) => e.role === 'barista')).toHaveLength(2);
    expect(s.candidates).toHaveLength(3);
    expect(s.equipment).toEqual(expect.arrayContaining(['machineBasic', 'register', 'fridge', 'furniture']));
    expect(s.inspections[0]).toMatchObject({ reason: 'planned', visitDay: 75, noticeDay: 65 });
  });

  it('сложность задаёт капитал, вывеска сразу добавляет узнаваемость', () => {
    expect(createInitialState(1, opts({ difficulty: 'training' })).startCapital).toBe(30000);
    expect(createInitialState(1, opts({ difficulty: 'survival' })).startCapital).toBe(13000);
    expect(createInitialState(1, opts({ extras: ['signage'] })).awareness).toBeCloseTo(0.4);
  });

  it('скрытый дефект зависит только от сида; осмотр его показывает, полный ремонт устраняет', () => {
    expect(rollDefects(5)).toEqual(rollDefects(5));
    let seed = 1;
    while (!rollDefects(seed).metro) seed++;
    const blind = createInitialState(seed);
    expect(blind.defect).toBe(true);
    expect(blind.defectKnown).toBe(false);
    expect(createInitialState(seed, opts({ premisesInspection: true })).defectKnown).toBe(true);
    expect(createInitialState(seed, opts({ repair: 'full' })).defect).toBe(false);
  });
});

describe('simulateDay: спрос и продажи', () => {
  it('первый день без шума совпадает с формулой из плана', () => {
    const s = createInitialState(7, undefined, quiet);
    const v = demandView(s, quiet);
    const r = simulateDay(s, quiet);
    const check = 2.44 / 0.85 + 0.625;
    // Q = 1,0 + мебель 0,1 + опыт (2,5 − 3)·0,05
    const own = 1.075 * Math.pow(3 / check, 1.5) * 1.1;
    const r1 = 0.8 * Math.pow(3 / 2.4, 1.5) * 1.1;
    const r2 = 1.3 * Math.pow(3 / 3.8, 1.5) * 1.1;
    const share = own / (own + r1 + r2 + 1);
    expect(v.quality).toBeCloseTo(1.075);
    expect(r.share).toBeCloseTo(share, 10);
    // первый день всегда ясный: погода × 1,05
    expect(r.demand).toBe(Math.round(b.locations.metro.footTraffic * 1.15 * 0.35 * 0.3 * share * b.weather.kinds.clear.demand));
    expect(r.served).toBe(r.demand);
    expect(r.rivalShares).toHaveLength(2);
  });

  it('выручка приходит в кассу, каждому клиенту – один напиток', () => {
    const s = createInitialState(3);
    const before = s.cash;
    const r = simulateDay(s);
    expect(s.cash).toBeCloseTo(before + r.revenue, 2);
    expect(r.cogs).toBeGreaterThan(0);
    const drinks = defaultConfig.items.filter((i) => i.kind === 'drink').reduce((a, i) => a + r.sold[i.id], 0);
    expect(drinks).toBe(r.served);
    expect(r.sold.croissant).toBeLessThanOrEqual(r.served);
    expect(s.day).toBe(2);
    expect(s.awareness).toBeCloseTo(0.31);
    expect(s.history).toHaveLength(1);
  });

  it('детерминированность: один сид – одна партия, другой сид – другая', () => {
    const a = createInitialState(123);
    const c = createInitialState(123);
    const other = createInitialState(124);
    advance(a, 60);
    advance(c, 60);
    advance(other, 60);
    expect(a).toEqual(c);
    expect(a.cash).not.toBe(other.cash);
  });

  it('сохранение в JSON и загрузка продолжают ту же партию', () => {
    const a = createInitialState(55);
    advance(a, 40);
    const loaded = JSON.parse(JSON.stringify(a)) as GameState;
    advance(a, 40);
    advance(loaded, 40);
    expect(loaded).toEqual(a);
  });

  it('цена выше – клиентов меньше, зимой больше, чем летом', () => {
    const base = simulateDay(createInitialState(1, undefined, quiet), quiet);
    const pricey = createInitialState(1, undefined, quiet);
    for (const id of Object.keys(pricey.prices)) pricey.prices[id] *= 1.5;
    expect(simulateDay(pricey, quiet).demand).toBeLessThan(base.demand);
    const summer = createInitialState(1, undefined, quiet);
    summer.day = 181;
    expect(demandView(summer, quiet).expected).toBeLessThan(demandView(createInitialState(1, undefined, quiet), quiet).expected);
  });

  it('мощность: 1 пост = 120 заказов за период, утренний пик теряет клиентов', () => {
    const s = createInitialState(1, undefined, quiet);
    expect(periodCapacity(s, quiet)).toBe(120);
    s.awareness = 1;
    s.footTraffic = 3600; // спрос ниже дневной мощности, но утро (40%) переполнено
    for (const m of quiet.materials) s.inventory[m.id] = [{ qty: 99999, expiresDay: 999, unitCost: m.cost }];
    const r = simulateDay(s, quiet);
    expect(r.capacity).toBe(360);
    expect(r.demand).toBeLessThan(r.capacity);
    expect(r.lostQueue).toBeGreaterThan(0);
    expect(r.served).toBeLessThanOrEqual(360);
  });

  it('второй пост удваивает мощность только при достаточном числе бариста', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'SetPosts', posts: 2 });
    expect(periodCapacity(s, defaultConfig)).toBe(240);
    s.employees = s.employees.slice(0, 1);
    expect(periodCapacity(s, defaultConfig)).toBe(120);
    expect(applyCommand(s, { type: 'SetPosts', posts: 3 })).toBe(false);
  });

  it('без бариста кофейня закрыта', () => {
    const s = createInitialState(1);
    s.employees = [];
    const r = simulateDay(s);
    expect(r.open).toBe(false);
    expect(r.served).toBe(0);
    expect(s.feed.some((f) => f.key === 'noBarista')).toBe(true);
  });
});

describe('расходы и налоги', () => {
  it('в конце месяца списываются аренда, коммуналка и зарплаты со взносами', () => {
    const s = createInitialState(2);
    advance(s, 29);
    const r = simulateDay(s);
    expect(r.expenses.rent).toBe(2400);
    expect(r.expenses.utilities).toBe(300);
    expect(r.expenses.payroll).toBeCloseTo((800 + 850) * 1.34, 2);
    expect(s.pending[0]).toEqual({ kind: 'monthReport', month: 1 });
    expect(() => simulateDay(s)).toThrow();
    expect(applyCommand(s, { type: 'Acknowledge' })).toBe(true);
    expect(s.pending).toHaveLength(0);
  });

  it('ООО платит бухгалтеру каждый месяц', () => {
    const s = createInitialState(2, opts({ form: 'ooo' }));
    advance(s, 30);
    expect(s.history[29].expenses.services).toBe(300);
  });

  it('6% с выручки: начисляется в конце квартала, платится по кнопке', () => {
    const s = createInitialState(4);
    advance(s, 90);
    const revenue = s.history.reduce((a, r) => a + r.revenue, 0);
    const due = s.tax.due!;
    expect(due.amount).toBeCloseTo(revenue * 0.06, 1);
    expect(due).toMatchObject({ declareBy: 110, payBy: 115, filed: false });
    expect(applyCommand(s, { type: 'PayTax' })).toBe(false); // сначала декларация
    expect(applyCommand(s, { type: 'FileDeclaration' })).toBe(true);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'PayTax' })).toBe(true);
    expect(s.cash).toBeCloseTo(cash - due.amount, 2);
    expect(s.tax.due).toBeNull();
  });

  it('забыл про налог: штраф за неподачу, пени, блокировка счёта и снижение шкалы', () => {
    const s = createInitialState(4);
    applyCommand(s, { type: 'DebugAddMoney', amount: 50000 });
    advance(s, 90);
    const amount = s.tax.due!.amount;
    advance(s, 21); // день 111 посчитан
    expect(s.tax.lateCount).toBe(1);
    expect(s.tax.due!.penalty).toBeCloseTo(200 + amount * 0.05, 1);
    advance(s, 40);
    expect(s.tax.lateCount).toBe(2);
    expect(s.feed.some((f) => f.key === 'accountBlocked')).toBe(true);
    const purchases = s.history.slice(-3).reduce((a, r) => a + (r.expenses.purchases ?? 0), 0);
    expect(purchases).toBe(0);
  });

  it('с бухгалтером декларация и оплата проходят сами', () => {
    const s = createInitialState(4, opts({ form: 'ooo' }));
    applyCommand(s, { type: 'DebugAddMoney', amount: 50000 });
    advance(s, 115);
    expect(s.tax.due).toBeNull();
    expect(s.tax.paidTotal).toBeGreaterThan(0);
    expect(s.tax.lateCount).toBe(0);
  });

  it('15% с прибыли: база – выручка минус подтверждённые расходы, но не меньше 1% выручки', () => {
    const s = createInitialState(4, opts({ taxRegime: 'profit15' }));
    advance(s, 89);
    closePending(s);
    const rev = s.tax.quarterRevenue;
    const ded = s.tax.quarterDeductible;
    simulateDay(s);
    const last = s.history[89];
    const rev90 = rev + last.revenue;
    const ded90 = ded + (last.expenses.purchases ?? 0) + (last.expenses.rent ?? 0) + (last.expenses.utilities ?? 0) + (last.expenses.payroll ?? 0);
    const expected = Math.max(Math.max(0, rev90 - ded90) * 0.15, rev90 * 0.01);
    expect(s.tax.due!.amount).toBeCloseTo(expected, 1);
  });

  it('банкротство: баланс ниже нуля дольше 14 дней', () => {
    const s = createInitialState(1);
    s.cash = -100000;
    advance(s, 14);
    expect(s.finished).toBe(false);
    advance(s, 1);
    expect(s.outcome).toBe('bankrupt');
  });

  it('год заканчивается после 360-го дня', () => {
    const s = createInitialState(9, opts({ difficulty: 'training' }));
    applyCommand(s, { type: 'DebugAddMoney', amount: 100000 });
    advance(s, 400);
    expect(s.outcome).toBe('year');
    expect(s.history).toHaveLength(360);
    expect(() => simulateDay(s)).toThrow();
  });
});

describe('склад', () => {
  it('без молока теряются заказы, часть клиентов берёт другое', () => {
    const s = createInitialState(1);
    s.inventory.milk = [];
    const r = simulateDay(s);
    expect(r.lostStock).toBeGreaterThan(0);
    expect(r.sold.cappuccino + r.sold.raf).toBe(0);
    expect(s.feed.some((f) => f.key === 'outOfStock')).toBe(true);
  });

  it('поставки пополняют склад и стоят денег, дешёвый поставщик – на 20% дешевле', () => {
    const s = createInitialState(1);
    advance(s, 8);
    expect(s.history.slice(1, 8).some((r) => (r.expenses.purchases ?? 0) > 0)).toBe(true);
    const cheap = createInitialState(1);
    applyCommand(cheap, { type: 'SetSupplier', supplier: 'cheap' });
    advance(cheap, 30);
    const unit = cheap.inventory.beans.at(-1)!.unitCost;
    expect([0.35, 0.28]).toContain(unit);
    expect(cheap.inventory.pastry.every((x) => x.unitCost === 0.8 || x.unitCost === 1)).toBe(true);
  });

  it('просрочка списывается, без холодильника молоко живёт 2 дня', () => {
    const s = createInitialState(1);
    s.inventory.pastry = [{ qty: 500, expiresDay: 1, unitCost: 1 }];
    const r = simulateDay(s);
    expect(r.waste).toBeGreaterThan(300);
    expect(s.inventory.pastry.every((x) => x.expiresDay > 1)).toBe(true);
    const noFridge = createInitialState(1, opts({ extras: [] }));
    expect(noFridge.inventory.milk[0].expiresDay).toBe(2);
    expect(createInitialState(1).inventory.milk[0].expiresDay).toBe(7);
  });

  it('себестоимость позиции считается по рецепту', () => {
    const capp = defaultConfig.items.find((i) => i.id === 'cappuccino')!;
    expect(itemCost(capp, defaultConfig)).toBe(0.7);
    expect(itemCost(capp, defaultConfig, 0.8)).toBe(0.56);
  });
});

describe('персонал', () => {
  it('найм и увольнение: кандидат переходит в штат, увольнение стоит одну зарплату', () => {
    const s = createInitialState(1);
    const c = s.candidates.find((x) => x.role === 'barista') ?? s.candidates[0];
    expect(applyCommand(s, { type: 'Hire', candidateId: c.id })).toBe(true);
    expect(s.employees.some((e) => e.id === c.id)).toBe(true);
    expect(s.candidates).toHaveLength(2);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'Fire', employeeId: c.id })).toBe(true);
    expect(s.cash).toBeCloseTo(cash - c.salary, 2);
    expect(applyCommand(s, { type: 'Fire', employeeId: 999 })).toBe(false);
  });

  it('один бариста на весь график: копятся усталость и сверхурочные, в итоге он уходит', () => {
    const s = createInitialState(1);
    s.employees = s.employees.slice(0, 1);
    simulateDay(s);
    expect(s.employees[0].fatigue).toBeCloseTo((84 - 42) * 0.4);
    expect(s.overtimeAccrued).toBeGreaterThan(0);
    advance(s, 60);
    expect(s.feed.some((f) => f.key === 'quit')).toBe(true);
  });

  it('двое на одном посту работают по норме и не устают', () => {
    const s = createInitialState(1);
    advance(s, 20);
    expect(s.employees.every((e) => e.fatigue === 0)).toBe(true);
    expect(s.overtimeAccrued).toBe(0);
  });

  it('медкнижка: $80 и 5 дней', () => {
    const s = createInitialState(1);
    s.employees[0].hasMedBook = false;
    expect(applyCommand(s, { type: 'IssueMedBook', employeeId: s.employees[0].id })).toBe(true);
    expect(applyCommand(s, { type: 'IssueMedBook', employeeId: s.employees[0].id })).toBe(false);
    advance(s, 5);
    expect(s.employees[0].hasMedBook).toBe(false);
    advance(s, 1);
    expect(s.employees[0].hasMedBook).toBe(true);
  });
});

describe('команды', () => {
  it('SetPrice меняет цену, округляет до шага, держит границы и пишется в лог', () => {
    const s = createInitialState(1);
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'cappuccino', price: 3.26 })).toBe(true);
    expect(s.prices.cappuccino).toBe(3.3);
    expect(s.commandLog).toEqual([{ day: 1, command: { type: 'SetPrice', itemId: 'cappuccino', price: 3.26 } }]);
    applyCommand(s, { type: 'SetPrice', itemId: 'tea', price: 0 });
    expect(s.prices.tea).toBe(b.prices.min);
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'beer', price: 5 })).toBe(false);
    expect(applyCommand(s, { type: 'SetPrice', itemId: 'tea', price: NaN })).toBe(false);
    expect(s.commandLog).toHaveLength(2);
  });

  it('покупка оборудования: профессиональная машина поднимает качество и мощность', () => {
    const s = createInitialState(1);
    const q = demandView(s, defaultConfig).quality;
    expect(applyCommand(s, { type: 'BuyEquipment', id: 'machinePro' })).toBe(false); // не хватает денег
    applyCommand(s, { type: 'DebugAddMoney', amount: 10000 });
    const cash = s.cash;
    expect(applyCommand(s, { type: 'BuyEquipment', id: 'machinePro' })).toBe(true);
    expect(s.cash).toBeCloseTo(cash - 9000, 2);
    expect(demandView(s, defaultConfig).quality).toBeCloseTo(q + 0.2);
    expect(applyCommand(s, { type: 'BuyEquipment', id: 'machinePro' })).toBe(false);
  });

  it('сид + настройки + лог команд = точный повтор партии', () => {
    const s = createInitialState(777);
    const log = (c: Parameters<typeof applyCommand>[1]) => applyCommand(s, c);
    advance(s, 10);
    log({ type: 'SetPrice', itemId: 'cappuccino', price: 2.5 });
    log({ type: 'Clean' });
    log({ type: 'SetSupplier', supplier: 'cheap' });
    advance(s, 70);
    log({ type: 'SetSafety', factor: 1.6 });
    advance(s, 40);
    closePending(s);
    expect(s.commandLog.length).toBeGreaterThan(5);
    expect(replay(s.seed, s.options, s.commandLog, s.day)).toEqual(s);
  });
});

describe('Game: часы + ядро', () => {
  it('24 реальные секунды на 1× = один посчитанный день', () => {
    const g = new Game(1);
    g.clock.resetDay(0);
    expect(g.update(23.5)).toBe(0);
    expect(g.update(0.5)).toBe(1);
    expect(g.state.day).toBe(2);
  });

  it('автопауза: на итогах месяца время стоит, пока игрок не закроет окно', () => {
    const g = new Game(1);
    expect(g.skipDays(100)).toBe(30);
    expect(g.blocked).toBe(true);
    expect(g.update(1000)).toBe(0);
    g.dispatch({ type: 'Acknowledge' });
    expect(g.blocked).toBe(false);
    g.clock.resetDay(0);
    expect(g.update(24)).toBe(1);
  });

  it('продолжение из сохранения', () => {
    const g = new Game(5);
    g.skipDays(12);
    const saved = JSON.parse(JSON.stringify(g.state)) as GameState;
    const g2 = new Game(saved.seed, saved.options, defaultConfig, saved);
    g.skipDays(10);
    g2.skipDays(10);
    expect(g2.state).toEqual(g.state);
  });
});
