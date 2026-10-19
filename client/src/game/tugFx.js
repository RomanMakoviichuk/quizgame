/**
 * Canvas effects for «Перетягни канат» (TV only): drifting torch embers, dust
 * kicked up by the pullers' feet, floating "+N" jerk counters, sparks on the
 * rope knot and the winners' confetti.
 *
 *   const fx = createTugFx(canvas)
 *   fx.dust(x, y, dir, power)        // dir -1 = kick to the left, 1 = right
 *   fx.text(x, y, str, color)
 *   fx.sparks(x, y, n, color)
 *   fx.confetti(colors, n)
 *   fx.setEmbers(on)
 *   fx.destroy()
 *
 * Coordinates are canvas CSS pixels. The simulation stands still while the
 * game is paused (gameClock); particle count is capped to keep 60fps.
 */
import gameClock from "./gameClock";

const MAX_PARTICLES = 700;
const rand = (a, b) => a + Math.random() * (b - a);

export function createTugFx(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0;
  let h = 0;
  let dpr = 1;
  let parts = [];
  let embers = true;
  let emberCarry = 0;
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

  function dust(x, y, dir = 0, power = 1) {
    const n = Math.round(5 + power * 7);
    for (let i = 0; i < n; i++) {
      add({
        k: "dust",
        x: x + rand(-14, 14),
        y: y + rand(-4, 4),
        vx: dir * rand(30, 140) * power + rand(-25, 25),
        vy: -rand(10, 70) * power,
        r: rand(8, 20),
        grow: rand(26, 50),
        life: rand(0.6, 1.1),
        age: 0,
        tone: rand(0, 1),
      });
    }
    for (let i = 0; i < n; i++) {
      add({ k: "clod", x, y: y - 4, vx: dir * rand(60, 220) + rand(-40, 40), vy: -rand(90, 260), r: rand(1.5, 3.5), life: rand(0.5, 0.9), age: 0 });
    }
  }

  function text(x, y, str, color) {
    add({ k: "text", x, y, vx: rand(-12, 12), vy: -70, str, color, life: 0.9, age: 0 });
  }

  function sparks(x, y, n = 14, color = "#ffd36b") {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(80, 300);
      add({ k: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: rand(0.3, 0.7), age: 0, color });
    }
  }

  function confetti(colors, n = 180) {
    for (let i = 0; i < n; i++) {
      add({
        k: "conf",
        x: rand(0, w),
        y: rand(-h * 0.5, -10),
        vx: rand(-40, 40),
        vy: rand(80, 220),
        rot: rand(0, Math.PI * 2),
        vr: rand(-8, 8),
        sw: rand(6, 12),
        sh: rand(10, 18),
        phase: rand(0, Math.PI * 2),
        color: colors[i % colors.length],
        life: rand(3.5, 6),
        age: 0,
      });
    }
  }

  function update(dt) {
    if (embers) {
      emberCarry += dt * 9;
      while (emberCarry >= 1) {
        emberCarry -= 1;
        // torches stand at ~20% / ~80% of the width and in the stands
        const sx = [0.2, 0.31, 0.4, 0.6, 0.69, 0.8, rand(0, 1)][Math.floor(rand(0, 7))];
        add({ k: "ember", x: sx * w + rand(-30, 30), y: h * rand(0.3, 0.5), vx: rand(-15, 15), vy: -rand(25, 70), life: rand(2.5, 4.5), age: 0, r: rand(1, 2.4), phase: rand(0, 6) });
      }
    }
    const next = [];
    for (const p of parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      switch (p.k) {
        case "dust":
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 1 - 2.2 * dt;
          p.vy *= 1 - 2.2 * dt;
          p.r += p.grow * dt;
          break;
        case "clod":
        case "spark":
          p.vy += 620 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        case "text":
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy *= 1 - 1.5 * dt;
          break;
        case "ember":
          p.x += (p.vx + Math.sin(p.age * 2 + p.phase) * 18) * dt;
          p.y += p.vy * dt;
          break;
        case "conf":
          p.x += (p.vx + Math.sin(p.age * 3 + p.phase) * 40) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          break;
        default:
          break;
      }
      next.push(p);
    }
    parts = next;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      const t = p.age / p.life;
      switch (p.k) {
        case "dust": {
          const a = 0.42 * (1 - t);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          const c = p.tone > 0.5 ? "196,140,92" : "150,104,66";
          g.addColorStop(0, `rgba(${c},${a})`);
          g.addColorStop(1, `rgba(${c},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "clod":
          ctx.fillStyle = `rgba(90,56,30,${1 - t})`;
          ctx.fillRect(p.x, p.y, p.r, p.r);
          break;
        case "spark":
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case "text": {
          const s = Math.max(18, h * 0.035) * (t < 0.15 ? 0.6 + t * 2.6 : 1);
          ctx.globalAlpha = t > 0.6 ? (1 - t) / 0.4 : 1;
          ctx.font = `800 ${s}px Unbounded, Manrope, sans-serif`;
          ctx.textAlign = "center";
          ctx.lineWidth = 5;
          ctx.strokeStyle = "rgba(10,8,20,0.9)";
          ctx.strokeText(p.str, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.str, p.x, p.y);
          ctx.globalAlpha = 1;
          break;
        }
        case "ember": {
          const a = Math.sin(t * Math.PI) * (0.6 + 0.4 * Math.sin(p.age * 9 + p.phase));
          ctx.fillStyle = `rgba(255,${150 + Math.round(60 * (1 - t))},60,${Math.max(0, a)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "conf": {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.abs(Math.cos(p.age * 5 + p.phase)) + 0.15);
          ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.sw / 2, -p.sh / 2, p.sw, p.sh);
          ctx.restore();
          break;
        }
        default:
          break;
      }
    }
  }

  function frame(t) {
    if (!alive) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!gameClock.isPaused()) update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    dust,
    text,
    sparks,
    confetti,
    setEmbers(on) {
      embers = !!on;
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    },
  };
}
