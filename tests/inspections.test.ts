import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/core/commands';
import { defaultConfig as cfg, type ChecklistItem } from '../src/core/config';
import { computeScore, cushionDays, upcoming } from '../src/core/finance';
import { checklist, contestChance, inspectorById, itemScore, sesScore, violationChance } from '../src/core/inspections';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState, defaultOptions, type GameState, type Pending } from '../src/core/state';

type Visit = Extract<Pending, { kind: 'inspectionVisit' }>;

/** идёт по дням, закрывая итоги месяца и уведомления, до первого визита инспектора */
function untilVisit(s: GameState): Visit {
  for (let guard = 0; guard < 400 && !s.finished; guard++) {
    const p = s.pending[0];
    if (p?.kind === 'inspectionVisit') return p;
    if (p) applyCommand(s, { type: 'Acknowledge' });
    else simulateDay(s);
  }
  throw new Error('визита не было');
}

const noFridge = (seed: number, difficulty: 'training' | 'realism' | 'survival' = 'realism') =>
  createInitialState(seed, { ...defaultOptions(), extras: ['furniture'], difficulty });

describe('шкалы СЭС', () => {
  it('чистота падает на 3 в день, с уборщицей – втрое медленнее', () => {
    const s = createInitialState(1);
    simulateDay(s);
    expect(s.cleanliness).toBe(77);
    s.employees.push({ id: 99, name: 'Тест', role: 'cleaner', salary: 400, experience: 1, hasMedBook: true, medBookReadyDay: null, fatigue: 0, hiredDay: 1 });
    simulateDay(s);
    expect(s.cleanliness).toBe(76);
  });

  it('срочная уборка возвращает 100 и стоит $200', () => {
    const s = createInitialState(1);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'Clean' })).toBe(true);
    expect(s.cleanliness).toBe(100);
    expect(s.cash).toBe(cash - 200);
    expect(applyCommand(s, { type: 'Clean' })).toBe(false);
  });

  it('пункты: холодильник, медкнижки, документы поставщика', () => {
    const s = createInitialState(1);
    expect(itemScore(s, cfg, 'fridge')).toBe(100);
    expect(itemScore(noFridge(1), cfg, 'fridge')).toBe(0);
    s.employees[0].hasMedBook = false;
    expect(itemScore(s, cfg, 'medbooks')).toBe(50);
    applyCommand(s, { type: 'SetSupplier', supplier: 'cheap' });
    expect(itemScore(s, cfg, 'supplierDocs')).toBe(50);
    expect(sesScore(s, cfg)).toBeLessThan(sesScore(createInitialState(1), cfg));
  });

  it('скрытая сырость не видна игроку, пока её не нашли', () => {
    const s = createInitialState(1);
    s.defect = true;
    s.defectKnown = false;
    expect(itemScore(s, cfg, 'damp')).toBe(0);
    expect(itemScore(s, cfg, 'damp', true)).toBe(100);
  });

  it('шанс нарушения: p = (100 − шкала) / 100 · k, формалист цепляется к бумагам', () => {
    const items = checklist(cfg);
    const clean = items.find((i) => i.id === 'cleanliness') as ChecklistItem;
    const docs = items.find((i) => i.id === 'supplierDocs') as ChecklistItem;
    const tired = inspectorById(cfg, 'ses-tired');
    const formalist = inspectorById(cfg, 'ses-formalist');
    const practical = inspectorById(cfg, 'ses-practical');
    expect(violationChance(60, tired, clean)).toBeCloseTo(0.28);
    expect(violationChance(60, practical, clean)).toBeCloseTo(0.4 * 1.3);
    expect(violationChance(50, formalist, docs)).toBeCloseTo(0.5 * 1.3 * 1.5);
    expect(violationChance(100, formalist, docs)).toBe(0);
    expect(violationChance(0, formalist, docs)).toBe(1);
  });
});

describe('плановая проверка СЭС', () => {
  it('уведомление за 10 дней, визит на 75-й день', () => {
    const s = createInitialState(1);
    for (let i = 0; i < 64; i++) {
      while (s.pending.length) applyCommand(s, { type: 'Acknowledge' });
      simulateDay(s);
    }
    expect(s.day).toBe(65);
    expect(s.pending.some((p) => p.kind === 'inspectionNotice')).toBe(true);
    untilVisit(s);
    expect(s.day).toBe(75);
  });

  it('на «Учебке» формалистов нет', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createInitialState(seed, { ...defaultOptions(), difficulty: 'training' });
      expect(s.inspections[0].inspectorId).not.toBe('ses-formalist');
    }
  });

  it('нет холодильника – штраф $500 и приостановка на 3 дня; принял акт – повторная через 30 дней со штрафами ×2', () => {
    const s = noFridge(3);
    const visit = untilVisit(s);
    const fridge = visit.results.find((r) => r.itemId === 'fridge')!;
    expect(fridge).toMatchObject({ violated: true, fine: 500, suspensionDays: 3 });
    expect(visit.suspensionDays).toBe(3);
    expect(applyCommand(s, { type: 'Acknowledge' })).toBe(false);
    const cash = s.cash;
    expect(applyCommand(s, { type: 'ResolveInspection', choice: 'accept' })).toBe(true);
    expect(s.cash).toBeCloseTo(cash - visit.totalFine, 2);
    expect(s.suspendedUntilDay).toBe(77);
    expect(s.inspections[0]).toMatchObject({ reason: 'repeat', visitDay: 105, fineMultiplier: 2 });
    const closed = [simulateDay(s), simulateDay(s), simulateDay(s)];
    expect(closed.every((r) => !r.open && r.revenue === 0)).toBe(true);
    expect(simulateDay(s).open).toBe(true);
    expect(s.suspensionDaysTotal).toBe(3);

    const repeat = untilVisit(s);
    expect(repeat.reason).toBe('repeat');
    expect(repeat.results.find((r) => r.itemId === 'fridge')!.fine).toBe(1000);
  });

  it('всё в порядке – нарушений нет, окно просто закрывается', () => {
    let clean: GameState | null = null;
    for (let seed = 1; seed < 60 && !clean; seed++) {
      const s = createInitialState(seed, { ...defaultOptions(), repair: 'full' });
      while (s.day < 74) {
        while (s.pending.length) applyCommand(s, { type: 'Acknowledge' });
        simulateDay(s);
      }
      applyCommand(s, { type: 'Clean' });
      const v = untilVisit(s);
      if (v.totalFine === 0) clean = s;
    }
    expect(clean).not.toBeNull();
    expect(applyCommand(clean!, { type: 'ResolveInspection', choice: 'accept' })).toBe(false);
    expect(applyCommand(clean!, { type: 'Acknowledge' })).toBe(true);
    expect(clean!.inspections).toHaveLength(0);
  });

  it('оспорить: юрист $300, бывает и победа, и поражение; без нарушений по бумагам шанс выше', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = noFridge(seed);
      const visit = untilVisit(s);
      const cash = s.cash;
      applyCommand(s, { type: 'ResolveInspection', choice: 'contest' });
      const won = s.feed.some((f) => f.key === 'contestWon');
      outcomes.add(won ? 'won' : 'lost');
      expect(s.cash).toBeCloseTo(cash - 300 - (won ? 0 : visit.totalFine), 2);
      if (won) expect(s.suspendedUntilDay).toBe(0);
    }
    expect(outcomes.size).toBe(2);
    expect(contestChance(cfg, [{ itemId: 'fridge', violated: true, fine: 500, suspensionDays: 3, count: 1 }])).toBe(0.6);
    expect(contestChance(cfg, [{ itemId: 'medbooks', violated: true, fine: 200, suspensionDays: 0, count: 1 }])).toBe(0.3);
  });

  it('«договориться»: полштрафа и акт исчезает, но иногда это уголовное дело и конец игры', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = noFridge(seed);
      const visit = untilVisit(s);
      const cash = s.cash;
      applyCommand(s, { type: 'ResolveInspection', choice: 'bribe' });
      if (s.finished) {
        expect(s.outcome).toBe('criminal');
        outcomes.add('criminal');
      } else {
        expect(s.cash).toBeCloseTo(cash - visit.totalFine / 2, 2);
        expect(s.inspections).toHaveLength(0);
        outcomes.add('ok');
      }
      expect(s.stats.bribes).toBe(1);
    }
    expect(outcomes.size).toBe(2);
  });

  it('консультант: +15 к чистоте и находит скрытую сырость; её можно устранить', () => {
    const s = createInitialState(1);
    s.defect = true;
    s.defectKnown = false;
    expect(applyCommand(s, { type: 'HireConsultant' })).toBe(false); // проверка ещё не объявлена
    while (s.day < 65) {
      while (s.pending.length) applyCommand(s, { type: 'Acknowledge' });
      simulateDay(s);
    }
    const before = s.cleanliness;
    expect(applyCommand(s, { type: 'HireConsultant' })).toBe(true);
    expect(s.cleanliness).toBe(Math.min(100, before + 15));
    expect(s.defectKnown).toBe(true);
    expect(applyCommand(s, { type: 'HireConsultant' })).toBe(false);
    expect(applyCommand(s, { type: 'FixDefect' })).toBe(true);
    expect(s.defect).toBe(false);
  });
});

describe('внеплановые проверки и закрытие', () => {
  it('при шкале ниже 40 рано или поздно приходит внеплановая; на «Выживании» – без уведомления', () => {
    const s = noFridge(11, 'survival');
    s.inspections = [];
    applyCommand(s, { type: 'DebugAddMoney', amount: 500000 });
    applyCommand(s, { type: 'SetSupplier', supplier: 'cheap' });
    s.employees.forEach((e) => (e.hasMedBook = false));
    const visit = untilVisit(s);
    expect(visit.reason).toBe('unplanned');
    expect(s.feed.some((f) => f.key === 'inspectionScheduled')).toBe(false);
  });

  it('приостановки дольше 30 дней суммарно – договор аренды расторгнут', () => {
    const s = createInitialState(1);
    applyCommand(s, { type: 'DebugAddMoney', amount: 500000 });
    s.inspections = [];
    s.suspendedUntilDay = 40;
    for (let i = 0; i < 31 && !s.finished; i++) {
      while (s.pending.length) applyCommand(s, { type: 'Acknowledge' });
      simulateDay(s);
    }
    expect(s.outcome).toBe('closed');
  });
});

describe('финансовые сводки', () => {
  it('подушка: считается по темпу последних дней, в плюсе – бесконечность', () => {
    const s = createInitialState(1);
    for (let i = 0; i < 7; i++) simulateDay(s);
    const days = cushionDays(s, cfg);
    expect(days).toBeGreaterThan(0);
    expect(Number.isFinite(days)).toBe(true);
    s.history.forEach((r) => (r.revenue += 5000));
    expect(cushionDays(s, cfg)).toBe(Infinity);
  });

  it('календарь показывает платежи месяца, налог и плановую проверку', () => {
    const list = upcoming(createInitialState(1), cfg);
    expect(list[0]).toMatchObject({ day: 30, kind: 'month' });
    expect(list.some((u) => u.kind === 'inspection' && u.day === 75)).toBe(true);
    expect(list.some((u) => u.kind === 'tax' && u.day === 115)).toBe(true);
    expect(list.at(-1)).toMatchObject({ kind: 'yearEnd', day: 360 });
  });

  it('очки = деньги + половина оборудования + депозит − налоговый долг − стартовый капитал', () => {
    const s = createInitialState(1);
    const sc = computeScore(s, cfg);
    expect(sc.equipment).toBe((4000 + 400 + 2500 + 800) / 2);
    expect(sc.deposit).toBe(4800);
    expect(sc.total).toBeCloseTo(s.cash + sc.equipment + 4800 - 20000, 2);
    expect(sc.medal).toBeNull();
  });
});
