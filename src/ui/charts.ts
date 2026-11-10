/* Линейные графики в SVG: 2px линии, общая ось Y, легенда при 2+ сериях, перекрестие с подсказкой. */

export interface Series {
  name: string;
  /** CSS-цвет серии: --c1..--c3, цвет закреплён за сущностью */
  color: string;
  values: number[];
}

export interface ChartSpec {
  title: string;
  /** какому игровому дню соответствует точка */
  x: number[];
  series: Series[];
  format: (v: number) => string;
  /** фиксированный низ оси, например 0 */
  min?: number;
  max?: number;
}

const W = 480;
const H = 190;
const T = 12;
const B = 24;
const L = 54;

interface Geometry {
  spec: ChartSpec;
  sx: (i: number) => number;
  sy: (v: number) => number;
  right: number;
}

const registry = new Map<string, Geometry>();

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.5; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function clearCharts(): void {
  registry.clear();
}

export function lineChart(id: string, spec: ChartSpec): string {
  const n = spec.x.length;
  const legend = spec.series.length >= 2 ? `<div class="it-legend">${spec.series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>` : '';
  const head = `<div class="gs-chart-h"><div class="lbl">${spec.title}</div>${legend}</div>`;
  if (n < 2) return `<div class="gs-card gs-chart">${head}<div class="gs-empty">Появится после первых дней работы</div></div>`;

  const all = spec.series.flatMap((s) => s.values);
  const rawMin = spec.min ?? Math.min(0, ...all);
  const rawMax = spec.max ?? Math.max(...all, rawMin + 1);
  const ticks = niceTicks(rawMin, rawMax);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const right = spec.series.length >= 2 ? W - 78 : W - 14;
  const sx = (i: number) => L + ((right - L) * i) / (n - 1);
  const sy = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  registry.set(id, { spec, sx, sy, right });

  const grid = ticks
    .map((v) => `<line class="${v === 0 ? 'c-zero' : 'c-grid'}" x1="${L}" x2="${right}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}"/><text class="c-axis" x="${L - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${spec.format(v)}</text>`)
    .join('');
  const xTicks = [0, Math.floor((n - 1) / 2), n - 1]
    .map((i, k) => `<text class="c-axis" x="${sx(i).toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}">день ${spec.x[i]}</text>`)
    .join('');
  const lines = spec.series
    .map((s) => `<polyline class="c-line" style="stroke:${s.color}" points="${s.values.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}"/>`)
    .join('');
  const ends = spec.series.map((s) => `<circle class="c-dot" style="fill:${s.color}" cx="${sx(n - 1).toFixed(1)}" cy="${sy(s.values[n - 1]).toFixed(1)}" r="4"/>`).join('');

  // подписи на концах линий, раздвинутые, чтобы не слипались
  let labels = '';
  if (spec.series.length >= 2) {
    const placed = spec.series.map((s) => ({ name: s.name, y: sy(s.values[n - 1]) + 4 })).sort((a, c) => a.y - c.y);
    for (let i = 1; i < placed.length; i++) if (placed[i].y - placed[i - 1].y < 13) placed[i].y = placed[i - 1].y + 13;
    labels = placed.map((p) => `<text class="c-end" x="${right + 9}" y="${Math.min(H - B, p.y).toFixed(1)}">${p.name}</text>`).join('');
  }
  return `<div class="gs-card gs-chart">${head}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${spec.title}" data-chart="${id}">${grid}${xTicks}${lines}${ends}${labels}<g class="c-hover" hidden></g><rect class="c-hit" x="${L}" y="${T}" width="${right - L}" height="${H - T - B}"/></svg></div>`;
}

/** Перекрестие и подсказка: один делегированный обработчик на контейнер. */
export function bindCharts(host: HTMLElement, showTip: (html: string, x: number, y: number) => void, hideTip: () => void): void {
  host.addEventListener('pointermove', (e) => {
    const svg = (e.target as Element).closest?.('svg[data-chart]') as SVGSVGElement | null;
    if (!svg) return;
    const g = registry.get(svg.dataset.chart!);
    if (!g) return;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const n = g.spec.x.length;
    const i = Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (g.right - L)) * (n - 1))));
    const hover = svg.querySelector<SVGGElement>('.c-hover')!;
    hover.removeAttribute('hidden');
    hover.innerHTML =
      `<line class="c-cross" x1="${g.sx(i)}" x2="${g.sx(i)}" y1="${T}" y2="${H - B}"/>` +
      g.spec.series.map((s) => `<circle class="c-dot" style="fill:${s.color}" cx="${g.sx(i)}" cy="${g.sy(s.values[i])}" r="4"/>`).join('');
    showTip(
      `<b>День ${g.spec.x[i]}</b>` + g.spec.series.map((s) => `<div class="c-tip"><i style="background:${s.color}"></i><span>${s.name}</span><b>${g.spec.format(s.values[i])}</b></div>`).join(''),
      e.clientX,
      e.clientY,
    );
  });
  host.addEventListener('pointerout', (e) => {
    const svg = (e.target as Element).closest?.('svg[data-chart]');
    if (!svg || svg.contains(e.relatedTarget as Node)) return;
    svg.querySelector('.c-hover')?.setAttribute('hidden', '');
    hideTip();
  });
}
