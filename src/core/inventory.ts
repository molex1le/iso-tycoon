import { round2, type GameConfig, type Material } from './config';
import { say } from './feed';
import { fireTriggered } from './events';
import { accountBlocked, spend } from './finance';
import { nextRandom } from './rng';
import { costFactor, demandView, periodCapacity } from './shop';
import type { GameState } from './state';

export function stockQty(state: GameState, materialId: string): number {
  return (state.inventory[materialId] ?? []).reduce((a, b) => a + b.qty, 0);
}

/** Срок годности с учётом холодильника. */
export function shelfLife(state: GameState, m: Material, cfg: GameConfig): number {
  if (m.needsFridge && !state.equipment.includes('fridge')) return Math.min(m.shelfLifeDays, cfg.balance.inventory.noFridgeShelfLifeDays);
  return m.shelfLifeDays;
}

/** Ожидаемый расход сырья за день, порций. */
export function expectedDailyUsage(state: GameState, cfg: GameConfig): Record<string, number> {
  const clients = Math.min(demandView(state, cfg).expected, periodCapacity(state, cfg) * cfg.balance.periods.length);
  const drinks = cfg.items.filter((i) => i.kind === 'drink');
  const shareSum = drinks.reduce((a, i) => a + i.share, 0);
  const usage: Record<string, number> = {};
  for (const m of cfg.materials) usage[m.id] = 0;
  for (const item of cfg.items) {
    const perClient = item.kind === 'drink' ? item.share / shareSum : item.share;
    for (const [mat, qty] of Object.entries(item.recipe)) usage[mat] += clients * perClient * qty;
  }
  return usage;
}

/** Сколько заказать, чтобы дожить до следующей поставки с запасом. */
export function orderQuantity(state: GameState, m: Material, cfg: GameConfig): number {
  const need = expectedDailyUsage(state, cfg)[m.id] * m.deliveryEveryDays * state.safetyFactor;
  return Math.max(0, Math.ceil(need - stockQty(state, m.id)));
}

/** Утренние поставки по автозаказу. */
export function receiveDeliveries(state: GameState, cfg: GameConfig): void {
  const supplier = cfg.balance.suppliers[state.supplier];
  if (accountBlocked(state, cfg)) return;
  const failed: string[] = [];
  for (const m of cfg.materials) {
    if ((state.day - 1) % m.deliveryEveryDays !== 0) continue;
    const failChance = 1 - Math.pow(1 - supplier.failPerWeek, m.deliveryEveryDays / 7);
    if (nextRandom(state) < failChance) {
      failed.push(m.name);
      continue;
    }
    const qty = orderQuantity(state, m, cfg);
    if (qty <= 0) continue;
    const unitCost = round2(m.cost * supplier.priceFactor * costFactor(state));
    state.inventory[m.id].push({ qty, expiresDay: state.day + shelfLife(state, m, cfg) - 1, unitCost });
    spend(state, 'purchases', qty * unitCost, supplier.documents);
  }
  if (failed.length) say(state, cfg, 'deliveryFailed', 'warn', { materials: failed.join(', ') });
  if (failed.includes('Молоко')) fireTriggered(state, cfg, 'milk');
}

/** Снимает сырьё со склада по FIFO. Возвращает его стоимость. */
export function consume(state: GameState, materialId: string, qty: number): number {
  const batches = state.inventory[materialId];
  let cost = 0;
  let left = qty;
  while (left > 1e-9 && batches.length > 0) {
    const b = batches[0];
    const take = Math.min(b.qty, left);
    cost += take * b.unitCost;
    b.qty -= take;
    left -= take;
    if (b.qty <= 1e-9) batches.shift();
  }
  return cost;
}

/** Вечером списывает всё, что завтра уже не годно. */
export function writeOffExpired(state: GameState, cfg: GameConfig): { cost: number; names: string[] } {
  let cost = 0;
  const names: string[] = [];
  for (const m of cfg.materials) {
    const keep = [];
    for (const b of state.inventory[m.id]) {
      if (b.expiresDay + (state.lateWriteOff ? cfg.balance.grey.lateWriteOffDays : 0) <= state.day) {
        cost += b.qty * b.unitCost;
        if (b.qty >= 1 && !names.includes(m.name)) names.push(m.name);
      } else keep.push(b);
    }
    state.inventory[m.id] = keep;
  }
  return { cost: round2(cost), names };
}
