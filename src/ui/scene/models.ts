/* Библиотека изометрических моделей: здания и уличная мелочь. Всё – 2D-полигоны в плоском стиле. */
import { FL, hash, type Pen } from './pen';

export type ModelKind = 'panel' | 'brick' | 'house' | 'office' | 'metro' | 'cafePlayer' | 'cafeChain' | 'cafeCraft' | 'kiosk' | 'shop' | 'busStop';

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
}

export type Prop =
  | { kind: 'tree' | 'conifer' | 'bush' | 'lamp'; x: number; y: number }
  | { kind: 'bench'; x: number; y: number }
  | { kind: 'car'; x: number; y: number; axis: 'x' | 'y'; color: number }
  | { kind: 'flowers'; x: number; y: number };

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
  p.box(x, y, w, d, 0, H, 'white');
  p.wallL(x, x + w, y + d, 22, H, 'f-l m-chainred');
  p.wallR(y, y + d, x + w, 22, H, 'f-r m-chainred');
  winL(p, x, x + w, y + d, 4, w, 15, 0.8);
  winR(p, y, y + d, x + w, 4, d, 15, 0.8);
  doorL(p, x + w / 2 - 0.2, y + d, 0.4, 18, 'door glassdoor');
  p.text('L', x + w / 2, y + d + 0.001, 24, b.title ?? 'КОФЕМАРКЕТ', 'sign-text', 8.5);
  p.box(x + 0.1, y + 0.1, w - 0.2, d - 0.2, H, 3, 'roofgrey');
  // куб-рекламу видно издалека
  p.box(x + w - 1.3, y + 0.5, 1, 1, H + 3, 20, 'chainred');
  p.text('L', x + w - 0.8, y + 1.5 + 0.001, H + 8, 'КМ', 'sign-text', 12);
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

export function drawBuilding(pen: Pen, b: Building, look: ShopLook): void {
  switch (b.kind) {
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
    case 'car':
      drawCar(p, x, y, o.axis, o.color);
      break;
  }
}

// ---------- район 20×20 ----------

export const MAP = 20;

export function ground(x: number, y: number): string {
  const road = (v: number) => v === 9 || v === 10;
  const walk = (v: number) => v === 8 || v === 11;
  if (road(x) && road(y)) return 'road';
  if ((road(x) && walk(y)) || (road(y) && walk(x))) return 'road cross';
  if (road(x) || road(y)) return 'road';
  if (walk(x) || walk(y)) return 'pave';
  if (x >= 12 && x <= 14 && y >= 5 && y <= 7) return 'pave';
  if (x >= 15 && x <= 17 && y >= 15 && y <= 17) return 'water';
  return (x + y) % 2 ? 'grass-2' : 'grass';
}

export const PLAYER_SPOT: Building = { id: 'player', kind: 'cafePlayer', x: 5, y: 6, w: 3, d: 2 };

export const BUILDINGS: Building[] = [
  // северо-запад: квартал игрока
  { kind: 'panel', x: 0, y: 0, w: 4, d: 2, floors: 7 },
  { kind: 'panel', x: 5, y: 1, w: 2, d: 3, floors: 9, variant: 1 },
  { kind: 'brick', x: 1, y: 5, w: 3, d: 3, floors: 3 },
  { kind: 'house', x: 0, y: 3, w: 2, d: 2, variant: 2 },
  PLAYER_SPOT,
  // северо-восток: метро и сеть
  { id: 'metro', kind: 'metro', x: 12, y: 6, w: 2, d: 2 },
  { kind: 'kiosk', x: 14, y: 7, w: 1, d: 1 },
  { id: 'rival0', kind: 'cafeChain', x: 15, y: 5, w: 3, d: 3 },
  { kind: 'office', x: 13, y: 1, w: 3, d: 3, floors: 9 },
  { kind: 'panel', x: 17, y: 0, w: 3, d: 2, floors: 6 },
  { kind: 'brick', x: 18, y: 6, w: 2, d: 2, floors: 2 },
  // юго-запад: авторская кофейня и частный сектор
  { id: 'rival1', kind: 'cafeCraft', x: 6, y: 12, w: 2, d: 2 },
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
];
