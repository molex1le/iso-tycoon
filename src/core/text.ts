import balanceJson from '../data/balance.json';
import namesJson from '../data/names.json';

export type Gender = 'f' | 'm';

const GENDERS = new Map<string, Gender>([
  ...namesJson.map((n) => [n.name, n.gender as Gender] as const),
  ...balanceJson.staff.start.map((e) => [e.name, e.gender as Gender] as const),
]);

/** Пол по имени работника; для незнакомого имени – по окончанию. */
export function genderOf(name: string): Gender {
  return GENDERS.get(name) ?? (/[ая]$/i.test(name.split(' ')[0] ?? '') ? 'f' : 'm');
}

/** «уборщик» или «уборщица», «бариста» не склоняется. */
export function roleName(role: 'barista' | 'cleaner', name: string): string {
  if (role === 'barista') return 'бариста';
  return genderOf(name) === 'f' ? 'уборщица' : 'уборщик';
}

/**
 * Подставляет {переменные} и выбирает род по vars.name:
 * «{name} уволи[лся|лась]» – первый вариант мужской, второй женский.
 */
export function fillText(template: string, vars: Record<string, string | number>): string {
  const female = typeof vars.name === 'string' && vars.name !== '' && genderOf(vars.name) === 'f';
  return template
    .replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
    .replace(/\[([^\]|]*)\|([^\]|]*)\]/g, (_, m: string, f: string) => (female ? f : m));
}
