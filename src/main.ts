import './ui/styles/tokens.css';
import './ui/styles/bundle.css';
import './ui/styles/app.css';
import './ui/styles/scene.css';
import { defaultConfig as cfg } from './core/config';
import { Game } from './core/game';
import type { GameState, NewGameOptions } from './core/state';
import { telemetryCsv } from './core/telemetry';
import { mountGameScreen } from './ui/gameScreen';
import { mountMainMenu, mountWizard } from './ui/startScreens';

const KEY = 'iso-tycoon-save-v3';
const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;

function isSave(s: unknown): s is GameState {
  return typeof s === 'object' && s !== null && (s as GameState).version === 3 && typeof (s as GameState).seed === 'number';
}

function readSave(): GameState | undefined {
  try {
    const s: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return isSave(s) ? s : undefined;
  } catch {
    return undefined;
  }
}

function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно */
  }
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

function play(seed: number, options?: NewGameOptions, saved?: GameState): void {
  unmount?.();
  const game = new Game(seed, options, undefined, saved);
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(game.state));
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
      clearSave();
      wizard();
    },
    menu: showMenu,
  });
}

function wizard(): void {
  unmount?.();
  unmount = null;
  const seed = newSeed();
  mountWizard(root, cfg, seed, (o) => play(seed, o), showMenu);
}

function showMenu(error = ''): void {
  unmount?.();
  unmount = null;
  const saved = readSave();
  mountMainMenu(
    root,
    {
      canContinue: saved !== undefined,
      onContinue: () => saved && play(saved.seed, saved.options, saved),
      onNew: wizard,
      onLoadFile: (text) => {
        try {
          const s: unknown = JSON.parse(text);
          if (!isSave(s)) throw new Error('bad');
          play(s.seed, s.options, s);
        } catch {
          showMenu('Этот файл не похож на сейв Iso Tycoon или сделан в старой версии.');
        }
      },
    },
    typeof error === 'string' ? error : '',
  );
}

showMenu();
