import { dayOfMonth, monthOf, seasonOf } from '../core/calendar';
import type { Speed } from '../core/clock';
import { announcedInspection, type Command } from '../core/commands';
import { AGENCIES, itemCost, totalDays, type AccountingId, type AgencyId, type EquipmentId, type LoanProductId, type SupplierId } from '../core/config';
import { eventById, fillVars, optionCost } from '../core/events';
import { accountantMonthly, accountBlocked, computeScore, cushionDays, dailyFixed, payrollMonthly, taxOwed, upcoming } from '../core/finance';
import { loanOffer, loansDebt } from '../core/loans';
import type { Game } from '../core/game';
import { agencyScore, checklist, contestChance, inspectorById, itemScore } from '../core/inspections';
import { expectedDailyUsage, stockQty, shelfLife } from '../core/inventory';
import { closedReason, demandView, hoursPerWeek } from '../core/shop';
import { loyaltyOf } from '../core/staff';
import type { DayRecord, ExpenseCategory, GameState, Pending } from '../core/state';
import { clockTime, money, monthName, percent, price, signedMoney } from './format';
import { audio, audioControlsHtml, type Sfx } from './audio';
import { bindCharts, clearCharts, lineChart } from './charts';
import { hash } from './scene/pen';
import { nightFactor, SceneView } from './scene/sceneView';
import { settings, saveSettings } from './settings';
import tips from '../data/tips.json';
import { advise } from '../core/advisor';

type Tab = 'overview' | 'finance' | 'prices' | 'staff' | 'stock' | 'checks' | 'gear' | 'bank' | 'dates' | 'journal';
const TABS: [Tab, string][] = [['overview', 'Обзор'], ['finance', 'Финансы'], ['prices', 'Цены'], ['staff', 'Люди'], ['stock', 'Склад'], ['checks', 'Проверки'], ['gear', 'Техника'], ['bank', 'Банк'], ['dates', 'Сроки'], ['journal', 'Журнал']];

const STAR = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--coin-shade)"><path d="m10 1.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"/></svg>';
const PERSON = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--ink-muted)"><circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-4 3-6.5 7-6.5s7 2.5 7 6.5z"/></svg>';
const EXPENSE_NAMES: Record<ExpenseCategory, string> = { purchases: 'Закупки', rent: 'Аренда', payroll: 'Зарплаты и взносы', utilities: 'Коммуналка', services: 'Услуги', equipment: 'Оборудование', marketing: 'Реклама', tax: 'Налоги', loans: 'Кредиты', fines: 'Штрафы' };
const OUTCOMES = {
  year: ['Год завершён', 'Кофейня дожила до конца года.'],
  bankrupt: ['Банкротство', 'Баланс был ниже нуля больше 14 дней. Долги остались на вас лично.'],
  closed: ['Кофейня закрыта', 'Приостановки дольше 30 дней – арендодатель расторг договор.'],
  criminal: ['Уголовное дело', 'Инспектор записал разговор. Взятка должностному лицу – конец игры.'],
} as const;
const stars = (n: number) => n.toFixed(1).replace('.', ',');
type TipKey = keyof typeof tips;
const q = (key: TipKey) => `<span class="gs-q" tabindex="0" role="note" aria-label="${tips[key]}" data-tip="${tips[key]}">?</span>`;
const row = (label: string, value: string, cls = '', tip?: TipKey) => `<div class="it-row"><span class="muted">${label}${tip ? q(tip) : ''}</span><span class="num ${cls}">${value}</span></div>`;
const bar = (v: number, cls = '') => `<div class="it-bar ${cls}"><i style="width:${Math.max(0, Math.min(100, Math.round(v)))}%"></i></div>`;

export interface ScreenHooks {
  save: () => void;
  download: () => void;
  exportCsv: () => void;
  menu: () => void;
  newGame: () => void;
}

export function mountGameScreen(root: HTMLElement, game: Game, hooks: ScreenHooks): () => void {
  const { cfg } = game;
  const b = cfg.balance;
  let tab: Tab = 'overview';
  let agencyTab: AgencyId = 'ses';
  let selected: string | null = null;
  let windowOpen = false;
  let chartRange = 90;
  let menuOpen = false;
  let debugOpen = false;
  let flowsOn = false;
  let feedSeen = game.state.feed.length;
  let visitKey = '';
  let visitShown = 0;
  let visitTimer = 0;
  let shownPending = '';
  let alive = true;

  root.innerHTML = `
  <div class="it gs">
    <div class="gs-map" data-ref="map"></div>
    <div class="gs-top"><div class="it-panel it-hud" data-ref="hud"></div></div>
    <div class="gs-toasts" data-ref="toasts" aria-live="polite"></div>
    <div class="it-panel gs-debug" data-ref="menu" hidden></div>
    <div class="it-panel gs-place" data-ref="place" hidden></div>
    <div class="it-panel gs-win" data-ref="win" role="dialog" aria-label="Управление кофейней" hidden>
      <nav class="gs-nav" data-ref="nav"></nav>
      <div class="gs-win-main"><div class="gs-win-head" data-ref="head"></div><div class="gs-win-body" data-ref="side"></div></div>
    </div>
    <div class="it-panel gs-dock" data-ref="dock"></div>
    <div class="gs-tip" data-ref="tip" hidden></div>
    <div class="gs-end" data-ref="modal" hidden></div>
  </div>`;
  const ref = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const screen = root.querySelector<HTMLElement>('.gs')!;
  const hudEl = ref('hud');
  const sideEl = ref('side');
  const menuEl = ref('menu');
  const modalEl = ref('modal');
  const toastsEl = ref('toasts');
  const placeEl = ref('place');
  const winEl = ref('win');
  const navEl = ref('nav');
  const headEl = ref('head');
  const dockEl = ref('dock');
  const tipEl = ref('tip');
  const scene = new SceneView(ref('map'), (id) => {
    if (id === 'player') {
      selected = null;
      windowOpen = true;
      tab = 'overview';
      audio.play('open');
    } else selected = id;
    renderAll();
  }, game.state.options.location);

  function showTip(html: string, x: number, y: number): void {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x + 14))}px`;
    tipEl.style.top = `${Math.max(8, y + 18 + r.height > innerHeight ? y - r.height - 12 : y + 18)}px`;
  }
  const hideTip = () => {
    tipEl.hidden = true;
  };
  bindCharts(sideEl, showTip, hideTip);
  screen.addEventListener('pointerover', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (t) showTip(t.dataset.tip!, e.clientX, e.clientY);
  });
  screen.addEventListener('pointerout', (e) => {
    if ((e.target as Element).closest('[data-tip]')) hideTip();
  });
  screen.addEventListener('focusin', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    showTip(t.dataset.tip!, r.right, r.bottom);
  });
  screen.addEventListener('focusout', (e) => {
    if ((e.target as Element).closest('[data-tip]')) hideTip();
  });

  const last = (): DayRecord | undefined => game.state.history[game.state.history.length - 1];
  const s = () => game.state;

  /** innerHTML с сохранением фокуса по data-k */
  function fill(el: HTMLElement, html: string): void {
    const k = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.k : undefined;
    el.innerHTML = html;
    if (k) el.querySelector<HTMLElement>(`[data-k='${k}']`)?.focus();
  }
  /** кнопка-команда: data-cmd с JSON */
  const cmd = (c: Command, label: string, cls = 'secondary', extra = '') =>
    `<button class="it-btn it-btn--${cls}" data-cmd='${JSON.stringify(c)}' data-k='${JSON.stringify(c)}' ${extra}>${label}</button>`;

  // ---------- верхняя полоса ----------
  function renderHud(): void {
    const st = s();
    const day = Math.min(st.day, totalDays(b));
    const month = monthOf(day, b);
    const l = last();
    const speed = game.blocked ? 0 : game.clock.speed;
    const cushion = cushionDays(st, cfg);
    const next = upcoming(st, cfg).find((u) => u.kind !== 'yearEnd');
    const btn = (v: Speed, text: string, aria = '') =>
      `<button data-speed="${v}" data-k="sp${v}" class="${speed === v ? 'on' : ''}" ${aria ? `aria-label="${aria}"` : ''} aria-pressed="${speed === v}">${text}</button>`;
    fill(hudEl, `
      <div class="it-stat" data-tip="${tips.cash}"><i class="it-coin"></i><div><div class="lbl">Баланс</div><div class="v ${st.cash < 0 ? 'loss' : ''}">${money(st.cash)}</div></div></div>
      <div class="it-stat" data-tip="${tips.profit}"><div><div class="lbl">Прибыль / день</div><div class="v ${l ? (l.profit < 0 ? 'loss' : 'money') : 'muted'}">${l ? signedMoney(l.profit) : '–'}</div></div></div>
      <div class="it-stat" data-tip="${tips.cushion}"><div><div class="lbl">Подушка</div><div class="v ${cushion < 21 ? 'loss' : ''}">${cushion === Infinity ? 'в плюсе' : cushion + ' дн.'}</div></div></div>
      <div class="it-stat" data-tip="${tips.reputation}">${STAR}<div><div class="lbl">Репутация</div><div class="v">${stars(st.reputation)}</div></div></div>
      <div class="it-stat">${PERSON}<div><div class="lbl">Персонал</div><div class="v">${st.employees.length}</div></div></div>
      <div class="it-stat gs-opt" data-tip="${next ? next.title : ''}"><div><div class="lbl">Ближайший срок</div><div class="v ${next && next.day - st.day <= 3 ? 'warn' : ''}">${next ? (next.day <= st.day ? 'сегодня' : 'через ' + (next.day - st.day) + ' дн.') : '–'}</div></div></div>
      <div class="spacer"></div>
      <div class="it-date"><div class="lbl">${seasonOf(month, b).name} · день ${day} из ${totalDays(b)}</div><div style="font-weight:600">${dayOfMonth(day, b)} · ${monthName(month)} · <span class="num" data-ref="time"></span></div></div>
      <div class="it-speed" role="group" aria-label="Скорость">${btn(0, '❚❚', 'Пауза')}${btn(1, '1×')}${btn(2, '2×')}${btn(3, '3×')}</div>
      <button class="it-btn it-btn--secondary it-btn--icon" data-menu data-k="menu" aria-label="Меню">☰</button>`);
    shownTime = '';
  }

  let shownTime = '';
  function renderTime(): void {
    const t = s().finished ? '–' : clockTime(game.clock.hour);
    if (t === shownTime) return;
    shownTime = t;
    const el = hudEl.querySelector('[data-ref="time"]');
    if (el) el.textContent = t;
  }

  // ---------- карта ----------
  function syncScene(): void {
    const st = s();
    const l = last();
    const reason = closedReason(st, cfg);
    const title = /«(.+)»/.exec(st.shopName)?.[1] ?? st.shopName;
    scene.setLook(
      {
        title,
        signage: st.equipment.includes('signage'),
        pro: st.equipment.includes('machinePro'),
        furniture: st.equipment.includes('furniture'),
        closed: reason !== null,
        rivalsClosed: st.competitors.map((c) => c.closedUntilDay > 0),
        alerts: mapAlerts(),
      },
      selected,
    );
    const v = demandView(st, cfg);
    const want = b.demand.coffeeWantShare * 3;
    scene.setFlow({
      traffic: st.footTraffic,
      pPlayer: Math.min(0.4, want * st.awareness * v.share),
      pRivals: v.rivalShares.map((x) => Math.min(0.4, want * x)),
      playerOpen: reason === null,
      queue: l ? l.lostQueue : 0,
    });
    scene.setOverlay(flowsOn ? { player: v.share, rivals: st.competitors.map((c, i) => ({ name: c.name, share: v.rivalShares[i] ?? 0, closed: c.closedUntilDay > 0 })) } : null);
    const month = monthOf(Math.min(st.day, totalDays(b)), b);
    const season = seasonOf(month, b).id;
    const roll = hash(st.day, st.seed & 0xffff, 40);
    const chance = season === 'winter' ? 0.55 : season === 'summer' ? 0.12 : 0.35;
    scene.setSeason(season === 'winter', roll < chance ? (season === 'winter' ? 'snow' : 'rain') : 'clear');
    const visit = st.pending[0]?.kind === 'inspectionVisit';
    const soon = st.inspections.some((i) => i.noticeDay <= st.day && i.visitDay - st.day <= 1);
    scene.setInspector(visit ? 'door' : soon ? 'coming' : 'none');
  }

  /** Здания города, которым нужен игрок: «!» на карте. */
  function mapAlerts(): string[] {
    const st = s();
    const out: string[] = [];
    if (st.loans.some((x) => x.overdue > 0)) out.push('bank');
    if (st.tax.due) out.push('tax');
    if (cfg.materials.some((m) => st.inventory[m.id].reduce((a, lot) => a + lot.qty, 0) <= 0)) out.push('depot');
    return out;
  }

  // ---------- боковая панель ----------
  function renderSide(): void {
    const st = s();
    placeEl.hidden = !selected;
    if (selected) fill(placeEl, otherHtml(selected));
    const badges: Partial<Record<Tab, number>> = {
      checks: st.inspections.filter((i) => i.noticeDay <= st.day).length,
      bank: (st.tax.due ? 1 : 0) + st.loans.filter((l) => l.overdue > 0).length,
    };
    const btn = (id: Tab, name: string) => `<button class="it-tab ${windowOpen && tab === id ? 'on' : ''}" data-tab="${id}" data-k="tab-${id}" aria-pressed="${windowOpen && tab === id}">${name}${badges[id] ? `<span class="gs-badge">${badges[id]}</span>` : ''}</button>`;
    fill(dockEl, TABS.map(([id, name]) => btn(id, name)).join('') + `<span class="gs-dock-sep"></span><button class="it-tab ${flowsOn ? 'on' : ''}" data-flows data-k="flows" aria-pressed="${flowsOn}">Потоки</button>`);
    winEl.hidden = !windowOpen;
    if (!windowOpen) {
      clearCharts();
      return;
    }
    fill(navEl, TABS.map(([id, name]) => btn(id, name)).join(''));
    const loc = b.locations[st.options.location];
    fill(headEl, `<div class="grow"><span class="it-lvl">${b.forms[st.options.form].name} · ${loc.name.toUpperCase()}</span> <span class="ttl">${st.shopName}</span></div><button class="it-btn it-btn--ghost it-btn--icon" data-close data-k="close" aria-label="Закрыть">✕</button>`);
    const flow: Partial<Record<Tab, boolean>> = { overview: false, finance: false, journal: false };
    const body = { overview: overviewHtml, finance: financeHtml, prices: pricesHtml, staff: staffHtml, stock: stockHtml, checks: checksHtml, gear: gearHtml, bank: bankHtml, dates: datesHtml, journal: journalHtml }[tab]();
    fill(sideEl, flow[tab] === false ? body : `<div class="gs-cols">${body}</div>`);
  }

  function otherHtml(id: string): string {
    const st = s();
    const back = '';
    const closeBtn = `<button class="it-btn it-btn--ghost it-btn--icon" data-select="" data-k="pl-close" aria-label="Закрыть">✕</button>`;
    if (id === 'metro') {
      const season = seasonOf(monthOf(Math.min(st.day, totalDays(b)), b), b);
      return `<header><div class="t"><span class="it-lvl">ИСТОЧНИК ПОТОКА</span><div class="ttl" style="margin-top:6px">Метро</div></div>${closeBtn}</header>
        <div class="gs-facts">${row('Поток у вашей двери', `${st.footTraffic} чел/день`)}${row('Сезон: ' + season.name.toLowerCase(), '×' + season.demand.toLocaleString('ru-RU'))}${row('Хотят кофе', percent(b.demand.coffeeWantShare))}${row('Знают о вас', percent(st.awareness))}</div>
        <div class="gs-note">Клиенты = поток × сезон × «хотят кофе» × узнаваемость × ваша доля.</div>${back}`;
    }
    if (id === 'bank') {
      const debt = st.loans.reduce((a, x) => a + x.balance + x.overdue, 0);
      return `<header><div class="t"><span class="it-lvl">ГОРОД</span><div class="ttl" style="margin-top:6px">Банк</div></div>${closeBtn}</header>
        <div class="gs-facts">${row('Кредитная история', st.grade, '', 'grade')}${row('Кредитов', String(st.loans.length))}${row('Общий долг', money(debt), debt ? 'loss' : '')}</div>
        <button class="it-btn it-btn--secondary" data-tab="bank" data-k="pl-go">Открыть вкладку «Банк»</button>`;
    }
    if (id === 'tax') {
      const d = st.tax.due;
      return `<header><div class="t"><span class="it-lvl">ГОРОД</span><div class="ttl" style="margin-top:6px">Налоговая</div></div>${closeBtn}</header>
        <div class="gs-facts">${row('Режим', b.taxes.regimes[st.options.taxRegime].name, '', 'regime')}${row('К оплате', d ? money(taxOwed(st)) : 'ничего', d ? 'loss' : '')}${d ? row(d.filed ? 'Оплатить до' : 'Подать до', `${d.filed ? d.payBy : d.declareBy}-го дня`) : ''}</div>
        <button class="it-btn it-btn--secondary" data-tab="bank" data-k="pl-go">К декларации</button>`;
    }
    if (id === 'depot') {
      const sup = b.suppliers[st.supplier];
      const next = Math.min(...cfg.materials.map((m) => m.deliveryEveryDays - ((st.day - 1) % m.deliveryEveryDays)));
      return `<header><div class="t"><span class="it-lvl">ГОРОД</span><div class="ttl" style="margin-top:6px">Оптовый склад</div></div>${closeBtn}</header>
        <div class="gs-facts">${row('Поставщик', sup.name)}${row('Следующая поставка', next <= 1 ? 'завтра утром' : `через ${next} дн.`)}${row('Срывы поставок', `${Math.round(sup.failPerWeek * 100)}% в неделю`)}</div>
        <button class="it-btn it-btn--secondary" data-tab="stock" data-k="pl-go">Открыть склад</button>`;
    }
    const i = Number(id.replace('rival', ''));
    const c = st.competitors[i];
    const v = demandView(st, cfg);
    return `<header><div class="t"><span class="it-lvl">КОНКУРЕНТ</span><div class="ttl" style="margin-top:6px">«${c.name}»</div></div>${closeBtn}</header>
      <div class="gs-facts">${row('Средний чек', price(c.avgCheck))}${row('Качество', c.quality.toLocaleString('ru-RU'))}${row('Репутация', stars(c.reputation))}${row('Доля прохожих', percent(v.rivalShares[i]))}${row('Ваша доля', percent(v.share))}</div>
      <div class="gs-note">Ваш чек ${price(v.check)}, качество ${v.quality.toFixed(2).replace('.', ',')}.</div>${back}`;
  }

  function adviceHtml(): string {
    if (!settings.hints) return '';
    const list = advise(s(), cfg);
    return `<div class="gs-sec"><div class="lbl">Что сделать сейчас</div>${
      list.length
        ? list.map((a) => `<button class="gs-advice ${a.tone}" data-tab="${a.tab}" data-k="adv-${a.title}"><div><b>${a.title}</b><span>${a.text}</span></div></button>`).join('')
        : '<div class="gs-note">Срочных дел нет. Загляните в «Финансы».</div>'
    }</div>`;
  }

  function overviewHtml(): string {
    const st = s();
    const l = last();
    const v = demandView(st, cfg);
    const cushion = cushionDays(st, cfg);
    const facts = row('Узнаваемость', percent(st.awareness), '', 'awareness') + row('Качество', v.quality.toFixed(2).replace('.', ','), '', 'quality') + row('Постоянные расходы', money(dailyFixed(st, cfg)) + ' / день', '', 'fixed') + row('Доля среди прохожих', percent(v.share), '', 'share') + row('Средний чек', price(v.check), '', 'check');
    const tile = (label: string, value: string, cls = '', tip?: TipKey) => `<div class="gs-tile"><div class="lbl">${label}${tip ? q(tip) : ''}</div><div class="v ${cls}">${value}</div></div>`;
    const lost = l ? l.lostQueue + l.lostStock : 0;
    const load = l && l.capacity > 0 ? l.served / l.capacity : 0;
    const tiles = l
      ? tile('Выручка вчера', money(l.revenue)) + tile('Прибыль вчера', signedMoney(l.profit), l.profit < 0 ? 'loss' : 'money', 'profit') + tile('Клиентов', String(l.served)) + tile('Ушли без кофе', String(lost), lost ? 'loss' : '') + tile('Подушка', cushion === Infinity ? 'в плюсе' : cushion + ' дн.', cushion < 21 ? 'loss' : '', 'cushion')
      : tile('Ждём клиентов', '≈ ' + Math.round(v.expected)) + tile('Подушка', cushion === Infinity ? 'в плюсе' : cushion + ' дн.', cushion < 21 ? 'loss' : '', 'cushion');
    const data = series(30);
    return `<div class="gs-sec"><div class="gs-tiles">${tiles}</div>${closedNote()}
      <div class="gs-grid2">
        <div class="gs-sec">${lineChart('ov-cash', { title: 'Деньги на счёте, 30 дней', x: data.x, series: [{ name: 'Деньги', color: 'var(--c2)', values: data.cash }], format: short })}
          ${l ? `<div><div class="it-row" style="margin-bottom:6px"><span class="lbl grow">Загрузка${q('load')}</span><span class="num">${percent(load)}</span></div>${bar(load * 100)}</div>` : ''}
          <div class="gs-facts">${facts}</div></div>
        <div class="gs-sec">${adviceHtml()}${reviewsHtml()}</div>
      </div></div>`;
  }

  /** Истории по корзинам: на длинном интервале точки усредняются. */
  function series(range: number) {
    const h = s().history.slice(-range);
    const size = Math.max(1, Math.ceil(h.length / 45));
    const out = { x: [] as number[], cash: [] as number[], revenue: [] as number[], costs: [] as number[], served: [] as number[], lost: [] as number[], you: [] as number[], r0: [] as number[], r1: [] as number[], rep: [] as number[] };
    for (let i = 0; i < h.length; i += size) {
      const part = h.slice(i, i + size);
      const end = part[part.length - 1];
      const avg = (f: (r: DayRecord) => number) => Math.round((part.reduce((a, r) => a + f(r), 0) / part.length) * 100) / 100;
      out.x.push(end.day);
      out.cash.push(end.cash);
      out.revenue.push(avg((r) => r.revenue));
      out.costs.push(avg((r) => r.revenue - r.profit));
      out.served.push(avg((r) => r.served));
      out.lost.push(avg((r) => r.lostQueue + r.lostStock));
      out.you.push(avg((r) => r.share * 100));
      out.r0.push(avg((r) => (r.rivalShares[0] ?? 0) * 100));
      out.r1.push(avg((r) => (r.rivalShares[1] ?? 0) * 100));
      out.rep.push(end.reputation);
    }
    return out;
  }

  const short = (v: number) => {
    const sign = v < 0 ? '−' : '';
    const a = Math.abs(v);
    return sign + '$' + (a >= 10000 ? Math.round(a / 1000) + ' тыс.' : Math.round(a).toLocaleString('ru-RU'));
  };

  function financeHtml(): string {
    const st = s();
    const d = series(chartRange);
    const ranges = ([[30, '30 дней'], [90, '90 дней'], [360, 'Год']] as const).map(([v, n]) => `<button class="${chartRange === v ? 'on' : ''}" data-range="${v}" data-k="r${v}">${n}</button>`).join('');
    const names = st.competitors.map((c) => c.name);
    const charts = [
      lineChart('f-cash', { title: 'Деньги на счёте', x: d.x, series: [{ name: 'Деньги', color: 'var(--c2)', values: d.cash }], format: short }),
      lineChart('f-pl', { title: 'Выручка и расходы в день', x: d.x, series: [{ name: 'Выручка', color: 'var(--c3)', values: d.revenue }, { name: 'Расходы', color: 'var(--c1)', values: d.costs }], format: short, min: 0 }),
      lineChart('f-cl', { title: 'Клиенты в день', x: d.x, series: [{ name: 'Обслужили', color: 'var(--c3)', values: d.served }, { name: 'Ушли', color: 'var(--c1)', values: d.lost }], format: (v) => String(Math.round(v)), min: 0 }),
      lineChart('f-sh', { title: 'Доля рынка, %', x: d.x, series: [{ name: 'Вы', color: 'var(--c1)', values: d.you }, { name: names[0], color: 'var(--c2)', values: d.r0 }, { name: names[1], color: 'var(--c3)', values: d.r1 }], format: (v) => Math.round(v) + '%', min: 0 }),
      lineChart('f-rep', { title: 'Репутация, звёзды', x: d.x, series: [{ name: 'Репутация', color: 'var(--c2)', values: d.rep }], format: (v) => v.toFixed(1).replace('.', ','), min: 1, max: 5 }),
    ].join('');
    return `<div class="gs-sec"><div class="it-seg gs-range">${ranges}</div><div class="gs-grid2">${charts}</div><div class="lbl">Отчёт по месяцам, деньги</div><div class="gs-pl-wrap">${plTable()}</div></div>`;
  }

  function plTable(): string {
    const st = s();
    if (!st.history.length) return '<div class="gs-note">Первая строка появится после первого дня.</div>';
    const months = [...new Set(st.history.map((r) => r.month))];
    const byMonth = months.map((m) => {
      const days = st.history.filter((r) => r.month === m);
      const exp: Partial<Record<ExpenseCategory, number>> = {};
      for (const r of days) for (const [k, v] of Object.entries(r.expenses)) exp[k as ExpenseCategory] = (exp[k as ExpenseCategory] ?? 0) + v;
      return { rev: days.reduce((a, r) => a + r.revenue, 0), exp };
    });
    const cats = (Object.keys(EXPENSE_NAMES) as ExpenseCategory[]).filter((c) => byMonth.some((m) => m.exp[c]));
    const cell = (v: number, cls = '') => `<td class="${cls}">${v ? Math.round(v).toLocaleString('ru-RU') : '–'}</td>`;
    const totals = byMonth.map((m) => m.rev - Object.values(m.exp).reduce((a, v) => a + v, 0));
    return `<table class="gs-pl"><thead><tr><th>$</th>${months.map((m) => `<th>${monthName(m).slice(0, 3)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Выручка</td>${byMonth.map((m) => cell(m.rev)).join('')}</tr>
      ${cats.map((c) => `<tr><td>${EXPENSE_NAMES[c]}</td>${byMonth.map((m) => cell(m.exp[c] ?? 0)).join('')}</tr>`).join('')}
      <tr class="total"><td>Итог</td>${totals.map((v) => cell(v, v < 0 ? 'loss' : 'money')).join('')}</tr></tbody></table>`;
  }

  function journalHtml(): string {
    const feed = [...s().feed].reverse().slice(0, 80);
    return feed.length ? feed.map((f) => `<div class="gs-log"><span class="d">день ${f.day}</span><div><b>${f.title}</b>${f.text ? ` – ${f.text}` : ''}</div></div>`).join('') : '<div class="gs-note">Пока ничего не случилось.</div>';
  }

  function closedNote(): string {
    const r = closedReason(s(), cfg);
    return r ? `<div class="gs-note loss">Сегодня кофейня не работает: ${r}.</div>` : '';
  }

  function reviewsHtml(): string {
    const list = s().reviews.slice(-3).reverse();
    if (!list.length) return '';
    return `<div class="lbl">Отзывы</div>${list.map((r) => `<div class="gs-card"><div class="gs-note">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)} · день ${r.day}</div><div>${r.text}</div></div>`).join('')}`;
  }

  function pricesHtml(): string {
    const st = s();
    const factor = b.suppliers[st.supplier].priceFactor;
    const v = demandView(st, cfg);
    const rows = cfg.items.map((i) => {
      const p = st.prices[i.id];
      const cost = itemCost(i, cfg, factor);
      const step = b.prices.step;
      return `<div class="gs-price"><div class="n"><b>${i.name}</b><span>сырьё ${price(cost)} · наценка ${price(p - cost)}</span></div>
        <button class="it-btn it-btn--secondary gs-step" data-price="${i.id}" data-delta="${-step}" data-k="p-${i.id}-m" aria-label="${i.name}: дешевле" ${p <= b.prices.min ? 'disabled' : ''}>−</button>
        <span class="v">${price(p)}</span>
        <button class="it-btn it-btn--secondary gs-step" data-price="${i.id}" data-delta="${step}" data-k="p-${i.id}-p" aria-label="${i.name}: дороже" ${p >= b.prices.max ? 'disabled' : ''}>+</button></div>`;
    }).join('');
    const diff = v.check / b.demand.marketCheck - 1;
    return `<div class="gs-prices">${rows}</div><div class="gs-facts">${row('Ожидаемый средний чек', price(v.check))}${row('Район: ' + price(b.demand.marketCheck), `${diff > 0 ? 'выше' : 'ниже'} на ${percent(Math.abs(diff))}`, diff > 0.005 ? 'warn' : 'money')}${row('Ждём клиентов в день', '≈ ' + Math.round(v.expected))}</div>
      <div class="gs-note">+10% к чеку – примерно −13% клиентов.</div>`;
  }

  function staffHtml(): string {
    const st = s();
    const hours = hoursPerWeek(st, cfg);
    const over = hours > b.staff.weeklyNormHours;
    const posts = [1, 2].map((n) => `<button class="${st.posts === n ? 'on' : ''}" data-cmd='${JSON.stringify({ type: 'SetPosts', posts: n })}' data-k="posts${n}">${n} за стойкой</button>`).join('');
    const who = (role: string, exp: number) => (role === 'cleaner' ? 'Уборщица' : `Бариста · опыт ${'★'.repeat(exp)}${'☆'.repeat(5 - exp)}`);
    const team = st.employees.map((e) => {
      const book = e.hasMedBook ? '' : e.medBookReadyDay !== null ? `<span class="warn">медкнижка через ${e.medBookReadyDay - st.day} дн.</span>` : cmd({ type: 'IssueMedBook', employeeId: e.id }, `Медкнижка ${money(b.costs.medBook)}`, 'secondary gs-mini');
      const loyalty = loyaltyOf(e, cfg);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${e.name}</b><span class="num">${money(e.salary)}</span></div>
        <div class="gs-note">${who(e.role, e.experience)} · ${e.official ? 'официально' : '<span class="warn">в конверте</span>'}</div>
        ${e.role === 'barista' ? `<div class="it-row"><span class="gs-note" style="width:82px">Усталость${q('fatigue')}</span><div class="grow">${bar(e.fatigue, e.fatigue >= b.staff.fatigue.tired ? 'bad' : 'coin')}</div></div>` : ''}
        <div class="it-row"><span class="gs-note" style="width:82px">Лояльность${q('loyalty')}</span><div class="grow">${bar(loyalty, loyalty < b.staff.poachBelow ? 'bad' : '')}</div></div>
        <div class="it-row gs-wrap">${book}${e.official ? '' : cmd({ type: 'Officialize', employeeId: e.id }, 'Оформить', 'secondary gs-mini')}<span class="grow"></span>${cmd({ type: 'Fire', employeeId: e.id, severance: true }, `Уволить, ${money(e.salary)}`, 'ghost gs-mini loss')}${cmd({ type: 'Fire', employeeId: e.id, severance: false }, 'Без компенсации', 'ghost gs-mini loss', `title="Шанс жалобы: ${percent(e.official ? b.staff.complaintNoSeverance : b.staff.complaintEnvelope)}"`)}</div></div>`;
    }).join('');
    const full = (c: GameState['candidates'][number]) => st.employees.length >= b.staff.maxStaff || (c.role === 'cleaner' && st.employees.some((e) => e.role === 'cleaner'));
    const cands = st.candidates.map((c) => `<div class="gs-card"><div class="it-row"><b class="grow">${c.name}</b><span class="num">${money(c.salary)}</span></div>
        <div class="gs-note">${who(c.role, c.experience)} · ${c.hasMedBook ? 'медкнижка есть' : '<span class="warn">без медкнижки</span>'}</div>
        <div class="it-row">${cmd({ type: 'Hire', candidateId: c.id, official: true }, `Официально, +34%`, 'secondary gs-mini', full(c) ? 'disabled' : '')}${cmd({ type: 'Hire', candidateId: c.id, official: false }, 'В конверте', 'ghost gs-mini', full(c) ? 'disabled' : '')}</div></div>`).join('');
    return `<div class="it-seg">${posts}</div>
      <div class="gs-facts">${row('Часов в неделю на бариста', Math.round(hours) + ' из ' + b.staff.weeklyNormHours, over ? 'loss' : '', 'hours')}${row('Зарплаты со взносами', money(payrollMonthly(st, cfg)) + ' / мес')}</div>
      ${over ? '<div class="gs-note loss">Переработка: часы сверх нормы оплачиваются ×2, усталость растёт, на 90 люди увольняются.</div>' : ''}
      <div class="lbl">Команда</div>${team || '<div class="gs-note loss">Никого нет – кофейня закрыта.</div>'}
      <div class="lbl">Кандидаты этой недели</div>${cands || '<div class="gs-note">Новые придут в начале недели.</div>'}`;
  }

  function stockHtml(): string {
    const st = s();
    const usage = expectedDailyUsage(st, cfg);
    const sup = (Object.keys(b.suppliers) as SupplierId[]).map((id) => `<button class="${st.supplier === id ? 'on' : ''}" data-cmd='${JSON.stringify({ type: 'SetSupplier', supplier: id })}' data-k="sup-${id}">${b.suppliers[id].name}</button>`).join('');
    const step = b.inventory.safetyStep;
    const mats = cfg.materials.map((m) => {
      const qty = stockQty(st, m.id);
      const days = usage[m.id] > 0 ? qty / usage[m.id] : 99;
      const next = m.deliveryEveryDays - ((st.day - 1) % m.deliveryEveryDays);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${m.name}</b><span class="num ${days < 1 ? 'loss' : ''}">${Math.round(qty)} порц.</span></div>
        <div class="gs-note">хватит на ${days >= 99 ? '∞' : days.toFixed(1).replace('.', ',')} дн. · поставка ${m.deliveryEveryDays === 1 ? 'каждый день' : 'через ' + next + ' дн.'} · хранится ${shelfLife(st, m, cfg)} дн.</div></div>`;
    }).join('');
    return `<div class="lbl">Поставщик</div><div class="it-seg">${sup}</div><div class="gs-note">${b.suppliers[st.supplier].text}</div>
      <div class="gs-price"><div class="n"><b>Запас при автозаказе${q('safety')}</b><span>больше – реже пусто, но больше списаний</span></div>
        <button class="it-btn it-btn--secondary gs-step" data-safety="${-step}" data-k="sf-m" aria-label="Меньше запас" ${st.safetyFactor <= b.inventory.safetyMin ? 'disabled' : ''}>−</button>
        <span class="v">${percent(st.safetyFactor)}</span>
        <button class="it-btn it-btn--secondary gs-step" data-safety="${step}" data-k="sf-p" aria-label="Больше запас" ${st.safetyFactor >= b.inventory.safetyMax ? 'disabled' : ''}>+</button></div>
      ${toggle({ type: 'SetLateWriteOff', on: !st.lateWriteOff }, st.lateWriteOff, 'Не списывать до последнего', 'Экономит деньги, но просрочка на складе – приостановка от СЭС и риск отравления')}
      ${accountBlocked(st, cfg) ? '<div class="gs-note loss">Счёт заблокирован налоговой: поставок не будет, пока не погасите долг.</div>' : ''}
      ${mats}`;
  }

  function toggle(c: Command, on: boolean, name: string, text: string): string {
    return `<div class="gs-price"><div class="n"><b>${name}</b><span>${text}</span></div><button class="it-btn it-btn--${on ? 'primary' : 'secondary'} gs-mini" data-cmd='${JSON.stringify(c)}' data-k='${JSON.stringify(c)}' aria-pressed="${on}">${on ? 'Вкл.' : 'Выкл.'}</button></div>`;
  }

  function inspectorCard(id: string): string {
    const i = inspectorById(cfg, id);
    return `<div class="gs-card gs-inspector"><div class="gs-face" aria-hidden="true">${i.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div><div><b>${i.name}</b><div><span class="it-lvl">${i.traitName.toUpperCase()}</span></div><div class="gs-note">${i.text}</div></div></div>`;
  }

  function checksHtml(): string {
    const st = s();
    const agency = agencyTab;
    const a = cfg.inspections[agency];
    const score = agencyScore(st, cfg, agency, true);
    const insp = announcedInspection(st, agency);
    const heads = AGENCIES.map((id) => {
      const v = agencyScore(st, cfg, id, true);
      return `<button class="${id === agency ? 'on' : ''}" data-agency="${id}" data-k="ag-${id}">${cfg.inspections[id].name}<br><span class="num ${v < 40 ? 'loss' : ''}">${v}</span></button>`;
    }).join('');
    const items = checklist(cfg, agency).map((i) => {
      const v = itemScore(st, cfg, i.id, true);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${i.name}</b><span class="num ${v < 50 ? 'loss' : v < 100 ? 'warn' : 'money'}">${Math.round(v)}</span></div>${bar(v, v < 50 ? 'bad' : '')}<div class="gs-note">${i.hint}${i.fine ? ` Штраф ${money(i.fine)}.` : ''}</div></div>`;
    }).join('');
    const planned = st.inspections.find((i) => i.agency === agency && i.reason === 'planned');
    const defectName = { damp: 'сырость', wiring: 'проводку', exit: 'запасной выход' }[st.defectType];
    const cause = insp?.cause ? `<div class="gs-note">Повод: ${insp.cause}.</div>` : '';
    return `<div class="it-seg gs-agencies">${heads}</div>
      <div><div class="it-row" style="margin-bottom:6px"><span class="lbl grow">Готовность: ${a.fullName}${q('readiness')}</span><span class="num">${score}</span></div>${bar(score, score < 40 ? 'bad' : '')}</div>
      ${score < b.compliance.unplannedThreshold ? '<div class="gs-note loss">Ниже 40 – каждый день есть шанс внеплановой проверки.</div>' : ''}
      ${insp ? `<div class="lbl">Проверка на ${insp.visitDay}-й день · через ${insp.visitDay - st.day} дн.</div>${cause}${inspectorCard(insp.inspectorId)}` : planned ? `<div class="gs-note">Плановая проверка – на ${planned.visitDay}-й день, уведомление придёт за ${a.noticeDays} дней.</div>` : ''}
      <div class="it-row gs-wrap">
        ${agency === 'ses' ? cmd({ type: 'Clean' }, `Срочная уборка ${money(b.costs.cleaning)}`, 'secondary gs-mini', st.cleanliness >= 100 || st.cash < b.costs.cleaning ? 'disabled' : '') : ''}
        ${insp && !insp.consultant ? cmd({ type: 'HireConsultant', agency }, `Консультант ${money(b.costs.consultant)}`, 'secondary gs-mini', st.cash < b.costs.consultant ? 'disabled' : '') : ''}
        ${st.defect && st.defectKnown ? cmd({ type: 'FixDefect' }, `Устранить ${defectName} ${money(b.costs.defectFix[st.defectType])}`, 'secondary gs-mini', st.cash < b.costs.defectFix[st.defectType] ? 'disabled' : '') : ''}
      </div>${items}`;
  }

  function gearHtml(): string {
    const st = s();
    const m = b.marketing;
    const gear = (Object.keys(b.equipment) as EquipmentId[]).map((id) => {
      const e = b.equipment[id];
      const own = st.equipment.includes(id);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${e.name}</b>${own ? '<span class="money num">есть</span>' : cmd({ type: 'BuyEquipment', id }, `<span class="price"><i class="it-coin"></i>${e.price.toLocaleString('ru-RU')}</span>`, 'secondary gs-mini', st.cash < e.price ? 'disabled' : '')}</div><div class="gs-note">${e.text}</div></div>`;
    }).join('');
    const flyersOn = st.day <= st.flyersUntilDay;
    return `<div class="lbl">Реклама и договоры</div>
      <div class="gs-price"><div class="n"><b>${m.flyers.name}</b><span>${flyersOn ? `идут ещё ${st.flyersUntilDay - st.day + 1} дн.` : m.flyers.text}</span></div>${cmd({ type: 'BuyFlyers' }, money(m.flyers.price), 'secondary gs-mini', flyersOn || st.cash < m.flyers.price ? 'disabled' : '')}</div>
      ${toggle({ type: 'SetSocial', on: !st.social }, st.social, m.social.name, m.social.text)}
      ${toggle({ type: 'SetPromo', on: !st.promo }, st.promo, m.promo.name, m.promo.text)}
      ${toggle({ type: 'SetServiceContract', on: !st.serviceContract }, st.serviceContract, m.serviceContract.name, m.serviceContract.text)}
      <div class="lbl">Оборудование</div>${gear}`;
  }

  function bankHtml(): string {
    const st = s();
    const l = b.loans;
    const taken = st.loans.map((x) => {
      const days = x.overdueSince === null ? 0 : st.day - x.overdueSince;
      return `<div class="gs-card"><div class="it-row"><b class="grow">«${l.products[x.product].name}» · ${x.annualRate}%</b><span class="num">${money(x.balance + x.overdue)}</span></div>
        <div class="gs-note">Платёж ${money(x.payment)} · следующий на ${x.nextPayDay}-й день${x.overdue > 0 ? ` · <span class="loss">просрочка ${money(x.overdue)}, ${days} дн.</span>` : ''}</div>
        <div class="it-row gs-wrap">${cmd({ type: 'RepayLoan', loanId: x.id }, 'Погасить досрочно', 'secondary gs-mini', st.cash < x.balance + x.overdue ? 'disabled' : '')}${days >= l.restructureAfterDays ? cmd({ type: 'Restructure', loanId: x.id }, `Реструктуризация: +${l.restructureMonths} мес, +${l.restructureRate} п.п.`, 'secondary gs-mini') : ''}</div></div>`;
    }).join('');
    const offers = (Object.keys(l.products) as LoanProductId[]).map((id) => {
      const p = l.products[id];
      const o = loanOffer(st, cfg, id);
      const sums = o.available ? [0.25, 0.5, 1].map((k) => Math.max(l.minAmount, Math.floor((o.limit * k) / l.step) * l.step)).filter((v, i, a) => a.indexOf(v) === i) : [];
      const total = o.payment * p.months;
      return `<div class="gs-card"><div class="it-row"><b class="grow">«${p.name}»</b><span class="num">${o.rate}% · ${p.months} мес</span></div>
        <div class="gs-note">${p.text}</div>
        ${o.available ? `<div class="gs-note">До ${money(o.limit)}: платёж ${money(o.payment)}, переплата ${money(total - o.limit)}</div><div class="it-row gs-wrap">${sums.map((v) => cmd({ type: 'TakeLoan', product: id, amount: v }, money(v), 'secondary gs-mini')).join('')}</div>` : `<div class="gs-note warn">${o.reason}</div>`}</div>`;
    }).join('');
    const d = st.tax.due;
    const regime = b.taxes.regimes[st.options.taxRegime];
    const acc: [AccountingId, string][] = [['self', 'Сам'], ['outsource', 'Аутсорс'], ['staff', 'В штате']];
    const accBtns = acc.map(([id, name]) => `<button class="${st.accounting === id ? 'on' : ''}" data-cmd='${JSON.stringify({ type: 'SetAccounting', accounting: id })}' data-k="acc-${id}" ${id === 'self' && st.options.form === 'ooo' ? 'disabled' : ''}>${name}</button>`).join('');
    const taxBlock = d
      ? `<div class="gs-card"><div class="it-row"><b class="grow">Налог за квартал</b><span class="num">${money(taxOwed(st))}</span></div>
        <div class="gs-note">Декларация до ${d.declareBy}-го дня${d.filed ? ' – подана' : ''}, оплата до ${d.payBy}-го дня${d.penalty ? ` · <span class="loss">пени и штрафы ${money(d.penalty)}</span>` : ''}</div>
        <div class="it-row">${d.filed ? '' : cmd({ type: 'FileDeclaration' }, 'Подать декларацию', 'primary gs-mini')}${d.filed ? cmd({ type: 'PayTax' }, 'Оплатить', 'primary gs-mini', st.cash < taxOwed(st) ? 'disabled' : '') : ''}</div></div>`
      : '<div class="gs-note">Сейчас ничего не причитается. Налог начисляется в конце квартала.</div>';
    const g = b.grey;
    return `<div class="gs-facts">${row('Кредитная история', st.grade, '', 'grade')}${row('Долг по кредитам', money(loansDebt(st)))}${row('Налоговый режим', regime.name, '', 'regime')}</div>
      ${taken ? `<div class="lbl">Ваши кредиты</div>${taken}` : ''}
      <div class="lbl">Налоги</div>${taxBlock}
      <div class="lbl">Кто подаёт декларации</div><div class="it-seg">${accBtns}</div>
      <div class="gs-note">${st.accounting === 'self' ? 'Подавать и платить – самому, 10% шанс ошибки в сумме.' : `${money(accountantMonthly(st, cfg))} в месяц, подаёт и платит сам.`}</div>
      <div class="gs-price"><div class="n"><b>Мимо кассы${q('offbook')}</b><span>${st.offbookShare ? `накоплено ${money(st.offbookTotal)}` : 'налог меньше, но есть контрольная закупка'}</span></div>
        <button class="it-btn it-btn--secondary gs-step" data-offbook="${-g.offbookStep}" data-k="ob-m" aria-label="Меньше" ${st.offbookShare <= 0 ? 'disabled' : ''}>−</button>
        <span class="v">${percent(st.offbookShare)}</span>
        <button class="it-btn it-btn--secondary gs-step" data-offbook="${g.offbookStep}" data-k="ob-p" aria-label="Больше" ${st.offbookShare >= g.offbookMax ? 'disabled' : ''}>+</button></div>
      <div class="lbl">Кредиты</div>${offers}`;
  }

  function datesHtml(): string {
    const st = s();
    const lastDay = totalDays(b);
    return upcoming(st, cfg).map((u) => `<div class="gs-card"><div class="it-row"><b class="grow">${u.title}</b>${u.amount !== null ? `<span class="num">${money(u.amount)}</span>` : ''}</div>
      <div class="gs-note">день ${u.day}${u.day <= lastDay ? ` · ${dayOfMonth(u.day, b)} ${monthName(monthOf(u.day, b)).toLowerCase()}` : ' · уже после конца года'} · ${u.day === st.day ? 'сегодня' : 'через ' + (u.day - st.day) + ' дн.'}</div></div>`).join('');
  }

  // ---------- меню и отладка ----------
  function renderMenu(): void {
    menuEl.hidden = !menuOpen && !debugOpen;
    if (menuEl.hidden) return;
    if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT' && menuEl.contains(document.activeElement)) return;
    const st = s();
    const main = menuOpen
      ? `<div class="lbl">Настройки</div>${audioControlsHtml()}
      <label class="gs-check-line"><input type="checkbox" data-hints ${settings.hints ? 'checked' : ''}> Советник во вкладке «Обзор»</label>
      <div class="lbl">Партия</div>
      <div class="it-row"><button class="it-btn it-btn--secondary" data-act="download" data-k="dl">Скачать сейв</button><button class="it-btn it-btn--secondary" data-act="csv" data-k="csv">Телеметрия CSV</button></div>
      <button class="it-btn it-btn--secondary" data-act="menu" data-k="main">Главное меню</button>
      <div class="gs-note">Игра сохраняется сама каждый день. Пробел – пауза, 1 / 2 / 3 – скорость, колесо – зум, Esc – закрыть окно, F2 – отладка.</div>`
      : '';
    const dbg = debugOpen
      ? `<div class="lbl">Отладка · сид ${st.seed}</div>
      <div class="it-row">${cmd({ type: 'DebugAddMoney', amount: 1000 }, '+ $1 000')}</div>
      <div class="it-row">${AGENCIES.map((a) => cmd({ type: 'DebugInspection', agency: a }, cfg.inspections[a].name, 'secondary gs-mini')).join('')}</div>
      <select class="gs-select" data-ref="dbg-event" aria-label="Событие">${cfg.events.map((e) => `<option value="${e.id}">${e.title}</option>`).join('')}</select>
      <button class="it-btn it-btn--secondary" data-dbg-event data-k="dbgev">Запустить событие</button>
      <div class="it-row"><button class="it-btn it-btn--secondary" data-skip="1" data-k="s1">+1 дн.</button><button class="it-btn it-btn--secondary" data-skip="7" data-k="s7">+7</button><button class="it-btn it-btn--secondary" data-skip="30" data-k="s30">+30</button></div>
      <div class="gs-note">Команд в логе: ${st.commandLog.length} · дней в телеметрии: ${st.history.length}</div>`
      : '';
    fill(menuEl, main + dbg);
  }

  // ---------- тосты ----------
  function pushToasts(): void {
    const feed = s().feed;
    if (feedSeen > feed.length) feedSeen = 0;
    for (const f of feed.slice(feedSeen).slice(-4)) {
      const el = document.createElement('div');
      el.className = 'it-panel it-toast';
      const sfx: Record<string, Sfx> = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'tick' };
      audio.play(sfx[f.tone]);
      const dot = { ok: ['ok', '+'], warn: ['wr', '!'], bad: ['er', '!'], info: ['wr', 'i'] }[f.tone];
      el.innerHTML = `<span class="dot ${dot[0]}">${dot[1]}</span><div><div style="font-weight:600">${f.title}</div>${f.text ? `<div class="gs-note">${f.text}</div>` : ''}</div>`;
      toastsEl.appendChild(el);
      setTimeout(() => el.remove(), 7000);
    }
    feedSeen = feed.length;
    while (toastsEl.children.length > 4) toastsEl.firstElementChild!.remove();
  }

  // ---------- окна ----------
  function eventHtml(p: Extract<Pending, { kind: 'event' }>): string {
    const st = s();
    const e = eventById(cfg, p.eventId);
    const opts = e.options.map((o, i) => {
      const cost = optionCost(st, o);
      const chance = typeof o.chance === 'number' ? `шанс ${percent(o.chance)}` : o.chance === 'grade' ? 'зависит от истории платежей' : '';
      const note = [o.note, chance].filter(Boolean).join(' · ');
      return `<button class="it-btn it-btn--${i === 0 ? 'primary' : 'secondary'} it-choice" data-cmd='${JSON.stringify({ type: 'ChooseEventOption', index: i })}' data-k="ev${i}"><span>${o.label}${note ? `<br><small>${note}</small>` : ''}</span>${cost ? `<span class="price"><i class="it-coin"></i>${cost.toLocaleString('ru-RU')}</span>` : ''}</button>`;
    }).join('');
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="${fillVars(e.title, p.vars)}"><div class="ttl">${fillVars(e.title, p.vars)}</div><div>${fillVars(e.text, p.vars)}</div><div class="it-choices">${opts}</div></div>`;
  }

  function monthHtml(p: Extract<Pending, { kind: 'monthReport' }>): string {
    const days = s().history.filter((r) => r.month === p.month).slice(-b.time.daysPerMonth);
    const revenue = days.reduce((a, r) => a + r.revenue, 0);
    const exp: Partial<Record<ExpenseCategory, number>> = {};
    for (const r of days) for (const [k, v] of Object.entries(r.expenses)) exp[k as ExpenseCategory] = (exp[k as ExpenseCategory] ?? 0) + v;
    const total = Object.values(exp).reduce((a, v) => a + v, 0);
    const cushion = cushionDays(s(), cfg);
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="Итоги месяца">
      <div class="ttl">Итоги: ${monthName(p.month).toLowerCase()}</div>
      <table class="gs-table"><tr><td>Выручка</td><td class="money">${signedMoney(revenue)}</td></tr>
      ${Object.entries(exp).map(([k, v]) => `<tr><td>${EXPENSE_NAMES[k as ExpenseCategory]}</td><td>${signedMoney(-v)}</td></tr>`).join('')}
      <tr class="total"><td>Денежный итог</td><td class="${revenue - total < 0 ? 'loss' : 'money'}">${signedMoney(revenue - total)}</td></tr></table>
      <div class="gs-facts">${row('Клиентов за месяц', days.reduce((a, r) => a + r.served, 0).toLocaleString('ru-RU'))}${row('Ушли без кофе', String(days.reduce((a, r) => a + r.lostQueue + r.lostStock, 0)))}${row('Репутация', stars(s().reputation))}${row('Подушка', cushion === Infinity ? 'в плюсе' : cushion + ' дн.', cushion < 21 ? 'loss' : '')}</div>
      ${cmd({ type: 'Acknowledge' }, 'Дальше', 'primary')}</div>`;
  }

  function noticeHtml(p: Extract<Pending, { kind: 'inspectionNotice' }>): string {
    const insp = s().inspections.find((i) => i.id === p.inspectionId);
    if (!insp) return `<div class="it-panel it-event gs-modal">${cmd({ type: 'Acknowledge' }, 'Дальше', 'primary')}</div>`;
    const why = { planned: 'Плановая проверка по графику.', unplanned: 'Внеплановая: в службу поступил сигнал о нарушениях.', repeat: 'Повторная проверка после предписания. Штрафы ×2.' }[insp.reason];
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="Уведомление о проверке">
      <div class="lbl">Уведомление · ${cfg.inspections[insp.agency].fullName}</div><div class="ttl">Проверка через ${insp.visitDay - s().day} дн.</div>
      <div>${why} ${insp.cause && insp.reason === 'unplanned' ? 'Повод: ' + insp.cause + '. ' : ''}Визит на ${insp.visitDay}-й день.</div>${inspectorCard(insp.inspectorId)}
      <div class="gs-note">Вкладка «Проверки» покажет чек-лист. Консультант за ${money(b.costs.consultant)} найдёт скрытые дефекты.</div>
      <button class="it-btn it-btn--primary" data-cmd='{"type":"Acknowledge"}' data-goto="${insp.agency}" data-k="ack">Готовиться</button></div>`;
  }

  function visitHtml(p: Extract<Pending, { kind: 'inspectionVisit' }>): string {
    const items = checklist(cfg, p.agency);
    const a = cfg.inspections[p.agency];
    const done = visitShown >= p.results.length;
    const rows = p.results.map((r, i) => {
      const item = items.find((x) => x.id === r.itemId)!;
      if (i > visitShown) return `<div class="gs-check wait"><span class="mark">·</span><span class="grow">${item.name}</span></div>`;
      if (i === visitShown && !done) return `<div class="gs-check now"><span class="mark">…</span><span class="grow">${item.name}</span></div>`;
      return `<div class="gs-check ${r.violated ? 'bad' : 'ok'}"><span class="mark">${r.violated ? '✕' : '✓'}</span><span class="grow">${item.name}${r.count > 1 ? ` ×${r.count}` : ''}</span>${r.violated ? `<span class="num loss">${money(r.fine)}</span>` : ''}</div>`;
    }).join('');
    let foot = '';
    if (done && p.totalFine === 0) foot = `<div class="money" style="font-weight:600">Нарушений нет. Работаем дальше.</div>${cmd({ type: 'Acknowledge' }, 'Проводить инспектора', 'primary')}`;
    else if (done) {
      const bribe = a.bribe;
      foot = `<div><b class="loss">Акт: штраф ${money(p.totalFine)}</b>${p.suspensionDays ? ` и приостановка на ${p.suspensionDays} дн.` : ''}</div>
        <div class="it-choices">
          <button class="it-btn it-btn--primary it-choice" data-cmd='{"type":"ResolveInspection","choice":"accept"}' data-k="acc"><span>Принять и исправить<br><small>повторная проверка через 30 дней</small></span><span class="price"><i class="it-coin"></i>${Math.round(p.totalFine).toLocaleString('ru-RU')}</span></button>
          <button class="it-btn it-btn--secondary it-choice" data-cmd='{"type":"ResolveInspection","choice":"contest"}' data-k="con"><span>Оспорить через юриста<br><small>шанс отмены ${percent(contestChance(cfg, p.results, p.agency))}</small></span><span class="price"><i class="it-coin"></i>${b.costs.lawyer}</span></button>
          <button class="it-btn it-btn--danger it-choice" data-cmd='{"type":"ResolveInspection","choice":"bribe"}' data-k="bri"><span>«Договориться»<br><small>${percent(bribe.caughtChance)} – уголовное дело и конец игры</small></span><span class="price"><i class="it-coin"></i>${Math.round(p.totalFine * bribe.costShare).toLocaleString('ru-RU')}</span></button>
        </div>`;
    }
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="Проверка: ${a.name}">
      <div class="lbl">${a.fullName} · визит</div>${inspectorCard(p.inspectorId)}<div class="gs-checks">${rows}</div>${foot}</div>`;
  }

  function endHtml(): string {
    const st = s();
    const [title, text] = OUTCOMES[st.outcome ?? 'year'];
    const sc = computeScore(st, cfg);
    const medal = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };
    const grey = st.stats.offbookCaught > 0 || st.offbookTotal > 0 || st.employees.some((e) => !e.official);
    const honest = st.stats.bribes > 0 || grey ? 'Серый кардинал' : st.stats.fines > 0 ? 'Битый предприниматель' : 'Честный предприниматель';
    // цель партии: 3 месяца подряд в плюсе, нет просрочек, репутация не ниже 4,0
    const lastMonths = [10, 11, 12].map((m) => st.history.filter((r) => r.month === m).reduce((x, r) => x + r.profit, 0));
    const onFeet = st.outcome === 'year' && lastMonths.every((v) => v > 0) && !st.loans.some((l) => l.overdue > 0) && st.tax.lateCount === 0 && st.reputation >= 4;
    const chronicle = st.feed.filter((f) => f.tone === 'bad').slice(-5).map((f) => `<div class="gs-note">День ${f.day}: ${f.title}</div>`).join('');
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="${title}">
      <div class="ttl">${title}</div><div>${text}</div>
      <table class="gs-table"><tr><td>Деньги на счёте</td><td>${signedMoney(sc.cash)}</td></tr><tr><td>Оборудование (половина цены)</td><td>${signedMoney(sc.equipment)}</td></tr><tr><td>Возврат депозита</td><td>${signedMoney(sc.deposit)}</td></tr><tr><td>Налоговый долг</td><td>${signedMoney(-sc.taxDebt)}</td></tr><tr><td>Кредиты</td><td>${signedMoney(-sc.loans)}</td></tr><tr><td>Стартовый капитал</td><td>${signedMoney(-sc.startCapital)}</td></tr>
      <tr class="total"><td>Очки</td><td class="${sc.total < 0 ? 'loss' : 'money'}">${signedMoney(sc.total)}</td></tr></table>
      <div class="gs-facts">${row('«Кофейня на ногах»', onFeet ? 'да' : 'нет', onFeet ? 'money' : 'loss')}${sc.medal ? row('Медаль', medal[sc.medal]) : ''}${row('Репутация директора', honest)}${row('Репутация кофейни', stars(st.reputation))}${row('Проверок / штрафов', `${st.stats.inspections} / ${money(st.stats.fines)}`)}</div>
      ${chronicle ? `<div class="lbl">Хроника</div>${chronicle}` : ''}
      <button class="it-btn it-btn--primary" data-act="new" data-k="new">Новая партия</button></div>`;
  }

  function renderModal(): void {
    const st = s();
    const p = st.pending[0];
    clearTimeout(visitTimer);
    if (st.finished) {
      modalEl.hidden = false;
      return fill(modalEl, endHtml());
    }
    modalEl.hidden = !p;
    if (!p) {
      shownPending = '';
      return;
    }
    const pendingKey = `${st.day}:${p.kind}:${st.pending.length}`;
    if (pendingKey !== shownPending) {
      shownPending = pendingKey;
      audio.play(p.kind === 'monthReport' ? 'open' : 'chime');
    }
    if (p.kind === 'monthReport') return fill(modalEl, monthHtml(p));
    if (p.kind === 'inspectionNotice') return fill(modalEl, noticeHtml(p));
    if (p.kind === 'event') return fill(modalEl, eventHtml(p));
    // чек-лист открывается по одному пункту – главный момент напряжения
    const key = `${st.day}:${p.agency}:${p.inspectorId}`;
    if (key !== visitKey) {
      visitKey = key;
      visitShown = 0;
    }
    fill(modalEl, visitHtml(p));
    if (visitShown < p.results.length) {
      visitTimer = window.setTimeout(() => {
        visitShown++;
        audio.play(p.results[visitShown - 1]?.violated ? 'stamp' : 'tick');
        if (alive) renderModal();
      }, 900);
    }
  }

  function renderAll(): void {
    renderHud();
    syncScene();
    renderSide();
    renderMenu();
    renderModal();
    pushToasts();
  }

  // ---------- ввод ----------
  function setSpeed(v: Speed): void {
    if (game.blocked) return;
    game.clock.setSpeed(v);
    renderHud();
  }

  const onInput = (e: Event): void => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.vol) {
      settings[t.dataset.vol as 'music' | 'sfx'] = Number(t.value) / 100;
      audio.applyVolumes();
      saveSettings();
    } else if (t.dataset.hints !== undefined) {
      settings.hints = t.checked;
      saveSettings();
      renderSide();
    }
  };
  screen.addEventListener('input', onInput);

  const onClick = (e: MouseEvent): void => {
    audio.unlock();
    const t = (e.target as Element).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    const d = t.dataset;
    audio.play(d.tab ? 'tab' : 'click');
    if (d.speed !== undefined) return setSpeed(Number(d.speed) as Speed);
    if (d.act === 'download') return hooks.download();
    if (d.act === 'csv') return hooks.exportCsv();
    if (d.act === 'new') return hooks.newGame();
    if (d.act === 'menu') return hooks.menu();
    if (d.flows !== undefined) flowsOn = !flowsOn;
    else if (d.menu !== undefined) menuOpen = !menuOpen;
    else if (d.close !== undefined) windowOpen = false;
    else if (d.range) chartRange = Number(d.range);
    else if (d.tab) {
      // повторное нажатие на открытую вкладку закрывает окно
      windowOpen = !(windowOpen && tab === d.tab && !t.classList.contains('gs-advice'));
      tab = d.tab as Tab;
      selected = null;
    }
    else if (d.select !== undefined) selected = d.select || null;
    else if (d.price) game.dispatch({ type: 'SetPrice', itemId: d.price, price: s().prices[d.price] + Number(d.delta) });
    else if (d.safety) game.dispatch({ type: 'SetSafety', factor: s().safetyFactor + Number(d.safety) });
    else if (d.offbook) game.dispatch({ type: 'SetOffbook', share: s().offbookShare + Number(d.offbook) });
    else if (d.agency) agencyTab = d.agency as AgencyId;
    else if (d.dbgEvent !== undefined) game.dispatch({ type: 'DebugEvent', eventId: menuEl.querySelector<HTMLSelectElement>('[data-ref="dbg-event"]')!.value });
    else if (d.cmd) {
      game.dispatch(JSON.parse(d.cmd) as Command);
      if (d.goto) {
        tab = 'checks';
        agencyTab = d.goto as AgencyId;
        windowOpen = true;
        selected = null;
      }
    } else if (d.skip) game.skipDays(Number(d.skip));
    hooks.save();
    renderAll();
  };
  screen.addEventListener('click', onClick);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'F2') {
      e.preventDefault();
      debugOpen = !debugOpen;
      return renderMenu();
    }
    if (e.key === 'Escape') {
      if (menuOpen) menuOpen = false;
      else if (windowOpen) windowOpen = false;
      else if (selected) selected = null;
      else return;
      return renderAll();
    }
    if (e.metaKey || e.ctrlKey || e.altKey || game.blocked) return;
    if (e.code === 'Space') {
      if ((e.target as Element).closest?.('button')) return;
      e.preventDefault();
      game.clock.togglePause();
      renderHud();
    } else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key) as Speed);
  };
  window.addEventListener('keydown', onKey);

  game.onDay = (r) => {
    if (r.open) {
      scene.floatText(signedMoney(r.revenue - r.cogs), r.revenue - r.cogs < 0 ? 'loss' : 'money');
      if (cfg.materials.some((m) => r.day % m.deliveryEveryDays === 0)) scene.sendTruck();
      audio.play('coin');
    }
  };

  // ---------- игровой цикл ----------
  let prev = performance.now();
  function frame(now: number): void {
    if (!alive) return;
    // вкладка была в фоне – не проматываем пропущенное время разом
    const dt = Math.min((now - prev) / 1000, 0.25);
    prev = now;
    if (game.update(dt) > 0) {
      hooks.save();
      renderAll();
    } else renderTime();
    scene.frame(dt, game.blocked ? 0 : game.clock.speed, game.clock.hour);
    audio.setNight(nightFactor(game.clock.hour) > 0.5);
    requestAnimationFrame(frame);
  }
  renderAll();
  requestAnimationFrame(frame);

  return () => {
    alive = false;
    clearTimeout(visitTimer);
    window.removeEventListener('keydown', onKey);
    game.onDay = null;
    scene.destroy();
    tipEl.hidden = true;
  };
}
