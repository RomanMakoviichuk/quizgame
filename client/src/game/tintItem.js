import { useEffect, useState } from "react";

/**
 * «Меморі: кольоровий хаос» — one shared way to show an item in a colour.
 *
 * The picture is redrawn on a canvas: every pixel that carries the item's own
 * colour (saturated enough) gets the target hue, keeping its shading; white,
 * black, grey and metal parts (eyes, outlines, the cone's silver stripes) stay
 * as they are; transparent pixels stay transparent. The original files are
 * never changed. `color = null` turns the whole picture black-and-white (no hint).
 *
 * Results are cached per (picture, colour), so a colour is computed once.
 */

export const MEMORY_COLORS = {
  blue: { hue: 222, label: "Синій", css: "#2f6bff" },
  red: { hue: 358, label: "Червоний", css: "#ff2d44" },
  green: { hue: 128, label: "Зелений", css: "#22c55e" },
  yellow: { hue: 50, label: "Жовтий", css: "#ffd21f" },
};
export const COLOR_IDS = Object.keys(MEMORY_COLORS);

const MAX_SIDE = 360; // enough for a phone card / a TV slot, cheap to recolour
const cache = new Map(); // `${src}|${color}` -> Promise<string>

function loadImage(src, fallback) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (!fallback || img.src.endsWith(fallback)) return reject(new Error(`cannot load ${src}`));
      img.src = fallback;
    };
    img.src = src;
  });
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** HSV (h in degrees, s/v 0..1) -> [r, g, b] 0..1 */
function hsv(h, s, v) {
  const hh = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  return [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
}

function recolor(data, color) {
  const target = color ? MEMORY_COLORS[color] : null;
  if (!target) {
    // black-and-white: every pixel to its luminance, so no part hints at the colour
    for (let k = 0; k < data.length; k += 4) {
      const y = Math.round(0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]);
      data[k] = data[k + 1] = data[k + 2] = y;
    }
    return;
  }
  for (let k = 0; k < data.length; k += 4) {
    if (data[k + 3] === 0) continue;
    const r = data[k] / 255;
    const g = data[k + 1] / 255;
    const b = data[k + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const v = mx;
    const s = mx > 0 ? (mx - mn) / mx : 0;
    // how much this pixel is "the item's colour" (soft edges, no halos)
    const w = clamp01((s - 0.18) / 0.17) * clamp01((v - 0.08) / 0.12);
    if (w === 0) continue;
    let vv = v;
    if (color === "yellow") vv = 0.38 + 0.62 * v; // dark yellow turns olive otherwise
    else if (color === "blue") vv = Math.min(1, v * 1.05);
    const [nr, ng, nb] = hsv(target.hue, Math.max(s, 0.72), vv);
    data[k] = Math.round((r * (1 - w) + nr * w) * 255);
    data[k + 1] = Math.round((g * (1 - w) + ng * w) * 255);
    data[k + 2] = Math.round((b * (1 - w) + nb * w) * 255);
  }
}

/** A data URL of `item` painted `color` (null = black-and-white). Cached. */
export function tintedUrl(item, color) {
  if (!item?.src) return Promise.reject(new Error("no item"));
  const key = `${item.src}|${color || "none"}`;
  if (!cache.has(key)) {
    const job = loadImage(item.src, item.fallback).then((img) => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const pixels = ctx.getImageData(0, 0, w, h);
      recolor(pixels.data, color);
      ctx.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png");
    });
    job.catch(() => cache.delete(key)); // let a later render retry
    cache.set(key, job);
  }
  return cache.get(key);
}

/** Warm the cache (e.g. all four colours of every item on the phone). */
export function preloadTints(items, colors = [null, ...COLOR_IDS]) {
  (items || []).forEach((it) => colors.forEach((c) => tintedUrl(it, c).catch(() => {})));
}

/** <img> of an item in a colour; renders an empty box until it's ready. */
export function TintedItem({ item, color = null, className = "", alt = "" }) {
  const [url, setUrl] = useState(null);
  const src = item?.src;
  const fallback = item?.fallback;
  useEffect(() => {
    let alive = true;
    tintedUrl({ src, fallback }, color)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(fallback || src || null));
    return () => {
      alive = false;
    };
  }, [src, fallback, color]);
  return url ? <img className={className} src={url} alt={alt || item?.name || ""} draggable="false" /> : <span className={`${className} tint-loading`} />;
}
