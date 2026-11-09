/* Iso Tycoon – отрисовка изометрической карты (SVG, без зависимостей). Перенос docs/design-system/bundle.js. */

const NS = 'http://www.w3.org/2000/svg';
export const TW = 64;
export const TH = 32;

export type Roof = 'brick' | 'teal' | 'slate';
export type Ground = 'grass' | 'road' | 'water';

export interface IsoBuilding {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  roof?: Roof;
  windows?: boolean;
  selected?: boolean;
  ghost?: 'ok' | 'bad';
  /** плавающая подпись над крышей */
  label?: string;
  /** money – подпись дохода (зелёная), name – название (цвет текста) */
  labelKind?: 'money' | 'name';
}

export interface IsoMap {
  cols: number;
  rows: number;
  maxH?: number;
  ground?: (x: number, y: number) => Ground;
  buildings?: IsoBuilding[];
  trees?: [number, number][];
  tiles?: { x: number; y: number; cls: string }[];
}

type Pt = [number, number];
interface Origin {
  x: number;
  y: number;
}

function el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}
const P = (x: number, y: number, o: Origin): Pt => [o.x + ((x - y) * TW) / 2, o.y + ((x + y) * TH) / 2];
const pts = (list: Pt[]): string => list.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const lift = (p: Pt, h: number): Pt => [p[0], p[1] - h];

function tile(g: Element, x: number, y: number, o: Origin, cls: string): SVGElement {
  return el('polygon', { class: 'iso-tile ' + cls, points: pts([P(x, y, o), P(x + 1, y, o), P(x + 1, y + 1, o), P(x, y + 1, o)]) }, g);
}

function building(g: Element, b: IsoBuilding, o: Origin): SVGElement {
  const A = P(b.x, b.y, o);
  const B = P(b.x + b.w, b.y, o);
  const C = P(b.x + b.w, b.y + b.d, o);
  const D = P(b.x, b.y + b.d, o);
  const h = b.h;
  const grp = el('g', { class: 'iso-building' + (b.ghost ? ' ghost-' + b.ghost : '') }, g);
  el('polygon', { class: 'iso-wall-l', points: pts([D, C, lift(C, h), lift(D, h)]) }, grp);
  el('polygon', { class: 'iso-wall-r', points: pts([C, B, lift(B, h), lift(C, h)]) }, grp);
  // окна: ряды по этажам на обеих стенах
  const floors = Math.max(1, Math.floor(h / 18));
  if (b.windows !== false) {
    for (let f = 0; f < floors; f++) {
      const lo = 6 + f * 18; // высота низа окна над землёй
      const hi = lo + 8;
      const sides: [Pt, Pt, number][] = [
        [D, C, b.w],
        [C, B, b.d],
      ];
      for (const [s, e, len] of sides) {
        const n = Math.max(1, len * 2);
        for (let i = 0; i < n; i++) {
          const t0 = (i + 0.25) / n;
          const t1 = (i + 0.75) / n;
          const a: Pt = [s[0] + (e[0] - s[0]) * t0, s[1] + (e[1] - s[1]) * t0];
          const c: Pt = [s[0] + (e[0] - s[0]) * t1, s[1] + (e[1] - s[1]) * t1];
          el('polygon', { class: 'iso-glass', points: pts([lift(a, lo), lift(c, lo), lift(c, hi), lift(a, hi)]) }, grp);
        }
      }
    }
  }
  el('polygon', { class: 'iso-roof roof-' + (b.roof || 'brick'), points: pts([lift(A, h), lift(B, h), lift(C, h), lift(D, h)]) }, grp);
  if (b.selected) {
    el('polygon', { class: 'iso-select', points: pts([lift(A, h), lift(B, h), lift(B, 0), lift(C, 0), lift(D, 0), lift(D, h)]) }, grp);
  }
  return grp;
}

function label(g: Element, b: IsoBuilding, o: Origin): void {
  if (!b.label) return;
  const top = lift(P(b.x + b.w / 2, b.y + b.d / 2, o), b.h + 10);
  const lg = el('g', { class: 'iso-float' + (b.labelKind === 'name' ? ' name' : '') }, g);
  const w = b.label.length * 7 + 14;
  el('rect', { x: top[0] - w / 2, y: top[1] - 18, width: w, height: 20, rx: 10 }, lg);
  const t = el('text', { x: top[0], y: top[1] - 4, 'text-anchor': 'middle' }, lg);
  t.textContent = b.label;
}

function tree(g: Element, x: number, y: number, o: Origin): void {
  const c = P(x + 0.5, y + 0.5, o);
  const grp = el('g', { class: 'iso-treeg' }, g);
  el('rect', { class: 'iso-trunk', x: c[0] - 2, y: c[1] - 10, width: 4, height: 10 }, grp);
  el('ellipse', { class: 'iso-tree', cx: c[0], cy: c[1] - 20, rx: 11, ry: 14 }, grp);
}

/** Рисует карту в переданный <svg>: тайлы, затем объекты по painter's algorithm, подписи – поверх всего. */
export function render(svg: SVGSVGElement, map: IsoMap): SVGSVGElement {
  const { cols, rows } = map;
  const maxH = map.maxH ?? 90;
  const o: Origin = { x: (rows * TW) / 2, y: maxH + 24 };
  const W = ((cols + rows) * TW) / 2;
  const H = ((cols + rows) * TH) / 2 + maxH + 24;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const gTiles = el('g', {}, svg);
  const gObj = el('g', {}, svg);
  const gLabels = el('g', {}, svg);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = map.ground ? map.ground(x, y) : 'grass';
      tile(gTiles, x, y, o, k === 'grass' ? ((x + y) % 2 ? 'grass-2' : 'grass') : k);
    }
  }
  for (const t of map.tiles ?? []) tile(gTiles, t.x, t.y, o, t.cls);
  const objs: { k: number; f: () => void }[] = [];
  for (const b of map.buildings ?? []) {
    objs.push({ k: b.x + b.y + b.w + b.d, f: () => building(gObj, b, o) });
    label(gLabels, b, o);
  }
  for (const t of map.trees ?? []) objs.push({ k: t[0] + t[1] + 1.5, f: () => tree(gObj, t[0], t[1], o) });
  objs.sort((a, b) => a.k - b.k).forEach((q) => q.f());
  return svg;
}

/** Миниатюра одного здания для карточки в меню. */
export function thumb(svg: SVGSVGElement, b: Omit<IsoBuilding, 'x' | 'y'>): SVGSVGElement {
  return render(svg, { cols: b.w, rows: b.d, maxH: b.h + 6, buildings: [{ ...b, x: 0, y: 0 }], ground: () => 'grass' });
}
