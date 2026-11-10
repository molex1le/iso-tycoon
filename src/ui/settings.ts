/** Настройки игрока: живут только в браузере и на партию не влияют. */
export interface Settings {
  music: number;
  sfx: number;
  hints: boolean;
}

const KEY = 'iso-tycoon-settings';
const DEFAULTS: Settings = { music: 0.45, sfx: 0.7, hints: true };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* хранилище недоступно – настройки живут до перезагрузки */
  }
}
