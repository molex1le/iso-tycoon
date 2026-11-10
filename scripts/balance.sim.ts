import { nextQuestion } from '../src/core/inspections';
/**
 * Прогон партий ботами для проверки баланса: npm run balance (GAMES=1000 по умолчанию).
 * Ориентиры на «Реализме»: честный доживает в 60–75%, серый зарабатывает больше, но проигрывает чаще,
 * кредитный агрессор банкротится больше чем в половине случаев.
 */
import { it } from 'vitest';
import { announcedInspection, applyCommand } from '../src/core/commands';
import { defaultConfig as cfg, type EquipmentId } from '../src/core/config';
import { computeScore, taxOwed } from '../src/core/finance';
import { loanOffer } from '../src/core/loans';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState, defaultOptions, type GameState, type NewGameOptions } from '../src/core/state';

type Choice = 'accept' | 'contest' | 'bribe';
interface Bot {
  opts?: Partial<NewGameOptions>;
  act: (s: GameState) => void;
}

function closePending(s: GameState, choose: (fine: number) => Choice, option: (n: number) => number = () => 0): void {
  while (s.pending.length && !s.finished) {
    const p = s.pending[0];
    if (p.kind === 'event') {
      const n = cfg.events.find((e) => e.id === p.eventId)!.options.length;
      // разговор о деньгах: ни один разумный директор не поднимает зарплату каждый месяц
      const index = p.eventId === 'raise_ask' ? (s.cash > 6000 ? 0 : 2) : p.eventId === 'promise_due' ? (s.cash > 6000 ? 0 : 1) : option(n);
      applyCommand(s, { type: 'ChooseEventOption', index });
    } else if (p.kind === 'inspectionVisit' && p.totalFine > 0) {
      // без «переговоров» проверка стала бы дороже, чем для игрока: боты всегда признают нарушения
      while (nextQuestion(p) >= 0) applyCommand(s, { type: 'AnswerInspector', reply: 'admit' });
      if (p.totalFine > 0) applyCommand(s, { type: 'ResolveInspection', choice: choose(p.totalFine) });
      else applyCommand(s, { type: 'Acknowledge' });
    }
    else applyCommand(s, { type: 'Acknowledge' });
  }
}

function payTaxes(s: GameState): void {
  if (s.tax.due && !s.tax.due.filed) applyCommand(s, { type: 'FileDeclaration' });
  if (s.tax.due && s.cash > taxOwed(s) + 300) applyCommand(s, { type: 'PayTax' });
}

function keepBaristas(s: GameState, official: boolean): void {
  if (s.employees.filter((e) => e.role === 'barista').length < 2) {
    const c = s.candidates.find((x) => x.role === 'barista');
    if (c) applyCommand(s, { type: 'Hire', candidateId: c.id, official });
  }
}

function buyIf(s: GameState, id: EquipmentId, reserve: number): void {
  if (!s.equipment.includes(id) && s.cash > cfg.balance.equipment[id].price + reserve) applyCommand(s, { type: 'BuyEquipment', id });
}

const bots: Record<string, Bot> = {
  honest: {
    act: (s) => {
      closePending(s, () => 'accept');
      payTaxes(s);
      if (s.cleanliness < 60 && s.cash > 800) applyCommand(s, { type: 'Clean' });
      keepBaristas(s, true);
      for (const e of s.employees) if (!e.hasMedBook) applyCommand(s, { type: 'IssueMedBook', employeeId: e.id });
      const insp = announcedInspection(s);
      if (insp && !insp.consultant && s.cash > 1500) applyCommand(s, { type: 'HireConsultant' });
      if (s.defect && s.defectKnown && s.cash > 3000) applyCommand(s, { type: 'FixDefect' });
      if (s.day > 120) {
        buyIf(s, 'extinguishers', 500);
        buyIf(s, 'evacPlan', 500);
        buyIf(s, 'alarm', 3000);
      }
      if (s.cash < 0) {
        const o = loanOffer(s, cfg, 'start');
        if (o.available) applyCommand(s, { type: 'TakeLoan', product: 'start', amount: Math.min(o.limit, 5000) });
      }
    },
  },
  grey: {
    opts: { startStaffOfficial: false },
    act: (s) => {
      closePending(s, (fine) => (fine >= 1500 ? 'bribe' : 'contest'));
      payTaxes(s);
      if (s.supplier !== 'cheap') applyCommand(s, { type: 'SetSupplier', supplier: 'cheap' });
      if (s.offbookShare !== 0.2) applyCommand(s, { type: 'SetOffbook', share: 0.2 });
      keepBaristas(s, false);
      if (s.cleanliness < 45 && s.cash > 800) applyCommand(s, { type: 'Clean' });
      if (s.day > 140) buyIf(s, 'extinguishers', 500);
    },
  },
  aggressor: {
    opts: { startLoan: 20000 },
    act: (s) => {
      closePending(s, () => 'accept');
      payTaxes(s);
      keepBaristas(s, true);
      applyCommand(s, { type: 'TakeLoan', product: 'micro', amount: 5000 });
      buyIf(s, 'machinePro', 500);
      buyIf(s, 'signage', 500);
      if (!s.social && s.cash > 2000) applyCommand(s, { type: 'SetSocial', on: true });
      if (s.cleanliness < 50 && s.cash > 800) applyCommand(s, { type: 'Clean' });
    },
  },
};

function play(seed: number, bot: Bot, opts: NewGameOptions): GameState {
  const s = createInitialState(seed, { ...opts, ...bot.opts }, cfg);
  while (!s.finished) {
    bot.act(s);
    if (!s.finished && s.pending.length === 0) simulateDay(s, cfg);
  }
  return s;
}

const N = Number(process.env.GAMES ?? 1000);
const pct = (a: number[], q: number) => (a.length ? Math.round([...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)]) : 0);

it('баланс: прогон партий ботами', () => {
  const rows: string[] = [];
  for (const difficulty of ['training', 'realism', 'survival'] as const) {
    for (const [name, bot] of Object.entries(bots)) {
      const opts: NewGameOptions = { ...defaultOptions(cfg), difficulty };
      // на «Выживании» денег на метро не хватает – боты берут спальный район без мебели
      if (difficulty === 'survival') Object.assign(opts, { location: 'suburb', extras: ['fridge'] });
      let survived = 0;
      let score = 0;
      let lastDay = 0;
      const finals: number[] = [];
      const out: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const s = play(1000 + i, bot, opts);
        out[s.outcome!] = (out[s.outcome!] ?? 0) + 1;
        const total = computeScore(s, cfg).total;
        if (s.outcome === 'year') {
          survived++;
          finals.push(total);
        }
        score += total;
        lastDay += s.day;
      }
      rows.push(`${difficulty.padEnd(9)} ${name.padEnd(10)} дожили ${((survived / N) * 100).toFixed(0).padStart(3)}%  очки ${(score / N).toFixed(0).padStart(7)}  ср.день ${(lastDay / N).toFixed(0).padStart(3)}  выжившие p25/p50/p90 ${pct(finals, 0.25)}/${pct(finals, 0.5)}/${pct(finals, 0.9)}  ${JSON.stringify(out)}`);
    }
  }
  console.log('\n' + rows.join('\n'));
}, 900_000);
