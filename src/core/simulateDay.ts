import { dayOfMonth, monthOf, seasonOf } from './calendar';
import { clamp, defaultConfig, round2, totalDays, type GameConfig } from './config';
import { say, usd } from './feed';
import { dailyFixed, payMonthEnd, processTaxes } from './finance';
import { decayCleanliness, morningInspections, rollUnplanned } from './inspections';
import { consume, receiveDeliveries, stockQty, writeOffExpired } from './inventory';
import { nextRandom } from './rng';
import { baristas, demandView, periodCapacity } from './shop';
import { finishMedBooks, updateStaffDay } from './staff';
import { refreshCandidates, type DayRecord, type GameState } from './state';

export { round2 };

/** Делит целое число клиентов по периодам дня (метод наибольших остатков). */
function splitByPeriods(total: number, shares: number[]): number[] {
  const exact = shares.map((s) => total * s);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, n) => a + n, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length].i]++;
  return out;
}

/** Удовлетворённость дня в звёздах 1–5: качество, очередь, цена против рынка, чистота. */
export function daySatisfaction(
  cfg: GameConfig,
  p: { quality: number; check: number; demand: number; lost: number; cleanliness: number },
): number {
  const b = cfg.balance;
  const w = b.reputation.weights;
  const q = clamp((p.quality - b.quality.min) / (b.quality.max - b.quality.min), 0, 1);
  const queue = p.demand > 0 ? clamp(1 - (p.lost / p.demand) * 2, 0, 1) : 1;
  const price = clamp(1.5 - p.check / b.demand.marketCheck, 0, 1);
  const clean = clamp(p.cleanliness / 100, 0, 1);
  return 1 + 4 * (w.quality * q + w.queue * queue + w.price * price + w.cleanliness * clean);
}

/**
 * Считает текущий день партии и переводит состояние на следующий.
 * Продажи = минимум из спроса, мощности и запасов на складе.
 * Меняет state на месте, возвращает строку телеметрии за день.
 */
export function simulateDay(state: GameState, cfg: GameConfig = defaultConfig): DayRecord {
  if (state.finished) throw new Error('Партия уже завершена');
  if (state.pending.length > 0) throw new Error('Есть событие, которое ждёт решения игрока');
  const b = cfg.balance;
  const day = state.day;
  const month = monthOf(day, b);
  const season = seasonOf(month, b);

  // ---------- утро ----------
  if (day > 1 && day % 7 === 1) refreshCandidates(state, cfg);
  finishMedBooks(state, cfg);
  if (day > 1) receiveDeliveries(state, cfg);

  const suspended = day <= state.suspendedUntilDay;
  const open = !suspended && baristas(state).length > 0;
  if (suspended) state.suspensionDaysTotal++;
  else if (!open) say(state, cfg, 'noBarista', 'bad', {}, 3);
  if (!suspended && state.suspendedUntilDay === day - 1 && day > 1) say(state, cfg, 'reopened', 'ok');

  // ---------- спрос ----------
  const view = demandView(state, cfg, day);
  const noise = 1 + b.demand.noise * (nextRandom(state) * 2 - 1);
  const demand = open ? Math.max(0, Math.round(view.expected * noise)) : 0;

  // ---------- мощность по периодам: утро / день / вечер ----------
  const perPeriod = open ? periodCapacity(state, cfg) : 0;
  const byPeriod = splitByPeriods(demand, b.periods.map((p) => p.share));
  let seated = 0;
  for (const d of byPeriod) seated += Math.min(d, perPeriod);
  const lostQueue = demand - seated;

  // ---------- заказы: напиток по долям меню + добавки, пока хватает сырья ----------
  const drinks = cfg.items.filter((i) => i.kind === 'drink');
  const addons = cfg.items.filter((i) => i.kind === 'addon');
  const shareSum = drinks.reduce((a, i) => a + i.share, 0);
  const avail: Record<string, number> = {};
  const used: Record<string, number> = {};
  for (const m of cfg.materials) {
    avail[m.id] = stockQty(state, m.id);
    used[m.id] = 0;
  }
  const canMake = (recipe: Record<string, number>) => Object.entries(recipe).every(([mat, q]) => avail[mat] >= q - 1e-9);
  const make = (recipe: Record<string, number>) => {
    for (const [mat, q] of Object.entries(recipe)) {
      avail[mat] -= q;
      used[mat] += q;
    }
  };
  const sold: Record<string, number> = {};
  for (const i of cfg.items) sold[i.id] = 0;
  const missing = new Set<string>();
  let served = 0;
  let lostStock = 0;
  for (let n = 0; n < seated; n++) {
    let r = nextRandom(state) * shareSum;
    let drink = drinks[drinks.length - 1];
    for (const d of drinks) {
      if (r < d.share) {
        drink = d;
        break;
      }
      r -= d.share;
    }
    if (!canMake(drink.recipe)) {
      for (const mat of Object.keys(drink.recipe)) if (avail[mat] < drink.recipe[mat]) missing.add(mat);
      const options = drinks.filter((d) => canMake(d.recipe));
      const switched = nextRandom(state) < b.demand.switchChance && options.length > 0;
      if (!switched) {
        lostStock++;
        continue;
      }
      drink = options[Math.floor(nextRandom(state) * options.length)];
    }
    make(drink.recipe);
    sold[drink.id]++;
    served++;
    for (const a of addons) {
      if (nextRandom(state) < a.share && canMake(a.recipe)) {
        make(a.recipe);
        sold[a.id]++;
      }
    }
  }

  let revenue = 0;
  for (const i of cfg.items) revenue += sold[i.id] * state.prices[i.id];
  revenue = round2(revenue);
  let cogs = 0;
  for (const m of cfg.materials) if (used[m.id] > 0) cogs += consume(state, m.id, used[m.id]);
  cogs = round2(cogs);
  state.cash = round2(state.cash + revenue);
  state.tax.quarterRevenue = round2(state.tax.quarterRevenue + revenue);

  if (lostQueue > 0) say(state, cfg, 'queue', 'warn', { n: lostQueue }, 5);
  if (lostStock > 0) {
    const names = cfg.materials.filter((m) => missing.has(m.id)).map((m) => m.name.toLowerCase());
    say(state, cfg, 'outOfStock', 'warn', { materials: names.join(', '), n: lostStock }, 3);
  }

  // ---------- вечер ----------
  const fixed = dailyFixed(state, cfg);
  updateStaffDay(state, cfg, open);
  const waste = writeOffExpired(state, cfg);
  if (waste.cost >= 20) say(state, cfg, 'wasted', 'warn', { amount: usd(waste.cost), materials: waste.names.join(', ') }, 5);
  decayCleanliness(state, cfg);

  // репутация: раз в неделю сдвигается к средней удовлетворённости, не больше чем на шаг
  if (served > 0) {
    state.weekSatisfaction.push(
      daySatisfaction(cfg, { quality: view.quality, check: view.check, demand, lost: lostQueue + lostStock, cleanliness: state.cleanliness }),
    );
  }
  if (day % 7 === 0 && state.weekSatisfaction.length > 0) {
    const avg = state.weekSatisfaction.reduce((a, s) => a + s, 0) / state.weekSatisfaction.length;
    const step = b.reputation.weeklyMaxStep;
    const before = state.reputation;
    state.reputation = clamp(round2(before + clamp(avg - before, -step, step)), 1, 5);
    state.weekSatisfaction = [];
    const stars = state.reputation.toFixed(1).replace('.', ',');
    if (Math.floor(state.reputation * 2) > Math.floor(before * 2)) say(state, cfg, 'reputationUp', 'ok', { stars });
    else if (Math.floor(state.reputation * 2) < Math.floor(before * 2)) {
      const reason = lostQueue + lostStock > 0 ? 'Клиенты уходят без кофе' : state.cleanliness < 50 ? 'Грязно' : 'Цена выше, чем готовы платить';
      say(state, cfg, 'reputationDown', 'bad', { stars, reason });
    }
  }

  state.awareness = Math.min(b.awareness.max, round2(state.awareness + b.awareness.dailyGrowth));

  const monthEnd = dayOfMonth(day, b) === b.time.daysPerMonth;
  if (monthEnd) payMonthEnd(state, cfg);
  processTaxes(state, cfg);

  // ---------- конец игры ----------
  if (state.cash < 0) {
    state.negativeDays++;
    say(state, cfg, 'negative', 'bad', { n: Math.max(0, b.gameOver.negativeDaysLimit - state.negativeDays + 1) }, 3);
  } else state.negativeDays = 0;

  const record: DayRecord = {
    day,
    month,
    season: season.id,
    open,
    demand,
    served,
    lostQueue,
    lostStock,
    capacity: perPeriod * b.periods.length,
    revenue,
    cogs,
    waste: waste.cost,
    profit: round2(revenue - cogs - waste.cost - fixed),
    expenses: state.ledger,
    cash: state.cash,
    avgCheck: round2(view.check),
    quality: round2(view.quality),
    awareness: state.awareness,
    share: view.share,
    rivalShares: view.rivalShares,
    reputation: state.reputation,
    cleanliness: state.cleanliness,
    sold,
  };
  state.history.push(record);
  state.ledger = {};
  state.day = day + 1;

  if (state.negativeDays > b.gameOver.negativeDaysLimit) finish(state, 'bankrupt');
  else if (state.suspensionDaysTotal > b.gameOver.suspensionDaysLimit) finish(state, 'closed');
  else if (state.day > totalDays(b)) finish(state, 'year');

  if (!state.finished) {
    // ---------- утро нового дня: то, что требует решения игрока ----------
    if (monthEnd) state.pending.push({ kind: 'monthReport', month });
    rollUnplanned(state, cfg);
    morningInspections(state, cfg);
  }
  return record;
}

function finish(state: GameState, outcome: GameState['outcome']): void {
  state.finished = true;
  state.outcome = outcome;
  state.pending = [];
}
