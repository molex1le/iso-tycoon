/* Изометрическое «перо»: рисует примитивы в мировых координатах (тайлы x, y и высота z в пикселях). */

const NS = 'http://www.w3.org/2000/svg';
export const TW = 64;
export const TH = 32;
/** высота этажа, px */
export const FL = 18;

export type V3 = [number, number, number];

export function svgEl(tag: string, attrs: Record<string, string | number> = {}, parent?: Element): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

export class Pen {
  constructor(
    readonly g: SVGElement,
    readonly ox: number,
    readonly oy: number,
  ) {}

  /** мировые координаты → экран */
  pt(x: number, y: number, z = 0): [number, number] {
    return [this.ox + ((x - y) * TW) / 2, this.oy + ((x + y) * TH) / 2 - z];
  }

  group(cls = '', attrs: Record<string, string | number> = {}): Pen {
    return new Pen(svgEl('g', cls ? { class: cls, ...attrs } : attrs, this.g), this.ox, this.oy);
  }

  poly(points: V3[], cls: string): SVGElement {
    const s = points.map((p) => this.pt(p[0], p[1], p[2]).map((n) => n.toFixed(1)).join(',')).join(' ');
    return svgEl('polygon', { class: cls, points: s }, this.g);
  }

  /** прямоугольник на левой стене (плоскость y = const, смотрит на зрителя слева) */
  wallL(x0: number, x1: number, y: number, z0: number, z1: number, cls: string): SVGElement {
    return this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], cls);
  }

  /** прямоугольник на правой стене (плоскость x = const) */
  wallR(y0: number, y1: number, x: number, z0: number, z1: number, cls: string): SVGElement {
    return this.poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], cls);
  }

  /** горизонтальная площадка */
  flat(x: number, y: number, w: number, d: number, z: number, cls: string): SVGElement {
    return this.poly([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]], cls);
  }

  /** коробка: левая стена, правая стена и крышка одним материалом */
  box(x: number, y: number, w: number, d: number, z: number, h: number, mat: string): void {
    this.wallL(x, x + w, y + d, z, z + h, `f-l m-${mat}`);
    this.wallR(y, y + d, x + w, z, z + h, `f-r m-${mat}`);
    this.flat(x, y, w, d, z + h, `f-t m-${mat}`);
  }

  /** текст, лежащий на левой ('L') или правой ('R') стене; (x, y, z) – центр строки */
  text(side: 'L' | 'R', x: number, y: number, z: number, str: string, cls: string, size: number): SVGElement {
    const [px, py] = this.pt(x, y, z);
    const t = svgEl(
      'text',
      {
        class: cls,
        'font-size': size,
        'text-anchor': 'middle',
        transform: `matrix(1,${side === 'L' ? 0.5 : -0.5},0,1,${px.toFixed(1)},${py.toFixed(1)})`,
      },
      this.g,
    );
    t.textContent = str;
    return t;
  }

  disc(x: number, y: number, z: number, rx: number, ry: number, cls: string): SVGElement {
    const [px, py] = this.pt(x, y, z);
    return svgEl('ellipse', { class: cls, cx: px.toFixed(1), cy: py.toFixed(1), rx, ry }, this.g);
  }

  line(a: V3, b: V3, cls: string): SVGElement {
    const [x1, y1] = this.pt(a[0], a[1], a[2]);
    const [x2, y2] = this.pt(b[0], b[1], b[2]);
    return svgEl('line', { class: cls, x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1) }, this.g);
  }
}

/** Детерминированный «случайный» признак по координатам – например, какие окна горят ночью. */
export function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(Math.round(a * 31) + 7, 73856093) ^ Math.imul(Math.round(b * 31) + 3, 19349663) ^ Math.imul(c + 11, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return (h % 1000) / 1000;
}
