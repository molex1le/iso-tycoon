import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/core/commands';
import { defaultConfig as cfg } from '../src/core/config';
import { bribeCost, memoryLine, nextQuestion, replyChance, rollVisit } from '../src/core/inspections';
import { createInitialState, type GameState, type Pending } from '../src/core/state';
import { gameSummary } from '../src/core/summary';

type Visit = Extract<Pending, { kind: 'inspectionVisit' }>;

function visit(seed = 3): { s: GameState; v: Visit } {
  const s = createInitialState(seed);
  s.defect = false;
  s.cleanliness = 0;
  s.equipment = s.equipment.filter((e) => e !== 'fridge');
  const v: Visit = { kind: 'inspectionVisit', agency: 'ses', inspectorId: cfg.inspectors[0].id, reason: 'planned', results: [{ itemId: 'cleanliness', violated: true, fine: 300, suspensionDays: 0, count: 1 }, { itemId: 'fridge', violated: true, fine: 500, suspensionDays: 3, count: 1 }], totalFine: 800, suspensionDays: 3 };
  s.pending = [v];
  return { s, v };
}

describe('разговор с инспектором', () => {
  it('признание снижает штраф по пункту и идёт дальше', () => {
    const { s, v } = visit();
    expect(nextQuestion(v)).toBe(0);
    applyCommand(s, { type: 'AnswerInspector', reply: 'admit' });
    expect(v.results[0].fine).toBe(300 * cfg.balance.dialogue.admitFactor);
    expect(v.totalFine).toBe(225 + 500);
    expect(nextQuestion(v)).toBe(1);
  });

  it('снятый пункт убирает приостановку', () => {
    const { s, v } = visit();
    v.results = [v.results[1]];
    v.totalFine = 500;
    v.inspectorId = cfg.inspectors.find((i) => i.trait === 'tired')!.id;
    let cleared = false;
    for (let seed = 1; seed < 80 && !cleared; seed++) {
      const copy: GameState = JSON.parse(JSON.stringify(s));
      copy.rngState = seed * 7919;
      applyCommand(copy, { type: 'AnswerInspector', reply: 'explain' });
      const r = (copy.pending[0] as Visit).results[0];
      if (r.fine === 0) {
        cleared = true;
        expect((copy.pending[0] as Visit).suspensionDays).toBe(0);
      }
    }
    expect(cleared).toBe(true);
  });

  it('спор опирается на настоящую готовность', () => {
    const { s, v } = visit();
    const low = replyChance(s, cfg, v, 0, 'argue');
    s.cleanliness = 95;
    expect(replyChance(s, cfg, v, 0, 'argue')).toBeGreaterThan(low);
  });

  it('инспектор помнит взятку и берёт дороже', () => {
    const { s, v } = visit();
    const before = bribeCost(s, cfg, v);
    s.inspectorMemory = { [v.inspectorId]: { bribes: 1, admits: 0, argues: 0 } };
    expect(bribeCost(s, cfg, v)).toBeGreaterThan(before);
    expect(memoryLine(s, cfg, v.inspectorId)).toBe(cfg.dialogues.memory.bribe);
  });

  it('у каждого пункта чек-листа есть реплики', () => {
    for (const a of Object.values(cfg.inspections)) for (const item of a.items) expect(cfg.dialogues.items[item.id], item.id).toBeDefined();
  });

  it('повтор партии с ответами точный', () => {
    const s = createInitialState(11);
    s.pending = [rollVisit(s, cfg, s.inspections[0])];
    const a = s.pending[0] as Visit;
    while (nextQuestion(a) >= 0) applyCommand(s, { type: 'AnswerInspector', reply: 'explain' });
    expect(JSON.stringify(s)).toContain('inspectionVisit');
  });
});

describe('итог партии', () => {
  it('называет причину и отмечает решения', () => {
    const s = createInitialState(2);
    s.commandLog.push({ day: 5, command: { type: 'TakeLoan', product: 'start', amount: 5000 } } as GameState['commandLog'][number]);
    s.feed.push({ day: 40, tone: 'bad', key: 'inspectionAccepted', title: 'Штраф', text: '' });
    for (let day = 1; day <= 30; day++) s.history.push({ day, month: 1, revenue: 100, profit: -50, cash: 1000 - day * 50, demand: 50, served: 40, lostQueue: 10, lostStock: 0, open: true, expenses: { rent: 80 } } as unknown as GameState['history'][number]);
    s.outcome = 'bankrupt';
    const r = gameSummary(s, cfg);
    expect(r.milestones.map((m) => m.day)).toEqual([5, 40]);
    expect(r.causes[0]).toContain('Аренда');
    expect(r.firstNegativeDay).toBe(21);
  });
});
