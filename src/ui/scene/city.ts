/* Город вокруг ядра: кварталы-спрайты и горизонт. Рисуется один раз в картинки, поэтому почти не нагружает кадр. */
import sceneCss from '../styles/scene.css?raw';
import { CITY_MAX, CITY_MIN, ROADS, drawBuilding, drawProp, ground, type Building, type ModelKind, type Prop, type ShopLook } from './models';
import { Pen, TH, TW, hash, svgEl } from './pen';

export const MAX_H = 270;
export const CITY_W = (CITY_MAX - CITY_MIN) * TW;
export const CITY_H = (CITY_MAX - CITY_MIN) * TH + MAX_H + 30;
export const CITY_OX = CITY_W / 2;
export const CITY_OY = MAX_H + 24 - CITY_MIN * TH;

/** размер квартала между дорогами, тайлов */
const CELL = 9;
const CELL_STARTS = ROADS.map((r) => r + 3).concat(CITY_MIN).sort((a, b) => a - b).filter((c) => c < CITY_MAX - 1);
/** колонки, занятые ядром, нарисованным вручную */
const CORE = new Set([-1, 12, 25]);

const SPRITE_W = 600;
const SPRITE_H = 588;
const SPRITE_OX = 300;
const SPRITE_OY = 280;
const SCALE = 1.5;
const NIGHTC = '#141c33';

type Row = [ModelKind, number, number, number, number, number?, number?];
const PLANS: Row[][] = [
  // панельные дворы
  [['panel', 0, 0, 4, 2, 9], ['panel', 5, 0, 4, 2, 7, 1], ['panel', 0, 4, 2, 4, 5], ['panel', 6, 3, 3, 2, 9], ['brick', 3, 6, 3, 3, 3]],
  [['panel', 0, 0, 2, 4, 9, 1], ['panel', 3, 1, 4, 2, 12], ['panel', 7, 2, 2, 4, 6], ['panel', 1, 6, 5, 2, 7, 1]],
  // кирпичный центр
  [['brick', 0, 0, 3, 3, 4], ['brick', 4, 0, 2, 3, 3], ['brick', 7, 0, 2, 3, 5], ['brick', 0, 5, 3, 3, 3], ['brick', 5, 5, 4, 3, 4]],
  [['brick', 1, 1, 3, 3, 5], ['shop', 5, 1, 3, 2, 0, 0], ['brick', 1, 6, 3, 2, 3], ['shop', 5, 6, 3, 2, 0, 1]],
  // деловой квартал
  [['office', 0, 0, 3, 3, 14], ['office', 5, 0, 3, 3, 10], ['office', 0, 5, 3, 3, 9], ['panel', 5, 5, 4, 2, 11, 1]],
  [['office', 3, 2, 4, 4, 15], ['brick', 0, 6, 2, 2, 4], ['brick', 7, 0, 2, 2, 3]],
  // частный сектор
  [['house', 0, 0, 2, 2, 0, 0], ['house', 4, 0, 2, 2, 0, 1], ['house', 7, 0, 2, 2, 0, 3], ['house', 0, 4, 2, 2, 0, 2], ['house', 4, 4, 2, 2, 0, 3], ['house', 7, 4, 2, 2, 0, 0], ['house', 2, 7, 2, 2, 0, 1], ['house', 6, 7, 2, 2, 0, 2]],
  [['house', 1, 1, 2, 2, 0, 3], ['house', 6, 0, 2, 2, 0, 2], ['house', 3, 4, 2, 2, 0, 0], ['house', 0, 6, 2, 2, 0, 1], ['house', 6, 5, 2, 2, 0, 3]],
  // школа и торговля
  [['school', 1, 1, 5, 3], ['shop', 1, 6, 3, 2, 0, 2], ['house', 6, 6, 2, 2, 0, 1]],
  // сквер
  [['kiosk', 4, 4, 1, 1]],
];

function planContent(i: number): { b: Building[]; p: Prop[] } {
  const b: Building[] = PLANS[i].map(([kind, x, y, w, d, floors, variant]) => ({ kind, x, y, w, d, floors: floors || undefined, variant }));
  const p: Prop[] = [];
  const free = (x: number, y: number) => !b.some((c) => x > c.x - 0.6 && x < c.x + c.w + 0.6 && y > c.y - 0.6 && y < c.y + c.d + 0.6);
  const density = i === 9 ? 0.75 : 0.32;
  for (let x = 0; x < CELL; x++) {
    for (let y = 0; y < CELL; y++) {
      const h = hash(x + i * 13, y, 3);
      const px = x + 0.25 + hash(x, y + i, 4) * 0.5;
      const py = y + 0.25 + hash(y, x + i, 5) * 0.5;
      if (h < density && free(px, py)) p.push({ kind: h < density * 0.3 ? 'conifer' : h < density * 0.8 ? 'tree' : 'bush', x: px, y: py });
    }
  }
  for (const [x, y] of [[0.2, 4.5], [8.8, 4.5], [4.5, 0.2], [4.5, 8.8]]) p.push({ kind: 'lamp', x, y });
  return { b, p };
}

const LOOK: ShopLook = { title: '', signage: false, pro: false, furniture: false, closed: false };

function spriteMarkup(i: number): string {
  const host = svgEl('g', { class: 'scene' });
  const pen = new Pen(host, SPRITE_OX, SPRITE_OY);
  const { b, p } = planContent(i);
  type Item = { key: number; draw: () => void };
  const items: Item[] = [...b.map((c): Item => ({ key: c.x + c.y + c.w + c.d, draw: () => drawBuilding(pen, c, LOOK) })), ...p.map((o): Item => ({ key: o.x + o.y + 0.6, draw: () => drawProp(pen, o) }))];
  items.sort((a, c) => a.key - c.key).forEach((it) => it.draw());
  return new XMLSerializer().serializeToString(host);
}

function canvasUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(URL.createObjectURL(b)) : rej(new Error('blob'))), 'image/png'));
}

async function rasterize(markup: string, vars: string): Promise<string> {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_W}" height="${SPRITE_H}" viewBox="0 0 ${SPRITE_W} ${SPRITE_H}" style="${vars}"><style><![CDATA[${sceneCss}]]></style>${markup}</svg>`;
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  try {
    const c = document.createElement('canvas');
    c.width = Math.round(SPRITE_W * SCALE);
    c.height = Math.round(SPRITE_H * SCALE);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const out = await canvasUrl(c);
    URL.revokeObjectURL(url);
    return out;
  } catch {
    // браузер запретил чтение холста – оставляем векторную картинку
    return url;
  }
}

export interface BlockSprite {
  day: string;
  night: string;
}

let spritesP: Promise<BlockSprite[]> | null = null;

/** Кварталы рисуются один раз за запуск, карта мастера и игры делят результат. */
export function loadSprites(): Promise<BlockSprite[]> {
  spritesP ??= (async () => {
    const out: BlockSprite[] = [];
    const base = `--nightc:${NIGHTC};`;
    for (let i = 0; i < PLANS.length; i++) {
      const m = spriteMarkup(i);
      out.push({
        day: await rasterize(m, `${base}--dim:0%;--lit:0%;--glow:0`),
        night: await rasterize(m, `${base}--dim:58%;--lit:100%;--glow:1`),
      });
    }
    return out;
  })();
  return spritesP;
}

export interface BlockPlace {
  x: number;
  y: number;
  sprite: number;
}

/** Какой спрайт стоит в каждой клетке вне ядра: ближе к центру выше, дальше – частный сектор и скверы. */
export function blockPlaces(): BlockPlace[] {
  const out: BlockPlace[] = [];
  for (const x of CELL_STARTS) {
    for (const y of CELL_STARTS) {
      if (CORE.has(x) && CORE.has(y)) continue;
      const far = Math.max(Math.abs(x - 12), Math.abs(y - 12));
      const h = hash(x, y, 9);
      const pool = far <= 26 ? [4, 5, 2, 3, 0, 1, 8] : [0, 1, 6, 7, 6, 7, 9, 2];
      out.push({ x, y, sprite: pool[Math.floor(h * pool.length)] });
    }
  }
  return out;
}

export const spriteBox = { w: SPRITE_W, h: SPRITE_H, ox: SPRITE_OX, oy: SPRITE_OY };

// ---------- горизонт ----------

const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const css = (c: number[]) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

const EDGE = 34;
const HSCALE = 0.4;

export interface Horizon {
  day: string;
  night: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function paintHorizon(night: boolean, winter: boolean): HTMLCanvasElement {
  const nc = hex(NIGHTC);
  const skyDay = hex('#bfe3f2');
  const sky = night ? mix(skyDay, hex('#0d1326'), 0.87) : skyDay;
  const lit = (c: string, t: number, k = 1) => {
    const base = mix(hex(c), [0, 0, 0], 1 - k);
    return css(mix(night ? mix(base, nc, 0.58) : base, sky, t));
  };
  const min = CITY_MIN - EDGE;
  const max = CITY_MAX + EDGE;
  const span = max - min;
  const width = span * TW;
  const height = span * TH + 340;
  const px = (x: number, y: number, z = 0): [number, number] => [(width / 2 + ((x - y) * TW) / 2) * HSCALE, (300 + ((x - min + (y - min)) * TH) / 2 - z) * HSCALE];
  const c = document.createElement('canvas');
  c.width = Math.round(width * HSCALE);
  c.height = Math.round(height * HSCALE);
  const g = c.getContext('2d')!;
  const fade = (x: number, y: number) => {
    const d = Math.max(CITY_MIN - x, x - CITY_MAX, CITY_MIN - y, y - CITY_MAX, 0) / EDGE;
    return Math.min(1, Math.pow(d, 0.8));
  };
  const COLORS: Record<string, string> = { road: '#6f7480', 'road cross': '#6f7480', pave: '#d8cfbc', grass: winter ? '#e9eef2' : '#8ccf6e', 'grass-2': winter ? '#e2e9ee' : '#80c464', water: '#5ab4e0' };
  const quad = (pts: [number, number][], fill: string, pad = 0.6) => {
    g.fillStyle = fill;
    g.strokeStyle = fill;
    g.lineWidth = pad;
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    g.closePath();
    g.fill();
    g.stroke();
  };
  for (let y = min; y < max; y++) {
    for (let x = min; x < max; x++) {
      if (x >= CITY_MIN && x < CITY_MAX && y >= CITY_MIN && y < CITY_MAX) continue;
      quad([px(x, y), px(x + 1, y), px(x + 1, y + 1), px(x, y + 1)], lit(COLORS[ground(x, y)] ?? COLORS.grass, fade(x + 0.5, y + 0.5)));
    }
  }
  const walls = ['#e4dccb', '#cdd6da', '#b9694a', '#f3e3bf', '#a9c6d8'];
  const boxes: { x: number; y: number; w: number; d: number; h: number; c: string }[] = [];
  for (let y = min; y < max; y += 4) {
    for (let x = min; x < max; x += 4) {
      const outside = x + 3 <= CITY_MIN || x >= CITY_MAX || y + 3 <= CITY_MIN || y >= CITY_MAX;
      if (!outside) continue;
      const ok = [[0, 0], [3, 0], [0, 3], [3, 3]].every(([a, b]) => ground(x + a, y + b).startsWith('grass'));
      const t = fade(x + 1.5, y + 1.5);
      if (!ok || t > 0.92 || hash(x, y, 21) < 0.15) continue;
      const h = 22 + hash(x, y, 22) * hash(x, y, 23) * 190 * (1 - t * 0.7);
      boxes.push({ x, y, w: 2 + Math.round(hash(x, y, 24)), d: 2 + Math.round(hash(x, y, 25)), h, c: walls[Math.floor(hash(x, y, 26) * walls.length)] });
    }
  }
  boxes.sort((a, b) => a.x + a.y - b.x - b.y);
  for (const b of boxes) {
    const t = fade(b.x + b.w / 2, b.y + b.d / 2);
    quad([px(b.x, b.y + b.d), px(b.x + b.w, b.y + b.d), px(b.x + b.w, b.y + b.d, b.h), px(b.x, b.y + b.d, b.h)], lit(b.c, t));
    quad([px(b.x + b.w, b.y), px(b.x + b.w, b.y + b.d), px(b.x + b.w, b.y + b.d, b.h), px(b.x + b.w, b.y, b.h)], lit(b.c, t, 0.8));
    quad([px(b.x, b.y, b.h), px(b.x + b.w, b.y, b.h), px(b.x + b.w, b.y + b.d, b.h), px(b.x, b.y + b.d, b.h)], lit(winter ? '#eef2f5' : '#9aa1ad', t));
    if (night && t < 0.75) {
      g.fillStyle = css(mix(hex('#ffd772'), sky, t));
      for (let z = 8; z < b.h - 6; z += 16) {
        for (let i = 0; i < b.w * 2; i++) {
          if (hash(b.x + i, b.y, z) > 0.45) continue;
          const [wx, wy] = px(b.x + 0.2 + i * 0.5, b.y + b.d, z);
          g.fillRect(wx, wy, 2.2, 2.6);
        }
      }
    }
  }
  return c;
}

const horizons = new Map<string, Promise<Horizon>>();

/** Два изображения дальнего города. Края растворяются в цвете неба, поэтому границы мира не видно. */
export function loadHorizon(winter: boolean): Promise<Horizon> {
  const key = winter ? 'w' : 's';
  let p = horizons.get(key);
  if (!p) {
    p = (async () => {
      const span = CITY_MAX - CITY_MIN + 2 * EDGE;
      const day = await canvasUrl(paintHorizon(false, winter));
      const night = await canvasUrl(paintHorizon(true, winter));
      const width = span * TW;
      return { day, night, x: CITY_OX - width / 2, y: CITY_OY + (CITY_MIN - EDGE) * TH - 300, w: width, h: span * TH + 340 };
    })();
    horizons.set(key, p);
  }
  return p;
}
