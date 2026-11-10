/* Живая карта города: ядро в векторе, кварталы вокруг – картинками, движение, погода, камера. Только отображение – на игру не влияет. */
import { CITY_H, CITY_OX, CITY_OY, CITY_W, MAX_H, blockPlaces, loadHorizon, loadSprites, spriteBox, type BlockSprite } from './city';
import { ALL_WALKS, CITY_MAX, CITY_MIN, ROADS, WALKS, drawBuilding, drawCar, drawProp, drawTruck, ground, layoutFor, type Building, type Layout, type LocationKey, type Prop, type ShopLook } from './models';
import { Pen, svgEl } from './pen';

const W = CITY_W;
const H = CITY_H;
const ZOOM_K = (CITY_MAX - CITY_MIN) / 33;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 7 * ZOOM_K;
const SECTOR = 11;
const CULL_MARGIN = 80;

type Pt = [number, number];

interface Static {
  node: SVGElement;
  x: number;
  y: number;
  w: number;
  d: number;
  key: number;
  shown: boolean;
  box: [number, number, number, number];
}

interface Sector {
  node: SVGElement;
  box: [number, number, number, number];
  shown: boolean;
}

interface Car {
  node: SVGElement;
  axis: 'x' | 'y';
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

/** Разовый участник сцены: фура поставщика, инспектор. */
interface Actor {
  node: SVGElement;
  /** для машин: группы по направлениям */
  faces?: { x: SVGElement; y: SVGElement };
  pts: Pt[];
  seg: number;
  t: number;
  speed: number;
  /** секунд постоять на последней точке; Infinity – пока не уберут */
  hold: number;
  /** после стоянки вернуться тем же путём */
  back: boolean;
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

export interface FlowLabel {
  player: number;
  rivals: { name: string; share: number; closed: boolean }[];
}

export type Weather = 'clear' | 'rain' | 'snow';

const FAR = [-14, 47];
const EDGES: Pt[] = WALKS.flatMap((w): Pt[] => FAR.flatMap((f): Pt[] => [[f, w], [w, f]]));
const pick = (): number => WALKS[Math.floor(Math.random() * WALKS.length)];
const isH = (p: Pt) => ALL_WALKS.includes(p[1]);

/** Маршрут по тротуарам между двумя точками на линиях сетки. */
function route(a: Pt, b: Pt): Pt[] {
  const ha = isH(a);
  const hb = isH(b);
  if (ha && hb) {
    if (a[1] === b[1]) return [a, b];
    const vx = pick();
    return [a, [vx, a[1]], [vx, b[1]], b];
  }
  if (!ha && !hb) {
    if (a[0] === b[0]) return [a, b];
    const hy = pick();
    return [a, [a[0], hy], [b[0], hy], b];
  }
  return ha ? [a, [b[0], a[1]], b] : [a, [a[0], b[1]], b];
}

/** 0 – день, 1 – ночь, плавные сумерки. */
export function nightFactor(hour: number): number {
  const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (hour - a) / (b - a)));
  if (hour < 12) return 1 - ramp(3.5, 5.5);
  return ramp(18, 21);
}

export class SceneView {
  private svg: SVGSVGElement;
  private world: SVGElement;
  private gHorizon: SVGElement;
  private gGround: SVGElement;
  private gObj: SVGElement;
  private gOverlay: SVGElement;
  private gFx: SVGElement;
  private pen: Pen;
  private layout: Layout;
  private statics: Static[] = [];
  private blocks: Static[] = [];
  private sectors: Sector[] = [];
  private walkers: Walker[] = [];
  private cars: Car[] = [];
  private actors: Actor[] = [];
  private inspector: Actor | null = null;
  private queueNodes: SVGElement[] = [];
  private look: ShopLook | null = null;
  private selected: string | null = null;
  private flow: Flow = { traffic: 0, pPlayer: 0, pRivals: [], playerOpen: false, queue: 0 };
  private spawnDebt = 0;
  private ambientDebt = 0;
  private cam = { x: 0, y: 0, s: 1.5 };
  private view = { l: 0, t: 0, r: 0, b: 0 };
  private shownNight = -1;
  private winter = false;
  private dead = false;
  private weather: Weather = 'clear';
  private canvas: HTMLCanvasElement;
  private drops: { x: number; y: number; v: number; s: number }[] = [];
  private overlayData: FlowLabel | null = null;

  constructor(
    private host: HTMLElement,
    private onSelect: (id: string | null) => void,
    private location: LocationKey,
    private choosing = false,
  ) {
    this.layout = layoutFor(location, choosing);
    this.svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', class: 'scene' }, host) as SVGSVGElement;
    this.world = svgEl('g', {}, this.svg);
    this.gHorizon = svgEl('g', {}, this.world);
    this.gGround = svgEl('g', {}, this.world);
    this.gObj = svgEl('g', {}, this.world);
    this.gOverlay = svgEl('g', { class: 'flows' }, this.world);
    this.gFx = svgEl('g', {}, this.world);
    this.pen = new Pen(this.gObj, CITY_OX, CITY_OY);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'scene-weather';
    host.appendChild(this.canvas);
    this.drawGround();
    this.centerCamera();
    this.bindCamera();
    this.spawnCars();
    void this.loadCity();
    void this.loadHorizonImages();
  }

  destroy(): void {
    this.dead = true;
  }

  // ---------- камера и видимость ----------

  private centerCamera(): void {
    const r = this.svg.getBoundingClientRect();
    if (!r.width) return;
    const u = this.unit();
    const freeW = r.width * u;
    const [cx, cy] = this.pen.pt(this.layout.camera[0], this.layout.camera[1]);
    this.cam.s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, freeW / 830));
    const vy = ((r.height + 20) / 2 - r.height / 2) * u + H / 2;
    this.cam.x = W / 2 - cx * this.cam.s;
    this.cam.y = vy - cy * this.cam.s;
    this.applyCam();
  }

  /** Сменить помещение (экран выбора места). */
  setLocation(location: LocationKey): void {
    if (location === this.location) return;
    this.location = location;
    this.layout = layoutFor(location, this.choosing);
    this.look = null;
    for (const w of this.walkers) w.node.remove();
    this.walkers = [];
    this.centerCamera();
  }

  private applyCam(): void {
    const c = this.cam;
    c.s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.s));
    c.x = Math.min(W * 0.6, Math.max(W * 0.4 - W * c.s, c.x));
    c.y = Math.min(H * 0.6, Math.max(H * 0.4 - H * c.s, c.y));
    this.world.setAttribute('transform', `translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) scale(${c.s.toFixed(3)})`);
    this.updateView();
    this.cull();
  }

  private unit(): number {
    const r = this.svg.getBoundingClientRect();
    return 1 / Math.max(r.width / W, r.height / H);
  }

  private updateView(): void {
    const r = this.svg.getBoundingClientRect();
    const u = this.unit();
    const c = this.cam;
    this.view = {
      l: (W / 2 - (r.width / 2) * u - c.x) / c.s,
      r: (W / 2 + (r.width / 2) * u - c.x) / c.s,
      t: (H / 2 - (r.height / 2) * u - c.y) / c.s,
      b: (H / 2 + (r.height / 2) * u - c.y) / c.s,
    };
  }

  private boxOn(b: [number, number, number, number]): boolean {
    const v = this.view;
    return b[2] >= v.l - CULL_MARGIN && b[0] <= v.r + CULL_MARGIN && b[3] >= v.t - CULL_MARGIN && b[1] <= v.b + CULL_MARGIN;
  }

  private on(sx: number, sy: number): boolean {
    const v = this.view;
    return sx >= v.l - 60 && sx <= v.r + 60 && sy >= v.t - 40 && sy <= v.b + 60;
  }

  /** Что вне экрана, браузер не рисует совсем. */
  private cull(): void {
    for (const s of this.sectors) {
      const on = this.boxOn(s.box);
      if (on !== s.shown) {
        s.shown = on;
        s.node.style.display = on ? '' : 'none';
      }
    }
    for (const s of this.statics) {
      const on = this.boxOn(s.box);
      if (on !== s.shown) {
        s.shown = on;
        s.node.style.display = on ? '' : 'none';
      }
    }
  }

  private footprintBox(x: number, y: number, w: number, d: number, height: number): [number, number, number, number] {
    return [this.pen.pt(x, y + d)[0], this.pen.pt(x, y, height)[1], this.pen.pt(x + w, y)[0], this.pen.pt(x + w, y + d)[1]];
  }

  // ---------- город ----------

  private async loadCity(): Promise<void> {
    const sprites = await loadSprites();
    if (this.dead) return;
    const places = blockPlaces();
    this.blocks = places.map((p) => this.blockStatic(p.x, p.y, sprites[p.sprite]));
    this.look = this.look ? { ...this.look, title: this.look.title + ' ' } : null;
    this.rebuildStatics();
  }

  private blockStatic(x: number, y: number, s: BlockSprite): Static {
    const node = svgEl('g', { class: 'block' });
    const [ax, ay] = this.pen.pt(x, y);
    const at = { x: ax - spriteBox.ox, y: ay - spriteBox.oy, width: spriteBox.w, height: spriteBox.h };
    svgEl('image', { ...at, href: s.day }, node);
    svgEl('image', { ...at, href: s.night, class: 'night-img' }, node);
    return { node, x, y, w: 9, d: 9, key: x + y + 18, shown: true, box: this.footprintBox(x, y, 9, 9, spriteBox.oy) };
  }

  private async loadHorizonImages(): Promise<void> {
    const winter = this.winter;
    const h = await loadHorizon(winter);
    if (this.dead || winter !== this.winter) return;
    this.gHorizon.replaceChildren();
    const at = { x: h.x, y: h.y, width: h.w, height: h.h };
    svgEl('image', { ...at, href: h.day }, this.gHorizon);
    svgEl('image', { ...at, href: h.night, class: 'night-img' }, this.gHorizon);
  }

  private drawGround(): void {
    const p = new Pen(this.gGround, this.pen.ox, this.pen.oy);
    const f = (x: number, y: number) => p.pt(x, y).map((n) => n.toFixed(0)).join(' ');
    const quad = (x: number, y: number, w: number, d: number) => `M${f(x, y)}L${f(x + w, y)}L${f(x + w, y + d)}L${f(x, y + d)}Z`;
    const sectors = new Map<string, Map<string, string>>();
    const put = (x: number, y: number, cls: string, d: string) => {
      const k = `${Math.floor((x - CITY_MIN) / SECTOR)},${Math.floor((y - CITY_MIN) / SECTOR)}`;
      let m = sectors.get(k);
      if (!m) sectors.set(k, (m = new Map()));
      m.set(cls, (m.get(cls) ?? '') + d);
    };
    for (let y = CITY_MIN; y < CITY_MAX; y++) {
      for (let x = CITY_MIN; x < CITY_MAX; x++) put(x, y, 'tile ' + ground(x, y), quad(x, y, 1, 1));
    }
    for (const rx of ROADS) {
      for (const ry of ROADS) {
        for (const [x0, y0, along] of [[rx - 1, ry, 'y'], [rx + 2, ry, 'y'], [rx, ry - 1, 'x'], [rx, ry + 2, 'x']] as [number, number, string][]) {
          for (let i = 0; i < 6; i++) {
            const o = 0.12 + i * 0.32;
            if (along === 'y') put(x0, y0, 'zebra', quad(x0 + 0.15, y0 + o, 0.7, 0.14));
            else put(x0, y0, 'zebra', quad(x0 + o, y0 + 0.15, 0.14, 0.7));
          }
        }
      }
    }
    for (let i = CITY_MIN; i < CITY_MAX; i++) {
      if (ROADS.some((r) => i >= r - 1 && i < r + 3)) continue;
      for (const r of ROADS) {
        put(i, r, 'lane', quad(i + 0.25, r + 0.97, 0.5, 0.06));
        put(r, i, 'lane', quad(r + 0.97, i + 0.25, 0.06, 0.5));
      }
    }
    for (const [k, m] of sectors) {
      const [sx, sy] = k.split(',').map(Number);
      const node = svgEl('g', {}, this.gGround);
      for (const [cls, d] of m) svgEl('path', { class: cls, d }, node);
      const x = CITY_MIN + sx * SECTOR;
      const y = CITY_MIN + sy * SECTOR;
      this.sectors.push({ node, box: this.footprintBox(x, y, SECTOR, SECTOR, 0), shown: true });
    }
  }

  // ---------- здания ----------

  setLook(look: ShopLook, selected: string | null): void {
    if (this.look && JSON.stringify(look) === JSON.stringify(this.look) && selected === this.selected) return;
    this.look = { ...look };
    this.selected = selected;
    this.rebuildStatics();
  }

  private rebuildStatics(): void {
    const look = this.look;
    if (!look) return;
    const selected = this.selected;
    for (const s of this.statics) s.node.remove();
    this.statics = [];
    const add = (x: number, y: number, w: number, d: number, draw: (p: Pen) => void, attrs: Record<string, string> = {}) => {
      const g = this.pen.group('', attrs);
      draw(g);
      this.statics.push({ node: g.g, x, y, w, d, key: x + y + w + d, shown: true, box: this.footprintBox(x, y, w, d, MAX_H) });
    };
    for (const b of this.layout.buildings) {
      add(b.x, b.y, b.w, b.d, (p) => this.drawStaticBuilding(p, b, look, selected), b.id ? { 'data-id': b.id, class: 'pick' } : {});
    }
    for (const o of this.layout.props as Prop[]) {
      const size = o.kind === 'car' ? 0.7 : 0.3;
      add(o.x - (o.kind === 'car' ? 0 : size / 2), o.y - (o.kind === 'car' ? 0 : size / 2), size, size, (p) => drawProp(p, o));
    }
    this.statics.push(...this.blocks);
    this.statics.sort((a, b) => a.key - b.key);
    for (const s of this.statics) {
      s.shown = true;
      s.node.style.display = '';
      this.gObj.appendChild(s.node);
    }
    for (const w of this.walkers) w.anchor = undefined;
    for (const c of this.cars) c.anchor = undefined;
    for (const a of this.actors) a.anchor = undefined;
    this.placeQueue();
    this.cull();
    if (this.overlayData) this.drawOverlay();
  }

  private drawStaticBuilding(p: Pen, b: Building, look: ShopLook, selected: string | null): void {
    if (b.id && b.id === selected) p.flat(b.x - 0.08, b.y - 0.08, b.w + 0.16, b.d + 0.16, 0, 'select-ring');
    const chosen = this.choosing && b.id === 'player';
    drawBuilding(p, b, look);
    const pinZ = b.kind === 'tax' ? 130 : b.kind === 'bank' ? 92 : 60;
    if (b.id === 'player' || chosen) {
      const [px, py] = p.pt(b.x + b.w / 2, b.y + b.d / 2, look.signage ? 64 : 50);
      p.g.insertAdjacentHTML('beforeend', `<polygon class="pin" points="${px - 7},${py - 10} ${px + 7},${py - 10} ${px},${py}"/>`);
    }
    if (b.id?.startsWith('lot-')) {
      const [px, py] = p.pt(b.x + b.w / 2, b.y + b.d / 2, 50);
      p.g.insertAdjacentHTML('beforeend', `<polygon class="pin lot" points="${px - 7},${py - 10} ${px + 7},${py - 10} ${px},${py}"/>`);
    }
    const rival = b.id?.startsWith('rival') ? Number(b.id.slice(5)) : -1;
    if (rival >= 0 && look.rivalsClosed?.[rival]) {
      p.box(b.x + 0.15, b.y + b.d - 0.02, b.w - 0.3, 0.05, 9, 9, 'yellow');
      p.text('L', b.x + b.w / 2, b.y + b.d + 0.04, 11, 'ЗАКРЫТО', 'tape-text', 6);
    }
    if (b.id && look.alerts?.includes(b.id)) {
      const [px, py] = p.pt(b.x + b.w / 2, b.y + b.d / 2, pinZ);
      p.g.insertAdjacentHTML('beforeend', `<g class="alert" transform="translate(${px},${py - 14})"><circle r="11"/><text y="5" text-anchor="middle">!</text></g>`);
    }
  }

  setSeason(winter: boolean, weather: Weather): void {
    this.weather = weather;
    if (winter !== this.winter) {
      this.winter = winter;
      this.host.dataset.season = winter ? 'winter' : '';
      void this.loadHorizonImages();
    }
  }

  setFlow(flow: Flow): void {
    const queueChanged = flow.queue !== this.flow.queue;
    this.flow = flow;
    if (queueChanged) this.placeQueue();
  }

  private placeQueue(): void {
    for (const n of this.queueNodes) n.remove();
    this.queueNodes = [];
    const n = Math.min(12, Math.ceil(this.flow.queue / 3));
    const [dx, dy] = this.layout.steps.player;
    for (let i = 0; i < n; i++) {
      const node = this.personNode(i + 2, false);
      const pos: Pt = [dx + 0.25 + i * 0.26, dy + 0.17 + (i % 2) * 0.1];
      const [sx, sy] = this.pen.pt(pos[0], pos[1]);
      node.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
      this.insertSorted(node, pos);
      this.queueNodes.push(node);
    }
  }

  // ---------- транспорт ----------

  private spawnCars(): void {
    const lanes: [Car['axis'], number, 1 | -1][] = ROADS.flatMap((r): [Car['axis'], number, 1 | -1][] => [['x', r + 0.5, 1], ['x', r + 1.14, -1], ['y', r + 0.5, -1], ['y', r + 1.14, 1]]);
    lanes.forEach(([axis, lane, dir], i) => {
      for (let k = 0; k < 6; k++) {
        const node = svgEl('g', { class: 'car' });
        drawCar(new Pen(node, 0, 0), 0, 0, axis, (i * 2 + k + 1) % 4);
        this.cars.push({ node, axis, lane, dir, pos: CITY_MIN + Math.random() * (CITY_MAX - CITY_MIN), speed: 1.6 + Math.random() * 0.8, anchor: undefined });
      }
    });
  }

  private moveCars(step: number): void {
    for (const c of this.cars) {
      c.pos += c.dir * c.speed * step;
      if (c.pos > CITY_MAX) c.pos -= CITY_MAX - CITY_MIN;
      if (c.pos < CITY_MIN) c.pos += CITY_MAX - CITY_MIN;
      const p: Pt = c.axis === 'x' ? [c.pos, c.lane] : [c.lane, c.pos];
      const [sx, sy] = this.pen.pt(p[0], p[1]);
      if (!this.on(sx, sy)) {
        if (c.node.parentNode) c.node.remove();
        c.anchor = undefined;
        continue;
      }
      c.node.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
      const anchor = this.anchorFor(p);
      if (anchor !== c.anchor || !c.node.parentNode) {
        this.gObj.insertBefore(c.node, anchor);
        c.anchor = anchor;
      }
    }
  }

  /** Фургон поставщика едет со склада к кофейне и обратно. */
  sendTruck(): void {
    const [dx, dy] = this.layout.doors.player;
    const curb = (dy < 15 ? 9 : 22) + 0.5;
    const node = svgEl('g', { class: 'car' });
    const fx = svgEl('g', {}, node);
    const fy = svgEl('g', {}, node);
    drawTruck(new Pen(fx, 0, 0), 0, 0, 'x');
    drawTruck(new Pen(fy, 0, 0), 0, 0, 'y');
    this.actors.push({ node, faces: { x: fx, y: fy }, pts: [[3.5, 35.5], [9.5, 35.5], [9.5, curb], [dx, curb]], seg: 0, t: 0, speed: 3.2, hold: 2.5, back: true, anchor: undefined });
  }

  /** Инспектор: идёт к двери заранее и ждёт там, пока идёт проверка. */
  setInspector(mode: 'none' | 'coming' | 'door'): void {
    const step = this.layout.steps.player;
    const stand: Pt = [step[0] - 0.4, step[1] + 0.2];
    if (mode === 'none') {
      if (this.inspector) {
        this.inspector.node.remove();
        this.actors = this.actors.filter((a) => a !== this.inspector);
        this.inspector = null;
      }
      return;
    }
    if (!this.inspector) {
      const node = this.personNode(3, false);
      node.classList.add('inspector');
      node.insertAdjacentHTML('beforeend', `<rect class="folder" x="-5" y="-9" width="3" height="5"/><rect class="hat" x="-3" y="-17.6" width="6" height="2.4" rx="1"/>`);
      const start = this.layout.sources[0].at;
      const pts = mode === 'door' ? [stand, stand] : [...route(start, this.layout.doors.player), stand];
      this.inspector = { node, pts, seg: 0, t: 0, speed: 1.3, hold: Infinity, back: false, anchor: undefined };
      this.actors.push(this.inspector);
    } else if (mode === 'door') {
      const a = this.inspector;
      a.pts = [stand, stand];
      a.seg = 0;
      a.t = 0;
    }
  }

  private moveActors(step: number): void {
    const alive: Actor[] = [];
    for (const a of this.actors) {
      let done = false;
      let rem = step * a.speed;
      while (rem > 0 && a.seg < a.pts.length - 1) {
        const p = a.pts[a.seg];
        const q = a.pts[a.seg + 1];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 0.0001;
        const left = (1 - a.t) * len;
        if (rem < left) {
          a.t += rem / len;
          rem = 0;
        } else {
          rem -= left;
          a.seg++;
          a.t = 0;
        }
      }
      if (a.seg >= a.pts.length - 1) {
        a.hold -= step;
        if (a.hold <= 0) {
          if (a.back) {
            a.pts = [...a.pts].reverse();
            a.seg = 0;
            a.t = 0;
            a.back = false;
            a.hold = 0;
          } else done = true;
        }
      }
      if (done) {
        a.node.remove();
        continue;
      }
      const s = Math.min(a.seg, a.pts.length - 2);
      const p = a.pts[s];
      const q = a.pts[s + 1];
      const t = a.seg >= a.pts.length - 1 ? 1 : a.t;
      const pos: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      const [sx, sy] = this.pen.pt(pos[0], pos[1]);
      if (a.faces) {
        const alongX = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]);
        a.faces.x.style.display = alongX ? '' : 'none';
        a.faces.y.style.display = alongX ? 'none' : '';
      }
      if (!this.on(sx, sy)) {
        if (a.node.parentNode) a.node.remove();
        a.anchor = undefined;
      } else {
        a.node.setAttribute('transform', `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
        const anchor = this.anchorFor(pos);
        if (anchor !== a.anchor || !a.node.parentNode) {
          this.gObj.insertBefore(a.node, anchor);
          a.anchor = anchor;
        }
      }
      alive.push(a);
    }
    this.actors = alive;
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

  private insertSorted(node: SVGElement, pos: Pt): void {
    this.gObj.insertBefore(node, this.anchorFor(pos));
  }

  private spawn(from: Pt, to: Pt, enter: string | null, cup: string | null = null): void {
    if (this.walkers.length >= 220 || this.dead) return;
    const pts = route(from, to);
    if (enter) pts.push(this.layout.steps[enter]);
    if (cup) pts.unshift(this.layout.steps[cup]);
    const off = (Math.random() - 0.5) * 0.5;
    const shifted = pts.map((p, i): Pt => ((i === pts.length - 1 && enter) || (i === 0 && cup) ? p : [p[0] + off, p[1] + off]));
    const node = this.personNode(Math.floor(Math.random() * 6), cup !== null);
    this.walkers.push({ node, pts: shifted, seg: 0, t: 0, speed: 0.9 + Math.random() * 0.5, phase: Math.random() * 6, enter, anchor: undefined });
  }

  private spawnRandom(): void {
    const f = this.flow;
    const { sources, doors } = this.layout;
    let roll = Math.random();
    let from: Pt = EDGES[Math.floor(Math.random() * EDGES.length)];
    for (const s of sources) {
      if (roll < s.weight) {
        from = s.at;
        break;
      }
      roll -= s.weight;
    }
    let r = Math.random();
    const shops: [string, number][] = [['player', f.playerOpen ? f.pPlayer : 0], ...f.pRivals.map((p, i): [string, number] => [`rival${i}`, p])];
    for (const [id, p] of shops) {
      if (r < p && doors[id]) return this.spawn(from, doors[id], id);
      r -= p;
    }
    let to = EDGES[Math.floor(Math.random() * EDGES.length)];
    if (to === from) to = sources[0].at;
    this.spawn(from, to, null);
  }

  /** Просто прохожие на любых улицах в поле зрения. */
  private spawnAmbient(): void {
    const line = ALL_WALKS[Math.floor(Math.random() * ALL_WALKS.length)];
    const along = CITY_MIN + Math.random() * (CITY_MAX - CITY_MIN);
    const horizontal = Math.random() < 0.5;
    const len = (10 + Math.random() * 16) * (Math.random() < 0.5 ? 1 : -1);
    const a: Pt = horizontal ? [along, line] : [line, along];
    const [sx, sy] = this.pen.pt(a[0], a[1]);
    if (!this.on(sx, sy) || ground(Math.floor(a[0]), Math.floor(a[1])).startsWith('grass')) return;
    const clampC = (v: number) => Math.max(CITY_MIN + 1, Math.min(CITY_MAX - 1, v));
    const b: Pt = horizontal ? [clampC(along + len), line] : [line, clampC(along + len)];
    this.spawn(a, b, null);
  }

  frame(dt: number, speed: number, hour: number): void {
    const night = nightFactor(hour);
    this.applyNight(night);
    this.drawWeather(dt);
    if (speed === 0) return;
    const step = dt * speed;
    this.moveCars(step);
    this.moveActors(step);
    const dayness = hour >= 7 && hour < 22 ? 1 : 0.12;
    this.spawnDebt += step * 3.4 * dayness * Math.min(2, this.flow.traffic / 950);
    while (this.spawnDebt >= 1) {
      this.spawnDebt--;
      this.spawnRandom();
    }
    this.ambientDebt += step * 7 * dayness;
    while (this.ambientDebt >= 1) {
      this.ambientDebt--;
      this.spawnAmbient();
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
        if (w.enter) {
          const id = w.enter;
          const back = EDGES[Math.floor(Math.random() * EDGES.length)];
          setTimeout(() => this.spawn(this.layout.doors[id], back, null, id), (1500 + Math.random() * 2500) / Math.max(1, speed));
        }
        continue;
      }
      const pos: Pt = [a[0] + (b[0] - a[0]) * w.t, a[1] + (b[1] - a[1]) * w.t];
      const [sx, sy] = this.pen.pt(pos[0], pos[1]);
      alive.push(w);
      if (!this.on(sx, sy)) {
        if (w.node.parentNode) w.node.remove();
        w.anchor = undefined;
        continue;
      }
      w.phase += step * 9;
      w.node.setAttribute('transform', `translate(${sx.toFixed(1)},${(sy - Math.abs(Math.sin(w.phase)) * 1.2).toFixed(1)})`);
      const anchor = this.anchorFor(pos);
      if (anchor !== w.anchor || !w.node.parentNode) {
        this.gObj.insertBefore(w.node, anchor);
        w.anchor = anchor;
      }
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
    st.setProperty('--nightk', String(v));
    const dusk = Math.sin(Math.PI * v);
    st.setProperty('--dusk', String((dusk * 0.22).toFixed(3)));
  }

  // ---------- погода ----------

  private drawWeather(dt: number): void {
    const c = this.canvas;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (this.weather === 'clear') {
      this.drops = [];
      return;
    }
    const snow = this.weather === 'snow';
    const want = Math.round((w * h) / (snow ? 9000 : 6000));
    while (this.drops.length < want) this.drops.push({ x: Math.random() * w, y: Math.random() * h, v: 0.6 + Math.random() * 0.6, s: 1 + Math.random() * 1.6 });
    this.drops.length = want;
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.strokeStyle = 'rgba(200,225,245,.5)';
    g.lineWidth = 1;
    if (!snow) g.beginPath();
    for (const d of this.drops) {
      d.y += (snow ? 42 : 620) * d.v * dt;
      d.x += (snow ? Math.sin(d.y * 0.02) * 14 : -90 * d.v) * dt;
      if (d.y > h) {
        d.y = -8;
        d.x = Math.random() * w;
      }
      if (d.x < 0) d.x += w;
      if (snow) {
        g.beginPath();
        g.arc(d.x, d.y, d.s, 0, 7);
        g.fill();
      } else {
        g.moveTo(d.x, d.y);
        g.lineTo(d.x - 2.5, d.y + 13);
      }
    }
    if (!snow) g.stroke();
  }

  // ---------- слой потоков ----------

  /** Показывает, откуда идут люди и как они делятся между кофейнями. null – скрыть. */
  setOverlay(data: FlowLabel | null): void {
    const was = JSON.stringify(this.overlayData);
    if (was === JSON.stringify(data)) return;
    this.overlayData = data;
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const g = this.gOverlay;
    g.replaceChildren();
    const data = this.overlayData;
    if (!data) return;
    const p = new Pen(g, this.pen.ox, this.pen.oy);
    const line = (pts: Pt[], cls: string, width: number) => {
      const points = pts.map((q) => p.pt(q[0], q[1]).map((n) => n.toFixed(1)).join(',')).join(' ');
      svgEl('polyline', { class: cls, points, 'stroke-width': width.toFixed(1) }, g);
    };
    const label = (at: Pt, text: string, cls = '') => {
      const [x, y] = p.pt(at[0], at[1], 34);
      const t = svgEl('text', { class: `flow-label ${cls}`, x, y, 'text-anchor': 'middle' }, g);
      t.textContent = text;
    };
    const door = this.layout.doors.player;
    this.layout.sources.forEach((s) => {
      line(route(s.at, door), 'flow-line you', 3 + s.weight * 14);
      label(s.at, `${s.name} · ${Math.round(s.weight * 100)}% потока`);
    });
    data.rivals.forEach((r, i) => {
      if (r.closed) return;
      const d = this.layout.doors[`rival${i}`];
      line(route(this.layout.sources[0].at, d), `flow-line r${i}`, 2 + r.share * 16);
      label(d, `${r.name} · ${Math.round(r.share * 100)}%`, 'small');
    });
    label(door, `Вы · ${Math.round(data.player * 100)}%`, 'you');
  }

  floatText(text: string, tone: 'money' | 'loss'): void {
    const d = this.layout.doors.player;
    const [x, y] = this.pen.pt(d[0], d[1] - 1.5, 70);
    const t = svgEl('text', { class: `float ${tone}`, x, y, 'text-anchor': 'middle' }, this.gFx);
    t.textContent = text;
    t.addEventListener('animationend', () => t.remove());
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
        const vx = (e.clientX - r.left - r.width / 2) * u + W / 2;
        const vy = (e.clientY - r.top - r.height / 2) * u + H / 2;
        const before = this.cam.s;
        this.cam.s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before * Math.exp(-e.deltaY * 0.0015)));
        const k = this.cam.s / before;
        this.cam.x = vx - (vx - this.cam.x) * k;
        this.cam.y = vy - (vy - this.cam.y) * k;
        this.applyCam();
      },
      { passive: false },
    );
  }
}
