import './ui/styles/tokens.css';
import './ui/styles/bundle.css';
import './ui/styles/app.css';
import './ui/styles/scene.css';
import { Game } from './core/game';
import type { GameState } from './core/state';
import { mountGameScreen } from './ui/gameScreen';

const KEY = 'iso-tycoon-save-v2';
const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;

function loadSave(): GameState | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GameState | null;
    return s && s.version === 2 ? s : undefined;
  } catch {
    return undefined;
  }
}

function start(saved?: GameState): void {
  unmount?.();
  const raw = new URLSearchParams(location.search).get('seed');
  const seed = saved?.seed ?? (raw !== null && Number.isFinite(Number(raw)) ? Number(raw) | 0 : (Date.now() & 0x7fffffff) | 0);
  const game = new Game(seed, saved?.options, undefined, saved);
  unmount = mountGameScreen(root, game, {
    save: () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(game.state));
      } catch {
        /* хранилище недоступно – играем без автосохранения */
      }
    },
    download: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(game.state)], { type: 'application/json' }));
      a.download = `iso-tycoon-day${game.state.day}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    newGame: () => {
      localStorage.removeItem(KEY);
      start();
    },
  });
}

start(loadSave());
