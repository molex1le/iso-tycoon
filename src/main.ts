import './ui/styles/tokens.css';
import './ui/styles/bundle.css';
import './ui/styles/app.css';
import './ui/styles/scene.css';
import { defaultConfig as cfg } from './core/config';
import { Game } from './core/game';
import type { GameState, NewGameOptions } from './core/state';
import { telemetryCsv } from './core/telemetry';
import { mountGameScreen } from './ui/gameScreen';
import { mountMainMenu, mountWizard, type SlotInfo } from './ui/startScreens';

const SLOTS = 3;
const SLOT_KEY = 'iso-tycoon-slot';
/** первый слот хранится под старым ключом, чтобы прежняя партия не пропала */
const keyOf = (slot: number): string => (slot === 0 ? 'iso-tycoon-save-v3' : `iso-tycoon-save-v3-s${slot + 1}`);
const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;

function isSave(s: unknown): s is GameState {
  return typeof s === 'object' && s !== null && (s as GameState).version === 3 && typeof (s as GameState).seed === 'number';
}

function readSave(slot: number): GameState | undefined {
  try {
    const s: unknown = JSON.parse(localStorage.getItem(keyOf(slot)) ?? 'null');
    return isSave(s) ? s : undefined;
  } catch {
    return undefined;
  }
}

function clearSave(slot: number): void {
  try {
    localStorage.removeItem(keyOf(slot));
  } catch {
    /* хранилище недоступно */
  }
}

function activeSlot(): number {
  try {
    const n = Number(localStorage.getItem(SLOT_KEY) ?? 0);
    return Number.isInteger(n) && n >= 0 && n < SLOTS ? n : 0;
  } catch {
    return 0;
  }
}

function setActive(slot: number): void {
  try {
    localStorage.setItem(SLOT_KEY, String(slot));
  } catch {
    /* хранилище недоступно */
  }
}

function slotInfo(s: GameState | undefined): SlotInfo | null {
  if (!s) return null;
  return { day: s.day, cash: s.cash, finished: s.finished, difficulty: cfg.balance.difficulties[s.options.difficulty].name, location: cfg.balance.locations[s.options.location].name };
}

function newSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  return raw !== null && Number.isFinite(Number(raw)) ? Number(raw) | 0 : (Date.now() & 0x7fffffff) | 0;
}

function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function play(slot: number, seed: number, options?: NewGameOptions, saved?: GameState): void {
  unmount?.();
  setActive(slot);
  const game = new Game(seed, options, undefined, saved);
  const save = () => {
    try {
      localStorage.setItem(keyOf(slot), JSON.stringify(game.state));
    } catch {
      /* хранилище недоступно – играем без автосохранения */
    }
  };
  save();
  unmount = mountGameScreen(root, game, {
    save,
    download: () => download(`iso-tycoon-day${game.state.day}.json`, JSON.stringify(game.state), 'application/json'),
    exportCsv: () => download(`iso-tycoon-telemetry-${game.state.seed}.csv`, telemetryCsv(game.state), 'text/csv'),
    newGame: () => {
      clearSave(slot);
      wizard(slot);
    },
    menu: showMenu,
  });
}

function wizard(slot: number): void {
  unmount?.();
  unmount = null;
  const seed = newSeed();
  mountWizard(root, cfg, seed, (o) => play(slot, seed, o), showMenu);
}

function showMenu(error = ''): void {
  unmount?.();
  unmount = null;
  const saves = Array.from({ length: SLOTS }, (_, i) => readSave(i));
  mountMainMenu(
    root,
    {
      slots: saves.map(slotInfo),
      active: activeSlot(),
      onContinue: (slot) => {
        const s = saves[slot];
        if (s) play(slot, s.seed, s.options, s);
      },
      onNew: wizard,
      onDelete: (slot) => {
        clearSave(slot);
        showMenu();
      },
      onDownload: (slot) => {
        const s = saves[slot];
        if (s) download(`iso-tycoon-slot${slot + 1}-day${s.day}.json`, JSON.stringify(s), 'application/json');
      },
      onLoadFile: (slot, text) => {
        try {
          const s: unknown = JSON.parse(text);
          if (!isSave(s)) throw new Error('bad');
          play(slot, s.seed, s.options, s);
        } catch {
          showMenu('Этот файл не похож на сейв Iso Tycoon или сделан в старой версии.');
        }
      },
    },
    typeof error === 'string' ? error : '',
  );
}

showMenu();
