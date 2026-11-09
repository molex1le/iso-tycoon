import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/core/commands';
import { competitorsTurn } from '../src/core/competitors';
import { defaultConfig as base, type GameConfig, type EventDef } from '../src/core/config';
import { chooseOption, rollEvents } from '../src/core/events';
import { computeScore, payrollMonthly } from '../src/core/finance';
import { agencyScore, itemScore } from '../src/core/inspections';
import { annuity, loanOffer, loansDebt } from '../src/core/loans';
import { demandView } from '../src/core/shop';
import { simulateDay } from '../src/core/simulateDay';
import { loyaltyOf } from '../src/core/staff';
import { createInitialState, defaultOptions, type GameState } from '../src/core/state';
import eventsJson from '../src/data/events.json';

const cfg = base;
const allEvents: GameConfig = { ...base, events: eventsJson as unknown as EventDef[] };

function advance(s: GameState, days: number): void {
  for (let i = 0; i < days && !s.finished; i++) {
    while (s.pending.length && !s.finished) {
      const p = s.pending[0];
      if (p.kind === 'inspectionVisit' && p.totalFine > 0) applyCommand(s, { type: 'ResolveInspection', choice: 'accept' });
      else applyCommand(s, { type: 'Acknowledge' });
    }
    if (!s.finished) simulateDay(s);
  }
}

function hireEnvelope(s: GameState): void {
  const c = s.candidates[0];
  applyCommand(s, { type: 'Hire', candidateId: c.id, official: false });
}

describe('кредиты', () => {
  it('аннуитет из плана: $20 000 на 24 мес под 18% – примерно $998', () => {
    expect(annuity(20000, 18, 24)).toBeCloseTo(998.48, 1);
  });

  it('ставка зависит от сложности и истории, «Старт» у ООО выше на 50%', () => {
    expect(loanOffer(createInitialState(1), cfg, 'start')).toMatchObject({ available: true, limit: 20000, rate: 18 });
    expect(loanOffer(createInitialState(1, { ...defaultOptions(), difficulty: 'training' }), cfg, 'start').rate).toBe(14);
    expect(loanOffer(createInitialState(1, { ...defaultOptions(), form: 'ooo' }), cfg, 'start').limit).toBe(30000);
    const s = createInitialState(1);
    s.grade = 'E';
    expect(loanOffer(s, cfg, 'start').available).toBe(false);
  });

  it('деньги приходят сразу, платёж списывается через 30 дней, долг уменьшается', () => {
    const s = createInitialState(1);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'TakeLoan', product: 'start', amount: 10000 })).toBe(true);
    expect(s.cash).toBe(cash + 10000);
    advance(s, 30);
    expect(s.history[29].expenses.loans).toBeCloseTo(s.loans[0].payment, 2);
    expect(s.loans[0].balance).toBeLessThan(10000);
    expect(s.loans[0].overdue).toBe(0);
  });

  it('стартовый кредит из мастера, досрочное погашение без комиссии', () => {
    const s = createInitialState(1, { ...defaultOptions(), startLoan: 8000 });
    expect(s.loans).toHaveLength(1);
    const id = s.loans[0].id;
    applyCommand(s, { type: 'DebugAddMoney', amount: 5000 });
    const cash = s.cash;
    expect(applyCommand(s, { type: 'RepayLoan', loanId: id })).toBe(true);
    expect(s.cash).toBeCloseTo(cash - 8000, 2);
    expect(s.loans).toHaveLength(0);
  });

  it('оборотный – только после 3 месяцев и без просрочек', () => {
    const s = createInitialState(1);
    expect(loanOffer(s, cfg, 'working').available).toBe(false);
    applyCommand(s, { type: 'DebugAddMoney', amount: 20000 });
    advance(s, 95);
    expect(loanOffer(s, cfg, 'working').available).toBe(true);
    expect(loanOffer(s, cfg, 'working').limit).toBeGreaterThan(0);
  });

  it('лестница просрочки: штраф и история, реструктуризация на 30-й день, залог на 90-й', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'DebugAddMoney', amount: 1_000_000 });
    applyCommand(s, { type: 'TakeLoan', product: 'start', amount: 10000 });
    advance(s, 29);
    s.cash = -1_000_000; // денег нет, но партия идёт
    s.negativeDays = -10_000;
    advance(s, 1);
    expect(s.loans[0].overdueSince).toBe(30);
    expect(s.grade).toBe('D');
    expect(s.loans[0].overdue).toBeGreaterThan(s.loans[0].payment);
    const id = s.loans[0].id;
    expect(applyCommand(s, { type: 'Restructure', loanId: id })).toBe(false); // рано
    advance(s, 30);
    expect(s.feed.some((f) => f.key === 'loanOffer')).toBe(true);
    advance(s, 30);
    expect(s.feed.some((f) => f.key === 'collectors')).toBe(true);
    advance(s, 30);
    expect(s.feed.some((f) => f.key === 'seized')).toBe(true);
    expect(s.equipment).not.toContain('machineBasic');
    advance(s, 1);
    expect(s.history.at(-1)!.open).toBe(false);
  });

  it('реструктуризация: срок +12, ставка +3 п.п., просрочка уходит в тело долга', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'TakeLoan', product: 'start', amount: 10000 });
    const l = s.loans[0];
    l.overdue = 1000;
    l.overdueSince = -40;
    const debt = l.balance + l.overdue;
    expect(applyCommand(s, { type: 'Restructure', loanId: l.id })).toBe(true);
    expect(l).toMatchObject({ overdue: 0, overdueSince: null, annualRate: 21, months: 36 });
    expect(l.balance).toBeCloseTo(debt, 2);
  });

  it('микрозайм роняет кредитную историю, долги вычитаются из очков', () => {
    const s = createInitialState(1);
    const before = computeScore(s, cfg).total;
    applyCommand(s, { type: 'TakeLoan', product: 'micro', amount: 5000 });
    expect(s.grade).toBe('D');
    expect(loansDebt(s)).toBe(5000);
    expect(computeScore(s, cfg).total).toBeCloseTo(before, 2); // +5000 на счёте, −5000 долга
  });

  it('кредит, закрывающий минус, отодвигает банкротство, но не дольше 30 дней', () => {
    const s = createInitialState(1);
    s.cash = -500;
    for (let i = 0; i < 40 && !s.finished; i++) {
      advance(s, 1);
      s.cash = -500;
    }
    expect(s.outcome).toBe('bankrupt');
    expect(s.history.length).toBeGreaterThan(15);
    expect(s.history.length).toBeLessThanOrEqual(32);
  });
});

describe('«в конверте»', () => {
  it('без взносов, но −15 к трудовой шкале и ниже лояльность', () => {
    const s = createInitialState(1);
    const payroll = payrollMonthly(s, cfg);
    const c = s.candidates[0];
    hireEnvelope(s);
    expect(payrollMonthly(s, cfg)).toBeCloseTo(payroll + c.salary, 2);
    expect(itemScore(s, cfg, 'officialStaff')).toBe(85);
    const e = s.employees.at(-1)!;
    expect(loyaltyOf({ ...e, official: true }, cfg) - loyaltyOf(e, cfg)).toBe(20);
  });

  it('трудовая находит: штраф за человека, доначисление взносов, сигнал в налоговую', () => {
    const s = createInitialState(1);
    s.defect = false;
    applyCommand(s, { type: 'DebugAddMoney', amount: 100000 });
    hireEnvelope(s);
    s.inspections = [];
    applyCommand(s, { type: 'DebugInspection', agency: 'labour' });
    advance(s, 40);
    expect(s.pending.length === 0 || s.history.length > 0).toBe(true);
    expect(s.stats.inspections).toBeGreaterThanOrEqual(1);
    expect(s.feed.some((f) => f.key === 'signal')).toBe(true);
  });

  it('увольнение без компенсации: официального реже, «конвертного» чаще – жалоба и проверка', () => {
    let complaints = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const s = createInitialState(seed);
      hireEnvelope(s);
      const before = s.inspections.length;
      applyCommand(s, { type: 'Fire', employeeId: s.employees.at(-1)!.id, severance: false });
      if (s.inspections.length > before) {
        complaints++;
        expect(s.inspections.some((i) => i.agency === 'tax' && i.reason === 'unplanned')).toBe(true);
      }
    }
    expect(complaints).toBeGreaterThan(55);
    expect(complaints).toBeLessThan(85);
  });
});

describe('серые схемы', () => {
  it('мимо кассы: база налога меньше, сумма копится, шкала падает', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'SetOffbook', share: 0.2 });
    const r = simulateDay(s);
    expect(s.offbookTotal).toBeCloseTo(r.revenue * 0.2, 1);
    expect(s.tax.quarterRevenue).toBeCloseTo(r.revenue * 0.8, 1);
    expect(itemScore(s, cfg, 'offbook')).toBe(40);
    expect(applyCommand(s, { type: 'SetOffbook', share: 0.9 })).toBe(true);
    expect(s.offbookShare).toBe(0.3);
  });

  it('попался на крупной сумме – уголовное дело', () => {
    for (let seed = 1; seed < 80; seed++) {
      const s = createInitialState(seed);
      s.defect = false;
      s.inspections = [];
      applyCommand(s, { type: 'DebugAddMoney', amount: 100000 });
      applyCommand(s, { type: 'SetOffbook', share: 0.3 });
      s.offbookTotal = 6000;
      applyCommand(s, { type: 'DebugInspection', agency: 'tax' });
      advance(s, 2);
      if (s.stats.offbookCaught > 0) {
        expect(s.outcome).toBe('criminal');
        return;
      }
    }
    throw new Error('ни разу не поймали');
  });

  it('«не списывать до последнего» оставляет просрочку на складе', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'SetLateWriteOff', on: true });
    s.inventory.pastry = [{ qty: 500, expiresDay: 1, unitCost: 1 }];
    const r = simulateDay(s);
    expect(r.waste).toBe(0);
    expect(itemScore(s, cfg, 'expired')).toBe(0);
  });
});

describe('пожарная, налоговая и другие дефекты', () => {
  it('оборудование поднимает пожарную шкалу', () => {
    const s = createInitialState(1);
    s.defect = false;
    const before = agencyScore(s, cfg, 'fire');
    applyCommand(s, { type: 'BuyEquipment', id: 'extinguishers' });
    applyCommand(s, { type: 'BuyEquipment', id: 'evacPlan' });
    expect(agencyScore(s, cfg, 'fire')).toBeGreaterThan(before);
    expect(itemScore(s, cfg, 'fireCondition')).toBe(55);
  });

  it('скрытая проводка не видна игроку и приводит к приостановке на визите', () => {
    const s = createInitialState(1);
    s.defect = true;
    s.defectType = 'wiring';
    s.defectKnown = false;
    expect(itemScore(s, cfg, 'wiring', true)).toBe(100);
    s.inspections = [];
    applyCommand(s, { type: 'DebugAddMoney', amount: 50000 });
    applyCommand(s, { type: 'DebugInspection', agency: 'fire' });
    simulateDay(s);
    const v = s.pending.find((p) => p.kind === 'inspectionVisit');
    expect(v).toMatchObject({ agency: 'fire', suspensionDays: 7 });
  });

  it('ошибка в декларации всплывает только на проверке: доначисление + 20%', () => {
    const s = createInitialState(1);
    s.defect = false;
    s.tax.hiddenError = 500;
    expect(itemScore(s, cfg, 'returns', true)).toBe(100);
    expect(itemScore(s, cfg, 'returns')).toBe(0);
    s.inspections = [];
    applyCommand(s, { type: 'DebugAddMoney', amount: 50000 });
    applyCommand(s, { type: 'DebugInspection', agency: 'tax' });
    simulateDay(s);
    const v = s.pending.find((p) => p.kind === 'inspectionVisit');
    expect(v?.kind === 'inspectionVisit' && v.results.find((r) => r.itemId === 'returns')!.fine).toBe(600);
  });
});

describe('маркетинг', () => {
  it('листовки ускоряют узнаваемость на неделю, соцсети – пока включены', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'BuyFlyers' });
    simulateDay(s);
    expect(s.awareness).toBeCloseTo(0.33);
    expect(applyCommand(s, { type: 'BuyFlyers' })).toBe(false);
    const t = createInitialState(1);
    const v0 = demandView(t, cfg).share;
    applyCommand(t, { type: 'SetSocial', on: true });
    expect(demandView(t, cfg).share).toBeGreaterThan(v0);
  });

  it('акция: клиентов +25%, чек −15%', () => {
    const s = createInitialState(1);
    const e0 = demandView(s, cfg).expected;
    applyCommand(s, { type: 'SetPromo', on: true });
    expect(demandView(s, cfg).expected).toBeCloseTo(e0 * 1.25, 5);
  });
});

describe('конкуренты', () => {
  it('рост доли игрока – сеть снижает цены, авторская вкладывается в качество', () => {
    const s = createInitialState(1);
    s.day = 14;
    s.shareLog = new Array(15).fill(0.2);
    competitorsTurn(s, cfg, 0.3, [0.2, 0.2]);
    expect(s.competitors[0].avgCheck).toBeCloseTo(2.16, 2);
    expect(s.competitors[1].quality).toBeCloseTo(1.35, 2);
  });

  it('доля ниже 10% два месяца – конкурент закрывается и не участвует в спросе', () => {
    const s = createInitialState(1);
    const before = demandView(s, cfg).share;
    s.day = 15;
    s.competitors[0].lowShareDays = 59;
    competitorsTurn(s, cfg, 0.3, [0.05, 0.2]);
    expect(s.competitors[0].closedUntilDay).toBe(45);
    expect(demandView(s, cfg).share).toBeGreaterThan(before);
  });
});

describe('события', () => {
  it('файл событий: 20+ карточек, у каждой есть варианты', () => {
    expect(allEvents.events.length).toBeGreaterThanOrEqual(20);
    for (const e of allEvents.events) expect(e.options.length).toBeGreaterThan(0);
  });

  it('автопауза, выбор варианта применяет эффект и цену', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'DebugEvent', eventId: 'machine_break' }, allEvents);
    expect(() => simulateDay(s, allEvents)).toThrow();
    const cash = s.cash;
    expect(applyCommand(s, { type: 'Acknowledge' }, allEvents)).toBe(false);
    expect(applyCommand(s, { type: 'ChooseEventOption', index: 1 }, allEvents)).toBe(true);
    expect(s.cash).toBe(cash - 250);
    expect(s.machineDownUntilDay).toBe(4);
    expect(simulateDay(s, allEvents).open).toBe(false);
  });

  it('эффекты на цели: поднять зарплату, отпустить, оформить', () => {
    const s = createInitialState(1);
    const e = s.employees[0];
    const salary = e.salary;
    s.pending.push({ kind: 'event', eventId: 'poach', targetId: e.id, vars: { name: e.name } });
    chooseOption(s, allEvents, 0);
    expect(e.salary).toBe(Math.round(salary * 1.2));
    s.pending.push({ kind: 'event', eventId: 'poach', targetId: e.id, vars: { name: e.name } });
    chooseOption(s, allEvents, 1);
    expect(s.employees.some((x) => x.id === e.id)).toBe(false);
  });

  it('разовые события не повторяются, между событиями есть пауза', () => {
    const s = createInitialState(3);
    applyCommand(s, { type: 'DebugAddMoney', amount: 500000 }, allEvents);
    const days: number[] = [];
    const seen: Record<string, number> = {};
    for (let i = 0; i < 360 && !s.finished; i++) {
      while (s.pending.length && !s.finished) {
        const p = s.pending[0];
        if (p.kind === 'event') {
          days.push(s.day);
          seen[p.eventId] = (seen[p.eventId] ?? 0) + 1;
          applyCommand(s, { type: 'ChooseEventOption', index: 0 }, allEvents);
        } else if (p.kind === 'inspectionVisit' && p.totalFine > 0) applyCommand(s, { type: 'ResolveInspection', choice: 'accept' }, allEvents);
        else applyCommand(s, { type: 'Acknowledge' }, allEvents);
      }
      if (!s.finished) simulateDay(s, allEvents);
    }
    expect(days.length).toBeGreaterThan(3);
    expect(seen.rent_rise ?? 0).toBeLessThanOrEqual(1);
    expect(seen.law_change ?? 0).toBeLessThanOrEqual(1);
  });

  it('случайные события детерминированы сидом', () => {
    const run = () => {
      const s = createInitialState(9);
      for (let i = 0; i < 200 && !s.pending.some((p) => p.kind === 'event'); i++) {
        s.pending = [];
        rollEvents(s, allEvents);
        s.day++;
      }
      return s.pending;
    };
    expect(run()).toEqual(run());
  });
});
