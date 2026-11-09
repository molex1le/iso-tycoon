import { defaultConfig, type GameConfig } from './config';
import { simulateDay } from './simulateDay';
import { createInitialState, type GameState, type LoggedCommand } from './state';

/** Любое действие игрока – объект-команда. UI ничего не меняет в состоянии сам. */
export type Command =
  | { type: 'SetPrice'; itemId: string; price: number }
  | { type: 'DebugAddMoney'; amount: number };

/**
 * Применяет команду и пишет её в лог (с номером дня).
 * Возвращает false и ничего не пишет, если команда некорректна.
 */
export function applyCommand(state: GameState, command: Command, cfg: GameConfig = defaultConfig): boolean {
  if (state.finished) return false;
  switch (command.type) {
    case 'SetPrice': {
      const p = cfg.balance.prices;
      if (!(command.itemId in state.prices) || !Number.isFinite(command.price)) return false;
      const stepped = Math.round(command.price / p.step) * p.step;
      const price = Math.round(Math.min(p.max, Math.max(p.min, stepped)) * 100) / 100;
      if (price === state.prices[command.itemId]) return false;
      state.prices[command.itemId] = price;
      break;
    }
    case 'DebugAddMoney': {
      if (!Number.isFinite(command.amount)) return false;
      state.cash = Math.round((state.cash + command.amount) * 100) / 100;
      break;
    }
  }
  state.commandLog.push({ day: state.day, command });
  return true;
}

/** Точный повтор партии: сид + лог команд, до начала дня untilDay. */
export function replay(seed: number, log: LoggedCommand[], untilDay: number, cfg: GameConfig = defaultConfig): GameState {
  const state = createInitialState(seed, cfg);
  let i = 0;
  while (!state.finished && state.day <= untilDay) {
    while (i < log.length && log[i].day === state.day) applyCommand(state, log[i++].command, cfg);
    if (state.day === untilDay) break;
    simulateDay(state, cfg);
  }
  return state;
}
