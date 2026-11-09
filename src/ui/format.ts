const NBSP = ' ';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** Целые доллары: «$ 5 450». */
export function money(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '') + '$' + NBSP + Math.abs(v).toLocaleString('ru-RU');
}

/** Со знаком: «+ $330» / «− $40». */
export function signedMoney(n: number): string {
  const v = Math.round(n);
  return (v < 0 ? '−' : '+') + NBSP + '$' + Math.abs(v).toLocaleString('ru-RU');
}

/** Цена с центами: «$3,00». */
export function price(n: number): string {
  return '$' + n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function percent(share: number): string {
  return Math.round(share * 100) + '%';
}

export function clockTime(hour: number): string {
  const h = Math.floor(hour) % 24;
  return String(h).padStart(2, '0') + ':00';
}
