import { useEffect, useMemo, useRef } from "react";
import FireTitle from "./FireTitle";
import gameClock from "../game/gameClock";
import "./WelcomePlayers.css";

/**
 * "Welcome, guests" on the TV between the rules and round 1 (~10s), to the
 * game's main theme. In the knitted style of the characters: a burlap wall, a
 * thread across it, and every player's fabric tag (character, name, lives)
 * drops onto the thread on a clothes-peg and gently swings; sewing buttons
 * keep raining down. The music and the picture fade out at the end.
 * CSS animations (frozen by the game pause) + game-clock timers.
 */
export const WELCOME_MS = 10000;
const MUSIC = "/assets/menu/music.mp3";
const MUSIC_VOLUME = 1; // level set by game/loudness.js
const FADE_OUT_MS = 1200;

const sprite = (slot) => `/assets/characters/alive/${slot >= 1 && slot <= 8 ? slot : 1}.png`;

const BUTTON_COLORS = ["#c0392b", "#e6b04a", "#3f7f8c", "#8e5aa8", "#5e8c3a", "#d9d2c5"];

export default function WelcomePlayers({ players = [], onDone, muted = false }) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    // the main theme: fades in, follows the game pause, fades out with the picture
    const a = new Audio(MUSIC);
    a.loop = true;
    a.volume = 0;
    a.muted = muted;
    let fade = null;
    const fadeTo = (target, ms) => {
      window.clearInterval(fade);
      const from = a.volume;
      const t0 = performance.now();
      fade = window.setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
        if (k >= 1) window.clearInterval(fade);
      }, 50);
    };
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    fadeTo(MUSIC_VOLUME, 1500);
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    const out = gameClock.setTimeout(() => fadeTo(0, FADE_OUT_MS), WELCOME_MS - FADE_OUT_MS);
    const end = gameClock.setTimeout(() => onDoneRef.current?.(), WELCOME_MS);
    return () => {
      unsub();
      gameClock.clearTimeout(out);
      gameClock.clearTimeout(end);
      window.clearInterval(fade);
      a.pause();
    };
    // one showing per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guests = players.slice(0, 8);
  // sewing buttons falling like confetti — positions fixed for this showing
  const buttons = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        x: Math.random() * 100,
        d: 0.6 + Math.random() * 4,
        s: 1.6 + Math.random() * 2.2,
        dur: 3.2 + Math.random() * 2.4,
        r: Math.round(Math.random() * 360),
        c: BUTTON_COLORS[i % BUTTON_COLORS.length],
      })),
    []
  );

  return (
    <div className="wp-root" style={{ "--wp-ms": `${WELCOME_MS}ms` }}>
      <div className="wp-burlap" style={{ backgroundImage: "url(/assets/ui/background-mobile.jpg)" }} aria-hidden />
      <div className="wp-light" aria-hidden />

      <header className="wp-head">
        <p className="wp-kicker">Сьогодні на вечірці</p>
        <div className="wp-title">
          <FireTitle text="ХТО Є ХТО!" />
        </div>
      </header>

      <div className="wp-line" aria-hidden />
      <div className="wp-tags" style={{ "--n": Math.max(1, guests.length) }}>
        {guests.map((p, i) => {
          const lives = Number.isFinite(p.lives) ? p.lives : 3;
          return (
            <div key={p.id || i} className="wp-tag-slot" style={{ "--i": i }}>
              <span className="wp-peg" aria-hidden />
              <div className="wp-tag">
                <img src={sprite(p.characterSlot || i + 1)} alt="" />
                <span className="wp-hello">Привіт, я</span>
                <b className="wp-name">{p.name}</b>
                <span className="wp-lives">{"❤".repeat(Math.max(0, Math.min(5, lives)))}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="wp-tagline">Ласкаво просимо! Хай переможе найрозумніше… або найхитріше створіння 😈</p>

      <div className="wp-buttons" aria-hidden>
        {buttons.map((b, i) => (
          <i
            key={i}
            style={{ "--x": `${b.x}%`, "--d": `${b.d}s`, "--s": `${b.s}vh`, "--dur": `${b.dur}s`, "--r": `${b.r}deg`, "--c": b.c }}
          />
        ))}
      </div>
      <div className="wp-blackout" aria-hidden />
    </div>
  );
}
