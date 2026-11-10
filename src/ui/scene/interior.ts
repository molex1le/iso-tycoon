/* Зал кофейни в разрезе: всё купленное видно сразу. Только отображение. */
import type { GameConfig } from '../../core/config';
import type { GameState } from '../../core/state';
import { hash, Pen, svgEl } from './pen';

function person(x: number, y: number, body: string, extra = ''): string {
  return `<g class="person" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(2.1)"><ellipse class="shadow" cx="0" cy="0" rx="4.5" ry="2"/><rect class="body ${body}" x="-2.6" y="-11" width="5.2" height="9" rx="2"/><circle class="head" cx="0" cy="-13.4" r="2.7"/>${extra}</g>`;
}

/** Собирает SVG по текущему состоянию. Строка стабильна, пока состояние не изменилось. */
export function interiorSvg(st: GameState, cfg: GameConfig, title: string): string {
  const seats = cfg.balance.locations[st.options.location].seats;
  const w = seats >= 14 ? 11 : seats >= 10 ? 9 : 8;
  const d = 7;
  const viewW = (w + d) * 32 + 60;
  const viewH = (w + d) * 16 + 150;
  const root = svgEl('svg', { viewBox: `0 0 ${viewW} ${viewH}`, class: 'scene', role: 'img', 'aria-label': 'Зал кофейни' }) as SVGSVGElement;
  const pen = new Pen(root, d * 32 + 30, 112);
  const has = (id: GameState['equipment'][number]) => st.equipment.includes(id);
  const last = st.history[st.history.length - 1];

  // пол и стены-разрез
  for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) pen.flat(x, y, 1, 1, 0, (x + y) % 2 ? 'f-t m-wood' : 'f-t m-wooddark');
  pen.wallL(0, w, 0, 0, 84, 'f-l m-cream');
  pen.wallR(0, d, 0, 0, 84, 'f-r m-plaster2');
  pen.flat(-0.12, -0.12, w + 0.12, 0.12, 84, 'f-t m-concrete');
  pen.flat(-0.12, 0, 0.12, d, 84, 'f-t m-concrete');

  // грязь
  const dirt = Math.floor((100 - st.cleanliness) / 8);
  for (let i = 0; i < dirt; i++) pen.disc(0.8 + hash(i, st.day >> 4, 1) * (w - 1.5), 2.2 + hash(i, st.day >> 4, 2) * (d - 2.6), 0.5, 7 + hash(i, 3, 3) * 9, 3 + hash(i, 4, 4) * 4, 'floor-dirt');

  // стена: меню, вывеска, план эвакуации, огнетушитель, датчик
  pen.wallL(1.1, 3.6, 0.01, 44, 72, 'f-l m-coffee');
  for (let i = 0; i < 4; i++) pen.line([1.35, 0.01, 66 - i * 6], [3.3 - (i % 2) * 0.5, 0.01, 66 - i * 6], 'menu-line');
  if (has('signage')) {
    pen.wallL(4.2, Math.min(w - 0.6, 7.4), 0.01, 50, 70, 'f-l m-coffee');
    pen.text('L', (4.2 + Math.min(w - 0.6, 7.4)) / 2, 0.02, 56, title, 'neon-sign', 13);
  }
  const hot = (tab: string, label: string) => pen.group('hot', { 'data-goto-tab': tab, tabindex: 0, role: 'button', 'aria-label': label });
  if (has('evacPlan')) {
    const g = hot('checks', 'План эвакуации');
    g.wallR(1.1, 1.9, 0.01, 44, 62, 'f-r m-white');
    g.wallR(1.25, 1.75, 0.01, 50, 58, 'f-r m-green');
  }
  if (has('extinguishers')) {
    const g = hot('checks', 'Огнетушитель');
    g.box(0.06, 2.3, 0.26, 0.26, 12, 24, 'red');
    g.disc(0.19, 2.43, 39, 4, 3, 'bank-coin');
  }
  if (has('alarm')) {
    const g = hot('checks', 'Сигнализация');
    g.disc(w / 2, 0.01, 78, 5, 4, 'alarm-led');
  }

  type Item = { key: number; html: () => void };
  const items: Item[] = [];
  const push = (key: number, html: () => void) => items.push({ key, html });

  // стойка: бариста стоят за ней
  const team = st.employees.filter((e) => e.role === 'barista').slice(0, st.posts);
  team.forEach((_, i) => {
    const [px, py] = pen.pt(2.2 + i * 2, 0.62, 12);
    push(0.5 + i, () => root.insertAdjacentHTML('beforeend', `<g data-goto-tab="staff" class="hot" tabindex="0" role="button" aria-label="Бариста">${person(px, py, 'apron', '<rect class="cap" x="-3" y="-16.8" width="6" height="1.8" rx=".8"/>')}</g>`));
  });
  push(3, () => {
    pen.box(1, 1.2, Math.min(w - 2, 5.5), 0.85, 0, 26, 'wood');
    pen.box(0.94, 1.14, Math.min(w - 2, 5.5) + 0.12, 0.97, 26, 3, 'concrete');
  });
  push(3.2, () => {
    const g = hot('gear', 'Кофемашина');
    const pro = has('machinePro');
    g.box(2, 1.3, pro ? 1.5 : 1, 0.6, 29, pro ? 26 : 18, pro ? 'white' : 'roofgrey');
    g.box(2.1, 1.85, pro ? 1.3 : 0.8, 0.06, 35, 8, 'coffee');
    g.disc(2.5, 1.6, pro ? 60 : 52, 3, 3, 'steam');
  });
  push(3.3, () => {
    const g = hot('gear', 'Онлайн-касса');
    if (has('register')) g.box(4, 1.45, 0.45, 0.4, 29, 12, 'coffee');
    if (has('register')) g.wallL(4.05, 4.4, 1.86, 33, 40, 'f-l m-glassbody');
  });
  push(3.4, () => {
    pen.box(5.05, 1.32, Math.min(1.1, w - 6.2), 0.6, 29, 14, 'metroglass');
    pen.disc(5.4, 1.62, 32, 5, 3, 'bank-coin');
    pen.disc(5.8, 1.62, 32, 5, 3, 'bank-coin');
  });
  if (has('fridge')) {
    push(3.6, () => {
      const g = hot('stock', 'Холодильник');
      g.box(0.15, 3.3, 0.8, 1, 0, 62, 'white');
      g.line([0.95, 3.45, 42], [0.95, 3.45, 28], 'pole');
    });
  }

  // столики
  const tables = Math.ceil(seats / 2);
  const pro = has('furniture');
  const load = last && last.capacity > 0 ? Math.min(1, last.served / last.capacity + 0.25) : 0.3;
  let guests = Math.round(seats * load);
  const cols = Math.max(2, Math.ceil(tables / 2));
  for (let i = 0; i < tables; i++) {
    const tx = 2.3 + (i % cols) * ((w - 3.2) / cols);
    const ty = 3.5 + Math.floor(i / cols) * 1.9;
    const seat = (cx: number, cy: number) => {
      push(cx + cy, () => pen.box(cx - 0.17, cy - 0.17, 0.34, 0.34, 0, pro ? 15 : 10, pro ? 'green' : 'wood'));
      if (guests > 0) {
        guests--;
        const [px, py] = pen.pt(cx, cy);
        const c = Math.floor(hash(i, cx, st.day) * 6);
        push(cx + cy + 0.05, () => root.insertAdjacentHTML('beforeend', person(px, py - 12, `pc${c}`)));
      }
    };
    seat(tx - 0.62, ty);
    seat(tx + 0.62, ty);
    push(tx + ty + 0.3, () => {
      const g = hot('gear', 'Мебель');
      if (pro) {
        g.line([tx, ty, 0], [tx, ty, 18], 'pole');
        g.disc(tx, ty, 19, 17, 8.5, 'tabletop');
      } else g.box(tx - 0.32, ty - 0.32, 0.64, 0.64, 0, 18, 'wood');
      g.disc(tx + 0.1, ty, 21, 3, 2, 'cup-small');
    });
  }

  // очередь от двери к кассе
  pen.flat(w - 1.9, d - 0.05, 1.3, 0.05, 0, 'f-t m-glassbody');
  const queue = Math.min(8, last ? Math.ceil(last.lostQueue / 3) + (last.served > 40 ? 2 : 1) : 0);
  for (let i = 0; i < queue; i++) {
    const qx = 4.2 + (i % 4) * 0.55 + (i >= 4 ? 0.2 : 0);
    const qy = 2.55 + Math.floor(i / 4) * 0.42;
    const [px, py] = pen.pt(qx, qy);
    const c = Math.floor(hash(i, 7, st.day) * 6);
    push(qx + qy, () => root.insertAdjacentHTML('beforeend', person(px, py, `pc${c}`)));
  }
  items.sort((a, b) => a.key - b.key).forEach((i) => i.html());
  return root.outerHTML;
}
