/* Живая карта района: статичная сцена, пешеходы, время суток, камера. Только отображение – на игру не влияет. */
import { BUILDINGS, MAP, PROPS, drawBuilding, drawCar, drawProp, ground, type ShopLook } from './models';
import { Pen, TH, TW, svgEl } from './pen';

const MAX_H = 215;
const W = MAP * TW;
const H = MAP * TH + MAX_H + 30;

interface Static {
  node: SVGElement;
  x: number;
  y: number;
  w: number;
  d: number;
  key: number;
}

type Pt = [number, number];

interface Car {
  node: SVGElement;
  axis: 'x' | 'y';
  /** постоянная координата полосы */
  lane: number;
  pos: number;
  dir: 1 | -1;
  speed: number;
  anchor: Element | null | undefined;
}

interface Walker {
  node: SVGElement;
  pts: Pt[];
  seg: number;
  t: number;
  speed: number;
  phase: number;
  enter: string | null;
  anchor: Element | null | undefined;
}

/** Потоки людей: доля прохожих, заходящих в каждую кофейню. */
export interface Flow {
  traffic: number;
  pPlayer: number;
  pRivals: number[];
  playerOpen: boolean;
  queue: number;
}

const DOORS: Record<string, Pt> = { player: [6.5, 8.5], rival0: [16.5, 8.5], rival1: [8.5, 13.5] };
const DOOR_STEP: Record<string, Pt> = { player: [6.5, 8.05], rival0: [16.5, 8.05], rival1: [8.05, 13.5] };
const METRO: Pt = [13, 8.5];
const EDGES: Pt[] = [[0, 8.5], [20, 8.5], [0, 11.5], [20, 11.5], [8.5, 0], [8.5, 20], [11.5, 0], [11.5, 20]];
const isH = (p: Pt) => p[1] === 8.5 || p[1] === 11.5;

/** Маршрут по тротуарам между двумя точками на линиях сетки. */
function route(a: Pt, b: Pt): Pt[] {
  const ha = isH(a);
  const hb = isH(b);
  if (ha && hb) {
    if (a[1] === b[1]) return [a, b];
    const vx = Math.random() < 0.5 ? 8.5 : 11.5;
    return [a, [vx, a[1]], [vx, b[1]], b];
  }
  if (!ha && !hb) {
    if (a[0] === b[0]) return [a, b];
    const hy = Math.random() < 0.5 ? 8.5 : 11.5;
    return [a, [a[0], hy], [b[0], hy], b];
  }
  return ha ? [a, [b[0], a[1]], b] : [a, [a[0], b[1]], b];
}

/** 0 – день, 1 – ночь, плавные сумерки. */
export function nightFactor(hour: number): number {
  const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (hour - a) / (b - a)));
  if (hour < 12) return 1 - ramp(5, 7.5);
  return ramp(18, 21);
}

export class SceneView {
  private svg: SVGSVGElement;
  private world: SVGElement;
  private gGround: SVGElement;
  private gObj: SVGElement;
  private gFx: SVGElement;
  private pen: Pen;
  private statics: Static[] = [];
  private walkers: Walker[] = [];
  private cars: Car[] = [];
  private queueNodes: SVGElement[] = [];
  private look: ShopLook | null = null;
  private selected: string | null = null;
  private flow: Flow = { traffic: 0, pPlayer: 0, pRivals: [], playerOpen: false, queue: 0 };
  private spawnDebt = 0;
  private cam = { x: 0, y: 0, s: 1.5 };
  private shownNight = -1;

  constructor(
    private host: HTMLElement,
    private onSelect: (id: string | null) => void,
  ) {
    this.svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', class: 'scene' }, host) as SVGSVGElement;
    this.world = svgEl('g', {}, this.svg);
    this.gGround = svgEl('g', {}, this.world);
    this.gObj = svgEl('g', {}, this.world);
    this.gFx = svgEl('g', {}, this.world);
    this.pen = new Pen(this.gObj, W / 2, MAX_H + 24);
    this.drawGround();
    // камера смотрит на перекрёсток, чуть левее – справа панель
    this.centerCamera();
    this.bindCamera();
    this.spawnCars();
  }

  /** Кофейня и метро – в свободной части экрана: слева от панели и под верхней полосой. */
  private centerCamera(): void {
    const r = this.svg.getBoundingClientRect();
    const u = this.unit();
    const panel = r.width > 900 ? 364 : 0;
    const freeW = Math.max(240, r.width - panel) * u;
    const [ax, ay] = this.pen.pt(6.5, 7);
    const [bx, by] = this.pen.pt(13, 7);
    this.cam.s = Math.min(1.7, Math.max(0.75, freeW / (bx - ax + 380)));
    const sx = (r.width - panel) / 2;
    const sy = (r.height + 80) / 2;
    const vx = (sx - r.width / 2) * u + W / 2;
    const vy = (sy - r.height / 2) * u + H / 2;
    this.cam.x = vx - ((ax + bx) / 2) * this.cam.s;
    this.cam.y = vy - ((ay + by) / 2) * this.cam.s;
    this.applyCam();
  }

  private spawnCars(): void {
    const lanes: [Car['axis'], number, 1 | -1][] = [['x', 9.5, 1], ['x', 10.14, -1], ['y', 9.5, -1], ['y', 10.14, 1]];
    lanes.forEach(([axis, lane, dir], i) => {
      for (let k = 0; k < 2; k++) {
        const node = svgEl('g', { class: 'car' });
        drawCar(new Pen(node, 0, 0), 0, 0, axis, (i * 2 + k + 1) % 4);
        this.cars.push({ node, axis, lane, dir, pos: Math.random() * MAP, speed: 1.6 + Math.random() * 0.8, anchor: undefined });
      }
    });
  }

  private moveCars(step: number): void {
    for (const c of this.cars) {
      c.pos += c.dir * c.speed * step;
      if (c.pos > MAP) c.pos -= MAP;
      if (c.pos < 0) c.pos += MAP;
      const p: Pt = c.axis === 'x' ? [c.pos, c.lane] : [c.lane, c.pos];
      const [sx, sy] = this.pen.pt(p[0], p[1]);
      c.node.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
      const anchor = this.anchorFor(p);
      if (anchor !== c.anchor || !c.node.parentNode) {
        this.gObj.insertBefore(c.node, anchor);
        c.anchor = anchor;
      }
    }
  }

  // ---------- сцена ----------

  private drawGround(): void {
    const p = new Pen(this.gGround, this.pen.ox, this.pen.oy);
    for (let y = 0; y < MAP; y++) {
      for (let x = 0; x < MAP; x++) p.flat(x, y, 1, 1, 0, 'tile ' + ground(x, y));
    }
    // зебры и разметка
    for (const [x0, y0, along] of [[8, 9, 'y'], [11, 9, 'y'], [9, 8, 'x'], [9, 11, 'x']] as [number, number, string][]) {
      for (let i = 0; i < 6; i++) {
        const o = 0.12 + i * 0.32;
        if (along === 'y') p.flat(x0 + 0.15, y0 + o, 0.7, 0.14, 0.2, 'zebra');
        else p.flat(x0 + o, y0 + 0.15, 0.14, 0.7, 0.2, 'zebra');
      }
    }
    for (let i = 0; i < MAP; i += 1) {
      if (i >= 8 && i < 12) continue;
      p.flat(i + 0.25, 9.97, 0.5, 0.06, 0.2, 'lane');
      p.flat(9.97, i + 0.25, 0.06, 0.5, 0.2, 'lane');
    }
  }

  /** Перерисовывает здания, если изменился вид кофейни или выделение. */
  setLook(look: ShopLook, selected: string | null): void {
    if (this.look && JSON.stringify(look) === JSON.stringify(this.look) && selected === this.selected) return;
    this.look = { ...look };
    this.selected = selected;
    for (const s of this.statics) s.node.remove();
    this.statics = [];
    const add = (x: number, y: number, w: number, d: number, draw: (p: Pen) => void, attrs: Record<string, string> = {}) => {
      const g = this.pen.group('', attrs);
      draw(g);
      this.statics.push({ node: g.g, x, y, w, d, key: x + y + w + d });
    };
    for (const b of BUILDINGS) {
      add(b.x, b.y, b.w, b.d, (p) => {
        if (b.id && b.id === selected) p.flat(b.x - 0.08, b.y - 0.08, b.w + 0.16, b.d + 0.16, 0, 'select-ring');
        drawBuilding(p, b, look);
        if (b.id === 'player') {
          const [px, py] = p.pt(b.x + b.w / 2, b.y + b.d / 2, look.signage ? 64 : 50);
          p.g.insertAdjacentHTML('beforeend', `<polygon class="pin" points="${px - 7},${py - 10} ${px + 7},${py - 10} ${px},${py}"/>`);
        }
      }, b.id ? { 'data-id': b.id, class: 'pick' } : {});
    }
    for (const o of PROPS) {
      const size = o.kind === 'car' ? 0.7 : 0.3;
      add(o.x - (o.kind === 'car' ? 0 : size / 2), o.y - (o.kind === 'car' ? 0 : size / 2), size, size, (p) => drawProp(p, o));
    }
    this.statics.sort((a, b) => a.key - b.key);
    for (const s of this.statics) this.gObj.appendChild(s.node);
    for (const w of this.walkers) w.anchor = undefined;
    for (const c of this.cars) c.anchor = undefined;
    this.placeQueue();
  }

  setFlow(flow: Flow): void {
    const queueChanged = flow.queue !== this.flow.queue;
    this.flow = flow;
    if (queueChanged) this.placeQueue();
  }

  private placeQueue(): void {
    for (const n of this.queueNodes) n.remove();
    this.queueNodes = [];
    const n = Math.min(6, Math.ceil(this.flow.queue / 4));
    for (let i = 0; i < n; i++) {
      const node = this.personNode(i + 2, false);
      const pos: Pt = [6.75 + i * 0.28, 8.22];
      const [sx, sy] = this.pen.pt(pos[0], pos[1]);
      node.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
      this.insertSorted(node, pos);
      this.queueNodes.push(node);
    }
  }

  // ---------- пешеходы ----------

  private personNode(color: number, cup: boolean): SVGElement {
    const g = svgEl('g', { class: 'person' });
    g.innerHTML =
      `<ellipse class="shadow" cx="0" cy="0" rx="4.5" ry="2"/>` +
      `<rect class="body pc${color % 6}" x="-2.6" y="-11" width="5.2" height="9" rx="2"/>` +
      `<circle class="head" cx="0" cy="-13.4" r="2.7"/>` +
      (cup ? `<rect class="cup" x="2.2" y="-8.5" width="2.2" height="3"/>` : '');
    return g;
  }

  private anchorFor(pos: Pt): Element | null {
    let idx = -1;
    for (let i = 0; i < this.statics.length; i++) {
      const s = this.statics[i];
      if (pos[1] >= s.y + s.d - 0.01 || pos[0] >= s.x + s.w - 0.01) idx = i;
    }
    return idx + 1 < this.statics.length ? this.statics[idx + 1].node : null;
  }

  private insertSorted(node: SVGElement, pos: Pt): Element | null {
    const anchor = this.anchorFor(pos);
    this.gObj.insertBefore(node, anchor);
    return anchor;
  }

  private spawn(from: Pt, to: Pt, enter: string | null, cup = false): void {
    if (this.walkers.length >= 70) return;
    const pts = route(from, to);
    if (enter) pts.push(DOOR_STEP[enter]);
    if (cup) pts.unshift(DOOR_STEP[Object.keys(DOORS).find((k) => DOORS[k] === from)!] ?? from);
    // каждый идёт по своей «полосе» тротуара
    const off = (Math.random() - 0.5) * 0.5;
    const shifted = pts.map((p, i): Pt => (i === pts.length - 1 && enter) || (i === 0 && cup) ? p : [p[0] + off, p[1] + off]);
    const node = this.personNode(Math.floor(Math.random() * 6), cup);
    this.walkers.push({ node, pts: shifted, seg: 0, t: 0, speed: 0.9 + Math.random() * 0.5, phase: Math.random() * 6, enter, anchor: undefined });
  }

  private spawnRandom(): void {
    const f = this.flow;
    const from = Math.random() < 0.45 ? METRO : EDGES[Math.floor(Math.random() * EDGES.length)];
    let r = Math.random();
    const shops: [string, number][] = [['player', f.playerOpen ? f.pPlayer : 0], ...f.pRivals.map((p, i): [string, number] => [`rival${i}`, p])];
    for (const [id, p] of shops) {
      if (r < p && DOORS[id]) return this.spawn(from, DOORS[id], id);
      r -= p;
    }
    let to = EDGES[Math.floor(Math.random() * EDGES.length)];
    if (to === from) to = METRO;
    this.spawn(from, to, null);
  }

  /** Кадр: движение людей, время суток. dt – реальные секунды, speed – скорость игры (0 – пауза). */
  frame(dt: number, speed: number, hour: number): void {
    const night = nightFactor(hour);
    this.applyNight(night);
    if (speed === 0) return;
    const step = dt * speed;
    this.moveCars(step);
    const dayness = hour >= 7 && hour < 22 ? 1 : 0.12;
    this.spawnDebt += step * 1.6 * dayness * Math.min(2, this.flow.traffic / 950);
    while (this.spawnDebt >= 1) {
      this.spawnDebt--;
      this.spawnRandom();
    }
    const alive: Walker[] = [];
    for (const w of this.walkers) {
      let a = w.pts[w.seg];
      let b = w.pts[w.seg + 1];
      let len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.001;
      w.t += (step * w.speed) / len;
      while (w.t >= 1 && w.seg < w.pts.length - 2) {
        w.t = (w.t - 1) * len;
        w.seg++;
        a = w.pts[w.seg];
        b = w.pts[w.seg + 1];
        len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.001;
        w.t /= len;
      }
      if (w.t >= 1) {
        w.node.remove();
        // зашёл в кофейню – через пару секунд выйдет со стаканом
        if (w.enter) {
          const id = w.enter;
          const back = EDGES[Math.floor(Math.random() * EDGES.length)];
          setTimeout(() => this.spawn(DOORS[id], back, null, true), (1500 + Math.random() * 2500) / Math.max(1, speed));
        }
        continue;
      }
      const pos: Pt = [a[0] + (b[0] - a[0]) * w.t, a[1] + (b[1] - a[1]) * w.t];
      const [sx, sy] = this.pen.pt(pos[0], pos[1]);
      w.phase += step * 9;
      w.node.setAttribute('transform', `translate(${sx.toFixed(1)},${(sy - Math.abs(Math.sin(w.phase)) * 1.2).toFixed(1)})`);
      const anchor = this.anchorFor(pos);
      if (anchor !== w.anchor) {
        this.gObj.insertBefore(w.node, anchor);
        w.anchor = anchor;
      }
      alive.push(w);
    }
    this.walkers = alive;
  }

  private applyNight(n: number): void {
    const v = Math.round(n * 50) / 50;
    if (v === this.shownNight) return;
    this.shownNight = v;
    const st = this.host.style;
    st.setProperty('--dim', `${Math.round(v * 58)}%`);
    st.setProperty('--lit', `${Math.round(Math.min(1, v * 1.6) * 100)}%`);
    st.setProperty('--glow', String(Math.min(1, v * 1.4)));
    // закат и рассвет подкрашены тёплым
    const dusk = Math.sin(Math.PI * v);
    st.setProperty('--dusk', String((dusk * 0.22).toFixed(3)));
  }

  /** Всплывающая сумма над кофейней в момент закрытия кассы. */
  floatText(text: string, tone: 'money' | 'loss'): void {
    const [x, y] = this.pen.pt(6.5, 7, 70);
    const t = svgEl('text', { class: `float ${tone}`, x, y, 'text-anchor': 'middle' }, this.gFx);
    t.textContent = text;
    t.addEventListener('animationend', () => t.remove());
  }

  // ---------- камера ----------

  private applyCam(): void {
    const c = this.cam;
    c.s = Math.min(3.2, Math.max(0.75, c.s));
    c.x = Math.min(W * 0.6, Math.max(W * 0.4 - W * c.s, c.x));
    c.y = Math.min(H * 0.6, Math.max(H * 0.4 - H * c.s, c.y));
    this.world.setAttribute('transform', `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) scale(${c.s.toFixed(3)})`);
  }

  /** пиксели экрана → единицы viewBox */
  private unit(): number {
    const r = this.svg.getBoundingClientRect();
    return 1 / Math.max(r.width / W, r.height / H);
  }

  private bindCamera(): void {
    let drag: { x: number; y: number; moved: number } | null = null;
    this.svg.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const u = this.unit();
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 4) {
        this.cam.x += dx * u;
        this.cam.y += dy * u;
        this.applyCam();
        this.svg.classList.add('dragging');
      }
    });
    const end = (e: PointerEvent) => {
      if (drag && drag.moved <= 4) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]');
        this.onSelect(hit ? hit.getAttribute('data-id') : null);
      }
      drag = null;
      this.svg.classList.remove('dragging');
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', () => (drag = null));
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.svg.getBoundingClientRect();
        const u = this.unit();
        // точка под курсором в координатах viewBox (slice: центрирование)
        const vx = (e.clientX - r.left - r.width / 2) * u + W / 2;
        const vy = (e.clientY - r.top - r.height / 2) * u + H / 2;
        const before = this.cam.s;
        this.cam.s = Math.min(3.2, Math.max(0.75, before * Math.exp(-e.deltaY * 0.0015)));
        const k = this.cam.s / before;
        this.cam.x = vx - (vx - this.cam.x) * k;
        this.cam.y = vy - (vy - this.cam.y) * k;
        this.applyCam();
      },
      { passive: false },
    );
  }
}
