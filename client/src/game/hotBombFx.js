/**
 * Canvas particle effects for «Гаряча бомба» (TV only): fuse sparks + smoke,
 * the bomb flying between players with a fire trail, and the explosion
 * (flash, fireball, shock rings, sparks, debris, smoke).
 *
 *   const fx = createHotBombFx(canvas)
 *   fx.setEmitter(() => ({ x, y, rate }) | null)  // called every frame (fuse end)
 *   fx.fly(from, to, ms)                          // {x,y} in canvas CSS pixels
 *   fx.explode(x, y, scale)
 *   fx.destroy()
 *
 * One requestAnimationFrame loop; the simulation stands still while the game
 * is paused (gameClock). Particle count is capped so a slow TV keeps 60fps.
 */
import gameClock from "./gameClock";

const MAX_PARTICLES = 900;
const rand = (a, b) => a + Math.random() * (b - a);

export function createHotBombFx(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0;
  let h = 0;
  let dpr = 1;
  let parts = [];
  let rings = [];
  let flashes = [];
  let flights = [];
  let emitter = null;
  let emitCarry = 0;
  let raf = 0;
  let last = performance.now();
  let alive = true;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width;
    h = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
  };
  resize();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);

  const add = (p) => {
    if (parts.length < MAX_PARTICLES) parts.push(p);
  };

  // ---------------------------------------------------------------- emitters

  function sparks(x, y, n, { speed = 160, spread = Math.PI * 2, dir = -Math.PI / 2, life = 0.6, hot = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(-spread / 2, spread / 2);
      const v = rand(0.35, 1) * speed;
      add({
        k: "spark",
        x,
        y,
        px: x,
        py: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.5, 1) * life,
        max: life,
        g: 260,
        size: rand(1.4, 3),
        hot,
      });
    }
  }

  function smoke(x, y, n, { size = 10, grow = 26, life = 1.4, vy = -38, dark = 0.5 } = {}) {
    for (let i = 0; i < n; i++) {
      add({
        k: "smoke",
        x: x + rand(-4, 4),
        y: y + rand(-4, 4),
        vx: rand(-14, 14),
        vy: vy * rand(0.6, 1.2),
        r: size * rand(0.7, 1.2),
        grow: grow * rand(0.7, 1.3),
        life: life * rand(0.7, 1.1),
        max: life,
        dark,
        rot: rand(0, Math.PI * 2),
      });
    }
  }

  function explode(x, y, scale = 1) {
    const s = Math.max(0.4, scale);
    flashes.push({ x, y, t: 0, max: 0.55, r: 520 * s });
    rings.push({ x, y, t: 0, max: 0.75, r: 380 * s, width: 22 * s, color: "255,220,140" });
    rings.push({ x, y, t: -0.12, max: 0.9, r: 520 * s, width: 10 * s, color: "255,140,60" });
    // fireball: big hot blobs that cool into smoke
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(30, 220) * s;
      add({ k: "fire", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * s, r: rand(26, 70) * s, grow: rand(30, 90) * s, life: rand(0.45, 0.9), max: 0.9 });
    }
    sparks(x, y, 170, { speed: 900 * s, life: 1.1, hot: 1 });
    for (let i = 0; i < 28; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(260, 720) * s;
      add({ k: "debris", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200 * s, rot: rand(0, 6.28), vr: rand(-14, 14), size: rand(4, 11) * s, life: rand(0.9, 1.6), max: 1.6, g: 900 });
    }
    smoke(x, y, 34, { size: 30 * s, grow: 70 * s, life: 2.6, vy: -70 * s, dark: 0.6 });
  }

  /** The bomb flies on an arc from `from` to `to`, spinning, leaving a fire trail. */
  function fly(from, to, ms = 520) {
    if (!from || !to) return;
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - Math.max(80, Math.abs(to.x - from.x) * 0.35);
    flights.push({ from, to, c: { x: mx, y: my }, t: 0, dur: ms / 1000, spin: rand(-12, 12) });
  }

  // ---------------------------------------------------------------- loop

  function update(dt) {
    // continuous emitter (the burning fuse end)
    const src = emitter ? emitter() : null;
    if (src) {
      emitCarry += src.rate * dt;
      const n = Math.floor(emitCarry);
      emitCarry -= n;
      if (n > 0) sparks(src.x, src.y, n, { speed: 120 + src.rate * 1.6, life: 0.5, spread: Math.PI * 1.4, dir: src.dir ?? -Math.PI / 2 });
      if (Math.random() < dt * (3 + src.rate * 0.05)) smoke(src.x, src.y - 4, 1, { size: 6, grow: 22, life: 1.6, vy: -46, dark: 0.35 });
    }

    for (const f of flights) {
      f.t += dt;
      const p = Math.min(1, f.t / f.dur);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const q = 1 - e;
      f.x = q * q * f.from.x + 2 * q * e * f.c.x + e * e * f.to.x;
      f.y = q * q * f.from.y + 2 * q * e * f.c.y + e * e * f.to.y;
      f.rot = f.spin * f.t;
      sparks(f.x, f.y, 3, { speed: 90, life: 0.45, hot: 1 });
      if (Math.random() < 0.6) smoke(f.x, f.y, 1, { size: 7, grow: 20, life: 0.9, vy: -20, dark: 0.45 });
    }
    flights = flights.filter((f) => {
      if (f.t < f.dur) return true;
      sparks(f.to.x, f.to.y, 26, { speed: 260, life: 0.5 });
      return false;
    });

    for (const p of parts) {
      p.life -= dt;
      if (p.k === "spark") {
        p.px = p.x;
        p.py = p.y;
        p.vy += p.g * dt;
        p.vx *= 1 - 1.2 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.k === "smoke" || p.k === "fire") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - 1.5 * dt;
        p.vy *= 1 - (p.k === "fire" ? 2.5 : 0.6) * dt;
        p.r += p.grow * dt;
        if (p.k === "fire" && p.life <= 0) {
          // a cooled fireball leaves smoke behind
          smoke(p.x, p.y, 1, { size: p.r * 0.6, grow: 30, life: 1.8, vy: -30, dark: 0.7 });
        }
      } else if (p.k === "debris") {
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }
    parts = parts.filter((p) => p.life > 0 && p.y < h + 60);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < r.max);
    for (const f of flashes) f.t += dt;
    flashes = flashes.filter((f) => f.t < f.max);
  }

  function drawMiniBomb(x, y, rot, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const g = ctx.createRadialGradient(-size * 0.35, -size * 0.35, size * 0.1, 0, 0, size);
    g.addColorStop(0, "#6b6f7b");
    g.addColorStop(0.5, "#24262d");
    g.addColorStop(1, "#060709");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a3d46";
    ctx.fillRect(-size * 0.25, -size * 1.18, size * 0.5, size * 0.32);
    ctx.strokeStyle = "#c9a46a";
    ctx.lineWidth = size * 0.16;
    ctx.beginPath();
    ctx.moveTo(0, -size * 1.15);
    ctx.quadraticCurveTo(size * 0.5, -size * 1.7, size * 0.9, -size * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // smoke first (under the fire)
    for (const p of parts) {
      if (p.k !== "smoke") continue;
      const a = Math.max(0, p.life / p.max) * 0.55;
      const c = Math.round(60 + (1 - p.dark) * 90);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${c},${c - 6},${c - 12},${a})`);
      g.addColorStop(1, `rgba(${c},${c - 6},${c - 12},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of parts) {
      if (p.k !== "debris") continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, p.life / 0.4);
      ctx.fillStyle = "#1a1b20";
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.fillStyle = "rgba(255,140,60,0.8)";
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size * 0.35, p.size * 0.2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    for (const f of flights) drawMiniBomb(f.x, f.y, f.rot, 22);

    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      if (p.k !== "fire") continue;
      const k = Math.max(0, p.life / p.max);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(255,${Math.round(200 + 55 * k)},${Math.round(120 * k)},${0.85 * k})`);
      g.addColorStop(0.45, `rgba(255,${Math.round(110 + 60 * k)},20,${0.55 * k})`);
      g.addColorStop(1, "rgba(160,30,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = "round";
    for (const p of parts) {
      if (p.k !== "spark") continue;
      const k = Math.max(0, p.life / p.max);
      ctx.strokeStyle = `rgba(255,${Math.round(150 + 105 * k)},${Math.round(60 + 140 * k * k)},${Math.min(1, k * 1.6)})`;
      ctx.lineWidth = p.size * (0.6 + k);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x + (p.x - p.px) * 0.6, p.y + (p.y - p.py) * 0.6);
      ctx.stroke();
    }
    for (const f of flashes) {
      const k = f.t / f.max;
      const r = f.r * Math.min(1, f.t / 0.12);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, `rgba(255,255,240,${1 - k})`);
      g.addColorStop(0.35, `rgba(255,200,90,${0.8 * (1 - k)})`);
      g.addColorStop(1, "rgba(255,90,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    for (const r of rings) {
      if (r.t < 0) continue;
      const k = r.t / r.max;
      ctx.strokeStyle = `rgba(${r.color},${(1 - k) * 0.9})`;
      ctx.lineWidth = r.width * (1 - k * 0.7);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * (0.15 + k * 0.85), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function loop(t) {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!gameClock.isPaused()) update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    setEmitter(fn) {
      emitter = fn;
    },
    sparks,
    smoke,
    explode,
    fly,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    },
  };
}
