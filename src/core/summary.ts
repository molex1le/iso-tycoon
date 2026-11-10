import type { GameConfig } from './config';
import type { ExpenseCategory, GameState } from './state';

export interface Milestone {
  day: number;
  label: string;
  tone: 'good' | 'bad' | 'neutral';
}

export interface GameSummary {
  /** почему партия закончилась именно так */
  causes: string[];
  milestones: Milestone[];
  /** день, когда деньги впервые ушли в минус; 0 – не уходили */
  firstNegativeDay: number;
}

const FEED_MARKS: Record<string, Milestone['tone']> = {
  inspectionClean: 'good',
  inspectionAccepted: 'bad',
  contestWon: 'good',
  contestLost: 'bad',
  bribeOk: 'bad',
  suspended: 'bad',
  rivalClosed: 'good',
  joinedRival: 'bad',
  quit: 'bad',
};

const MAX_MARKS = 12;

/** Итог партии: решения на линии времени и причины результата. Только читает состояние. */
export function gameSummary(state: GameState, cfg: GameConfig): GameSummary {
  const marks: (Milestone & { weight: number })[] = [];
  for (const { day, command: c } of state.commandLog) {
    if (c.type === 'TakeLoan') marks.push({ day, label: `Взяли кредит «${cfg.balance.loans.products[c.product].name}»`, tone: 'neutral', weight: 3 });
    if (c.type === 'BuyEquipment') marks.push({ day, label: `Купили: ${cfg.balance.equipment[c.id].name}`, tone: 'neutral', weight: 1 });
    if (c.type === 'Hire') marks.push({ day, label: 'Наняли сотрудника', tone: 'neutral', weight: 1 });
    if (c.type === 'SetOffbook' && c.share > 0) marks.push({ day, label: 'Пустили выручку мимо кассы', tone: 'bad', weight: 3 });
  }
  for (const f of state.feed) {
    const tone = FEED_MARKS[f.key];
    if (tone) marks.push({ day: f.day, label: f.title, tone, weight: tone === 'bad' ? 4 : 2 });
  }
  const milestones = marks
    .sort((a, b) => b.weight - a.weight || a.day - b.day)
    .slice(0, MAX_MARKS)
    .sort((a, b) => a.day - b.day)
    .map(({ day, label, tone }) => ({ day, label, tone }));

  const h = state.history;
  const firstNegative = h.find((r) => r.cash < 0);
  const revenue = h.reduce((a, r) => a + r.revenue, 0);
  const sum = (cats: ExpenseCategory[]) => h.reduce((a, r) => a + cats.reduce((b, c) => b + (r.expenses[c] ?? 0), 0), 0);
  const demand = h.reduce((a, r) => a + r.demand, 0);
  const lost = h.reduce((a, r) => a + r.lostQueue + r.lostStock, 0);
  const openDays = h.filter((r) => r.open).length;
  const scored: [number, string][] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (revenue > 0) {
    const fixed = sum(['rent', 'payroll', 'utilities']) / revenue;
    if (fixed > 0.6) scored.push([fixed, `Аренда и зарплаты съедали ${pct(fixed)} выручки: помещение или команда были слишком дорогими для такого потока.`]);
    const fines = sum(['fines']) / revenue;
    if (fines > 0.04) scored.push([fines * 5, `Штрафы забрали ${pct(fines)} выручки. Проверки ударили сильнее всего, что можно было подготовить заранее.`]);
    const loans = sum(['loans']) / revenue;
    if (loans > 0.15) scored.push([loans * 2.5, `Платежи по кредитам – ${pct(loans)} выручки: долг рос быстрее, чем кофейня зарабатывала.`]);
  }
  if (demand > 0 && lost / demand > 0.12) scored.push([(lost / demand) * 3, `${pct(lost / demand)} желающих ушли без кофе: не хватало людей, мощности кофемашины или продуктов.`]);
  if (h.length > 0 && openDays / h.length < 0.9) scored.push([(1 - openDays / h.length) * 4, `Кофейня простаивала ${h.length - openDays} дн. из ${h.length}.`]);
  if (state.reputation < 3) scored.push([(3 - state.reputation) / 2, `Репутация упала до ${state.reputation.toFixed(1).replace('.', ',')}: гости голосовали ногами.`]);
  if (state.outcome === 'criminal') scored.push([9, 'Схема вскрылась: это уголовное дело, а не штраф.']);
  const causes = scored.sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
  if (!causes.length) causes.push(state.outcome === 'year' ? 'Серьёзных провалов не было: кофейня пережила год без крупных ударов.' : 'Запас денег закончился раньше, чем поток гостей вышел на окупаемость.');
  return { causes, milestones, firstNegativeDay: firstNegative?.day ?? 0 };
}
