// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Sfx — zero-asset WebAudio sound-effects engine.
 *
 * Every sound is synthesized live with the Web Audio API: no audio files,
 * no downloads, no external dependencies. Safe to import in Node (all
 * playback becomes a silent no-op outside a browser).
 *
 * Usage:
 *   import { Sfx } from "./sfx.js";
 *   Sfx.click();            // ui click blip
 *   Sfx.diceRoll();         // rattling dice
 *   if (Sfx.isMuted()) ...  // mute state
 *   Sfx.toggle();           // flip mute, persisted to localStorage
 */

const MUTE_KEY = "aidm_sfx_muted_v1";

/* Storage that survives browsers with blocked localStorage, and Node. */
const memStore = {};
function getStore() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* blocked storage (private mode etc.) */
  }
  return {
    getItem: (k) => (k in memStore ? memStore[k] : null),
    setItem: (k, v) => { memStore[k] = String(v); },
  };
}

let muted = false;
try {
  muted = getStore().getItem(MUTE_KEY) === "1";
} catch {
  muted = false;
}

let ctx = null;
function ac() {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Warm up the AudioContext on first user gesture (autoplay policies). */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const warm = () => { ac(); };
  document.addEventListener("pointerdown", warm, { once: true });
  document.addEventListener("keydown", warm, { once: true });
}

function tone({ freq = 440, freqEnd = null, dur = 0.15, type = "sine", gain = 0.12, delay = 0, attack = 0.008 }) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  try {
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    /* audio glitch — never break the game over a sound */
  }
}

function noise({ dur = 0.2, gain = 0.1, delay = 0, filterFreq = 2000, type = "bandpass" }) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  try {
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(c.destination);
    src.start(t0);
  } catch {
    /* audio glitch — never break the game over a sound */
  }
}

export const Sfx = {
  isMuted() {
    return muted;
  },
  toggle() {
    muted = !muted;
    try {
      getStore().setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return muted;
  },
  setMuted(m) {
    muted = !!m;
    try {
      getStore().setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
  },

  /** Short UI click blip. */
  click() {
    tone({ freq: 680, freqEnd: 460, dur: 0.07, type: "triangle", gain: 0.09 });
  },
  /** Subtle hover tick for choice/dice buttons. */
  hoverTick() {
    tone({ freq: 1250, dur: 0.03, type: "sine", gain: 0.025 });
  },
  /** Rattling dice: a burst of filtered noise ticks. */
  diceRoll() {
    for (let i = 0; i < 7; i++) {
      noise({ dur: 0.045, gain: 0.09, delay: i * 0.065, filterFreq: 2800 + Math.random() * 2200 });
    }
  },
  /** Dice settle: "high" = nat 20 fanfare, "low" = nat 1 buzz. */
  diceSettle(crit) {
    if (crit === "high") {
      Sfx.fanfare();
    } else if (crit === "low") {
      Sfx.errorBuzz();
    } else {
      tone({ freq: 520, freqEnd: 780, dur: 0.12, type: "triangle", gain: 0.11 });
    }
  },
  /** Bright major-arpeggio chime for saves / wins. */
  successChime() {
    tone({ freq: 523.25, dur: 0.12, type: "sine", gain: 0.11 });
    tone({ freq: 659.25, dur: 0.12, type: "sine", gain: 0.11, delay: 0.09 });
    tone({ freq: 783.99, dur: 0.22, type: "sine", gain: 0.12, delay: 0.18 });
  },
  /** Low sawtooth buzz for errors / fumbles. */
  errorBuzz() {
    tone({ freq: 170, freqEnd: 105, dur: 0.28, type: "sawtooth", gain: 0.09 });
    tone({ freq: 120, freqEnd: 90, dur: 0.28, type: "square", gain: 0.04, delay: 0.02 });
  },
  /** Airy whoosh for screen transitions / sends. */
  whoosh() {
    noise({ dur: 0.35, gain: 0.09, filterFreq: 850, type: "bandpass" });
    tone({ freq: 190, freqEnd: 620, dur: 0.3, type: "sine", gain: 0.035 });
  },
  /** Triumphant four-note fanfare. */
  fanfare() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.2, type: "triangle", gain: 0.12, delay: i * 0.11 })
    );
    noise({ dur: 0.5, gain: 0.03, filterFreq: 6000, type: "highpass", delay: 0.3 });
  },
  /** Rising chiptune arpeggio for quest completion / level-ups. */
  levelUp() {
    [440, 554.37, 659.25, 880, 1108.7].forEach((f, i) =>
      tone({ freq: f, dur: 0.14, type: "square", gain: 0.045, delay: i * 0.07 })
    );
  },
};
