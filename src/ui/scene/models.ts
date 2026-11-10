/* Библиотека изометрических моделей: здания и уличная мелочь. Всё – 2D-полигоны в плоском стиле. */
import { FL, hash, type Pen } from './pen';

export type ModelKind = 'panel' | 'brick' | 'house' | 'office' | 'metro' | 'cafePlayer' | 'cafeChain' | 'cafeCraft' | 'kiosk' | 'shop' | 'busStop' | 'mall' | 'school' | 'gas' | 'bank' | 'tax' | 'depot' | 'vacant';

export interface Building {
  id?: string;
  kind: ModelKind;
  x: number;
  y: number;
  w: number;
  d: number;
  floors?: number;
  variant?: number;
  title?: string;
}

/** Как выглядит кофейня игрока сейчас. */
export interface ShopLook {
  title: string;
  signage: boolean;
  pro: boolean;
  furniture: boolean;
  closed: boolean;
  /** какие конкуренты сейчас закрыты */
  rivalsClosed?: boolean[];
  /** здания, требующие внимания: метка «!» */
  alerts?: string[];
}

export type Prop =
  | { kind: 'tree' | 'conifer' | 'bush' | 'lamp'; x: number; y: number }
  | { kind: 'bench'; x: number; y: number }
  | { kind: 'car'; x: number; y: number; axis: 'x' | 'y'; color: number }
  | { kind: 'flowers'; x: number; y: number }
  | { kind: 'fountain'; x: number; y: number };

// ---------- детали ----------

function winL(p: Pen, x0: number, x1: number, y: number, z: number, n: number, h = 9, fill = 0.5): void {
  const slot = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + slot * (i + 0.5 - fill / 2);
    p.wallL(a, a + slot * fill, y, z, z + h, 'win' + (hash(a, y, z) < 0.5 ? ' off' : ''));
  }
}
function winR(p: Pen, y0: number, y1: number, x: number, z: number, n: number, h = 9, fill = 0.5): void {
  const slot = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = y0 + slot * (i + 0.5 - fill / 2);
    p.wallR(a, a + slot * fill, x, z, z + h, 'win' + (hash(x, a, z) < 0.5 ? ' off' : ''));
  }
}
function floorsWindows(p: Pen, b: Building, floors: number, z0 = 0, perTile = 2): void {
  for (let f = 0; f < floors; f++) {
    winL(p, b.x, b.x + b.w, b.y + b.d, z0 + f * FL + 6, b.w * perTile);
    winR(p, b.y, b.y + b.d, b.x + b.w, z0 + f * FL + 6, b.d * perTile);
  }
}
function gable(p: Pen, x: number, y: number, w: number, d: number, z: number, rh: number, roof: string, wall: string, axis: 'x' | 'y'): void {
  if (axis === 'x') {
    p.poly([[x, y, z], [x + w, y, z], [x + w, y + d / 2, z + rh], [x, y + d / 2, z + rh]], `f-r m-${roof}`);
    p.poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d / 2, z + rh]], `f-r m-${wall}`);
    p.poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d / 2, z + rh], [x, y + d / 2, z + rh]], `f-l m-${roof}`);
  } else {
    p.poly([[x, y, z], [x, y + d, z], [x + w / 2, y + d, z + rh], [x + w / 2, y, z + rh]], `f-t m-${roof}`);
    p.poly([[x, y + d, z], [x + w, y + d, z], [x + w / 2, y + d, z + rh]], `f-l m-${wall}`);
    p.poly([[x + w, y, z], [x + w, y + d, z], [x + w / 2, y + d, z + rh], [x + w / 2, y, z + rh]], `f-r m-${roof}`);
  }
}
/** полосатый навес над левой стеной */
function awningL(p: Pen, x0: number, x1: number, y: number, z: number, a: string, b: string, n = 6): void {
  const s = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + s * i;
    p.poly([[xa, y, z], [xa + s, y, z], [xa + s, y + 0.3, z - 6], [xa, y + 0.3, z - 6]], `f-t m-${i % 2 ? b : a}`);
  }
  p.wallL(x0, x1, y + 0.3, z - 9, z - 6, `f-l m-${a}`);
}
function awningR(p: Pen, y0: number, y1: number, x: number, z: number, a: string, b: string, n = 4): void {
  const s = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const ya = y0 + s * i;
    p.poly([[x, ya, z], [x, ya + s, z], [x + 0.3, ya + s, z - 6], [x + 0.3, ya, z - 6]], `f-t m-${i % 2 ? b : a}`);
  }
  p.wallR(y0, y1, x + 0.3, z - 9, z - 6, `f-r m-${a}`);
}
function doorL(p: Pen, x: number, y: number, w = 0.3, h = 14, cls = 'door'): void {
  p.wallL(x, x + w, y, 0, h, cls);
}
function acUnit(p: Pen, x: number, y: number, z: number): void {
  p.box(x, y, 0.35, 0.3, z, 5, 'concrete');
}

// ---------- здания ----------

function panel(p: Pen, b: Building): void {
  const floors = b.floors ?? 6;
  const H = floors * FL + 4;
  const mat = b.variant ? 'panel2' : 'panel';
  p.box(b.x, b.y, b.w, b.d, 0, H, mat);
  p.wallL(b.x, b.x + b.w, b.y + b.d, 0, 4, 'f-l m-concrete');
  p.wallR(b.y, b.y + b.d, b.x + b.w, 0, 4, 'f-r m-concrete');
  floorsWindows(p, b, floors, 2);
  // балконы через окно
  for (let f = 1; f < floors; f++) {
    for (let i = 0; i < b.w * 2; i += 2) p.wallL(b.x + i / 2 + 0.08, b.x + i / 2 + 0.42, b.y + b.d, f * FL + 3, f * FL + 8, 'balcony');
  }
  doorL(p, b.x + 0.35, b.y + b.d);
  p.box(b.x + 0.25, b.y + b.d, 0.5, 0.15, 15, 2, 'roofgrey');
  p.box(b.x + 0.06, b.y + 0.06, b.w - 0.12, b.d - 0.12, H, 3, 'roofgrey');
  p.box(b.x + b.w * 0.4, b.y + b.d * 0.3, 0.5, 0.5, H + 3, 9, mat);
  p.line([b.x + 0.4, b.y + 0.4, H + 3], [b.x + 0.4, b.y + 0.4, H + 22], 'pole');
}

function brick(p: Pen, b: Building): void {
  const floors = b.floors ?? 3;
  const H = floors * FL + 2;
  p.box(b.x, b.y, b.w, b.d, 0, H, 'brick');
  floorsWindows(p, b, floors, 0);
  doorL(p, b.x + b.w / 2 - 0.15, b.y + b.d);
  const axis = b.w >= b.d ? 'x' : 'y';
  gable(p, b.x - 0.06, b.y - 0.06, b.w + 0.12, b.d + 0.12, H, 16 + Math.min(b.w, b.d) * 4, 'tile', 'brick', axis);
  p.box(b.x + b.w * 0.7, b.y + b.d * 0.35, 0.22, 0.22, H + 8, 16, 'brick');
}

function house(p: Pen, b: Building): void {
  const floors = b.floors ?? 1;
  const H = floors * FL + 4;
  const wall = ['plaster', 'plaster2', 'plaster3', 'white'][(b.variant ?? 0) % 4];
  const roof = ['tile', 'slateroof', 'greenroof', 'tile'][(b.variant ?? 0) % 4];
  p.box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.d - 0.2, 0, H, wall);
  const inner: Building = { ...b, x: b.x + 0.1, y: b.y + 0.1, w: b.w - 0.2, d: b.d - 0.2 };
  floorsWindows(p, inner, floors, 2, 1.5);
  doorL(p, b.x + b.w / 2 - 0.12, b.y + b.d - 0.1, 0.24, 13);
  gable(p, b.x, b.y, b.w, b.d, H, 18, roof, wall, (b.variant ?? 0) % 2 ? 'y' : 'x');
  p.box(b.x + b.w * 0.25, b.y + b.d * 0.3, 0.18, 0.18, H + 8, 14, 'brick');
}

function office(p: Pen, b: Building): void {
  const floors = b.floors ?? 9;
  p.box(b.x, b.y, b.w, b.d, 0, FL + 4, 'concrete');
  winL(p, b.x, b.x + b.w, b.y + b.d, 4, b.w, 14, 0.8);
  winR(p, b.y, b.y + b.d, b.x + b.w, 4, b.d, 14, 0.8);
  doorL(p, b.x + b.w / 2 - 0.2, b.y + b.d, 0.4, 16, 'door glassdoor');
  const z0 = FL + 4;
  const H = floors * FL;
  const i = 0.2;
  p.box(b.x + i, b.y + i, b.w - 2 * i, b.d - 2 * i, z0, H, 'glassbody');
  for (let f = 0; f < floors; f++) {
    winL(p, b.x + i, b.x + b.w - i, b.y + b.d - i, z0 + f * FL + 3, b.w * 3, 12, 0.82);
    winR(p, b.y + i, b.y + b.d - i, b.x + b.w - i, z0 + f * FL + 3, b.d * 3, 12, 0.82);
  }
  p.box(b.x + i + 0.1, b.y + i + 0.1, b.w - 2 * i - 0.2, b.d - 2 * i - 0.2, z0 + H, 4, 'roofgrey');
  acUnit(p, b.x + 0.6, b.y + 0.6, z0 + H + 4);
  acUnit(p, b.x + 1.3, b.y + 0.9, z0 + H + 4);
  p.line([b.x + b.w - 0.6, b.y + 0.6, z0 + H + 4], [b.x + b.w - 0.6, b.y + 0.6, z0 + H + 34], 'pole');
}

function metro(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  // стеклянный павильон под нависающей крышей
  p.box(x + 0.2, y + 0.2, w - 0.4, d - 0.4, 0, 22, 'metroglass');
  for (let i = 0; i <= 4; i++) {
    const t = x + 0.2 + ((w - 0.4) * i) / 4;
    p.line([t, y + d - 0.2, 0], [t, y + d - 0.2, 22], 'mullion');
    const u = y + 0.2 + ((d - 0.4) * i) / 4;
    p.line([x + w - 0.2, u, 0], [x + w - 0.2, u, 22], 'mullion');
  }
  // вход: тёмный проём со ступенями вниз
  p.wallL(x + 0.55, x + w - 0.55, y + d - 0.2, 0, 17, 'dark');
  for (let s = 1; s <= 3; s++) p.line([x + 0.55, y + d - 0.2, s * 4], [x + w - 0.55, y + d - 0.2, s * 4], 'step');
  p.box(x, y, w, d, 22, 5, 'metroroof');
  // вывеска на козырьке
  p.box(x + 0.35, y + d - 0.1, w - 0.7, 0.1, 27, 13, 'red');
  p.text('L', x + w / 2, y + d + 0.001, 30, 'МЕТРО', 'sign-text', 10);
  // пилон с буквой «М»
  p.box(x + w - 0.16, y + d - 0.16, 0.12, 0.12, 27, 30, 'concrete');
  const [cx, cy] = p.pt(x + w - 0.1, y + d - 0.1, 70);
  p.disc(x + w - 0.1, y + d - 0.1, 70, 12, 12, 'metro-badge');
  const t = p.text('L', 0, 0, 0, 'М', 'metro-m', 15);
  t.setAttribute('transform', `translate(${cx.toFixed(1)},${(cy + 5.5).toFixed(1)})`);
}

function cafePlayer(p: Pen, b: Building, look: ShopLook): void {
  const { x, y, w, d } = b;
  const H = 28;
  p.box(x, y, w, d, 0, H, 'cream');
  p.wallL(x, x + w, y + d, 0, 5, 'f-l m-wood');
  p.wallR(y, y + d, x + w, 0, 5, 'f-r m-wood');
  // витрины и стеклянная дверь
  p.wallL(x + 0.15, x + 1.2, y + d, 6, 19, 'win vitrine');
  p.wallL(x + 1.75, x + w - 0.15, y + d, 6, 19, 'win vitrine');
  doorL(p, x + 1.3, y + d, 0.36, 18, 'door glassdoor');
  p.wallR(y + 0.2, y + d - 0.2, x + w, 6, 19, 'win vitrine');
  awningL(p, x + 0.05, x + w - 0.05, y + d, 25, 'red', 'white', 9);
  awningR(p, y + 0.1, y + d - 0.1, x + w, 25, 'red', 'white', 6);
  // плоская крыша с парапетом
  p.box(x + 0.08, y + 0.08, w - 0.16, d - 0.16, H, 3, 'roofgrey');
  acUnit(p, x + 0.4, y + 0.4, H + 3);
  if (look.pro) {
    p.box(x + w - 0.8, y + 0.5, 0.25, 0.25, H + 3, 14, 'concrete');
    const [sx, sy] = p.pt(x + w - 0.68, y + 0.62, H + 20);
    for (let i = 0; i < 3; i++) {
      const c = p.disc(0, 0, 0, 5, 5, 'steam');
      c.setAttribute('cx', sx.toFixed(1));
      c.setAttribute('cy', sy.toFixed(1));
      (c as SVGElement).style.animationDelay = `${i * 0.9}s`;
    }
  }
  if (look.signage) {
    p.box(x + 0.5, y + d - 0.16, w - 1, 0.12, H + 3, 15, 'coffee');
    p.text('L', x + w / 2, y + d - 0.04 + 0.001, H + 6.5, look.title.toUpperCase(), 'sign-text', 11);
  }
  if (look.furniture) {
    for (const tx of [x + 0.3, x + 2.2]) {
      p.box(tx, y + d + 0.42, 0.16, 0.16, 0, 6, 'wood');
      p.disc(tx + 0.08, y + d + 0.5, 7, 7, 3.5, 'tabletop');
    }
  }
  if (look.closed) {
    p.wallL(x + 1.1, x + 1.9, y + d + 0.01, 7, 14, 'tape');
    p.text('L', x + 1.5, y + d + 0.011, 8.5, 'ЗАКРЫТО', 'tape-text', 5.5);
  }
}

function cafeChain(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 32;
  const brand = b.variant ? 'green' : 'chainred';
  p.box(x, y, w, d, 0, H, 'white');
  p.wallL(x, x + w, y + d, 22, H, `f-l m-${brand}`);
  p.wallR(y, y + d, x + w, 22, H, `f-r m-${brand}`);
  winL(p, x, x + w, y + d, 4, w, 15, 0.8);
  winR(p, y, y + d, x + w, 4, d, 15, 0.8);
  doorL(p, x + w / 2 - 0.2, y + d, 0.4, 18, 'door glassdoor');
  p.text('L', x + w / 2, y + d + 0.001, 24, b.title ?? 'КОФЕМАРКЕТ', 'sign-text', 8.5);
  p.box(x + 0.1, y + 0.1, w - 0.2, d - 0.2, H, 3, 'roofgrey');
  // куб-рекламу видно издалека
  p.box(x + w - 1.3, y + 0.5, 1, 1, H + 3, 20, brand);
  const initials = (b.title ?? 'КОФЕ МАРКЕТ').replace('КОФЕМАРКЕТ', 'КОФЕ МАРКЕТ').split(/\s+/).map((s) => s[0]).join('').slice(0, 2);
  p.text('L', x + w - 0.8, y + 1.5 + 0.001, H + 8, initials, 'sign-text', 12);
  acUnit(p, x + 0.5, y + 1.6, H + 3);
}

function cafeCraft(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 24;
  p.box(x + 0.1, y + 0.1, w - 0.2, d - 0.2, 0, H, 'wooddark');
  // фасад смотрит на правую стену
  p.wallR(y + 0.3, y + d - 0.75, x + w - 0.1, 5, 17, 'win vitrine');
  p.wallR(y + d - 0.6, y + d - 0.3, x + w - 0.1, 0, 16, 'door glassdoor');
  winL(p, x + 0.1, x + w - 0.1, y + d - 0.1, 6, 2, 10, 0.5);
  awningR(p, y + 0.2, y + d - 0.2, x + w - 0.1, 22, 'green', 'green', 4);
  gable(p, x, y, w, d, H, 18, 'slateroof', 'wooddark', 'y');
  p.text('R', x + w - 0.1 + 0.001, y + d / 2, H - 1.5, '', 'sign-text', 7);
  // круглая вывеска на кронштейне
  p.line([x + w - 0.1, y + d - 0.2, 22], [x + w + 0.3, y + d - 0.2, 22], 'pole');
  p.disc(x + w + 0.3, y + d - 0.2, 15, 7, 7, 'craft-badge');
  const [cx, cy] = p.pt(x + w + 0.3, y + d - 0.2, 15);
  const t = p.text('L', 0, 0, 0, 'З', 'craft-letter', 9);
  t.setAttribute('transform', `translate(${cx.toFixed(1)},${(cy + 3.2).toFixed(1)})`);
}

function kiosk(p: Pen, b: Building): void {
  const { x, y } = b;
  p.box(x + 0.2, y + 0.2, 0.6, 0.6, 0, 16, 'yellow');
  p.wallL(x + 0.28, x + 0.72, y + 0.8, 7, 13, 'win');
  p.box(x + 0.1, y + 0.1, 0.8, 0.8, 16, 3, 'red');
}

function shop(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 24;
  const v = (b.variant ?? 0) % 3;
  const band = ['green', 'blue', 'orange'][v];
  const label = b.title ?? ['ПРОДУКТЫ', 'АПТЕКА', 'ЦВЕТЫ'][v];
  p.box(x, y, w, d, 0, H, 'white');
  p.wallL(x, x + w, y + d, 16, H, `f-l m-${band}`);
  p.wallR(y, y + d, x + w, 16, H, `f-r m-${band}`);
  winL(p, x, x + w, y + d, 4, w, 10, 0.75);
  winR(p, y, y + d, x + w, 4, d, 10, 0.7);
  doorL(p, x + w / 2 - 0.16, y + d, 0.32, 14, 'door glassdoor');
  p.text('L', x + w / 2, y + d + 0.001, 17.5, label, 'sign-text', 7.5);
  p.box(x + 0.08, y + 0.08, w - 0.16, d - 0.16, H, 3, 'roofgrey');
  acUnit(p, x + 0.4, y + 0.5, H + 3);
}

function busStop(p: Pen, b: Building): void {
  const { x, y } = b;
  p.box(x + 0.15, y + 0.5, 0.7, 0.14, 0, 5, 'wood');
  for (const px of [x + 0.05, x + 1.15]) p.line([px, y + 0.75, 0], [px, y + 0.75, 18], 'pole');
  p.wallL(x + 0.05, x + 1.15, y + 0.75, 3, 17, 'glass-thin');
  p.box(x, y + 0.3, 1.2, 0.5, 18, 2, 'metroroof');
  p.line([x + 1.5, y + 0.6, 0], [x + 1.5, y + 0.6, 24], 'pole');
  p.disc(x + 1.5, y + 0.6, 26, 5, 5, 'stop-badge');
}

function mall(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 48;
  p.box(x, y, w, d, 0, H, 'white');
  winL(p, x, x + w, y + d, 30, w * 2, 12, 0.8);
  winR(p, y, y + d, x + w, 30, d * 2, 12, 0.8);
  // стеклянный атриум на всю высоту
  p.wallL(x + w / 2 - 1.2, x + w / 2 + 1.2, y + d, 0, 28, 'win vitrine');
  for (let i = 0; i <= 6; i++) {
    const t = x + w / 2 - 1.2 + (2.4 * i) / 6;
    p.line([t, y + d, 0], [t, y + d, 28], 'mullion');
  }
  doorL(p, x + w / 2 - 0.4, y + d, 0.8, 16, 'door glassdoor');
  p.wallL(x + 0.3, x + 1.6, y + d, 4, 22, 'f-l m-orange');
  p.wallL(x + w - 1.6, x + w - 0.3, y + d, 4, 22, 'f-l m-blue');
  p.box(x + 0.08, y + 0.08, w - 0.16, d - 0.16, H, 3, 'roofgrey');
  p.box(x + w / 2 - 1.5, y + d - 0.14, 3, 0.12, H + 3, 14, 'coffee');
  p.text('L', x + w / 2, y + d - 0.02 + 0.001, H + 6.5, b.title ?? 'ТЦ ГАЛЕРЕЯ', 'sign-text', 10);
  acUnit(p, x + 1, y + 1, H + 3);
  acUnit(p, x + 3, y + 1.6, H + 3);
  acUnit(p, x + 4.4, y + 0.8, H + 3);
}

function school(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 3 * FL + 2;
  p.box(x, y, w, d, 0, H, 'plaster2');
  floorsWindows(p, b, 3, 0, 2);
  p.box(x + w / 2 - 0.5, y + d, 1, 0.5, 0, 22, 'plaster');
  doorL(p, x + w / 2 - 0.2, y + d + 0.5, 0.4, 16);
  p.box(x + w / 2 - 0.6, y + d - 0.05, 1.2, 0.65, 22, 3, 'slateroof');
  gable(p, x - 0.06, y - 0.06, w + 0.12, d + 0.12, H, 20, 'greenroof', 'plaster2', 'x');
  p.text('L', x + w / 2, y + d + 0.001, H - 9, 'ШКОЛА', 'sign-dark', 8);
  p.line([x + 0.4, y + d + 0.6, 0], [x + 0.4, y + d + 0.6, 40], 'pole');
  p.wallL(x + 0.4, x + 0.85, y + d + 0.6, 30, 40, 'f-l m-red');
}

function gas(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  p.box(x + 0.1, y + 0.1, 1.3, d - 0.2, 0, 18, 'white');
  winR(p, y + 0.3, y + d - 0.3, x + 1.4, 3, 2, 10, 0.8);
  // колонки и навес
  for (const py of [y + 0.7, y + d - 0.9]) {
    p.box(x + 2.1, py, 0.22, 0.34, 0, 10, 'red');
    p.line([x + 2.2, py + 0.17, 10], [x + 2.2, py + 0.17, 24], 'pole');
  }
  p.box(x + 1.6, y + 0.3, w - 1.7, d - 0.6, 24, 4, 'green');
  p.line([x + w - 0.1, y + d - 0.1, 0], [x + w - 0.1, y + d - 0.1, 50], 'pole');
  p.box(x + w - 0.4, y + d - 0.15, 0.6, 0.1, 40, 18, 'green');
  p.text('L', x + w - 0.1, y + d - 0.05 + 0.001, 45, 'АЗС', 'sign-text', 8);
}

function bank(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 46;
  p.flat(x - 0.25, y + d, w + 0.5, 0.5, 2, 'f-t m-concrete');
  p.box(x, y, w, d, 0, H, 'concrete');
  winR(p, y + 0.2, y + d - 0.2, x + w, 16, d * 2, 15, 0.7);
  doorL(p, x + w / 2 - 0.3, y + d, 0.6, 22, 'door glassdoor');
  // портик: колонны и фронтон с названием
  for (let i = 0; i <= 5; i++) {
    const t = x + 0.2 + ((w - 0.55) * i) / 5;
    p.box(t, y + d + 0.1, 0.18, 0.18, 2, 32, 'white');
  }
  p.box(x - 0.1, y + d - 0.05, w + 0.2, 0.42, 34, 8, 'plaster');
  p.text('L', x + w / 2, y + d + 0.37 + 0.001, 36, b.title ?? 'БАНК', 'sign-dark', 10);
  p.box(x + 0.1, y + 0.1, w - 0.2, d - 0.2, H, 3, 'roofgrey');
  p.disc(x + w / 2, y + d / 2, H + 18, 9, 9, 'bank-coin');
  p.line([x + w / 2, y + d / 2, H + 3], [x + w / 2, y + d / 2, H + 12], 'pole');
}

function taxOffice(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 4 * FL + 2;
  p.box(x, y, w, d, 0, H, 'panel2');
  floorsWindows(p, b, 4, 0, 2);
  p.box(x + w / 2 - 0.9, y + d, 1.8, 0.5, 0, 24, 'concrete');
  doorL(p, x + w / 2 - 0.3, y + d + 0.5, 0.6, 18);
  p.box(x + w / 2 - 1, y + d - 0.05, 2, 0.65, 24, 3, 'slateroof');
  p.box(x + 0.5, y + d - 0.02, w - 1, 0.04, H - 12, 11, 'metroroof');
  p.text('L', x + w / 2, y + d + 0.02 + 0.001, H - 9, b.title ?? 'НАЛОГОВАЯ', 'sign-text', 8);
  p.box(x + 0.08, y + 0.08, w - 0.16, d - 0.16, H, 3, 'roofgrey');
  // флаг на крыше
  p.line([x + w / 2, y + d / 2, H + 3], [x + w / 2, y + d / 2, H + 34], 'pole');
  p.wallL(x + w / 2, x + w / 2 + 0.7, y + d / 2, H + 23, H + 29, 'f-l m-white');
  p.wallL(x + w / 2, x + w / 2 + 0.7, y + d / 2, H + 17, H + 23, 'f-l m-red');
}

function depot(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  const H = 28;
  p.box(x, y, w, d, 0, H, 'panel2');
  // ворота с полосами
  for (const t of [x + 0.5, x + w / 2 - 0.6, x + w - 1.7]) {
    p.wallL(t, t + 1.2, y + d, 0, 18, 'f-l m-roofgrey');
    for (let z = 3; z < 18; z += 3) p.line([t, y + d, z], [t + 1.2, y + d, z], 'mullion');
  }
  p.box(x + 0.4, y + d - 0.02, w - 0.8, 0.04, 20, 7, 'orange');
  p.text('L', x + w / 2, y + d + 0.02 + 0.001, 21.5, b.title ?? 'ОПТОВЫЙ СКЛАД', 'sign-text', 6.5);
  gable(p, x - 0.06, y - 0.06, w + 0.12, d + 0.12, H, 12, 'roofgrey', 'panel2', 'x');
  p.box(x + 0.6, y + d + 0.5, 0.8, 0.8, 0, 6, 'wood');
  p.box(x + 1.7, y + d + 0.4, 0.8, 0.8, 0, 6, 'wood');
  p.box(x + 1, y + d + 0.6, 0.6, 0.6, 6, 6, 'wood');
}

/** Свободное помещение: показывается только при выборе места. */
function vacant(p: Pen, b: Building): void {
  const { x, y, w, d } = b;
  p.box(x, y, w, d, 0, 26, 'cream');
  winL(p, x, x + w, y + d, 4, w * 2, 14, 0);
  p.box(x + 0.08, y + 0.08, w - 0.16, d - 0.16, 26, 2, 'roofgrey');
  p.box(x + 0.3, y + d - 0.02, w - 0.6, 0.04, 19, 6, 'yellow');
  p.text('L', x + w / 2, y + d + 0.02 + 0.001, 20, b.title ?? 'АРЕНДА', 'sign-dark', 5.5);
}

export function drawBuilding(pen: Pen, b: Building, look: ShopLook): void {
  switch (b.kind) {
    case 'bank': return bank(pen, b);
    case 'tax': return taxOffice(pen, b);
    case 'depot': return depot(pen, b);
    case 'vacant': return vacant(pen, b);
    case 'panel': return panel(pen, b);
    case 'brick': return brick(pen, b);
    case 'house': return house(pen, b);
    case 'office': return office(pen, b);
    case 'metro': return metro(pen, b);
    case 'cafePlayer': return cafePlayer(pen, b, look);
    case 'cafeChain': return cafeChain(pen, b);
    case 'cafeCraft': return cafeCraft(pen, b);
    case 'kiosk': return kiosk(pen, b);
    case 'shop': return shop(pen, b);
    case 'busStop': return busStop(pen, b);
    case 'mall': return mall(pen, b);
    case 'school': return school(pen, b);
    case 'gas': return gas(pen, b);
  }
}

// ---------- уличная мелочь ----------

export function drawCar(p: Pen, x: number, y: number, axis: 'x' | 'y', color: number): void {
  const mat = ['car1', 'car2', 'car3', 'car4'][color % 4];
  const [w, d] = axis === 'x' ? [0.72, 0.36] : [0.36, 0.72];
  p.disc(x + w / 2, y + d / 2, 0, 22, 10, 'shadow');
  p.box(x, y, w, d, 2, 6, mat);
  const i = 0.07;
  const [cw, cd] = axis === 'x' ? [w * 0.55, d - 2 * i] : [w - 2 * i, d * 0.55];
  p.box(x + (w - cw) / 2, y + (d - cd) / 2, cw, cd, 8, 5, 'carglass');
}

/** Фургон поставщика. */
export function drawTruck(p: Pen, x: number, y: number, axis: 'x' | 'y'): void {
  const [w, d] = axis === 'x' ? [1.05, 0.42] : [0.42, 1.05];
  p.disc(x + w / 2, y + d / 2, 0, 30, 13, 'shadow');
  if (axis === 'x') {
    p.box(x, y, 0.72, d, 3, 16, 'white');
    p.box(x + 0.72, y, 0.33, d, 3, 11, 'orange');
  } else {
    p.box(x, y, d === 1.05 ? w : d, 0.72, 3, 16, 'white');
    p.box(x, y + 0.72, w, 0.33, 3, 11, 'orange');
  }
}

export function drawProp(p: Pen, o: Prop): void {
  const { x, y } = o;
  switch (o.kind) {
    case 'tree': {
      const s = 0.85 + hash(x, y, 1) * 0.4;
      p.disc(x, y, 0, 11 * s, 5 * s, 'shadow');
      p.line([x, y, 0], [x, y, 14 * s], 'trunk');
      p.disc(x, y, 22 * s, 12 * s, 14 * s, 'leaf');
      p.disc(x - 0.08, y - 0.02, 26 * s, 7 * s, 8 * s, 'leaf hi');
      break;
    }
    case 'conifer': {
      p.disc(x, y, 0, 9, 4, 'shadow');
      p.line([x, y, 0], [x, y, 8], 'trunk');
      for (let i = 0; i < 3; i++) {
        const [cx, cy] = p.pt(x, y, 6 + i * 9);
        const r = 11 - i * 2.5;
        p.g.insertAdjacentHTML('beforeend', `<polygon class="leaf dark" points="${cx - r},${cy} ${cx + r},${cy} ${cx},${cy - 16}"/>`);
      }
      break;
    }
    case 'bush':
      p.disc(x, y, 4, 8, 6, 'leaf');
      p.disc(x - 0.04, y, 6, 4, 3, 'leaf hi');
      break;
    case 'lamp':
      p.line([x, y, 0], [x, y, 30], 'pole');
      p.line([x, y, 30], [x + 0.18, y, 30], 'pole');
      p.disc(x + 0.18, y, 14, 26, 20, 'lamp-glow');
      p.disc(x + 0.18, y, 29, 3, 2, 'lamp-head');
      break;
    case 'bench':
      p.box(x, y, 0.5, 0.14, 3, 2, 'wood');
      p.wallL(x, x + 0.5, y, 5, 10, 'f-l m-wood');
      break;
    case 'flowers':
      p.flat(x, y, 0.8, 0.5, 0.5, 'bed');
      for (let i = 0; i < 7; i++) p.disc(x + 0.1 + hash(x, y, i) * 0.6, y + 0.08 + hash(y, x, i) * 0.34, 3, 2.2, 2.2, `flower c${i % 3}`);
      break;
    case 'fountain': {
      p.disc(x, y, 1, 26, 13, 'pool-rim');
      p.disc(x, y, 3, 22, 11, 'pool');
      p.line([x, y, 3], [x, y, 16], 'pole');
      for (let i = 0; i < 3; i++) {
        const c = p.disc(x, y, 18, 3, 3, 'spray');
        c.style.animationDelay = `${i * 0.5}s`;
      }
      break;
    }
    case 'car':
      drawCar(p, x, y, o.axis, o.color);
      break;
  }
}

// ---------- город ----------

/** ядро, нарисованное вручную: 0..MAP по обеим осям */
export const MAP = 33;
/** весь город: вокруг ядра – кварталы-спрайты */
export const CITY_MIN = -27;
export const CITY_MAX = 60;
/** полосы проезжей части */
export const ROADS = [-17, -4, 9, 22, 35, 48];
/** тротуары, по которым ходят гости кофеен */
export const WALKS = [8.5, 11.5, 21.5, 24.5];
export const ALL_WALKS = ROADS.flatMap((r) => [r - 0.5, r + 2.5]);

const isRoad = (v: number) => ROADS.some((r) => v === r || v === r + 1);
const isWalk = (v: number) => ROADS.some((r) => v === r - 1 || v === r + 2);

export function ground(x: number, y: number): string {
  if (isRoad(x) && isRoad(y)) return 'road';
  if ((isRoad(x) && isWalk(y)) || (isRoad(y) && isWalk(x))) return 'road cross';
  if (isRoad(x) || isRoad(y)) return 'road';
  if (isWalk(x) || isWalk(y)) return 'pave';
  if (x >= 12 && x <= 14 && y >= 5 && y <= 7) return 'pave';
  if (x >= 15 && x <= 17 && y >= 15 && y <= 17) return 'water';
  if (x >= 27 && x <= 30 && y >= 29 && y <= 31) return 'water';
  if (x >= 28 && x <= 32 && y >= 25 && y <= 27) return 'pave';
  return (x + y) % 2 ? 'grass-2' : 'grass';
}

export const BUILDINGS: Building[] = [
  // северо-запад: квартал игрока
  { kind: 'panel', x: 0, y: 0, w: 4, d: 2, floors: 7 },
  { kind: 'panel', x: 5, y: 1, w: 2, d: 3, floors: 9, variant: 1 },
  { kind: 'brick', x: 1, y: 5, w: 3, d: 3, floors: 3 },
  { kind: 'house', x: 0, y: 3, w: 2, d: 2, variant: 2 },
  // северо-восток: метро и сеть
  { id: 'metro', kind: 'metro', x: 12, y: 6, w: 2, d: 2 },
  { kind: 'kiosk', x: 14, y: 7, w: 1, d: 1 },
  { kind: 'office', x: 13, y: 1, w: 3, d: 3, floors: 9 },
  { kind: 'panel', x: 17, y: 0, w: 3, d: 2, floors: 6 },
  { kind: 'brick', x: 18, y: 6, w: 2, d: 2, floors: 2 },
  // юго-запад: авторская кофейня и частный сектор
  { kind: 'shop', x: 2, y: 12, w: 3, d: 2, variant: 0 },
  { kind: 'house', x: 6, y: 15, w: 2, d: 2, variant: 0 },
  { kind: 'house', x: 3, y: 16, w: 2, d: 2, variant: 1 },
  { kind: 'house', x: 0, y: 15, w: 2, d: 2, variant: 3 },
  { kind: 'house', x: 6, y: 18, w: 2, d: 2, variant: 2 },
  // юго-восток: парк, аптека, остановка
  { kind: 'shop', x: 17, y: 12, w: 3, d: 2, variant: 1 },
  { kind: 'busStop', x: 13, y: 11, w: 2, d: 1 },
  { kind: 'house', x: 12, y: 17, w: 2, d: 2, variant: 1 },
  { kind: 'shop', x: 18, y: 18, w: 2, d: 2, variant: 2 },
  // восток: деловой квартал
  { kind: 'office', x: 25, y: 1, w: 3, d: 3, floors: 12 },
  { kind: 'panel', x: 29, y: 0, w: 4, d: 2, floors: 8, variant: 1 },
  { kind: 'brick', x: 29, y: 4, w: 3, d: 3, floors: 4 },
  { kind: 'shop', x: 25, y: 6, w: 3, d: 2, variant: 1, title: 'ОПТИКА' },
  { kind: 'mall', x: 25, y: 12, w: 6, d: 5, title: 'ТЦ ГАЛЕРЕЯ' },
  { id: 'tax', kind: 'tax', x: 25, y: 18, w: 4, d: 3 },
  { kind: 'house', x: 30, y: 18, w: 2, d: 2, variant: 3 },
  // юг: школа и жилые кварталы
  { kind: 'school', x: 1, y: 25, w: 5, d: 3 },
  { id: 'depot', kind: 'depot', x: 1, y: 29.5, w: 6, d: 3 },
  { id: 'bank', kind: 'bank', x: 11.5, y: 25, w: 4, d: 3 },
  { kind: 'panel', x: 16, y: 25, w: 4, d: 2, floors: 7, variant: 1 },
  { kind: 'brick', x: 12, y: 29, w: 3, d: 3, floors: 3 },
  { kind: 'brick', x: 16, y: 29, w: 3, d: 3, floors: 2 },
  { kind: 'gas', x: 25, y: 25, w: 3, d: 3 },
];

export const PROPS: Prop[] = [
  ...[[4.5, 6.5], [4.5, 7.4], [2.5, 3.5], [3.5, 4.2], [7.5, 0.6], [7.4, 4.6], [0.5, 2.5], [4.4, 3.3]].map(([x, y]) => ({ kind: 'tree' as const, x, y })),
  ...[[12.5, 0.6], [16.5, 3.5], [19.4, 3.5], [12.4, 4.4], [18.5, 4.5], [16.6, 0.6]].map(([x, y]) => ({ kind: 'tree' as const, x, y })),
  ...[[0.6, 12.6], [1.5, 13.5], [5.5, 14.5], [2.5, 15.2], [5.4, 17.5], [1.5, 18.5], [3.4, 19.3], [0.5, 19.4]].map(([x, y]) => ({ kind: 'tree' as const, x, y })),
  ...[[12.6, 13.5], [14.5, 12.6], [13.5, 15.5], [18.5, 15.5], [16.5, 18.6], [14.5, 19.3], [19.3, 16.5]].map(([x, y]) => ({ kind: 'tree' as const, x, y })),
  ...[[15.5, 13.5], [16.4, 14.2], [14.4, 17.4], [18.4, 17.3], [15.3, 18.3]].map(([x, y]) => ({ kind: 'conifer' as const, x, y })),
  ...[[8.2, 12.3], [8.2, 13.8], [0.4, 5.4], [14.6, 14.6], [17.6, 14.4]].map(([x, y]) => ({ kind: 'bush' as const, x, y })),
  ...[[8.85, 2.5], [8.85, 6.5], [8.85, 14.5], [8.85, 18.5], [11.1, 4.5], [11.1, 15.5], [2.5, 8.85], [16.5, 8.85], [4.5, 11.1], [15.5, 11.1], [19.2, 11.1], [0.6, 8.85]].map(([x, y]) => ({ kind: 'lamp' as const, x, y })),
  { kind: 'bench', x: 14.2, y: 14.1 },
  { kind: 'bench', x: 17.4, y: 14.9 },
  { kind: 'bench', x: 13.3, y: 5.4 },
  { kind: 'flowers', x: 12.4, y: 12.4 },
  { kind: 'flowers', x: 16.2, y: 12.5 },
  { kind: 'flowers', x: 13.1, y: 14.6 },
  { kind: 'car', x: 2.2, y: 9.08, axis: 'x', color: 0 },
  { kind: 'car', x: 15.2, y: 10.56, axis: 'x', color: 2 },
  { kind: 'car', x: 9.08, y: 3.2, axis: 'y', color: 1 },
  { kind: 'car', x: 10.56, y: 15.3, axis: 'y', color: 3 },
  { kind: 'car', x: 15.2, y: 22.08, axis: 'x', color: 1 },
  { kind: 'car', x: 28.2, y: 23.56, axis: 'x', color: 0 },
  { kind: 'car', x: 22.08, y: 15.2, axis: 'y', color: 2 },
  { kind: 'fountain', x: 29.5, y: 26 },
  { kind: 'bench', x: 28.5, y: 27.2 },
  { kind: 'bench', x: 31, y: 27.2 },
  ...generatedProps(),
];

/** Деревья и фонари новых кварталов: расставляются по детерминированному хешу. */
function generatedProps(): Prop[] {
  const out: Prop[] = [];
  const taken = new Set<string>();
  for (const b of BUILDINGS) for (let x = b.x - 1; x < b.x + b.w; x++) for (let y = b.y - 1; y < b.y + b.d + 1; y++) taken.add(`${x},${y}`);
  for (let x = 0; x < MAP; x++) {
    for (let y = 0; y < MAP; y++) {
      if (x <= 20 && y <= 20) continue;
      if (!ground(x, y).startsWith('grass') || taken.has(`${x},${y}`)) continue;
      const h = hash(x, y, 5);
      if (h < 0.3) out.push({ kind: h < 0.09 ? 'conifer' : h < 0.24 ? 'tree' : 'bush', x: x + 0.3 + hash(x, y, 6) * 0.4, y: y + 0.3 + hash(y, x, 7) * 0.4 });
    }
  }
  for (let i = 2; i < MAP; i += 6) {
    if (Math.abs(i - 10) > 3) out.push({ kind: 'lamp', x: 21.85, y: i + 0.5 }, { kind: 'lamp', x: i + 0.5, y: 21.85 });
    if (i > 20 && i !== 26) out.push({ kind: 'lamp', x: 8.85, y: i + 0.5 }, { kind: 'lamp', x: i + 0.5, y: 8.85 });
  }
  return out;
}

// ---------- место кофейни ----------

export type Pt = [number, number];
export type LocationKey = 'suburb' | 'metro' | 'center';

interface Pt2 { x: number; y: number; w: number; d: number }
interface Site extends Pt2 { door: Pt; step: Pt }
export interface FlowSource { id: string; name: string; at: Pt; weight: number }
interface Plan { player: Site; rival0: Site; rival1: Site; rival2: Site; rival3: Site; sources: FlowSource[]; camera: Pt }

/** Три помещения на карте: у каждого своё окружение, конкуренты и источники людей. */
const PLANS: Record<LocationKey, Plan> = {
  metro: {
    player: { x: 5, y: 6, w: 3, d: 2, door: [6.5, 8.5], step: [6.5, 8.05] },
    rival0: { x: 15, y: 5, w: 3, d: 3, door: [16.5, 8.5], step: [16.5, 8.05] },
    rival1: { x: 6, y: 12, w: 2, d: 2, door: [8.5, 13.5], step: [8.05, 13.5] },
    rival2: { x: 18, y: 6, w: 3, d: 2, door: [19.5, 8.5], step: [19.5, 8.05] },
    rival3: { x: 12, y: 19, w: 3, d: 2, door: [13.5, 21.5], step: [13.5, 21.05] },
    sources: [{ id: 'metro', name: 'Метро', at: [13, 8.5], weight: 0.45 }, { id: 'stop', name: 'Остановка', at: [14, 11.5], weight: 0.15 }],
    camera: [9.75, 7],
  },
  center: {
    player: { x: 25, y: 6, w: 3, d: 2, door: [26.5, 8.5], step: [26.5, 8.05] },
    rival0: { x: 29, y: 5, w: 3, d: 3, door: [30.5, 8.5], step: [30.5, 8.05] },
    rival1: { x: 19, y: 15, w: 2, d: 2, door: [21.5, 16.5], step: [21.05, 16.5] },
    rival2: { x: 15, y: 5, w: 3, d: 3, door: [16.5, 8.5], step: [16.5, 8.05] },
    rival3: { x: 30, y: 18, w: 3, d: 3, door: [31.5, 21.5], step: [31.5, 21.05] },
    sources: [{ id: 'mall', name: 'Торговый центр', at: [24.5, 14.5], weight: 0.35 }, { id: 'office', name: 'Бизнес-центр', at: [24.5, 2.5], weight: 0.3 }],
    camera: [27, 8],
  },
  suburb: {
    player: { x: 3, y: 19, w: 3, d: 2, door: [4.5, 21.5], step: [4.5, 21.05] },
    rival0: { x: 17, y: 18, w: 3, d: 3, door: [18.5, 21.5], step: [18.5, 21.05] },
    rival1: { x: 6, y: 25, w: 2, d: 2, door: [8.5, 26.5], step: [8.05, 26.5] },
    rival2: { x: 12, y: 19, w: 3, d: 2, door: [13.5, 21.5], step: [13.5, 21.05] },
    rival3: { x: 15, y: 5, w: 3, d: 3, door: [16.5, 8.5], step: [16.5, 8.05] },
    sources: [{ id: 'yards', name: 'Дворы', at: [8.5, 18.5], weight: 0.3 }, { id: 'school', name: 'Школа', at: [3.5, 24.5], weight: 0.2 }],
    camera: [8, 20],
  },
};

export interface Layout {
  buildings: Building[];
  props: Prop[];
  doors: Record<string, Pt>;
  steps: Record<string, Pt>;
  sources: FlowSource[];
  camera: Pt;
}

export const LOCATION_KEYS = Object.keys(PLANS) as LocationKey[];

/** Что в городе меняется по ходу партии: новые конкуренты и ваш филиал. */
export interface World {
  rivals: { kind?: string; name: string; opening: boolean }[];
  branch?: LocationKey | null;
}

/** Собирает карту под выбранное помещение. В режиме выбора остальные помещения показаны как свободные. */
export function layoutFor(location: LocationKey, choosing = false, world: World = { rivals: [] }): Layout {
  const plan = PLANS[location];
  const sites = [plan.rival0, plan.rival1, plan.rival2, plan.rival3];
  const rivals = world.rivals.length ? world.rivals : [{ kind: 'chain', name: '', opening: false }, { kind: 'craft', name: '', opening: false }];
  const placed: Building[] = [{ id: 'player', kind: 'cafePlayer', x: plan.player.x, y: plan.player.y, w: 3, d: 2 }];
  rivals.slice(0, 4).forEach((r, i) => {
    const site = rect(sites[i]);
    const id = `rival${i}`;
    if (r.opening) placed.push({ id, kind: 'vacant', ...site, title: 'СКОРО' });
    else if (i === 1) placed.push({ id, kind: 'cafeCraft', ...site });
    else placed.push({ id, kind: 'cafeChain', ...site, title: i === 0 ? undefined : r.name.toUpperCase(), variant: r.kind === 'craft' ? 1 : 0 });
  });
  for (const k of LOCATION_KEYS) {
    if (k === location) continue;
    const p = PLANS[k].player;
    if (choosing) placed.push({ id: `lot-${k}`, kind: 'vacant', x: p.x, y: p.y, w: 3, d: 2 });
    else if (world.branch === k) placed.push({ id: 'branch', kind: 'cafePlayer', x: p.x, y: p.y, w: 3, d: 2 });
    else if (k === 'metro') placed.push({ kind: 'shop', x: p.x, y: p.y, w: 3, d: 2, variant: 2, title: 'ПРОДУКТЫ' });
  }
  const hit = (b: { x: number; y: number; w: number; d: number }, c: Building) => b.x < c.x + c.w && c.x < b.x + b.w && b.y < c.y + c.d && c.y < b.y + b.d;
  const base = BUILDINGS.filter((b) => !placed.some((c) => hit(b, c)));
  const kept = placed.filter((c, i) => !placed.some((o, k) => k < i && hit(o, c)));
  const props = PROPS.filter((o) => !kept.some((c) => o.x > c.x - 0.4 && o.x < c.x + c.w + 0.4 && o.y > c.y - 0.4 && o.y < c.y + c.d + 0.4));
  const doors: Record<string, Pt> = { player: plan.player.door };
  const steps: Record<string, Pt> = { player: plan.player.step };
  sites.forEach((site, i) => {
    doors[`rival${i}`] = site.door;
    steps[`rival${i}`] = site.step;
  });
  return { buildings: [...base, ...kept], props, doors, steps, sources: plan.sources.map((x) => ({ ...x })), camera: plan.camera };
}

function rect(s: Pt2): Pt2 {
  return { x: s.x, y: s.y, w: s.w, d: s.d };
}
