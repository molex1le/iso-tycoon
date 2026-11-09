import type { GameConfig } from './config';
import type { FeedEntry, GameState } from './state';

const FEED_LIMIT = 200;

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Сумма для текстов ленты: «$1 250». */
export function usd(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + '$' + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Пишет строку в ленту событий (тосты, журнал, хроника).
 * throttleDays > 0 – не повторять то же сообщение чаще, чем раз в столько дней.
 */
export function say(
  state: GameState,
  cfg: GameConfig,
  key: string,
  tone: FeedEntry['tone'],
  vars: Record<string, string | number> = {},
  throttleDays = 0,
): void {
  if (throttleDays > 0 && key in state.lastSaid && state.day - state.lastSaid[key] < throttleDays) return;
  state.lastSaid[key] = state.day;
  const t = cfg.texts[key] ?? { title: key, text: '' };
  state.feed.push({ day: state.day, tone, key, title: fill(t.title, vars), text: fill(t.text, vars) });
  if (state.feed.length > FEED_LIMIT) state.feed.splice(0, state.feed.length - FEED_LIMIT);
}
