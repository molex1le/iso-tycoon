import { defaultConfig, type GameConfig } from './config';
import { seedToState } from './rng';
import type { Command } from './commands';

export interface Competitor {
  id: string;
  name: string;
  quality: number;
  avgCheck: number;
  reputation: number;
}

/** Строка телеметрии: итог одного игрового дня. */
export interface DayRecord {
  day: number;
  month: number;
  season: string;
  /** сколько людей хотело к нам */
  demand: number;
  /** сколько обслужили */
  served: number;
  /** ушли из очереди – не хватило мощности */
  lost: number;
  /** мощность за день, заказов */
  capacity: number;
  revenue: number;
  cogs: number;
  profit: number;
  /** деньги на конец дня */
  cash: number;
  avgCheck: number;
  awareness: number;
  share: number;
  reputation: number;
  sold: Record<string, number>;
}

export interface LoggedCommand {
  day: number;
  command: Command;
}

/** Всё состояние партии. Только данные – сериализуется в JSON как есть. */
export interface GameState {
  version: 1;
  seed: number;
  rngState: number;
  /** текущий (ещё не посчитанный) день, 1..360 */
  day: number;
  finished: boolean;
  shopName: string;
  difficulty: string;
  location: string;
  form: string;
  startCapital: number;
  cash: number;
  footTraffic: number;
  quality: number;
  awareness: number;
  reputation: number;
  baristas: number;
  machineOrdersPerHour: number;
  prices: Record<string, number>;
  competitors: Competitor[];
  history: DayRecord[];
  commandLog: LoggedCommand[];
}

export function createInitialState(seed: number, cfg: GameConfig = defaultConfig): GameState {
  const b = cfg.balance;
  const preset = b.startPreset;
  const difficulty = b.difficulties[preset.difficulty as keyof typeof b.difficulties];
  const location = b.locations[preset.location as keyof typeof b.locations];
  const equipment = b.equipment as Record<string, { ordersPerHour: number; quality: number }>;
  const machine = equipment[preset.machine];

  let quality = b.quality.base + machine.quality;
  for (const id of preset.equipment) quality += equipment[id].quality;
  quality = Math.min(b.quality.max, Math.max(b.quality.min, quality));

  const prices: Record<string, number> = {};
  for (const item of cfg.items) prices[item.id] = item.defaultPrice;

  return {
    version: 1,
    seed,
    rngState: seedToState(seed),
    day: 1,
    finished: false,
    shopName: preset.shopName,
    difficulty: preset.difficulty,
    location: preset.location,
    form: preset.form,
    startCapital: difficulty.startCapital,
    cash: preset.cash,
    footTraffic: location.footTraffic,
    quality,
    awareness: b.awareness.start,
    reputation: b.reputation.start,
    baristas: preset.baristas,
    machineOrdersPerHour: machine.ordersPerHour,
    prices,
    competitors: b.competitors.map((c) => ({ ...c })),
    history: [],
    commandLog: [],
  };
}
