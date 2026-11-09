import { monthOf, seasonOf } from './calendar';
import { defaultConfig, totalDays, type GameConfig } from './config';
import { attractiveness, averageCheck, customersPerDay, marketShare } from './demand';
import { nextRandom } from './rng';
import type { DayRecord, GameState } from './state';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Мощность за один период дня: минимум из бариста на смене и кофемашины. */
export function periodCapacity(state: GameState, cfg: GameConfig = defaultConfig): number {
  const c = cfg.balance.capacity;
  return Math.min(state.baristas * c.ordersPerBaristaHour, state.machineOrdersPerHour) * c.hoursPerPeriod;
}

/** Делит целое число клиентов по периодам дня (метод наибольших остатков). */
function splitByPeriods(total: number, shares: number[]): number[] {
  const exact = shares.map((s) => total * s);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, n) => a + n, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length].i]++;
  return out;
}

/**
 * Считает текущий день партии и переводит состояние на следующий.
 * Продажи = минимум из спроса и мощности (склад пока не ограничивает).
 * Меняет state на месте, возвращает строку телеметрии за день.
 */
export function simulateDay(state: GameState, cfg: GameConfig = defaultConfig): DayRecord {
  if (state.finished) throw new Error('Партия уже завершена');
  const b = cfg.balance;
  const day = state.day;
  const month = monthOf(day, b);
  const season = seasonOf(month, b);

  // спрос
  const check = averageCheck(state.prices, cfg.items);
  const own = attractiveness(state.quality, check, state.reputation, b.demand);
  const rivals = state.competitors.map((c) => attractiveness(c.quality, c.avgCheck, c.reputation, b.demand));
  const share = marketShare(own, rivals, b.demand.stayHomeWeight);
  const noise = 1 + b.demand.noise * (nextRandom(state) * 2 - 1);
  const demand = Math.max(
    0,
    Math.round(
      customersPerDay({
        footTraffic: state.footTraffic,
        season: season.demand,
        coffeeWantShare: b.demand.coffeeWantShare,
        awareness: state.awareness,
        share,
      }) * noise,
    ),
  );

  // мощность по периодам: утро / день / вечер
  const perPeriod = periodCapacity(state, cfg);
  const byPeriod = splitByPeriods(demand, b.periods.map((p) => p.share));
  let served = 0;
  for (const d of byPeriod) served += Math.min(d, perPeriod);
  const lost = demand - served;

  // заказы: напиток по долям меню + добавки
  const drinks = cfg.items.filter((i) => i.kind === 'drink');
  const addons = cfg.items.filter((i) => i.kind === 'addon');
  const shareSum = drinks.reduce((a, i) => a + i.share, 0);
  const sold: Record<string, number> = {};
  for (const i of cfg.items) sold[i.id] = 0;
  for (let n = 0; n < served; n++) {
    let r = nextRandom(state) * shareSum;
    let drink = drinks[drinks.length - 1];
    for (const d of drinks) {
      if (r < d.share) {
        drink = d;
        break;
      }
      r -= d.share;
    }
    sold[drink.id]++;
    for (const a of addons) if (nextRandom(state) < a.share) sold[a.id]++;
  }

  let revenue = 0;
  let cogs = 0;
  for (const i of cfg.items) {
    revenue += sold[i.id] * state.prices[i.id];
    cogs += sold[i.id] * i.cost;
  }
  revenue = round2(revenue);
  cogs = round2(cogs);
  const profit = round2(revenue - cogs);
  state.cash = round2(state.cash + profit);

  const record: DayRecord = {
    day,
    month,
    season: season.id,
    demand,
    served,
    lost,
    capacity: perPeriod * b.periods.length,
    revenue,
    cogs,
    profit,
    cash: state.cash,
    avgCheck: round2(check),
    awareness: state.awareness,
    share,
    reputation: state.reputation,
    sold,
  };
  state.history.push(record);

  // конец дня
  state.awareness = Math.min(b.awareness.max, round2(state.awareness + b.awareness.dailyGrowth));
  state.day = day + 1;
  if (state.day > totalDays(b)) state.finished = true;
  return record;
}
