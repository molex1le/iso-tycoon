/** Настройки игрока: живут только в браузере и на партию не влияют. */
export interface Settings {
  music: number;
  sfx: number;
  hints: boolean;
  tutorialDone: boolean;
  /** тема панелей: авто – ночью тёмная */
  theme: 'auto' | 'day' | 'night';
}

const KEY = 'iso-tycoon-settings';
const DEFAULTS: Settings = { music: 0.45, sfx: 0.7, hints: true, tutorialDone: false, theme: 'auto' };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

/** Режим разработчика включается адресом с ?dev. Без него отладки в игре нет совсем. */
export const devMode: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* хранилище недоступно – настройки живут до перезагрузки */
  }
}
