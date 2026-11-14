import chatJson from '../data/chat.json';
import { usd } from './feed';
import { spend } from './finance';
import { moodOf } from './staff';
import type { Employee, GameState } from './state';
import { fillText } from './text';
import type { GameConfig } from './config';

export const chatCfg = chatJson;

export interface ChatMsg {
  day: number;
  /** имя сотрудника или 'me' – директор */
  from: string;
  text: string;
}

/**
 * Выбор реплики без общего генератора случайности: чат – украшение
 * и не должен менять ход партии при том же сиде.
 */
function pick<T>(list: T[], state: GameState, salt: number): T {
  const h = Math.abs(Math.imul(state.seed ^ (state.day * 2654435761) ^ (salt * 40503), 2246822519)) >>> 0;
  return list[h % list.length];
}

export function pushChat(state: GameState, from: string, text: string): void {
  if (!text) return;
  const chat = (state.chat ??= []);
  chat.push({ day: state.day, from, text: from === 'me' ? text : fillText(text, { name: from }) });
  if (chat.length > chatJson.limit) chat.splice(0, chat.length - chatJson.limit);
}

/** Реплика сотрудника по поводу: найм, уход, прибавка, снижение. */
export function chatReact(state: GameState, e: Employee, kind: 'hired' | 'quit' | 'fired' | 'raise' | 'cut'): void {
  pushChat(state, e.name, pick(chatJson[kind], state, e.id));
}

/** Утро: раз в несколько дней кто-то из команды пишет в чат – по настроению. */
export function ambientChat(state: GameState, cfg: GameConfig): void {
  if (state.day % chatJson.everyDays !== 0 || state.employees.length === 0) return;
  const e = pick(state.employees, state, 7);
  pushChat(state, e.name, pick(chatJson.ambient[moodOf(e, cfg)], state, e.id + 13));
}

export function canPraise(state: GameState): boolean {
  return state.employees.length > 0 && state.day - (state.lastPraiseDay ?? -99) >= chatJson.praiseEveryDays;
}

/** Похвалить команду: бесплатно, но не чаще раза в неделю. */
export function praise(state: GameState): boolean {
  if (!canPraise(state)) return false;
  state.lastPraiseDay = state.day;
  for (const e of state.employees) e.loyaltyBonus += chatJson.praiseLoyalty;
  pushChat(state, 'me', chatJson.praise);
  pushChat(state, pick(state.employees, state, 3).name, pick(chatJson.praiseReply, state, 5));
  return true;
}

export function bonusCost(state: GameState): number {
  return chatJson.bonusPerHead * state.employees.length;
}

/** Премия всем: деньги сейчас, лояльность надолго. */
export function bonus(state: GameState): boolean {
  const cost = bonusCost(state);
  if (cost <= 0 || state.cash < cost) return false;
  spend(state, 'payroll', cost);
  for (const e of state.employees) e.loyaltyBonus += chatJson.bonusLoyalty;
  pushChat(state, 'me', fillText(chatJson.bonus, { amount: usd(chatJson.bonusPerHead) }));
  pushChat(state, pick(state.employees, state, 11).name, pick(chatJson.bonusReply, state, 17));
  return true;
}
