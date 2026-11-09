import { dayOfMonth, monthOf, seasonOf } from '../core/calendar';
import type { Speed } from '../core/clock';
import { totalDays } from '../core/config';
import { averageCheck } from '../core/demand';
import { Game } from '../core/game';
import { clockTime, money, monthName, percent, price, signedMoney } from './format';
import { render as renderIso, type IsoBuilding, type IsoMap } from './iso';

type Tab = 'overview' | 'prices';

const STAR = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--coin-shade)"><path d="m10 1.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"/></svg>';
const PERSON = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--ink-muted)"><circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-4 3-6.5 7-6.5s7 2.5 7 6.5z"/></svg>';

/** Карта района: кофейня игрока, два конкурента, метро и дома для атмосферы. */
const N = 12;
function ground(x: number, y: number): 'grass' | 'road' {
  return y === 5 || x === 6 ? 'road' : 'grass';
}
const SCENERY: IsoBuilding[] = [
  { x: 7, y: 6, w: 2, d: 1, h: 16, roof: 'slate', label: 'Метро', labelKind: 'name' },
  { x: 9, y: 1, w: 2, d: 2, h: 72, roof: 'teal' },
  { x: 1, y: 0, w: 2, d: 2, h: 46, roof: 'teal' },
  { x: 4, y: 1, w: 1, d: 2, h: 28, roof: 'slate' },
  { x: 9, y: 8, w: 2, d: 2, h: 54, roof: 'teal' },
  { x: 1, y: 8, w: 2, d: 2, h: 36, roof: 'slate' },
  { x: 4, y: 10, w: 2, d: 1, h: 22, roof: 'slate' },
  { x: 10, y: 6, w: 1, d: 1, h: 30, roof: 'teal' },
];
const TREES: [number, number][] = [[0, 3], [3, 0], [0, 6], [3, 8], [0, 11], [7, 0], [11, 4], [8, 10], [11, 11], [7, 8], [3, 3], [11, 0]];
const RIVAL_SPOTS: Omit<IsoBuilding, 'label'>[] = [
  { x: 7, y: 3, w: 2, d: 2, h: 30, roof: 'brick' },
  { x: 1, y: 3, w: 1, d: 2, h: 22, roof: 'brick' },
];

function seedFromUrl(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n | 0 : (Date.now() & 0x7fffffff) | 0;
}

export function mountGameScreen(root: HTMLElement): void {
  let game = new Game(seedFromUrl());
  let tab: Tab = 'overview';
  let debugOpen = false;

  root.innerHTML = `
  <div class="it gs">
    <svg class="gs-map" data-ref="map" preserveAspectRatio="xMidYMid meet" aria-label="Карта района"></svg>
    <div class="gs-top"><div class="it-panel it-hud" data-ref="hud"></div></div>
    <div class="it-panel gs-debug" data-ref="debug" hidden></div>
    <div class="it-panel it-bp gs-side" data-ref="side"></div>
    <div class="gs-hint">Пробел – пауза · 1 / 2 / 3 – скорость · F2 – отладка</div>
    <div class="gs-end" data-ref="end" hidden></div>
  </div>`;

  const ref = <T extends Element>(name: string): T => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const screen = root.querySelector<HTMLElement>('.gs')!;
  const mapEl = ref<SVGSVGElement>('map');
  const hudEl = ref<HTMLElement>('hud');
  const sideEl = ref<HTMLElement>('side');
  const debugEl = ref<HTMLElement>('debug');
  const endEl = ref<HTMLElement>('end');

  const last = () => game.state.history[game.state.history.length - 1];

  // ---------- верхняя полоса ----------
  function renderHud(): void {
    const s = game.state;
    const b = game.cfg.balance;
    const day = Math.min(s.day, totalDays(b));
    const month = monthOf(day, b);
    const l = last();
    const speed = game.clock.speed;
    const btn = (v: Speed, text: string, aria = '') =>
      `<button data-speed="${v}" class="${speed === v ? 'on' : ''}" ${aria ? `aria-label="${aria}"` : ''} aria-pressed="${speed === v}">${text}</button>`;
    hudEl.innerHTML = `
      <div class="it-stat"><i class="it-coin"></i><div><div class="lbl">Баланс</div><div class="v ${s.cash < 0 ? 'loss' : ''}">${money(s.cash)}</div></div></div>
      <div class="it-stat"><div><div class="lbl">Доход / день</div><div class="v ${l ? (l.profit < 0 ? 'loss' : 'money') : 'muted'}">${l ? signedMoney(l.profit) : '–'}</div></div></div>
      <div class="it-stat">${STAR}<div><div class="lbl">Репутация</div><div class="v">${s.reputation.toFixed(1).replace('.', ',')}</div></div></div>
      <div class="it-stat">${PERSON}<div><div class="lbl">Персонал</div><div class="v">${s.baristas}</div></div></div>
      <div class="spacer"></div>
      <div class="it-date"><div class="lbl">${seasonOf(month, b).name} · день ${day} из ${totalDays(b)}</div><div style="font-weight:600">${dayOfMonth(day, b)} · ${monthName(month)} · <span class="num" data-ref="time"></span></div></div>
      <div class="it-speed" role="group" aria-label="Скорость">${btn(0, '❚❚', 'Пауза')}${btn(1, '1×')}${btn(2, '2×')}${btn(3, '3×')}</div>`;
    renderTime(true);
  }

  // ---------- часы и тема (каждый кадр) ----------
  let shownTime = '';
  let shownNight: boolean | null = null;
  function renderTime(force = false): void {
    const t = game.state.finished ? '–' : clockTime(game.clock.hour);
    if (force || t !== shownTime) {
      shownTime = t;
      const el = hudEl.querySelector('[data-ref="time"]');
      if (el) el.textContent = t;
    }
    const { nightFromHour, nightToHour } = game.cfg.balance.time;
    const h = game.clock.hour;
    const night = !game.state.finished && (h >= nightFromHour || h < nightToHour);
    if (night !== shownNight) {
      shownNight = night;
      if (night) document.documentElement.dataset.theme = 'night';
      else delete document.documentElement.dataset.theme;
    }
  }

  // ---------- карта ----------
  function renderMap(): void {
    const s = game.state;
    const l = last();
    const map: IsoMap = {
      cols: N,
      rows: N,
      maxH: 80,
      ground,
      trees: TREES,
      buildings: [
        ...SCENERY,
        ...s.competitors.slice(0, RIVAL_SPOTS.length).map((c, i) => ({ ...RIVAL_SPOTS[i], label: c.name, labelKind: 'name' as const })),
        { x: 4, y: 6, w: 2, d: 2, h: 24, roof: 'brick', selected: true, label: l ? signedMoney(l.profit) : s.shopName.replace(/^Кофейня /, ''), labelKind: l ? 'money' : 'name' },
      ],
    };
    renderIso(mapEl, map);
  }

  // ---------- панель кофейни ----------
  function renderSide(): void {
    const s = game.state;
    const b = game.cfg.balance;
    const loc = b.locations[s.location as keyof typeof b.locations];
    const head = `
      <header><div class="t"><span class="it-lvl">${s.form} · ${loc.name.toUpperCase()}</span><div class="ttl" style="margin-top:6px">${s.shopName}</div></div></header>
      <div class="it-seg" role="tablist">
        <button data-tab="overview" role="tab" aria-selected="${tab === 'overview'}" class="${tab === 'overview' ? 'on' : ''}">Обзор</button>
        <button data-tab="prices" role="tab" aria-selected="${tab === 'prices'}" class="${tab === 'prices' ? 'on' : ''}">Цены</button>
      </div>`;
    sideEl.innerHTML = head + (tab === 'overview' ? overviewHtml() : pricesHtml());
  }

  function overviewHtml(): string {
    const s = game.state;
    const l = last();
    if (!l) {
      return `<div class="gs-note">Идёт первый день. Касса закрывается в полночь – тогда здесь появятся выручка, клиенты и загрузка.</div>
        <div class="gs-facts">
          <div class="it-row"><span class="muted">Узнаваемость</span><span class="num">${percent(s.awareness)}</span></div>
          <div class="it-row"><span class="muted">Поток у помещения</span><span class="num">${s.footTraffic} чел/день</span></div>
        </div>`;
    }
    const load = l.capacity > 0 ? l.served / l.capacity : 0;
    const week = s.history.slice(-7);
    const max = Math.max(1, ...week.map((r) => Math.abs(r.profit)));
    const bars = week.map((r) => `<i class="${r.profit < 0 ? 'neg' : ''}" style="height:${Math.max(4, Math.round((Math.abs(r.profit) / max) * 100))}%" title="День ${r.day}: ${signedMoney(r.profit)}"></i>`).join('');
    return `
      <div class="lbl">Вчера · день ${l.day}</div>
      <div class="it-grid">
        <div class="it-cell"><span class="lbl">Выручка</span><span class="v">${money(l.revenue)}</span></div>
        <div class="it-cell"><span class="lbl">Сырьё</span><span class="v">${money(l.cogs)}</span></div>
        <div class="it-cell"><span class="lbl">Прибыль</span><span class="v ${l.profit < 0 ? 'loss' : 'money'}">${signedMoney(l.profit)}</span></div>
      </div>
      <div><div class="it-row" style="margin-bottom:6px"><span class="lbl grow">Загрузка</span><span class="num">${percent(load)}</span></div><div class="it-bar"><i style="width:${Math.min(100, Math.round(load * 100))}%"></i></div></div>
      <div><div class="lbl" style="margin-bottom:6px">Прибыль за ${week.length} дн.</div><div class="it-spark" style="height:44px">${bars}</div></div>
      <div class="gs-facts">
        <div class="it-row"><span class="muted">Клиентов</span><span class="num">${l.served}${l.lost > 0 ? ` <span class="loss">(ушли из очереди: ${l.lost})</span>` : ''}</span></div>
        <div class="it-row"><span class="muted">Средний чек</span><span class="num">${price(l.served > 0 ? l.revenue / l.served : 0)}</span></div>
        <div class="it-row"><span class="muted">Доля среди прохожих</span><span class="num">${percent(l.share)}</span></div>
        <div class="it-row"><span class="muted">Узнаваемость</span><span class="num">${percent(s.awareness)}</span></div>
      </div>`;
  }

  function pricesHtml(): string {
    const s = game.state;
    const { items, balance: b } = game.cfg;
    const check = averageCheck(s.prices, items);
    const rows = items
      .map((i) => {
        const p = s.prices[i.id];
        const off = s.finished ? 'disabled' : '';
        return `<div class="gs-price">
          <div class="n"><b>${i.name}</b><span>сырьё ${price(i.cost)} · наценка ${price(p - i.cost)}</span></div>
          <button class="it-btn it-btn--secondary gs-step" data-price="${i.id}" data-delta="-1" aria-label="${i.name}: дешевле" ${off || (p <= b.prices.min ? 'disabled' : '')}>−</button>
          <span class="v">${price(p)}</span>
          <button class="it-btn it-btn--secondary gs-step" data-price="${i.id}" data-delta="1" aria-label="${i.name}: дороже" ${off || (p >= b.prices.max ? 'disabled' : '')}>+</button>
        </div>`;
      })
      .join('');
    const diff = check / b.demand.marketCheck - 1;
    const cls = diff > 0.005 ? 'warn' : 'money';
    const word = Math.abs(diff) <= 0.005 ? 'как в районе' : `${diff > 0 ? 'выше' : 'ниже'} на ${percent(Math.abs(diff))}`;
    return `<div class="gs-prices">${rows}</div>
      <div class="gs-facts">
        <div class="it-row"><span class="muted">Ожидаемый средний чек</span><span class="num">${price(check)}</span></div>
        <div class="it-row"><span class="muted">Район: ${price(b.demand.marketCheck)}</span><span class="num ${cls}">${word}</span></div>
      </div>
      <div class="gs-note">Цена чувствительна: +10% к чеку – примерно −13% клиентов. Новые цены работают с сегодняшнего закрытия кассы.</div>`;
  }

  // ---------- отладка (F2) ----------
  function renderDebug(): void {
    debugEl.hidden = !debugOpen;
    if (!debugOpen) return;
    const s = game.state;
    debugEl.innerHTML = `
      <div class="lbl">Отладка · сид ${s.seed}</div>
      <div class="it-row"><button class="it-btn it-btn--secondary grow" data-debug="money">+ $1 000</button></div>
      <div class="it-row">
        <button class="it-btn it-btn--secondary grow" data-debug="skip" data-days="1">+1 дн.</button>
        <button class="it-btn it-btn--secondary grow" data-debug="skip" data-days="7">+7</button>
        <button class="it-btn it-btn--secondary grow" data-debug="skip" data-days="30">+30</button>
      </div>
      <div class="it-row"><button class="it-btn it-btn--ghost grow" data-debug="restart">Новая партия</button></div>
      <div class="gs-note">Команд в логе: ${s.commandLog.length} · дней в телеметрии: ${s.history.length}</div>`;
  }

  // ---------- итоги года ----------
  function renderEnd(): void {
    const s = game.state;
    endEl.hidden = !s.finished;
    if (!s.finished) return;
    const revenue = s.history.reduce((a, r) => a + r.revenue, 0);
    const clients = s.history.reduce((a, r) => a + r.served, 0);
    endEl.innerHTML = `
      <div class="it-panel it-event" role="dialog" aria-label="Год завершён">
        <div class="ttl">Год завершён</div>
        <div class="it-grid">
          <div class="it-cell"><span class="lbl">Баланс</span><span class="v">${money(s.cash)}</span></div>
          <div class="it-cell"><span class="lbl">Выручка</span><span class="v">${money(revenue)}</span></div>
          <div class="it-cell"><span class="lbl">Клиентов</span><span class="v">${clients.toLocaleString('ru-RU')}</span></div>
        </div>
        <button class="it-btn it-btn--primary" data-debug="restart">Новая партия</button>
      </div>`;
  }

  function renderAll(): void {
    renderHud();
    renderMap();
    renderSide();
    renderDebug();
    renderEnd();
  }

  // ---------- ввод ----------
  function setSpeed(v: Speed): void {
    if (game.state.finished) return;
    game.clock.setSpeed(v);
    renderHud();
  }

  screen.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    const d = t.dataset;
    if (d.speed !== undefined) {
      setSpeed(Number(d.speed) as Speed);
    } else if (d.tab) {
      tab = d.tab as Tab;
      renderSide();
      sideEl.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
    } else if (d.price) {
      const step = game.cfg.balance.prices.step;
      const delta = Number(d.delta);
      game.dispatch({ type: 'SetPrice', itemId: d.price, price: game.state.prices[d.price] + delta * step });
      renderSide();
      sideEl.querySelector<HTMLElement>(`[data-price="${d.price}"][data-delta="${d.delta}"]`)?.focus();
      if (debugOpen) renderDebug();
    } else if (d.debug === 'money') {
      game.dispatch({ type: 'DebugAddMoney', amount: 1000 });
      renderAll();
    } else if (d.debug === 'skip') {
      game.skipDays(Number(d.days));
      renderAll();
    } else if (d.debug === 'restart') {
      game = new Game((Date.now() & 0x7fffffff) | 0);
      tab = 'overview';
      renderAll();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F2') {
      e.preventDefault();
      debugOpen = !debugOpen;
      renderDebug();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      // пробел на кнопке в фокусе – это нажатие кнопки, а не пауза
      if ((e.target as Element).closest?.('button')) return;
      e.preventDefault();
      if (!game.state.finished) {
        game.clock.togglePause();
        renderHud();
      }
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      setSpeed(Number(e.key) as Speed);
    }
  });

  // ---------- игровой цикл ----------
  let prev = performance.now();
  function frame(now: number): void {
    // вкладка была в фоне – не проматываем пропущенное время разом
    const dt = Math.min((now - prev) / 1000, 0.25);
    prev = now;
    if (game.update(dt) > 0) renderAll();
    else renderTime();
    requestAnimationFrame(frame);
  }

  renderAll();
  requestAnimationFrame(frame);
}
