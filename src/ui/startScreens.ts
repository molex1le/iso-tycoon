import { totalDays, type AccountingId, type DifficultyId, type EquipmentId, type FormId, type GameConfig, type LocationId, type TaxRegimeId } from '../core/config';
import { cushionDays } from '../core/finance';
import { createInitialState, defaultOptions, rollDefects, type NewGameOptions } from '../core/state';
import { money, monthName } from './format';
import { monthOf } from '../core/calendar';
import { audio, audioControlsHtml } from './audio';
import type { LocationKey } from './scene/models';
import { SceneView } from './scene/sceneView';
import { saveSettings, settings } from './settings';

/** Краткое описание сохранения для списка слотов. */
export interface SlotInfo { day: number; cash: number; difficulty: string; location: string; finished: boolean }

export interface MenuHooks {
  slots: (SlotInfo | null)[];
  /** слот, в который играли последним */
  active: number;
  onContinue: (slot: number) => void;
  onNew: (slot: number) => void;
  onDelete: (slot: number) => void;
  onDownload: (slot: number) => void;
  onLoadFile: (slot: number, text: string) => void;
}

const WORLDS: [string, boolean][] = [['Кофейня', true], ['Доставка', false], ['Производство', false], ['Агентство', false], ['Банк', false]];

export function mountMainMenu(root: HTMLElement, hooks: MenuHooks, error = ''): void {
  delete document.documentElement.dataset.theme;
  root.innerHTML = `
  <div class="it st"><div>
    <div class="st-logo">Iso Tycoon</div>
    <div class="st-sub">Открой кофейню и попробуй не закрыться</div>
    <div class="it-panel st-menu">
      <div class="lbl">Сохранения</div>
      ${hooks.slots.map((x, i) => slotHtml(x, i, i === hooks.active, confirmDelete === i)).join('')}
      <input type="file" accept="application/json,.json" hidden data-file>
      ${error ? `<div class="loss">${error}</div>` : ''}
      <div class="lbl">Звук</div>${audioControlsHtml()}
      <div class="lbl">Миры</div>
      <div class="st-worlds">${WORLDS.map(([n, open]) => `<div class="st-world ${open ? '' : 'lock'}">${open ? '' : '🔒 '}${n}</div>`).join('')}</div>
    </div>
  </div></div>`;
  const file = root.querySelector<HTMLInputElement>('[data-file]')!;
  root.querySelector('.st')!.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.vol) return;
    settings[t.dataset.vol as 'music' | 'sfx'] = Number(t.value) / 100;
    audio.applyVolumes();
    saveSettings();
  });
  root.querySelector('.st')!.addEventListener('click', (e) => {
    audio.unlock();
    const btn = (e.target as Element).closest<HTMLElement>('button');
    const a = btn?.dataset.a;
    if (!btn || !a) return;
    const slot = Number(btn.dataset.slot);
    if (a === 'continue') hooks.onContinue(slot);
    else if (a === 'new') hooks.onNew(slot);
    else if (a === 'download') hooks.onDownload(slot);
    else if (a === 'load') {
      loadSlot = slot;
      file.click();
    } else if (a === 'delete') {
      confirmDelete = slot;
      mountMainMenu(root, hooks, error);
    } else if (a === 'delete-no') {
      confirmDelete = -1;
      mountMainMenu(root, hooks, error);
    } else if (a === 'delete-yes') {
      confirmDelete = -1;
      hooks.onDelete(slot);
    }
  });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) hooks.onLoadFile(loadSlot, await f.text());
  });
}

let confirmDelete = -1;
let loadSlot = 0;

function slotHtml(x: SlotInfo | null, i: number, active: boolean, confirming: boolean): string {
  const n = i + 1;
  if (!x) {
    return `<div class="st-slot empty"><div class="st-slot-head"><b>Слот ${n}</b><span>пусто</span></div>
      <div class="it-row"><button class="it-btn it-btn--${active ? 'primary' : 'secondary'}" data-a="new" data-slot="${i}">Новая игра</button><button class="it-btn it-btn--secondary" data-a="load" data-slot="${i}">Из файла</button></div></div>`;
  }
  if (confirming) {
    return `<div class="st-slot"><div class="st-slot-head"><b>Слот ${n}</b><span>Удалить партию? Вернуть её будет нельзя.</span></div>
      <div class="it-row"><button class="it-btn it-btn--danger" data-a="delete-yes" data-slot="${i}">Удалить</button><button class="it-btn it-btn--secondary" data-a="delete-no" data-slot="${i}">Оставить</button></div></div>`;
  }
  return `<div class="st-slot"><div class="st-slot-head"><b>Слот ${n}</b><span>${x.location} · ${x.difficulty} · ${x.finished ? 'партия окончена' : 'день ' + x.day} · ${money(x.cash)}</span></div>
    <div class="it-row"><button class="it-btn it-btn--${active ? 'primary' : 'secondary'}" data-a="continue" data-slot="${i}">${x.finished ? 'Открыть итог' : 'Продолжить'}</button><button class="it-btn it-btn--secondary st-slot-mini" data-a="download" data-slot="${i}" aria-label="Скачать сейв слота ${n}">Скачать</button><button class="it-btn it-btn--secondary st-slot-mini" data-a="delete" data-slot="${i}" aria-label="Удалить слот ${n}">Удалить</button></div></div>`;
}

const FORM_TEXT: Record<FormId, string> = {
  ip: '$50, 1 день. Простая отчётность, можно без бухгалтера. Но долги остаются на вас лично.',
  ooo: '$300. Отвечает только фирма, кредитный лимит +50%, заказы от офисов. Нужен бухгалтер.',
};
const REGIME_TEXT: Record<TaxRegimeId, string> = {
  revenue6: 'Просто и надёжно. Платите с оборота, даже если прибыли нет.',
  profit15: 'Выгоднее при низкой марже, но каждый расход нужно подтвердить документом.',
};
const ACC_TEXT: Record<AccountingId, [string, string]> = {
  self: ['Сам', 'Бесплатно. Нажимать «Подать» и «Оплатить» самому, 10% шанс ошибки. Только ИП.'],
  outsource: ['Аутсорс, $300/мес', 'Подаёт и платит сам, 5% шанс ошибки.'],
  staff: ['Бухгалтер в штате, $900/мес', 'Подаёт и платит сам, 1% шанс ошибки.'],
};
const EXTRAS: EquipmentId[] = ['fridge', 'furniture', 'signage', 'extinguishers', 'evacPlan', 'alarm'];
const DEFECT_NAME = { damp: 'сырость', wiring: 'старая проводка', exit: 'нет запасного выхода' };

export function mountWizard(root: HTMLElement, cfg: GameConfig, seed: number, onStart: (o: NewGameOptions) => void, onBack: () => void): void {
  const b = cfg.balance;
  const o: NewGameOptions = { ...defaultOptions(cfg), premisesInspection: false };
  const defects = rollDefects(seed, cfg);
  let step = 0;
  const STEPS = 6;

  const opt = (attr: string, value: string, on: boolean, title: string, text: string, disabled = false) =>
    `<button class="st-opt ${on ? 'on' : ''}" data-${attr}="${value}" aria-pressed="${on}" ${disabled ? 'disabled' : ''}><b>${title}</b><span>${text}</span></button>`;

  function body(): string {
    switch (step) {
      case 0:
        return `<div class="ttl">Сложность и капитал</div>
        <div class="st-opts">${(Object.keys(b.difficulties) as DifficultyId[]).map((id) => opt('difficulty', id, o.difficulty === id, `${b.difficulties[id].name}, ${money(b.difficulties[id].startCapital)}`, b.difficulties[id].text)).join('')}</div>
        <label class="lbl" for="st-name">Название</label><input id="st-name" class="st-input" data-name maxlength="32" value="${o.shopName.replace(/"/g, '&quot;')}">
        <div class="lbl">Стартовый кредит «${b.loans.products.start.name}», ${b.loans.products.start.rate}% на 24 мес</div>
        <div class="st-opts">${[0, 5000, 10000, 20000].map((v) => opt('loan', String(v), o.startLoan === v, v ? money(v) : 'Без кредита', v ? 'Деньги сразу, платежи с первого месяца' : 'Только свои')).join('')}</div>`;
      case 1:
        return `<div class="ttl">Форма бизнеса</div>
        <div class="st-opts">${(Object.keys(b.forms) as FormId[]).map((id) => opt('form', id, o.form === id, b.forms[id].name, FORM_TEXT[id])).join('')}</div>
        <div class="lbl">Кто ведёт бухгалтерию</div>
        <div class="st-opts">${(Object.keys(ACC_TEXT) as AccountingId[]).map((id) => opt('acc', id, o.accounting === id, ACC_TEXT[id][0], ACC_TEXT[id][1], id === 'self' && o.form === 'ooo')).join('')}</div>
        <div class="lbl">Первые два бариста</div>
        <div class="st-opts">${opt('staff', '1', o.startStaffOfficial, 'Официально', 'Зарплата + 34% взносов')}${opt('staff', '0', !o.startStaffOfficial, '«В конверте»', 'Без взносов. Риск трудовой и налоговой')}</div>`;
      case 2:
        return `<div class="ttl">Налоговый режим</div><div class="gs-note">Сменить можно только с нового года.</div>
        <div class="st-opts">${(Object.keys(b.taxes.regimes) as TaxRegimeId[]).map((id) => opt('regime', id, o.taxRegime === id, b.taxes.regimes[id].name, REGIME_TEXT[id])).join('')}</div>`;
      case 3: {
        const d = defects[o.location];
        return `<div class="ttl">Помещение</div>
        <div class="gs-note">Кликните по зданию с меткой или выберите ниже. Колесо – зум, перетаскивание – обзор.</div>
        <div class="st-map-slot"></div>
        <div class="st-opts">${(Object.keys(b.locations) as LocationId[]).map((id) => { const l = b.locations[id]; return opt('location', id, o.location === id, l.name, `Аренда ${money(l.rent)}/мес · поток ${l.footTraffic} чел/день · ${l.seats} мест`); }).join('')}</div>
        <div class="gs-note">Депозит – 2 месяца аренды, договор на год. У каждого помещения может быть скрытый дефект.</div>
        ${opt('inspect', '1', o.premisesInspection, `Заказать осмотр, ${money(b.costs.premisesInspection)}`, o.premisesInspection ? (d ? `Найдено: ${DEFECT_NAME[d]}. Полный ремонт устранит.` : 'Дефектов не найдено.') : 'Покажет, есть ли дефект у выбранного помещения')}`;
      }
      case 4:
        return `<div class="ttl">Ремонт и оснащение</div>
        <div class="st-opts">${opt('repair', 'cosmetic', o.repair === 'cosmetic', `Косметический, ${money(b.costs.repair.cosmetic)}`, 'Скрытый дефект останется')}${opt('repair', 'full', o.repair === 'full', `Полный, ${money(b.costs.repair.full)}`, 'Устраняет дефект, +20 к пожарной шкале')}</div>
        <div class="lbl">Кофемашина</div>
        <div class="st-opts">${(['machineBasic', 'machinePro'] as const).map((id) => opt('machine', id, o.machine === id, `${b.equipment[id].name}, ${money(b.equipment[id].price)}`, b.equipment[id].text)).join('')}</div>
        <div class="lbl">Ещё</div>
        <div class="st-opts">${EXTRAS.map((id) => opt('extra', id, o.extras.includes(id), `${b.equipment[id].name}, ${money(b.equipment[id].price)}`, b.equipment[id].text)).join('')}</div>`;
      default: {
        const p = createInitialState(seed, o, cfg);
        const cushion = cushionDays(p, cfg);
        const first = [...p.inspections].sort((a, c) => a.visitDay - c.visitDay)[0];
        const m = monthOf(first.visitDay, b);
        return `<div class="ttl">Брифинг</div>
        <div>Денег хватит ${cushion === Infinity ? 'надолго' : `примерно на ${Math.max(0, Math.round(cushion / 7))} нед.`}, рядом ${p.competitors.length} конкурента, первая плановая проверка – ${cfg.inspections[first.agency].name} в ${monthName(m).toLowerCase().replace(/ь$/, 'е').replace(/й$/, 'е').replace(/т$/, 'те')}.</div>
        <div class="gs-note">Цель – продержаться ${totalDays(b)} дней: три месяца подряд в плюсе, без просрочек, репутация не ниже 4,0. Налоги не списываются сами – смотрите вкладку «Сроки».</div>`;
      }
    }
  }

  let mapHost: HTMLElement | null = null;
  let mapScene: SceneView | null = null;
  let mapFrame = 0;

  function closeMap(): void {
    cancelAnimationFrame(mapFrame);
    mapFrame = 0;
    mapScene?.destroy();
    mapScene = null;
    mapHost = null;
  }

  function mountMap(): void {
    const slot = root.querySelector('.st-map-slot');
    if (!slot) return;
    if (!mapHost) {
      mapHost = document.createElement('div');
      mapHost.className = 'st-map';
      slot.replaceWith(mapHost);
      mapScene = new SceneView(mapHost, (id) => {
        if (id?.startsWith('lot-')) {
          o.location = id.slice(4) as LocationId;
          render();
        }
      }, o.location, true);
      let prev = performance.now();
      const tick = (now: number) => {
        if (!mapScene) return;
        mapScene.setLook({ title: 'Ваша кофейня', signage: false, pro: false, furniture: false, closed: false }, 'player');
        mapScene.setFlow({ traffic: b.locations[o.location].footTraffic, pPlayer: 0.08, pRivals: [0.08, 0.05], playerOpen: true, queue: 0 });
        mapScene.frame(Math.min(0.1, (now - prev) / 1000), 1, 12);
        prev = now;
        mapFrame = requestAnimationFrame(tick);
      };
      mapFrame = requestAnimationFrame(tick);
    } else slot.replaceWith(mapHost);
    mapScene!.setLocation(o.location as LocationKey);
  }

  function render(): void {
    const preview = createInitialState(seed, o, cfg);
    const lines = preview.setup.map((l) => `<div class="st-line"><span>${l.name}</span><b>${money(l.amount)}</b></div>`).join('');
    const bad = preview.cash < 0;
    const focusKey = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-name') !== null && document.activeElement?.hasAttribute('data-name');
    root.innerHTML = `<div class="it st"><div class="st-wiz">
      <div class="it-panel st-main">
        <div class="st-steps" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS}" aria-valuenow="${step + 1}">${Array.from({ length: STEPS }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
        ${body()}
        <div class="st-nav"><button class="it-btn it-btn--ghost" data-nav="back">Назад</button>${step < STEPS - 1 ? '<button class="it-btn it-btn--primary" data-nav="next">Дальше</button>' : `<button class="it-btn it-btn--primary" data-nav="start" ${bad ? 'disabled' : ''}>Открыть кофейню</button>`}</div>
      </div>
      <div class="it-panel st-sum"><div class="lbl">Смета открытия</div>
        <div class="st-line"><span>Капитал</span><b>${money(preview.startCapital)}</b></div>
        ${o.startLoan ? `<div class="st-line"><span>Кредит</span><b>${money(o.startLoan)}</b></div>` : ''}
        ${lines}
        <div class="st-line st-total"><span>Останется</span><b class="${bad ? 'loss' : 'money'}">${money(preview.cash)}</b></div>
        ${bad ? '<div class="gs-note loss">Денег не хватает: уберите лишнее или возьмите кредит.</div>' : ''}
      </div></div></div>`;
    if (focusKey) {
      const el = root.querySelector<HTMLInputElement>('[data-name]');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
    if (step === 3) mountMap();
    else if (mapHost) closeMap();
  }

  root.onclick = (e) => {
    const t = (e.target as Element).closest<HTMLElement>('button');
    if (!t || t.hasAttribute('disabled')) return;
    audio.unlock();
    audio.play('click');
    const d = t.dataset;
    if (d.nav === 'back') {
      if (step === 0) {
        closeMap();
        root.onclick = null;
        root.oninput = null;
        return onBack();
      }
      step--;
    } else if (d.nav === 'next') step++;
    else if (d.nav === 'start') {
      closeMap();
      root.onclick = null;
      root.oninput = null;
      return onStart(o);
    } else if (d.difficulty) o.difficulty = d.difficulty as DifficultyId;
    else if (d.loan) o.startLoan = Number(d.loan);
    else if (d.form) {
      o.form = d.form as FormId;
      if (o.form === 'ooo' && o.accounting === 'self') o.accounting = 'outsource';
    } else if (d.acc) o.accounting = d.acc as AccountingId;
    else if (d.staff) o.startStaffOfficial = d.staff === '1';
    else if (d.regime) o.taxRegime = d.regime as TaxRegimeId;
    else if (d.location) o.location = d.location as LocationId;
    else if (d.inspect) o.premisesInspection = !o.premisesInspection;
    else if (d.repair) o.repair = d.repair as NewGameOptions['repair'];
    else if (d.machine) o.machine = d.machine as NewGameOptions['machine'];
    else if (d.extra) {
      const id = d.extra as EquipmentId;
      o.extras = o.extras.includes(id) ? o.extras.filter((x) => x !== id) : [...o.extras, id];
    } else return;
    render();
  };
  root.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.name !== undefined) o.shopName = t.value.trim() || 'Кофейня';
  };
  render();
}
