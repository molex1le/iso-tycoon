import type { Balance } from './config';

export type Season = Balance['seasons'][number];

/** Дней в году: сумма длин месяцев (365, високосных лет нет). */
export function yearDays(b: Balance): number {
  return b.time.monthLengths.reduce((a, n) => a + n, 0);
}

/** Год партии: 1 для дней 1..365, 2 для 366..730 и т. д. */
export function yearOf(day: number, b: Balance): number {
  return Math.floor((Math.max(1, day) - 1) / yearDays(b)) + 1;
}

/** Календарный год для показа игроку. */
export function calendarYear(day: number, b: Balance): number {
  return b.time.startYear + yearOf(day, b) - 1;
}

function split(day: number, b: Balance): { month: number; dom: number } {
  let rest = (Math.max(1, day) - 1) % yearDays(b);
  const lens = b.time.monthLengths;
  for (let m = 0; m < lens.length; m++) {
    if (rest < lens[m]) return { month: m + 1, dom: rest + 1 };
    rest -= lens[m];
  }
  return { month: lens.length, dom: lens[lens.length - 1] };
}

/** Месяц 1..12 для дня партии. */
export function monthOf(day: number, b: Balance): number {
  return split(day, b).month;
}

/** День месяца 1..31. */
export function dayOfMonth(day: number, b: Balance): number {
  return split(day, b).dom;
}

/** Сквозной номер месяца с начала партии: 1..12 в первый год, 13..24 во второй. */
export function monthIndex(day: number, b: Balance): number {
  return (yearOf(day, b) - 1) * b.time.monthLengths.length + monthOf(day, b);
}

/** Последний день месяца, в который попадает day. */
export function monthEndOf(day: number, b: Balance): number {
  const { month, dom } = split(day, b);
  return day + (b.time.monthLengths[month - 1] - dom);
}

export function isMonthEnd(day: number, b: Balance): boolean {
  return monthEndOf(day, b) === day;
}

/** Последний день календарного квартала, в который попадает day. */
export function quarterEndOf(day: number, b: Balance): number {
  let end = monthEndOf(day, b);
  while (monthOf(end, b) % 3 !== 0) end = monthEndOf(end + 1, b);
  return end;
}

export function isQuarterEnd(day: number, b: Balance): boolean {
  return quarterEndOf(day, b) === day;
}

/** «15 марта» – дата для текстов. */
export function dateLabel(day: number, b: Balance): string {
  const { month, dom } = split(day, b);
  return `${dom} ${b.time.monthNamesGen[month - 1]}`;
}

export function seasonOf(month: number, b: Balance): Season {
  const s = b.seasons.find((x) => x.months.includes(month));
  if (!s) throw new Error(`Нет сезона для месяца ${month}`);
  return s;
}
