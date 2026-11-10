import type { GameConfig } from './config';
import { AGENCIES } from './config';
import { cushionDays, taxOwed } from './finance';
import { agencyScore } from './inspections';
import { baristas, closedReason, demandView, hasCleaner, hoursPerWeek } from './shop';
import type { GameState } from './state';

export interface Advice {
  /** чем выше, тем срочнее */
  priority: number;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  tab: string;
}

/** Советник: что важнее всего сделать сейчас. Только читает состояние. */
export function advise(state: GameState, cfg: GameConfig): Advice[] {
  const b = cfg.balance;
  const out: Advice[] = [];
  const add = (priority: number, tone: Advice['tone'], title: string, text: string, tab: string) => out.push({ priority, tone, title, text, tab });

  const closed = closedReason(state, cfg);
  if (closed) add(100, 'bad', `Кофейня не работает: ${closed}`, 'Каждый день простоя – минус выручка, а аренда идёт.', closed === 'нет бариста' ? 'staff' : 'overview');

  for (const l of state.loans) {
    if (l.overdue > 0 && l.overdueSince !== null) add(95, 'bad', 'Просрочка по кредиту', 'На 60-й день придут коллекторы, на 90-й банк заберёт кофемашину.', 'bank');
  }

  const d = state.tax.due;
  if (d && !d.filed) add(state.day >= d.declareBy - 5 ? 90 : 55, state.day > d.declareBy ? 'bad' : 'warn', state.day > d.declareBy ? 'Декларация просрочена' : `Подайте декларацию до ${d.declareBy}-го дня`, 'Иначе штраф и пени. Вкладка «Банк».', 'bank');
  else if (d && d.filed) add(state.day >= d.payBy - 5 ? 90 : 55, state.day > d.payBy ? 'bad' : 'warn', `Оплатите налог до ${d.payBy}-го дня`, `К оплате ${Math.round(taxOwed(state))} $. После срока – пеня 0,1% в день.`, 'bank');

  const cushion = cushionDays(state, cfg);
  if (cushion < 21) add(85, 'bad', `Денег на ${cushion} дн.`, 'Поднимите выручку, сократите расходы или посмотрите кредиты.', 'bank');

  for (const agency of AGENCIES) {
    const insp = state.inspections.find((i) => i.agency === agency && i.noticeDay <= state.day);
    if (!insp) continue;
    const score = agencyScore(state, cfg, agency, true);
    if (score < 100) add(80, 'warn', `${cfg.inspections[agency].name}: визит через ${insp.visitDay - state.day} дн.`, `Готовность ${score} из 100. Посмотрите чек-лист.`, 'checks');
  }
  const fire = state.inspections.find((i) => i.agency === 'fire' && i.reason === 'planned');
  if (fire && fire.visitDay - state.day <= 40 && !state.equipment.includes('extinguishers')) add(50, 'warn', 'Скоро пожарная проверка', 'Огнетушители и план эвакуации стоят дешевле штрафа.', 'gear');

  if (state.cleanliness < 50) add(70, 'warn', 'Грязно', 'Падают качество и репутация, СЭС это заметит.', 'checks');
  else if (state.cleanliness < 65 && !hasCleaner(state)) add(30, 'info', 'Нужна уборщица', 'Без неё чистота падает втрое быстрее. Кандидаты – во вкладке «Люди».', 'staff');

  if (state.employees.some((e) => !e.hasMedBook && e.medBookReadyDay === null)) add(45, 'warn', 'Нет медкнижки', 'За каждого сотрудника без неё – штраф от СЭС.', 'staff');

  const hours = hoursPerWeek(state, cfg);
  if (hours > b.staff.weeklyNormHours) add(65, 'warn', 'Люди перерабатывают', `${Math.round(hours)} часов в неделю при норме ${b.staff.weeklyNormHours}. Наймите ещё бариста или уберите второй пост.`, 'staff');
  if (baristas(state).some((e) => e.fatigue >= b.staff.fatigue.tired)) add(60, 'warn', 'Команда на пределе', 'С усталостью выше 90 люди увольняются.', 'staff');

  const week = state.history.slice(-5);
  if (week.length >= 3) {
    const demand = week.reduce((a, r) => a + r.demand, 0);
    const queue = week.reduce((a, r) => a + r.lostQueue, 0);
    const stock = week.reduce((a, r) => a + r.lostStock, 0);
    if (demand > 0 && queue / demand > 0.05) add(62, 'warn', 'Гости уходят из очереди', 'Поставьте второго бариста за стойку или купите машину мощнее.', 'staff');
    if (demand > 0 && stock / demand > 0.03) add(58, 'warn', 'Не хватает продуктов', 'Поднимите запас при автозаказе.', 'stock');
  }

  const v = demandView(state, cfg);
  if (v.check > b.demand.marketCheck * 1.25) add(35, 'info', 'Цены выше района', 'Чек заметно выше рынка – часть гостей уходит к конкурентам.', 'prices');
  if (state.awareness < 0.5 && !state.social && state.day > state.flyersUntilDay) add(25, 'info', 'О вас мало кто знает', 'Вывеска или листовки ускорят рост узнаваемости.', 'gear');

  return out.sort((a, c) => c.priority - a.priority).slice(0, 5);
}
