import balanceJson from '../data/balance.json';
import inspectionsJson from '../data/inspections.json';
import inspectorsJson from '../data/inspectors.json';
import itemsJson from '../data/items.json';
import materialsJson from '../data/materials.json';
import namesJson from '../data/names.json';
import textsJson from '../data/texts.json';

export type Balance = typeof balanceJson;
export type DifficultyId = keyof Balance['difficulties'];
export type LocationId = keyof Balance['locations'];
export type FormId = keyof Balance['forms'];
export type TaxRegimeId = keyof Balance['taxes']['regimes'];
export type SupplierId = keyof Balance['suppliers'];
export type EquipmentId = keyof Balance['equipment'];

export interface Item {
  id: string;
  name: string;
  /** drink – основной напиток заказа, addon – добавка к заказу (share = шанс добавки) */
  kind: 'drink' | 'addon';
  defaultPrice: number;
  share: number;
  /** сколько порций сырья уходит на одну позицию */
  recipe: Record<string, number>;
}

export interface Material {
  id: string;
  name: string;
  /** цена порции у «Надёжного» поставщика */
  cost: number;
  shelfLifeDays: number;
  deliveryEveryDays: number;
  needsFridge: boolean;
}

export interface ChecklistItem {
  id: string;
  name: string;
  /** live – шанс нарушения зависит от шкалы, static – есть или нет */
  type: 'live' | 'static';
  fine: number;
  suspensionDays: number;
  /** пункт про бумаги: формалисты цепляются сильнее, без таких нарушений легче оспорить */
  docs: boolean;
  hint: string;
}

export interface Inspector {
  id: string;
  agency: string;
  name: string;
  trait: string;
  traitName: string;
  /** строгость: множитель шанса нарушения по живым пунктам */
  k: number;
  focus: string | null;
  focusFactor: number;
  text: string;
}

export type Inspections = typeof inspectionsJson;

export interface GameConfig {
  balance: Balance;
  items: Item[];
  materials: Material[];
  inspections: Inspections;
  inspectors: Inspector[];
  names: string[];
  texts: Record<string, { title: string; text: string }>;
}

export const defaultConfig: GameConfig = {
  balance: balanceJson,
  items: itemsJson as unknown as Item[],
  materials: materialsJson,
  inspections: inspectionsJson,
  inspectors: inspectorsJson,
  names: namesJson,
  texts: textsJson,
};

export function totalDays(b: Balance): number {
  return b.time.daysPerMonth * b.time.monthsPerYear;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Себестоимость позиции меню по рецепту. */
export function itemCost(item: Item, cfg: GameConfig, priceFactor = 1): number {
  let cost = 0;
  for (const [mat, qty] of Object.entries(item.recipe)) {
    cost += (cfg.materials.find((m) => m.id === mat)?.cost ?? 0) * qty;
  }
  return round2(cost * priceFactor);
}
