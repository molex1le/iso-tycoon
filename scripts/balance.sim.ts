/**
 * Прогон партий ботами для проверки баланса: npm run balance
 * Боты пока простые (кредитов и серых схем в ядре ещё нет):
 *  - «честный»: надёжный поставщик, уборка по расписанию, готовится к проверкам, принимает акты;
 *  - «экономный»: дешёвый поставщик, не убирается, оспаривает акты;
 *  - «пассивный»: ничего не трогает, только закрывает окна.
 */
import { it } from 'vitest';
import { announcedInspection, applyCommand } from '../src/core/commands';
import { defaultConfig as cfg } from '../src/core/config';
import { computeScore } from '../src/core/finance';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState, defaultOptions, type GameState, type NewGameOptions } from '../src/core/state';

type Bot = (s: GameState) => void;

function closePending(s: GameState, choice: 'accept' | 'contest' | 'bribe') {
  while (s.pending.length && !s.finished) {
    const p = s.pending[0];
    if (p.kind === 'inspectionVisit' && p.totalFine > 0) applyCommand(s, { type: 'ResolveInspection', choice });
    else applyCommand(s, { type: 'Acknowledge' });
  }
}

const bots: Record<string, Bot> = {
  honest: (s) => {
    closePending(s, 'accept');
    if (s.cleanliness < 60) applyCommand(s, { type: 'Clean' });
    const insp = announcedInspection(s);
    if (insp && !insp.consultant && s.cash > 1500) applyCommand(s, { type: 'HireConsultant' });
    if (s.defect && s.defectKnown && s.cash > 2500) applyCommand(s, { type: 'FixDefect' });
    if (s.employees.filter((e) => e.role === 'barista').length < 2) {
      const c = s.candidates.find((x) => x.role === 'barista');
      if (c) applyCommand(s, { type: 'Hire', candidateId: c.id });
    }
    for (const e of s.employees) if (!e.hasMedBook) applyCommand(s, { type: 'IssueMedBook', employeeId: e.id });
  },
  cheap: (s) => {
    closePending(s, 'contest');
    if (s.supplier !== 'cheap') applyCommand(s, { type: 'SetSupplier', supplier: 'cheap' });
    if (s.employees.filter((e) => e.role === 'barista').length < 2) {
      const c = s.candidates.find((x) => x.role === 'barista');
      if (c) applyCommand(s, { type: 'Hire', candidateId: c.id });
    }
  },
  passive: (s) => closePending(s, 'accept'),
};

function play(seed: number, bot: Bot, opts: NewGameOptions): GameState {
  const s = createInitialState(seed, opts, cfg);
  while (!s.finished) {
    bot(s);
    if (!s.finished) simulateDay(s, cfg);
  }
  return s;
}

const N = Number(process.env.GAMES ?? 1000);

it('баланс: прогон партий ботами', () => {
  const rows: string[] = [];
  for (const difficulty of ['training', 'realism', 'survival'] as const) {
    for (const [name, bot] of Object.entries(bots)) {
      const opts: NewGameOptions = { ...defaultOptions(cfg), difficulty };
      // на «Выживании» денег на метро не хватает – бот берёт спальный район без мебели
      if (difficulty === 'survival') Object.assign(opts, { location: 'suburb', extras: ['fridge'] });
      let survived = 0;
      let score = 0;
      let minCash = 0;
      let rep = 0;
      const out: Record<string, number> = {};
      const months = new Array(12).fill(0);
      for (let i = 0; i < N; i++) {
        const s = play(1000 + i, bot, opts);
        out[s.outcome!] = (out[s.outcome!] ?? 0) + 1;
        if (s.outcome === 'year') survived++;
        score += computeScore(s, cfg).total;
        minCash += Math.min(...s.history.map((r) => r.cash));
        rep += s.reputation;
        for (const r of s.history) months[r.month - 1] += r.profit / N;
      }
      rows.push(
        `${difficulty.padEnd(9)} ${name.padEnd(8)} дожили ${((survived / N) * 100).toFixed(0).padStart(3)}%  очки ${(score / N).toFixed(0).padStart(7)}  мин.деньги ${(minCash / N).toFixed(0).padStart(7)}  реп ${(rep / N).toFixed(2)}  ${JSON.stringify(out)}\n` +
          `          прибыль по месяцам: ${months.map((m) => m.toFixed(0)).join(' ')}`,
      );
    }
  }
  console.log('\n' + rows.join('\n'));
}, 600_000);
