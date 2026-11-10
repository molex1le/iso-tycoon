/* Весь звук синтезируется в браузере (Web Audio): никаких файлов и лицензий. */
import { settings } from './settings';

export type Sfx = 'click' | 'tab' | 'coin' | 'ok' | 'warn' | 'bad' | 'stamp' | 'tick' | 'chime' | 'open';

type Chord = number[];
// полутоны от ля малой октавы; день – мягкий мажор, ночь – минор и реже
const DAY: Chord[] = [[0, 4, 7, 11], [9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17]];
const NIGHT: Chord[] = [[9, 12, 16, 19], [5, 9, 12, 16], [0, 4, 7, 11], [4, 7, 11, 14]];
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const BASE = 220;
const hz = (semi: number) => BASE * Math.pow(2, semi / 12);

class AudioEngine {
  private ctx: AudioContext | null = null;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private nextBeat = 0;
  private beat = 0;
  private night = false;
  private playing = false;

  /** Браузер разрешает звук только после действия игрока. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(comp);
      this.sfxBus.connect(comp);
      this.noise = this.makeNoise();
      this.applyVolumes();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) void this.ctx?.suspend();
        else void this.ctx?.resume();
      });
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startMusic();
  }

  get state(): string {
    return this.ctx?.state ?? 'locked';
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.sfx * 0.8, t, 0.02);
  }

  setNight(night: boolean): void {
    this.night = night;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private tone(bus: AudioNode, f: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(bus);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private burst(bus: AudioNode, at: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(at, Math.random() * 0.5, dur + 0.02);
  }

  play(name: Sfx): void {
    if (!this.ctx || this.ctx.state !== 'running' || settings.sfx <= 0) return;
    const t = this.ctx.currentTime + 0.005;
    const b = this.sfxBus;
    switch (name) {
      case 'click': this.tone(b, 520, t, 0.06, 0.12, 'triangle', 380); break;
      case 'tab': this.tone(b, 660, t, 0.05, 0.08, 'triangle'); break;
      case 'tick': this.tone(b, 1100, t, 0.03, 0.05, 'square'); break;
      case 'coin': this.tone(b, 988, t, 0.09, 0.14); this.tone(b, 1319, t + 0.07, 0.22, 0.14); break;
      case 'ok': [523, 659, 784].forEach((f, i) => this.tone(b, f, t + i * 0.08, 0.2, 0.13, 'triangle')); break;
      case 'warn': this.tone(b, 587, t, 0.13, 0.13, 'triangle'); this.tone(b, 440, t + 0.14, 0.2, 0.13, 'triangle'); break;
      case 'bad': this.tone(b, 220, t, 0.42, 0.18, 'sawtooth', 96); break;
      case 'stamp': this.burst(b, t, 0.1, 0.5, 900, 0.7); this.tone(b, 110, t, 0.14, 0.32, 'sine', 55); break;
      case 'chime': [659, 880, 1047].forEach((f, i) => this.tone(b, f, t + i * 0.1, 0.5, 0.11)); break;
      case 'open': this.burst(b, t, 0.12, 0.09, 1600, 0.8); break;
    }
  }

  private startMusic(): void {
    if (this.playing || !this.ctx) return;
    this.playing = true;
    this.nextBeat = this.ctx.currentTime + 0.1;
    this.street();
    this.timer = window.setInterval(() => this.schedule(), 150);
  }

  /** Едва слышный гул улицы под музыкой. */
  private street(): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 340;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    s.connect(f).connect(g).connect(this.musicBus);
    s.start();
  }

  private schedule(): void {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return;
    const spb = 60 / (this.night ? 62 : 76) / 2; // восьмые
    while (this.nextBeat < ctx.currentTime + 0.5) {
      this.step(this.nextBeat, spb);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  private step(t: number, spb: number): void {
    const b = this.musicBus;
    const prog = this.night ? NIGHT : DAY;
    const bar = Math.floor(this.beat / 8);
    const pos = this.beat % 8;
    const chord = prog[bar % prog.length];
    if (pos === 0) {
      // мягкий пэд на весь такт
      for (const semi of chord) {
        this.tone(b, hz(semi), t, spb * 8.4, 0.05, 'triangle');
        this.tone(b, hz(semi) * 1.004, t, spb * 8.4, 0.03, 'sine');
      }
      this.tone(b, hz(chord[0]) / 2, t, spb * 3.6, 0.2);
    }
    if (pos === 5) this.tone(b, hz(chord[2]) / 2, t, spb * 2.4, 0.13);
    // щётки и бочка
    if (pos === 0 || pos === 3) this.tone(b, 92, t, 0.16, this.night ? 0.1 : 0.18, 'sine', 48);
    if (pos === 4) this.burst(b, t, 0.1, 0.06, 2400, 0.6);
    if (pos % 2 === 1) this.burst(b, t, 0.035, 0.022, 7000, 1, 'highpass');
    // мелодия: редкие ноты из пентатоники, не повторяется дословно
    const density = this.night ? 0.22 : 0.34;
    if (pos % 2 === 0 && Math.random() < density) {
      const note = SCALE[Math.floor(Math.random() * SCALE.length)];
      this.tone(b, hz(note + 12), t, spb * 2.6, 0.07, 'triangle');
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.playing = false;
  }
}

export const audio = new AudioEngine();

/** Ползунки звука: одинаковые в меню и в игре. */
export function audioControlsHtml(): string {
  return `<label class="gs-slider"><span>Музыка</span><input type="range" min="0" max="100" value="${Math.round(settings.music * 100)}" data-vol="music"></label>
    <label class="gs-slider"><span>Звуки</span><input type="range" min="0" max="100" value="${Math.round(settings.sfx * 100)}" data-vol="sfx"></label>`;
}
