import type { Command } from './commands';
import {
  AGENCIES,
  clamp,
  defaultConfig,
  round2,
  type AccountingId,
  type AgencyId,
  type DifficultyId,
  type EquipmentId,
  type FormId,
  type GameConfig,
  type LoanProductId,
  type LocationId,
  type SupplierId,
  type TaxRegimeId,
} from './config';
import { orderQuantity, shelfLife } from './inventory';
import { makeLoan } from './loans';
import { nextRandom, seedToState } from './rng';

export interface Competitor {
  id: string;
  name: string;
  quality: number;
  avgCheck: number;
  reputation: number;
  lowShareDays: number;
  /** закрыт до этого дня включительно (0 – работает) */
  closedUntilDay: number;
}

export interface Employee {
  id: number;
  name: string;
  role: 'barista' | 'cleaner';
  salary: number;
  experience: number;
  hasMedBook: boolean;
  /** день, когда будет готова заказанная медкнижка */
  medBookReadyDay: number | null;
  fatigue: number;
  hiredDay: number;
  official: boolean;
  /** накопленные события: премии, отказы */
  loyaltyBonus: number;
}

export interface Candidate {
  id: number;
  name: string;
  role: 'barista' | 'cleaner';
  salary: number;
  experience: number;
  hasMedBook: boolean;
}

/** Партия сырья на складе (FIFO). Годна по день expiresDay включительно. */
export interface Batch {
  qty: number;
  expiresDay: number;
  unitCost: number;
}

export type InspectionReason = 'planned' | 'unplanned' | 'repeat';

export interface Inspection {
  id: number;
  agency: AgencyId;
  inspectorId: string;
  reason: InspectionReason;
  /** за что пришли – показывается игроку */
  cause: string;
  noticeDay: number;
  visitDay: number;
  fineMultiplier: number;
  consultant: boolean;
}

export interface VisitResult {
  itemId: string;
  violated: boolean;
  fine: number;
  suspensionDays: number;
  /** сколько раз нарушено (например, сотрудников без медкнижки) */
  count: number;
}

/** Событие, которое ставит игру на паузу и ждёт игрока. */
export type Pending =
  | { kind: 'monthReport'; month: number }
  | { kind: 'inspectionNotice'; inspectionId: number }
  | { kind: 'event'; eventId: string; targetId: number | null; vars: Record<string, string> }
  | {
      kind: 'inspectionVisit';
      agency: AgencyId;
      inspectorId: string;
      reason: InspectionReason;
      results: VisitResult[];
      totalFine: number;
      suspensionDays: number;
    };

export type ExpenseCategory = 'purchases' | 'rent' | 'payroll' | 'utilities' | 'services' | 'equipment' | 'marketing' | 'tax' | 'loans' | 'fines';

export type Outcome = 'year' | 'bankrupt' | 'closed' | 'criminal';

export interface FeedEntry {
  day: number;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  key: string;
  title: string;
  text: string;
}

export interface Review {
  day: number;
  stars: number;
  text: string;
}

/** Строка телеметрии: итог одного игрового дня. */
export interface DayRecord {
  day: number;
  month: number;
  season: string;
  open: boolean;
  /** сколько людей хотело к нам */
  demand: number;
  served: number;
  /** ушли из очереди – не хватило мощности */
  lostQueue: number;
  /** ушли, потому что кончились продукты */
  lostStock: number;
  /** мощность за день, заказов */
  capacity: number;
  revenue: number;
  /** сырьё, ушедшее в проданные заказы */
  cogs: number;
  /** списанная просрочка */
  waste: number;
  /** прибыль дня по начислению: выручка − сырьё − дневная доля постоянных расходов */
  profit: number;
  /** реальные списания денег за день по статьям */
  expenses: Partial<Record<ExpenseCategory, number>>;
  cash: number;
  avgCheck: number;
  quality: number;
  awareness: number;
  share: number;
  rivalShares: number[];
  reputation: number;
  cleanliness: number;
  sold: Record<string, number>;
}

export interface LoggedCommand {
  day: number;
  command: Command;
}

export interface NewGameOptions {
  shopName: string;
  difficulty: DifficultyId;
  form: FormId;
  taxRegime: TaxRegimeId;
  location: LocationId;
  /** осмотр помещения до аренды – показывает скрытый дефект */
  premisesInspection: boolean;
  repair: 'cosmetic' | 'full';
  machine: 'machineBasic' | 'machinePro';
  extras: EquipmentId[];
  accounting: AccountingId;
  /** сумма стартового кредита «Старт», 0 – без кредита */
  startLoan: number;
  /** первые два бариста: официально или «в конверте» */
  startStaffOfficial: boolean;
}

export interface SetupLine {
  id: string;
  name: string;
  amount: number;
}

export interface Loan {
  id: number;
  product: LoanProductId;
  principal: number;
  /** остаток основного долга */
  balance: number;
  annualRate: number;
  months: number;
  payment: number;
  nextPayDay: number;
  /** просроченная сумма с пенями */
  overdue: number;
  overdueSince: number | null;
  collectors: boolean;
}

export type DefectType = 'damp' | 'wiring' | 'exit';

export interface TaxDue {
  amount: number;
  declareBy: number;
  payBy: number;
  filed: boolean;
  /** пени и штрафы сверх налога */
  penalty: number;
  /** штраф за неподачу уже начислен столько раз */
  undeclaredFines: number;
}

/** Всё состояние партии. Только данные – сериализуется в JSON как есть. */
export interface GameState {
  version: 3;
  seed: number;
  rngState: number;
  /** текущий (ещё не посчитанный) день, 1..360 */
  day: number;
  finished: boolean;
  outcome: Outcome | null;
  options: NewGameOptions;
  setup: SetupLine[];
  shopName: string;
  startCapital: number;
  cash: number;
  footTraffic: number;
  awareness: number;
  reputation: number;
  /** оценки удовлетворённости за текущую неделю */
  weekSatisfaction: number[];
  equipment: EquipmentId[];
  supplier: SupplierId;
  safetyFactor: number;
  /** сколько бариста одновременно за стойкой */
  posts: number;
  employees: Employee[];
  candidates: Candidate[];
  nextId: number;
  /** начисленные, но ещё не выплаченные сверхурочные */
  overtimeAccrued: number;
  inventory: Record<string, Batch[]>;
  cleanliness: number;
  /** скрытый дефект помещения */
  defect: boolean;
  defectType: DefectType;
  defectKnown: boolean;
  inspections: Inspection[];
  pending: Pending[];
  /** кофейня опечатана по этот день включительно */
  suspendedUntilDay: number;
  suspensionDaysTotal: number;
  /** закрыта по своей воле или из-за аварии */
  closedUntilDay: number;
  machineDownUntilDay: number;
  negativeDays: number;
  accounting: AccountingId;
  tax: {
    quarterRevenue: number;
    quarterDeductible: number;
    due: TaxDue | null;
    paidTotal: number;
    lateCount: number;
    /** недоплата из-за ошибок в декларациях – найдёт только проверка */
    hiddenError: number;
    rateDelta: number;
  };
  /** доля выручки мимо кассы, 0..0,3 */
  offbookShare: number;
  offbookTotal: number;
  /** «не списывать до последнего» */
  lateWriteOff: boolean;
  grade: string;
  onTimeStreak: number;
  loans: Loan[];
  flyersUntilDay: number;
  social: boolean;
  promo: boolean;
  serviceContract: boolean;
  rentFactor: number;
  flowMods: { factor: number; untilDay: number }[];
  costMods: { factor: number; untilDay: number }[];
  /** корпоративный заказ: осталось недель и деньги в пути */
  contractWeeks: number;
  receivables: { day: number; amount: number }[];
  eventLog: Record<string, number>;
  lastEventDay: number;
  reviews: Review[];
  /** ежедневная доля игрока для реакции конкурентов */
  shareLog: number[];
  /** ledger текущего дня по статьям, уходит в DayRecord */
  ledger: Partial<Record<ExpenseCategory, number>>;
  stats: { fines: number; bribes: number; contests: number; inspections: number; offbookCaught: number };
  lastSaid: Record<string, number>;
  feed: FeedEntry[];
  prices: Record<string, number>;
  competitors: Competitor[];
  history: DayRecord[];
  commandLog: LoggedCommand[];
}

export function defaultOptions(cfg: GameConfig = defaultConfig): NewGameOptions {
  return JSON.parse(JSON.stringify(cfg.balance.startPreset)) as NewGameOptions;
}

/**
 * Скрытые дефекты помещений. Зависят только от сида, а не от хода партии,
 * поэтому мастер старта и ядро видят одно и то же.
 */
export function rollDefects(seed: number, cfg: GameConfig = defaultConfig): Record<LocationId, DefectType | null> {
  const holder = { rngState: seedToState(seed ^ 0x5eed1234) };
  const out = {} as Record<LocationId, DefectType | null>;
  const types: DefectType[] = ['damp', 'wiring', 'exit'];
  for (const id of Object.keys(cfg.balance.locations) as LocationId[]) {
    const has = nextRandom(holder) < cfg.balance.locations[id].defectChance;
    const type = types[Math.floor(nextRandom(holder) * types.length)];
    out[id] = has ? type : null;
  }
  return out;
}

/** Строки расходов на открытие (без первой закупки). */
export function setupLines(opts: NewGameOptions, cfg: GameConfig = defaultConfig): SetupLine[] {
  const b = cfg.balance;
  const c = b.costs;
  const location = b.locations[opts.location];
  const lines: SetupLine[] = [
    { id: 'registration', name: `Регистрация ${b.forms[opts.form].name}`, amount: c.registration[opts.form] },
    { id: 'deposit', name: `Депозит за ${c.depositMonths} мес. аренды`, amount: location.rent * c.depositMonths },
  ];
  if (opts.premisesInspection) lines.push({ id: 'premisesInspection', name: 'Осмотр помещения', amount: c.premisesInspection });
  lines.push({ id: 'repair', name: opts.repair === 'full' ? 'Полный ремонт' : 'Косметический ремонт', amount: c.repair[opts.repair] });
  const equipment: EquipmentId[] = [opts.machine, 'register'];
  for (const id of opts.extras) if (id in b.equipment && !equipment.includes(id)) equipment.push(id);
  for (const id of equipment) lines.push({ id, name: b.equipment[id].name, amount: b.equipment[id].price });
  return lines;
}

export function createInitialState(seed: number, options?: NewGameOptions, cfg: GameConfig = defaultConfig): GameState {
  const b = cfg.balance;
  const opts = { ...defaultOptions(cfg), ...options };
  const difficulty = b.difficulties[opts.difficulty];
  const location = b.locations[opts.location];

  const setup = setupLines(opts, cfg);
  const equipment = setup.filter((l) => l.id in b.equipment).map((l) => l.id as EquipmentId);
  const defect = rollDefects(seed, cfg)[opts.location];
  const prices: Record<string, number> = {};
  for (const item of cfg.items) prices[item.id] = item.defaultPrice;

  let awareness = b.awareness.start;
  for (const id of equipment) awareness += b.equipment[id].awareness;

  const state: GameState = {
    version: 3,
    seed,
    rngState: seedToState(seed),
    day: 1,
    finished: false,
    outcome: null,
    options: opts,
    setup,
    shopName: opts.shopName,
    startCapital: difficulty.startCapital,
    cash: 0,
    footTraffic: location.footTraffic,
    awareness: clamp(round2(awareness), 0, b.awareness.max),
    reputation: b.reputation.start,
    weekSatisfaction: [],
    equipment,
    supplier: 'reliable',
    safetyFactor: b.inventory.safetyDefault,
    posts: 1,
    employees: b.staff.start.map((e, i) => ({
      id: i + 1,
      name: e.name,
      role: e.role as Employee['role'],
      salary: e.salary,
      experience: e.experience,
      hasMedBook: true,
      medBookReadyDay: null,
      fatigue: 0,
      hiredDay: 1,
      official: opts.startStaffOfficial,
      loyaltyBonus: 0,
    })),
    candidates: [],
    nextId: b.staff.start.length + 1,
    overtimeAccrued: 0,
    inventory: {},
    cleanliness: b.compliance.cleanStart,
    defect: defect !== null && opts.repair !== 'full',
    defectType: defect ?? 'damp',
    defectKnown: defect !== null && opts.premisesInspection,
    inspections: [],
    pending: [],
    suspendedUntilDay: 0,
    suspensionDaysTotal: 0,
    closedUntilDay: 0,
    machineDownUntilDay: 0,
    negativeDays: 0,
    accounting: opts.form === 'ooo' && opts.accounting === 'self' ? 'outsource' : opts.accounting,
    tax: { quarterRevenue: 0, quarterDeductible: 0, due: null, paidTotal: 0, lateCount: 0, hiddenError: 0, rateDelta: 0 },
    offbookShare: 0,
    offbookTotal: 0,
    lateWriteOff: false,
    grade: b.loans.startGrade,
    onTimeStreak: 0,
    loans: [],
    flyersUntilDay: 0,
    social: false,
    promo: false,
    serviceContract: false,
    rentFactor: 1,
    flowMods: [],
    costMods: [],
    contractWeeks: 0,
    receivables: [],
    eventLog: {},
    lastEventDay: 0,
    reviews: [],
    shareLog: [],
    ledger: {},
    stats: { fines: 0, bribes: 0, contests: 0, inspections: 0, offbookCaught: 0 },
    lastSaid: {},
    feed: [],
    prices,
    competitors: b.competitors.map((x) => ({ ...x, lowShareDays: 0, closedUntilDay: 0 })),
    history: [],
    commandLog: [],
  };

  // первая закупка: запас до первой поставки по каждому виду сырья
  let firstPurchase = 0;
  for (const m of cfg.materials) {
    const qty = orderQuantity(state, m, cfg);
    state.inventory[m.id] = qty > 0 ? [{ qty, expiresDay: shelfLife(state, m, cfg), unitCost: m.cost }] : [];
    firstPurchase += qty * m.cost;
  }
  setup.push({ id: 'firstPurchase', name: 'Первая закупка продуктов', amount: round2(firstPurchase) });

  const total = setup.reduce((a, l) => a + l.amount, 0);
  state.cash = round2(difficulty.startCapital - total);

  if (opts.startLoan > 0) {
    state.loans.push(makeLoan(state, cfg, 'start', opts.startLoan));
    state.cash = round2(state.cash + opts.startLoan);
  }

  // плановые проверки видны в календаре с первого дня
  for (const agency of AGENCIES) {
    const a = cfg.inspections[agency];
    state.inspections.push({
      id: state.nextId++,
      agency,
      inspectorId: pickInspectorId(state, cfg, agency),
      reason: 'planned',
      cause: 'План по графику',
      noticeDay: a.plannedDay - a.noticeDays,
      visitDay: a.plannedDay,
      fineMultiplier: 1,
      consultant: false,
    });
  }
  refreshCandidates(state, cfg);
  return state;
}

export function pickInspectorId(state: GameState, cfg: GameConfig, agency: AgencyId): string {
  const allowFormalists = cfg.balance.difficulties[state.options.difficulty].formalists;
  const pool = cfg.inspectors.filter((i) => i.agency === agency && (allowFormalists || i.trait !== 'formalist'));
  return pool[Math.floor(nextRandom(state) * pool.length)].id;
}

/** Раз в неделю приходят новые кандидаты. */
export function refreshCandidates(state: GameState, cfg: GameConfig): void {
  const s = cfg.balance.staff;
  const taken = new Set([...state.employees.map((e) => e.name)]);
  const out: Candidate[] = [];
  for (let i = 0; i < s.candidatesPerWeek; i++) {
    let name = cfg.names[Math.floor(nextRandom(state) * cfg.names.length)];
    for (let guard = 0; taken.has(name) && guard < cfg.names.length; guard++) {
      name = cfg.names[(cfg.names.indexOf(name) + 1) % cfg.names.length];
    }
    taken.add(name);
    const cleaner = nextRandom(state) < s.cleanerChance;
    const experience = 1 + Math.floor(nextRandom(state) * 5);
    const noise = Math.round((nextRandom(state) * 2 - 1) * s.baristaSalaryNoise);
    const hasMedBook = nextRandom(state) < s.medBookChance;
    out.push({
      id: state.nextId++,
      name,
      role: cleaner ? 'cleaner' : 'barista',
      salary: cleaner ? s.cleanerSalary : Math.round((s.baristaSalaryBase + s.baristaSalaryPerExp * experience + noise) / 10) * 10,
      experience: cleaner ? 1 : experience,
      hasMedBook,
    });
  }
  state.candidates = out;
}
