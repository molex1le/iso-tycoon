import { describe, expect, it } from 'vitest';
import { advise } from '../src/core/advisor';
import { applyCommand } from '../src/core/commands';
import { defaultConfig as cfg } from '../src/core/config';
import { simulateDay } from '../src/core/simulateDay';
import { createInitialState } from '../src/core/state';

const titles = (s: Parameters<typeof advise>[0]) => advise(s, cfg).map((a) => a.title);

describe('советник', () => {
  it('закрытая кофейня важнее всего', () => {
    const s = createInitialState(1);
    s.employees = [];
    expect(titles(s)[0]).toContain('нет бариста');
  });

  it('напоминает про декларацию и оплату', () => {
    const s = createInitialState(1);
    s.tax.due = { amount: 500, declareBy: 10, payBy: 15, filed: false, penalty: 0, undeclaredFines: 0 };
    expect(titles(s).some((t) => t.includes('декларацию'))).toBe(true);
    applyCommand(s, { type: 'FileDeclaration' });
    expect(titles(s).some((t) => t.includes('Оплатите'))).toBe(true);
  });

  it('видит переработки и не больше пяти советов', () => {
    const s = createInitialState(1);
    s.employees = s.employees.slice(0, 1);
    simulateDay(s);
    expect(titles(s)).toContain('Люди перерабатывают');
    s.cleanliness = 10;
    s.cash = 10;
    expect(advise(s, cfg).length).toBeLessThanOrEqual(5);
  });

  it('советник не меняет состояние', () => {
    const s = createInitialState(5);
    const before = JSON.stringify(s);
    advise(s, cfg);
    expect(JSON.stringify(s)).toBe(before);
  });
});
