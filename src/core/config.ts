import balanceJson from '../data/balance.json';
import itemsJson from '../data/items.json';

export type Balance = typeof balanceJson;

export interface Item {
  id: string;
  name: string;
  /** drink – основной напиток заказа, addon – добавка к заказу (share = шанс добавки) */
  kind: 'drink' | 'addon';
  defaultPrice: number;
  cost: number;
  share: number;
}

export interface GameConfig {
  balance: Balance;
  items: Item[];
}

export const defaultConfig: GameConfig = {
  balance: balanceJson,
  items: itemsJson as Item[],
};

export function totalDays(b: Balance): number {
  return b.time.daysPerMonth * b.time.monthsPerYear;
}
