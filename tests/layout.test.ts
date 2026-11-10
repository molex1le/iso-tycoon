import { describe, expect, it } from 'vitest';
import { BUILDINGS, LOCATION_KEYS, layoutFor } from '../src/ui/scene/models';

const hit = (a: { x: number; y: number; w: number; d: number }, b: { x: number; y: number; w: number; d: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

describe('карта района', () => {
  it('здания не стоят друг на друге', () => {
    for (let i = 0; i < BUILDINGS.length; i++) {
      for (let k = i + 1; k < BUILDINGS.length; k++) expect(hit(BUILDINGS[i], BUILDINGS[k]), `${i} и ${k}`).toBe(false);
    }
  });

  it('в каждом районе на месте банк, налоговая, склад, игрок и четыре конкурента', () => {
    const world = { rivals: [0, 1, 2, 3].map((i) => ({ kind: i % 2 ? 'craft' : 'chain', name: 'Тест', opening: false })) };
    for (const loc of LOCATION_KEYS) {
      const layout = layoutFor(loc, false, world);
      const ids = layout.buildings.map((b) => b.id);
      for (const id of ['bank', 'tax', 'depot', 'player', 'rival0', 'rival1', 'rival2', 'rival3']) expect(ids, `${loc}: ${id}`).toContain(id);
      for (let i = 0; i < layout.buildings.length; i++) {
        for (let k = i + 1; k < layout.buildings.length; k++) expect(hit(layout.buildings[i], layout.buildings[k]), `${loc}: ${i} и ${k}`).toBe(false);
      }
    }
  });
});
