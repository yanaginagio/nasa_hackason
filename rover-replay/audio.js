// Sound for the game.
// - Recorded on Mars (NASA/JPL-Caltech): the Sol 16 drive, from Perseverance's EDL
//   microphone, plays while the rover drives; faint wind from SuperCam on Sol 1 plays
//   underneath. Both files are in assets/audio/.
// - Event sounds are synthesized here with the Web Audio API, so no sound files or
//   licences are needed for them.
// Browsers only allow sound after the player does something, so start() is called
// from the first click.

const STORE_KEY = "jezero-sound";
const rand = (a, b) => a + Math.random() * (b - a);
const DRIVE_VOLUME = 0.6;
const WIND_VOLUME = 0.35;

export class Sound {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem(STORE_KEY) !== "off"; } catch { /* storage unavailable */ }
    this.ctx = null;
    this.master = null;
    this.drive = null;
    this.wind = null;
    this.fades = new Map();
    this.lastLow = 0;
  }

  // Create the audio context only (the prologue uses effects, not the Mars recordings).
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }

  // Create the audio context and the recorded loops. Safe to call more than once.
  start() {
    this.unlock();
    if (this.drive) return;
    this.drive = this.loop("assets/audio/drive-sol16.mp3");
    this.wind = this.loop("assets/audio/wind-sol1.mp3");
    this.fade(this.wind, WIND_VOLUME, 1500);
  }

  loop(src) {
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0;
    audio.muted = !this.enabled;
    audio.preload = "auto";
    return audio;
  }

  // Ease an <audio> element's volume to target; pause it when it reaches silence.
  fade(audio, target, ms) {
    if (!audio) return;
    cancelAnimationFrame(this.fades.get(audio));
    if (target > 0 && audio.paused) audio.play().catch(() => {});
    const from = audio.volume, began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (t < 1) this.fades.set(audio, requestAnimationFrame(step));
      else if (target === 0) audio.pause();
    };
    this.fades.set(audio, requestAnimationFrame(step));
  }

  // The driving recording plays only while the rover moves.
  scene(mode) {
    if (!this.drive) return;
    this.fade(this.drive, mode === "drive" ? DRIVE_VOLUME : 0, mode === "drive" ? 700 : 400);
    this.fade(this.wind, mode === "bigevent" ? WIND_VOLUME * 1.6 : WIND_VOLUME, 800);
  }

  stopAll() {
    this.fade(this.drive, 0, 600);
    this.fade(this.wind, WIND_VOLUME * 0.6, 800);
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(STORE_KEY, this.enabled ? "on" : "off"); } catch { /* storage unavailable */ }
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.8 : 0, this.ctx.currentTime, 0.05);
    for (const audio of [this.drive, this.wind]) if (audio) audio.muted = !this.enabled;
    window.dispatchEvent(new CustomEvent("soundchange", {detail: this.enabled}));
    return this.enabled;
  }

  // ----- synthesized effects -----
  tone(freq, start, length, {type = "sine", gain = 0.2, to = null, attack = 0.01} = {}) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  noise(start, length, {from = 300, to = 2400, gain = 0.25, q = 1.2, type = "bandpass"} = {}) {
    const ctx = this.ctx, t = ctx.currentTime + start;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = buffer;
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + length * 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(amp).connect(this.master);
    source.start(t);
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    const s = this;
    const effects = {
      // incoming transmission: three short blips and a rising note
      plan() { [0, 0.09, 0.18].forEach((t) => s.tone(1046, t, 0.07, {gain: 0.12})); s.tone(784, 0.3, 0.35, {gain: 0.14, to: 1175}); },
      // alarm: two-tone klaxon
      accident() { for (let i = 0; i < 4; i += 1) s.tone(i % 2 ? 560 : 760, i * 0.2, 0.19, {type: "square", gain: 0.07}); },
      // large event: rising whoosh, low rumble, then a bright chord
      big() {
        s.noise(0, 1.3, {from: 180, to: 2600, gain: 0.3});
        s.tone(55, 0, 1.6, {gain: 0.25, attack: 0.4});
        [523, 659, 784, 1046].forEach((f, i) => s.tone(f, 1.25 + i * 0.03, 1.2, {type: "triangle", gain: 0.08}));
      },
      correct() { [659, 784, 988, 1318].forEach((f, i) => s.tone(f, i * 0.07, 0.22, {type: "triangle", gain: 0.13})); },
      wrong() { s.tone(196, 0, 0.32, {type: "sawtooth", gain: 0.09, to: 110}); },
      low() { s.tone(440, 0, 0.12, {gain: 0.12}); s.tone(440, 0.18, 0.12, {gain: 0.12}); },
      recharge() { s.tone(330, 0, 0.5, {type: "triangle", gain: 0.08, to: 880}); },
      success() { [523, 659, 784, 1046, 1318].forEach((f, i) => s.tone(f, i * 0.11, 0.5, {type: "triangle", gain: 0.12})); },
      fail() { s.tone(330, 0, 1.1, {type: "sawtooth", gain: 0.1, to: 70}); s.noise(0.2, 0.9, {from: 900, to: 120, gain: 0.12}); },
      open() { s.tone(880, 0, 0.06, {gain: 0.06}); s.tone(1320, 0.05, 0.08, {gain: 0.05}); },
      // ----- prologue -----
      count() { s.tone(880, 0, 0.16, {type: "square", gain: 0.06}); },
      go() { s.tone(1320, 0, 0.7, {type: "square", gain: 0.06}); s.noise(0.05, 3.5, {from: 120, to: 60, gain: 0.35, type: "lowpass", q: 0.7}); },
      warn() { for (let i = 0; i < 3; i += 1) s.tone(988, i * 0.24, 0.16, {type: "square", gain: 0.06}); },
      hit() { s.noise(0, 0.32, {from: 2400, to: 200, gain: 0.4}); s.tone(110, 0, 0.3, {type: "sawtooth", gain: 0.12, to: 45}); },
      clear() { [784, 988, 1175].forEach((f, i) => s.tone(f, i * 0.08, 0.3, {type: "triangle", gain: 0.1})); },
      sep() { s.noise(0, 0.5, {from: 3000, to: 400, gain: 0.2, type: "highpass", q: 0.5}); s.tone(220, 0, 0.4, {gain: 0.1, to: 110}); },
      entry() { s.noise(0, 4, {from: 200, to: 900, gain: 0.3, type: "lowpass", q: 0.6}); s.tone(48, 0, 4, {gain: 0.2, attack: 1}); },
      // mission complete: a rising fanfare over a low swell
      fanfare() {
        s.tone(65, 0, 3.2, {gain: 0.18, attack: 0.5});
        const notes = [[523, 0], [659, 0.16], [784, 0.32], [1046, 0.5], [784, 0.86], [1046, 1.02], [1318, 1.2], [1568, 1.5]];
        for (const [f, t] of notes) s.tone(f, t, t >= 1.5 ? 1.8 : 0.32, {type: "triangle", gain: 0.11});
        [523, 659, 784].forEach((f) => s.tone(f, 1.5, 1.8, {type: "sine", gain: 0.06}));
      },
      pop() { s.noise(0, 0.45, {from: 3000, to: 300, gain: 0.22}); s.tone(rand(600, 1200), 0.05, 0.4, {gain: 0.05, to: 200}); },
      arrive() {
        s.tone(98, 0, 2.2, {gain: 0.2, attack: 0.3});
        [392, 523, 659, 784, 1046].forEach((f, i) => s.tone(f, 0.2 + i * 0.12, 1.6, {type: "triangle", gain: 0.09}));
      },
    };
    try { effects[name]?.(); } catch { /* audio unavailable */ }
  }

  // A quiet drone for the cruise through space.
  drone(on) {
    if (!this.ctx) return;
    if (on && !this.droneNodes) {
      const amp = this.ctx.createGain();
      amp.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.05, this.ctx.currentTime + 2);
      amp.connect(this.master);
      const oscillators = [55, 82.4, 110.3].map((freq) => {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(amp);
        osc.start();
        return osc;
      });
      this.droneNodes = {amp, oscillators};
    } else if (!on && this.droneNodes) {
      const {amp, oscillators} = this.droneNodes;
      amp.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
      for (const osc of oscillators) osc.stop(this.ctx.currentTime + 2);
      this.droneNodes = null;
    }
  }

  // Power warning, at most every 4 seconds.
  lowWarning() {
    const now = performance.now();
    if (now - this.lastLow < 4000) return;
    this.lastLow = now;
    this.play("low");
  }
}

// One sound system shared by the prologue and the rover game.
export const sound = new Sound();
