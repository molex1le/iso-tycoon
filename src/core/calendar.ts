import type { Balance } from './config';

export type Season = Balance['seasons'][number];

/** Месяц 1..12 для дня партии 1..360. */
export function monthOf(day: number, b: Balance): number {
  const m = Math.floor((day - 1) / b.time.daysPerMonth);
  return (m % b.time.monthsPerYear) + 1;
}

/** День месяца 1..30. */
export function dayOfMonth(day: number, b: Balance): number {
  return ((day - 1) % b.time.daysPerMonth) + 1;
}

export function seasonOf(month: number, b: Balance): Season {
  const s = b.seasons.find((x) => x.months.includes(month));
  if (!s) throw new Error(`Нет сезона для месяца ${month}`);
  return s;
}
