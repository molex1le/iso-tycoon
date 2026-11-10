import type { GameState } from './state';

/** Экспорт партии для разбора плейтеста: строка на день, затем решения игрока. */
export function telemetryCsv(s: GameState): string {
  const cols = ['day', 'month', 'weather', 'open', 'demand', 'served', 'lostQueue', 'lostStock', 'revenue', 'cogs', 'waste', 'profit', 'cash', 'quality', 'awareness', 'share', 'reputation', 'cleanliness', 'branchProfit'] as const;
  const days = s.history.map((r) => cols.map((c) => r[c] ?? '').join(','));
  const decisions = s.commandLog.map((c) => `${c.day},${c.command.type},"${JSON.stringify(c.command).replace(/"/g, '""')}"`);
  return [`# seed=${s.seed} outcome=${s.outcome ?? 'in_progress'}`, cols.join(','), ...days, '', 'day,command,json', ...decisions].join('\n') + '\n';
}
