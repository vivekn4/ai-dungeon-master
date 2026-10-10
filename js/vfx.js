// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Vfx — canvas particle-effects engine. Zero dependencies.
 *
 * - Ambient particles matching the app theme ("ember" or "dust").
 * - One-shot effects: confetti(), sparkle(), shake().
 * - Auto-quality: fewer particles on small screens / high-DPI.
 * - Honors prefers-reduced-motion (effects become no-ops).
 * - Safe to import in Node (everything becomes a no-op outside a browser).
 *
 * Usage:
 *   import { Vfx } from "./vfx.js";
 *   Vfx.init({ mode: "ember" });
 *   Vfx.confetti(window.innerWidth / 2, 140);
 *   Vfx.sparkle(x, y);
 *   Vfx.shake(10, 350);
 */

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

let canvas = null;
let ctx = null;
let rafId = 0;
let running = false;
let mode = "ember";
let reducedMotion = false;
let ambient = [];
let bursts = [];
let lastT = 0;

const PALETTES = {
  ember: ["#ff9d4d", "#ff7b2e", "#ffc46b", "#e0552e", "#ffd98a"],
  dust: ["#e8c96a", "#d4af37", "#f5e3a8", "#c9a227", "#fff3c4"],
  confetti: ["#f0d060", "#c9a227", "#b03a2e", "#7b5fc7", "#3fa34d", "#ffffff"],
};

/**
 * Pure function: how many ambient particles for this viewport.
 * Exported for unit tests.
 */
export function computeParticleCount(width, dpr) {
  let n = 70;
  if (width < 640) n = 32;
  else if (width < 1100) n = 52;
  if (dpr > 2) n = Math.floor(n * 0.6);
  else if (dpr > 1.5) n = Math.floor(n * 0.8);
  return n;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeAmbientParticle(w, h) {
  if (mode === "ember") {
    return {
      kind: "ember",
      x: rand(0, w),
      y: rand(h * 0.4, h + 20),
      vx: rand(-12, 12),
      vy: rand(-46, -16),
      size: rand(1.5, 4.2),
      life: rand(4, 9),
      age: 0,
      color: pick(PALETTES.ember),
      flick: rand(0, Math.PI * 2),
    };
  }
  // golden dust motes: slow drift, gentle twinkle
  return {
    kind: "dust",
    x: rand(0, w),
    y: rand(0, h),
    vx: rand(-9, 9),
    vy: rand(-11, -3),
    size: rand(1, 3),
    life: rand(6, 12),
    age: 0,
    color: pick(PALETTES.dust),
    flick: rand(0, Math.PI * 2),
  };
}

function resize() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function step(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // ambient particles
  for (let i = ambient.length - 1; i >= 0; i--) {
    const p = ambient[i];
    p.age += dt;
    if (p.age >= p.life) {
      ambient[i] = makeAmbientParticle(w, h);
      continue;
    }
    p.x += (p.vx + Math.sin(p.age * 2 + p.flick) * 10) * dt;
    p.y += p.vy * dt;
    const fade = Math.sin((p.age / p.life) * Math.PI);
    const tw = 0.55 + 0.45 * Math.sin(t * 0.004 + p.flick);
    ctx.globalAlpha = Math.max(0, fade * tw * 0.8);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // one-shot bursts
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.age += dt;
    if (b.age >= b.life) {
      bursts.splice(i, 1);
      continue;
    }
    const k = b.age / b.life;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += (b.gravity || 0) * dt;
    b.rot += b.vr * dt;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.fillStyle = b.color;
    if (b.shape === "rect") {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      ctx.restore();
    } else if (b.shape === "streak") {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.05, b.y - b.vy * 0.05);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  rafId = requestAnimationFrame(step);
}

export const Vfx = {
  /**
   * Start the ambient particle layer.
   * @param {{mode?: "ember"|"dust", canvasId?: string}} opts
   * @returns {boolean} true if the layer is running
   */
  init(opts = {}) {
    if (!hasDom) return false;
    mode = opts.mode === "dust" ? "dust" : "ember";
    try {
      reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reducedMotion = false;
    }
    if (reducedMotion) return false; // honor reduced motion: no animation at all
    canvas = document.getElementById(opts.canvasId || "vfx-canvas");
    if (!canvas) return false;
    ctx = canvas.getContext("2d");
    if (!ctx) return false;
    resize();
    window.addEventListener("resize", resize);
    const n = computeParticleCount(window.innerWidth, window.devicePixelRatio || 1);
    ambient = [];
    for (let i = 0; i < n; i++) {
      const p = makeAmbientParticle(canvas.width, canvas.height);
      p.age = rand(0, p.life); // pre-warm so the screen isn't empty
      p.y = rand(0, canvas.height);
      ambient.push(p);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        running = false;
      } else if (!running && !reducedMotion) {
        running = true;
        lastT = performance.now();
        rafId = requestAnimationFrame(step);
      }
    });
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(step);
    return true;
  },

  stop() {
    running = false;
    if (hasDom) cancelAnimationFrame(rafId);
    ambient = [];
    bursts = [];
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  },

  /** Celebration explosion. */
  confetti(x, y, opts = {}) {
    if (!running || reducedMotion) return;
    const count = opts.count || 90;
    const colors = opts.colors || PALETTES.confetti;
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(120, 420);
      bursts.push({
        shape: "rect",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 160,
        gravity: 520,
        size: rand(5, 10),
        rot: rand(0, Math.PI * 2),
        vr: rand(-9, 9),
        life: rand(0.9, 1.8),
        age: 0,
        color: pick(colors),
      });
    }
  },

  /** Small star-burst for button clicks / pickups. */
  sparkle(x, y, opts = {}) {
    if (!running || reducedMotion) return;
    const count = opts.count || 14;
    const colors = opts.colors || (mode === "ember" ? PALETTES.ember : PALETTES.dust);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.2, 0.2);
      const sp = rand(60, 200);
      bursts.push({
        shape: "streak",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        gravity: 60,
        size: rand(2, 4),
        rot: 0,
        vr: 0,
        life: rand(0.35, 0.7),
        age: 0,
        color: pick(colors),
      });
    }
  },

  /** Screen shake — use for critical fumbles / heavy hits. */
  shake(power = 8, dur = 350) {
    if (!hasDom || reducedMotion) return;
    try {
      const start = performance.now();
      const frame = (t) => {
        const el = (t - start) / dur;
        if (el >= 1) {
          document.body.style.transform = "";
          return;
        }
        const m = power * (1 - el);
        const x = (Math.random() * 2 - 1) * m;
        const y = (Math.random() * 2 - 1) * m;
        document.body.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } catch {
      /* never break the page over a shake */
    }
  },
};
