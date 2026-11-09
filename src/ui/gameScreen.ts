import { dayOfMonth, monthOf, seasonOf } from '../core/calendar';
import type { Speed } from '../core/clock';
import { announcedInspection, type Command } from '../core/commands';
import { itemCost, totalDays, type EquipmentId, type SupplierId } from '../core/config';
import { computeScore, cushionDays, dailyFixed, monthlyFixed, upcoming } from '../core/finance';
import type { Game } from '../core/game';
import { checklist, contestChance, inspectorById, itemScore, sesScore } from '../core/inspections';
import { expectedDailyUsage, stockQty, shelfLife } from '../core/inventory';
import { baristas, demandView, hoursPerWeek } from '../core/shop';
import type { DayRecord, ExpenseCategory, Pending } from '../core/state';
import { clockTime, money, monthName, percent, price, signedMoney } from './format';
import { SceneView } from './scene/sceneView';

type Tab = 'overview' | 'prices' | 'staff' | 'stock' | 'ses' | 'gear' | 'dates';
const TABS: [Tab, string][] = [['overview', 'Обзор'], ['prices', 'Цены'], ['staff', 'Люди'], ['stock', 'Склад'], ['ses', 'СЭС'], ['gear', 'Техника'], ['dates', 'Сроки']];

const STAR = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--coin-shade)"><path d="m10 1.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z"/></svg>';
const PERSON = '<svg class="it-ico" viewBox="0 0 20 20" style="color:var(--ink-muted)"><circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-4 3-6.5 7-6.5s7 2.5 7 6.5z"/></svg>';
const EXPENSE_NAMES: Record<ExpenseCategory, string> = { purchases: 'Закупки', rent: 'Аренда', payroll: 'Зарплаты и взносы', utilities: 'Коммуналка', services: 'Услуги', equipment: 'Оборудование', tax: 'Налоги', fines: 'Штрафы' };
const OUTCOMES = {
  year: ['Год завершён', 'Кофейня дожила до конца года.'],
  bankrupt: ['Банкротство', 'Баланс был ниже нуля больше 14 дней. Долги остались на вас лично.'],
  closed: ['Кофейня закрыта', 'Приостановки дольше 30 дней – арендодатель расторг договор.'],
  criminal: ['Уголовное дело', 'Инспектор записал разговор. Взятка должностному лицу – конец игры.'],
} as const;
const stars = (n: number) => n.toFixed(1).replace('.', ',');
const row = (label: string, value: string, cls = '') => `<div class="it-row"><span class="muted">${label}</span><span class="num ${cls}">${value}</span></div>`;
const bar = (v: number, cls = '') => `<div class="it-bar ${cls}"><i style="width:${Math.max(0, Math.min(100, Math.round(v)))}%"></i></div>`;

export interface ScreenHooks {
  save: () => void;
  download: () => void;
  newGame: () => void;
}

export function mountGameScreen(root: HTMLElement, game: Game, hooks: ScreenHooks): () => void {
  const { cfg } = game;
  const b = cfg.balance;
  let tab: Tab = 'overview';
  let selected: string | null = 'player';
  let menuOpen = false;
  let feedSeen = game.state.feed.length;
  let visitKey = '';
  let visitShown = 0;
  let visitTimer = 0;
  let alive = true;

  root.innerHTML = `
  <div class="it gs">
    <div class="gs-map" data-ref="map"></div>
    <div class="gs-top"><div class="it-panel it-hud" data-ref="hud"></div></div>
    <div class="gs-toasts" data-ref="toasts" aria-live="polite"></div>
    <div class="it-panel gs-debug" data-ref="menu" hidden></div>
    <div class="it-panel it-bp gs-side" data-ref="side"></div>
    <div class="gs-hint">Пробел – пауза · 1 / 2 / 3 – скорость · колесо – зум · F2 – меню</div>
    <div class="gs-end" data-ref="modal" hidden></div>
  </div>`;
  const ref = <T extends HTMLElement>(name: string): T => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const screen = root.querySelector<HTMLElement>('.gs')!;
  const hudEl = ref('hud');
  const sideEl = ref('side');
  const menuEl = ref('menu');
  const modalEl = ref('modal');
  const toastsEl = ref('toasts');
  const scene = new SceneView(ref('map'), (id) => {
    if (id) selected = id;
    renderAll();
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
    const btn = (v: Speed, text: string, aria = '') =>
      `<button data-speed="${v}" data-k="sp${v}" class="${speed === v ? 'on' : ''}" ${aria ? `aria-label="${aria}"` : ''} aria-pressed="${speed === v}">${text}</button>`;
    fill(hudEl, `
      <div class="it-stat"><i class="it-coin"></i><div><div class="lbl">Баланс</div><div class="v ${st.cash < 0 ? 'loss' : ''}">${money(st.cash)}</div></div></div>
      <div class="it-stat"><div><div class="lbl">Прибыль / день</div><div class="v ${l ? (l.profit < 0 ? 'loss' : 'money') : 'muted'}">${l ? signedMoney(l.profit) : '–'}</div></div></div>
      <div class="it-stat"><div><div class="lbl">Подушка</div><div class="v ${cushion < 21 ? 'loss' : ''}">${cushion === Infinity ? 'в плюсе' : cushion + ' дн.'}</div></div></div>
      <div class="it-stat">${STAR}<div><div class="lbl">Репутация</div><div class="v">${stars(st.reputation)}</div></div></div>
      <div class="it-stat">${PERSON}<div><div class="lbl">Персонал</div><div class="v">${st.employees.length}</div></div></div>
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
    const suspended = st.day <= st.suspendedUntilDay;
    const title = /«(.+)»/.exec(st.shopName)?.[1] ?? st.shopName;
    scene.setLook(
      { title, signage: st.equipment.includes('signage'), pro: st.equipment.includes('machinePro'), furniture: st.equipment.includes('furniture'), closed: suspended || baristas(st).length === 0 },
      selected,
    );
    const v = demandView(st, cfg);
    const want = b.demand.coffeeWantShare * 3;
    scene.setFlow({
      traffic: st.footTraffic,
      pPlayer: Math.min(0.4, want * st.awareness * v.share),
      pRivals: v.rivalShares.map((x) => Math.min(0.4, want * x)),
      playerOpen: !suspended && baristas(st).length > 0,
      queue: l ? l.lostQueue : 0,
    });
  }

  // ---------- боковая панель ----------
  function renderSide(): void {
    const st = s();
    if (selected && selected !== 'player') return fill(sideEl, otherHtml(selected));
    const loc = b.locations[st.options.location];
    const body = { overview: overviewHtml, prices: pricesHtml, staff: staffHtml, stock: stockHtml, ses: sesHtml, gear: gearHtml, dates: datesHtml }[tab]();
    fill(sideEl, `
      <header><div class="t"><span class="it-lvl">${b.forms[st.options.form].name} · ${loc.name.toUpperCase()}</span><div class="ttl" style="margin-top:6px">${st.shopName}</div></div></header>
      <div class="it-tabs gs-tabs" role="tablist">${TABS.map(([id, name]) => `<button class="it-tab ${tab === id ? 'on' : ''}" role="tab" aria-selected="${tab === id}" data-tab="${id}" data-k="tab-${id}">${name}</button>`).join('')}</div>
      ${body}`);
  }

  function otherHtml(id: string): string {
    const st = s();
    const back = `<button class="it-btn it-btn--secondary" data-select="player" data-k="back">← Моя кофейня</button>`;
    if (id === 'metro') {
      const season = seasonOf(monthOf(Math.min(st.day, totalDays(b)), b), b);
      return `<header><div class="t"><span class="it-lvl">ИСТОЧНИК ПОТОКА</span><div class="ttl" style="margin-top:6px">Метро</div></div></header>
        <div class="gs-facts">${row('Поток у вашей двери', `${st.footTraffic} чел/день`)}${row('Сезон: ' + season.name.toLowerCase(), '×' + season.demand.toLocaleString('ru-RU'))}${row('Хотят кофе', percent(b.demand.coffeeWantShare))}${row('Знают о вас', percent(st.awareness))}</div>
        <div class="gs-note">Клиенты = поток × сезон × «хотят кофе» × узнаваемость × ваша доля.</div>${back}`;
    }
    const i = Number(id.replace('rival', ''));
    const c = st.competitors[i];
    const v = demandView(st, cfg);
    return `<header><div class="t"><span class="it-lvl">КОНКУРЕНТ</span><div class="ttl" style="margin-top:6px">«${c.name}»</div></div></header>
      <div class="gs-facts">${row('Средний чек', price(c.avgCheck))}${row('Качество', c.quality.toLocaleString('ru-RU'))}${row('Репутация', stars(c.reputation))}${row('Доля прохожих', percent(v.rivalShares[i]))}${row('Ваша доля', percent(v.share))}</div>
      <div class="gs-note">Ваш чек ${price(v.check)}, качество ${v.quality.toFixed(2).replace('.', ',')}.</div>${back}`;
  }

  function overviewHtml(): string {
    const st = s();
    const l = last();
    const v = demandView(st, cfg);
    const cushion = cushionDays(st, cfg);
    const common = row('Узнаваемость', percent(st.awareness)) + row('Качество', v.quality.toFixed(2).replace('.', ',')) + row('Постоянные расходы', money(dailyFixed(st, cfg)) + ' / день') + row('Подушка', cushion === Infinity ? 'в плюсе' : cushion + ' дн.', cushion < 21 ? 'loss' : '');
    if (!l) return `<div class="gs-note">Идёт первый день. Касса закрывается в полночь – тогда здесь появятся выручка, клиенты и загрузка.</div><div class="gs-facts">${row('Ждём клиентов в день', '≈ ' + Math.round(v.expected))}${common}</div>`;
    const load = l.capacity > 0 ? l.served / l.capacity : 0;
    const week = st.history.slice(-7);
    const max = Math.max(1, ...week.map((r) => Math.abs(r.profit)));
    const bars = week.map((r) => `<i class="${r.profit < 0 ? 'neg' : ''}" style="height:${Math.max(4, Math.round((Math.abs(r.profit) / max) * 100))}%" title="День ${r.day}: ${signedMoney(r.profit)}"></i>`).join('');
    const lost = l.lostQueue + l.lostStock;
    return `
      <div class="lbl">Вчера · день ${l.day}${l.open ? '' : ' · закрыто'}</div>
      <div class="it-grid">
        <div class="it-cell"><span class="lbl">Выручка</span><span class="v">${money(l.revenue)}</span></div>
        <div class="it-cell"><span class="lbl">Сырьё</span><span class="v">${money(l.cogs + l.waste)}</span></div>
        <div class="it-cell"><span class="lbl">Прибыль</span><span class="v ${l.profit < 0 ? 'loss' : 'money'}">${signedMoney(l.profit)}</span></div>
      </div>
      <div><div class="it-row" style="margin-bottom:6px"><span class="lbl grow">Загрузка</span><span class="num">${percent(load)}</span></div>${bar(load * 100)}</div>
      <div><div class="lbl" style="margin-bottom:6px">Прибыль за ${week.length} дн. (с долей аренды и зарплат)</div><div class="it-spark" style="height:44px">${bars}</div></div>
      <div class="gs-facts">${row('Клиентов', l.served + (lost ? ` <span class="loss">(ушли: ${lost})</span>` : ''))}${row('Доля среди прохожих', percent(l.share))}${common}</div>`;
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
      return `<div class="gs-card"><div class="it-row"><b class="grow">${e.name}</b><span class="num">${money(e.salary)}</span></div>
        <div class="gs-note">${who(e.role, e.experience)}</div>
        ${e.role === 'barista' ? `<div class="it-row"><span class="gs-note" style="width:68px">Усталость</span><div class="grow">${bar(e.fatigue, e.fatigue >= b.staff.fatigue.tired ? 'bad' : 'coin')}</div></div>` : ''}
        <div class="it-row">${book}<span class="grow"></span>${cmd({ type: 'Fire', employeeId: e.id }, 'Уволить', 'ghost gs-mini loss')}</div></div>`;
    }).join('');
    const cands = st.candidates.map((c) => `<div class="gs-card"><div class="it-row"><b class="grow">${c.name}</b><span class="num">${money(c.salary)}</span></div>
        <div class="gs-note">${who(c.role, c.experience)} · ${c.hasMedBook ? 'медкнижка есть' : '<span class="warn">без медкнижки</span>'}</div>
        ${cmd({ type: 'Hire', candidateId: c.id }, 'Нанять', 'secondary gs-mini', st.employees.length >= b.staff.maxStaff || (c.role === 'cleaner' && st.employees.some((e) => e.role === 'cleaner')) ? 'disabled' : '')}</div>`).join('');
    return `<div class="it-seg">${posts}</div>
      <div class="gs-facts">${row('Часов в неделю на бариста', Math.round(hours) + ' из ' + b.staff.weeklyNormHours, over ? 'loss' : '')}${row('Зарплаты со взносами 34%', money(monthlyFixed(st, cfg) - b.locations[st.options.location].rent - b.costs.utilities) + ' / мес')}</div>
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
      <div class="gs-price"><div class="n"><b>Запас при автозаказе</b><span>больше – реже пусто, но больше списаний</span></div>
        <button class="it-btn it-btn--secondary gs-step" data-safety="${-step}" data-k="sf-m" aria-label="Меньше запас" ${st.safetyFactor <= b.inventory.safetyMin ? 'disabled' : ''}>−</button>
        <span class="v">${percent(st.safetyFactor)}</span>
        <button class="it-btn it-btn--secondary gs-step" data-safety="${step}" data-k="sf-p" aria-label="Больше запас" ${st.safetyFactor >= b.inventory.safetyMax ? 'disabled' : ''}>+</button></div>
      ${mats}`;
  }

  function inspectorCard(id: string): string {
    const i = inspectorById(cfg, id);
    return `<div class="gs-card gs-inspector"><div class="gs-face" aria-hidden="true">${i.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div><div><b>${i.name}</b><div><span class="it-lvl">${i.traitName.toUpperCase()}</span></div><div class="gs-note">${i.text}</div></div></div>`;
  }

  function sesHtml(): string {
    const st = s();
    const score = sesScore(st, cfg, true);
    const insp = announcedInspection(st);
    const items = checklist(cfg).map((i) => {
      const v = itemScore(st, cfg, i.id, true);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${i.name}</b><span class="num ${v < 50 ? 'loss' : v < 100 ? 'warn' : 'money'}">${Math.round(v)}</span></div>${bar(v, v < 50 ? 'bad' : '')}<div class="gs-note">${i.hint} Штраф ${money(i.fine)}.</div></div>`;
    }).join('');
    const planned = st.inspections.find((i) => i.reason === 'planned');
    return `<div><div class="it-row" style="margin-bottom:6px"><span class="lbl grow">Готовность к проверке</span><span class="num">${score}</span></div>${bar(score, score < 40 ? 'bad' : '')}</div>
      ${score < b.compliance.unplannedThreshold ? '<div class="gs-note loss">Ниже 40 – каждый день есть шанс внеплановой проверки.</div>' : ''}
      ${insp ? `<div class="lbl">Проверка на ${insp.visitDay}-й день · через ${insp.visitDay - st.day} дн.</div>${inspectorCard(insp.inspectorId)}` : planned ? `<div class="gs-note">Плановая проверка – на ${planned.visitDay}-й день, уведомление придёт за ${cfg.inspections.ses.noticeDays} дней.</div>` : ''}
      <div class="it-row gs-wrap">
        ${cmd({ type: 'Clean' }, `Срочная уборка ${money(b.costs.cleaning)}`, 'secondary gs-mini', st.cleanliness >= 100 ? 'disabled' : '')}
        ${insp && !insp.consultant ? cmd({ type: 'HireConsultant' }, `Консультант ${money(b.costs.consultant)}`, 'secondary gs-mini') : ''}
        ${st.defect && st.defectKnown ? cmd({ type: 'FixDefect' }, `Устранить сырость ${money(b.costs.defectFix)}`, 'secondary gs-mini') : ''}
      </div>${items}`;
  }

  function gearHtml(): string {
    const st = s();
    return (Object.keys(b.equipment) as EquipmentId[]).map((id) => {
      const e = b.equipment[id];
      const own = st.equipment.includes(id);
      return `<div class="gs-card"><div class="it-row"><b class="grow">${e.name}</b>${own ? '<span class="money num">есть</span>' : cmd({ type: 'BuyEquipment', id }, `<span class="price"><i class="it-coin"></i>${e.price.toLocaleString('ru-RU')}</span>`, 'secondary gs-mini')}</div><div class="gs-note">${e.text}</div></div>`;
    }).join('');
  }

  function datesHtml(): string {
    const st = s();
    const lastDay = totalDays(b);
    return upcoming(st, cfg).map((u) => `<div class="gs-card"><div class="it-row"><b class="grow">${u.title}</b>${u.amount !== null ? `<span class="num">${money(u.amount)}</span>` : ''}</div>
      <div class="gs-note">день ${u.day}${u.day <= lastDay ? ` · ${dayOfMonth(u.day, b)} ${monthName(monthOf(u.day, b)).toLowerCase()}` : ' · уже после конца года'} · ${u.day === st.day ? 'сегодня' : 'через ' + (u.day - st.day) + ' дн.'}</div></div>`).join('');
  }

  // ---------- меню и отладка ----------
  function renderMenu(): void {
    menuEl.hidden = !menuOpen;
    if (!menuOpen) return;
    const st = s();
    fill(menuEl, `<div class="lbl">Партия · сид ${st.seed}</div>
      <div class="it-row"><button class="it-btn it-btn--secondary grow" data-act="download" data-k="dl">Скачать сейв</button><button class="it-btn it-btn--ghost grow" data-act="new" data-k="new">Новая игра</button></div>
      <div class="gs-note">Игра сохраняется сама каждый день.</div>
      <div class="lbl">Отладка</div>
      <div class="it-row">${cmd({ type: 'DebugAddMoney', amount: 1000 }, '+ $1 000')}${cmd({ type: 'DebugInspection' }, 'Проверка завтра')}</div>
      <div class="it-row"><button class="it-btn it-btn--secondary grow" data-skip="1" data-k="s1">+1 дн.</button><button class="it-btn it-btn--secondary grow" data-skip="7" data-k="s7">+7</button><button class="it-btn it-btn--secondary grow" data-skip="30" data-k="s30">+30</button></div>
      <div class="gs-note">Команд в логе: ${st.commandLog.length} · дней в телеметрии: ${st.history.length}</div>`);
  }

  // ---------- тосты ----------
  function pushToasts(): void {
    const feed = s().feed;
    if (feedSeen > feed.length) feedSeen = 0;
    for (const f of feed.slice(feedSeen).slice(-4)) {
      const el = document.createElement('div');
      el.className = 'it-panel it-toast';
      const dot = { ok: ['ok', '+'], warn: ['wr', '!'], bad: ['er', '!'], info: ['wr', 'i'] }[f.tone];
      el.innerHTML = `<span class="dot ${dot[0]}">${dot[1]}</span><div><div style="font-weight:600">${f.title}</div>${f.text ? `<div class="gs-note">${f.text}</div>` : ''}</div>`;
      toastsEl.appendChild(el);
      setTimeout(() => el.remove(), 7000);
    }
    feedSeen = feed.length;
    while (toastsEl.children.length > 4) toastsEl.firstElementChild!.remove();
  }

  // ---------- окна ----------
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
      <div class="lbl">Уведомление · ${cfg.inspections.ses.fullName}</div><div class="ttl">Проверка через ${insp.visitDay - s().day} дн.</div>
      <div>${why} Визит на ${insp.visitDay}-й день.</div>${inspectorCard(insp.inspectorId)}
      <div class="gs-note">Вкладка «СЭС»: уборка, медкнижки, холодильник, поставщик. Консультант за ${money(b.costs.consultant)} добавит +15 к чистоте и найдёт скрытые дефекты.</div>
      <button class="it-btn it-btn--primary" data-cmd='{"type":"Acknowledge"}' data-goto="ses" data-k="ack">Готовиться</button></div>`;
  }

  function visitHtml(p: Extract<Pending, { kind: 'inspectionVisit' }>): string {
    const items = checklist(cfg);
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
      const bribe = cfg.inspections.ses.bribe;
      foot = `<div><b class="loss">Акт: штраф ${money(p.totalFine)}</b>${p.suspensionDays ? ` и приостановка на ${p.suspensionDays} дн.` : ''}</div>
        <div class="it-choices">
          <button class="it-btn it-btn--primary it-choice" data-cmd='{"type":"ResolveInspection","choice":"accept"}' data-k="acc"><span>Принять и исправить<br><small>повторная проверка через 30 дней</small></span><span class="price"><i class="it-coin"></i>${Math.round(p.totalFine).toLocaleString('ru-RU')}</span></button>
          <button class="it-btn it-btn--secondary it-choice" data-cmd='{"type":"ResolveInspection","choice":"contest"}' data-k="con"><span>Оспорить через юриста<br><small>шанс отмены ${percent(contestChance(cfg, p.results))}</small></span><span class="price"><i class="it-coin"></i>${b.costs.lawyer}</span></button>
          <button class="it-btn it-btn--danger it-choice" data-cmd='{"type":"ResolveInspection","choice":"bribe"}' data-k="bri"><span>«Договориться»<br><small>${percent(bribe.caughtChance)} – уголовное дело и конец игры</small></span><span class="price"><i class="it-coin"></i>${Math.round(p.totalFine * bribe.costShare).toLocaleString('ru-RU')}</span></button>
        </div>`;
    }
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="Проверка СЭС">
      <div class="lbl">${cfg.inspections.ses.fullName} · визит</div>${inspectorCard(p.inspectorId)}<div class="gs-checks">${rows}</div>${foot}</div>`;
  }

  function endHtml(): string {
    const st = s();
    const [title, text] = OUTCOMES[st.outcome ?? 'year'];
    const sc = computeScore(st, cfg);
    const medal = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };
    const honest = st.stats.bribes > 0 ? 'Серый кардинал' : st.stats.fines > 0 ? 'Битый предприниматель' : 'Честный предприниматель';
    const chronicle = st.feed.filter((f) => f.tone === 'bad').slice(-5).map((f) => `<div class="gs-note">День ${f.day}: ${f.title}</div>`).join('');
    return `<div class="it-panel it-event gs-modal" role="dialog" aria-label="${title}">
      <div class="ttl">${title}</div><div>${text}</div>
      <table class="gs-table"><tr><td>Деньги на счёте</td><td>${signedMoney(sc.cash)}</td></tr><tr><td>Оборудование (половина цены)</td><td>${signedMoney(sc.equipment)}</td></tr><tr><td>Возврат депозита</td><td>${signedMoney(sc.deposit)}</td></tr><tr><td>Налоговый долг</td><td>${signedMoney(-sc.taxDebt)}</td></tr><tr><td>Стартовый капитал</td><td>${signedMoney(-sc.startCapital)}</td></tr>
      <tr class="total"><td>Очки</td><td class="${sc.total < 0 ? 'loss' : 'money'}">${signedMoney(sc.total)}</td></tr></table>
      <div class="gs-facts">${sc.medal ? row('Медаль', medal[sc.medal]) : ''}${row('Репутация директора', honest)}${row('Репутация кофейни', stars(st.reputation))}${row('Проверок / штрафов', `${st.stats.inspections} / ${money(st.stats.fines)}`)}</div>
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
    if (!p) return;
    if (p.kind === 'monthReport') return fill(modalEl, monthHtml(p));
    if (p.kind === 'inspectionNotice') return fill(modalEl, noticeHtml(p));
    // чек-лист открывается по одному пункту – главный момент напряжения
    const key = `${st.day}:${p.inspectorId}`;
    if (key !== visitKey) {
      visitKey = key;
      visitShown = 0;
    }
    fill(modalEl, visitHtml(p));
    if (visitShown < p.results.length) {
      visitTimer = window.setTimeout(() => {
        visitShown++;
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

  const onClick = (e: MouseEvent): void => {
    const t = (e.target as Element).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    const d = t.dataset;
    if (d.speed !== undefined) return setSpeed(Number(d.speed) as Speed);
    if (d.act === 'download') return hooks.download();
    if (d.act === 'new') return hooks.newGame();
    if (d.menu !== undefined) menuOpen = !menuOpen;
    else if (d.tab) tab = d.tab as Tab;
    else if (d.select) selected = d.select;
    else if (d.price) game.dispatch({ type: 'SetPrice', itemId: d.price, price: s().prices[d.price] + Number(d.delta) });
    else if (d.safety) game.dispatch({ type: 'SetSafety', factor: s().safetyFactor + Number(d.safety) });
    else if (d.cmd) {
      game.dispatch(JSON.parse(d.cmd) as Command);
      if (d.goto) {
        tab = d.goto as Tab;
        selected = 'player';
      }
    } else if (d.skip) game.skipDays(Number(d.skip));
    hooks.save();
    renderAll();
  };
  screen.addEventListener('click', onClick);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'F2') {
      e.preventDefault();
      menuOpen = !menuOpen;
      return renderMenu();
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
    if (r.open) scene.floatText(signedMoney(r.revenue - r.cogs), r.revenue - r.cogs < 0 ? 'loss' : 'money');
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
    requestAnimationFrame(frame);
  }
  renderAll();
  requestAnimationFrame(frame);

  return () => {
    alive = false;
    clearTimeout(visitTimer);
    window.removeEventListener('keydown', onKey);
    game.onDay = null;
  };
}
