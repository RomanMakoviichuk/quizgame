import { useEffect, useMemo, useRef, useState } from "react";
import "./MemoryMinigame.css";
import gameClock from "../game/gameClock";
import { COLOR_IDS, MEMORY_COLORS, TintedItem, preloadTints, tintedUrl } from "../game/tintItem";

/**
 * «Меморі: кольоровий хаос» (id: memory). Server-authoritative
 * (server/minigames/memory.js): the server picks the items, their colours and
 * the mode once, keeps the right answer and scores. This component renders.
 *
 * Events in:  mem:go { showAt, answerAt, endAt, serverNow, count, level, palette }
 *             mem:show { lineup: [{ id, name, src, fallback, color }] }   (TV only)
 *             mem:task { mode: "order" | "color", items, colors, answerAt, endAt }
 *             mem:progress { done, total }   mem:ack { locked }
 * Event out:  minigameEvent mem:answer { order | colors, final? }, mem:hello
 * Results:    results.memory { mode, max, lineup, answers, scores, ranked, topIds }
 */

const MUSIC = "/assets/minigames/items/background.mp3";
const MUSIC_VOLUME = 1; // level set by game/loudness.js
const SPRITE = (slot) => `/assets/images/Characters/alivecharacters/${slot >= 1 && slot <= 8 ? slot : 1}.png`;
const LOSE_SOUNDS = [1, 2, 3, 4].map((n) => `/assets/minigames/RPS/lose_${n}.mp3`);
const TICK_MS = 100;
// results scene: the right row flips in, then the scoreboard
const REVEAL = { BOARD: 3200, HOLD: 9000 };
const MODE_TEXT = {
  order: { tv: "РОЗСТАВ ПРЕДМЕТИ В ПРАВИЛЬНОМУ ПОРЯДКУ!", phone: "Розстав по порядку", icon: "🔀" },
  color: { tv: "ПРИГАДАЙ КОЛІР КОЖНОГО ПРЕДМЕТА!", phone: "Пригадай кольори", icon: "🎨" },
};

function sfx(src, volume = 0.6) {
  try {
    const a = new Audio(src);
    a.volume = volume;
    a.play().catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

function Title({ small }) {
  const word = "КОЛЬОРОВИЙ ХАОС";
  return (
    <header className={`mm-head ${small ? "small" : ""}`}>
      <h2 className="mm-title">МЕМОРІ</h2>
      <p className="mm-sub">
        {word.split("").map((ch, i) => (
          <span key={i} style={{ "--c": MEMORY_COLORS[COLOR_IDS[i % 4]].css, animationDelay: `${i * 0.07}s` }}>
            {ch}
          </span>
        ))}
      </p>
    </header>
  );
}

/** Drifting paint blobs in the four colours — the "chaos" backdrop. */
function Splash() {
  return (
    <div className="mm-splash" aria-hidden="true">
      {COLOR_IDS.map((c, i) => (
        <i key={c} className={`b${i}`} style={{ "--c": MEMORY_COLORS[c].css }} />
      ))}
      {Array.from({ length: 16 }, (_, i) => (
        <b key={i} style={{ "--c": MEMORY_COLORS[COLOR_IDS[i % 4]].css, "--x": `${(i * 53) % 100}%`, "--d": `${-i * 1.3}s`, "--t": `${9 + (i % 6)}s` }} />
      ))}
    </div>
  );
}

function TimeBar({ msLeft, totalMs, big }) {
  const frac = totalMs ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const secs = Math.ceil(msLeft / 1000);
  return (
    <div className={`mm-time ${big ? "big" : ""} ${secs <= 3 ? "hot" : ""}`}>
      <div className="mm-time-bar">
        <i style={{ transform: `scaleX(${frac})` }} />
      </div>
      <b key={secs <= 3 ? secs : "t"}>{secs}</b>
    </div>
  );
}

const ColorDot = ({ color, small }) => (
  <i className={`mm-dot ${small ? "small" : ""}`} style={{ "--c": color ? MEMORY_COLORS[color].css : "transparent" }} title={color ? MEMORY_COLORS[color].label : "—"} />
);

function Lives({ n }) {
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return <p className="mm-lives dead">💀 Життів не лишилось — тепер ти привид</p>;
  return (
    <div className="mm-lives">
      <span>Залишилось життів</span>
      <b>{"❤".repeat(Math.min(10, n))}</b>
    </div>
  );
}

// ---------------------------------------------------------------- component

export default function MemoryMinigame({
  socket,
  uiMode = "mobile",
  isActive,
  myPlayerId,
  namesById = {},
  slotsById = {},
  contestantIds = [],
  results,
  onSceneDone,
  onVideoStartedAt,
}) {
  const isDisplay = uiMode === "display";
  const [go, setGo] = useState(null); // { showAt, answerAt, endAt, offset, count }
  const [lineup, setLineup] = useState(null); // TV: the coloured row
  const [task, setTask] = useState(null); // { mode, items, colors }
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [locked, setLocked] = useState(false);
  const [order, setOrder] = useState([]); // phone, order mode: item ids per slot (null = empty)
  const [colors, setColors] = useState([]); // phone, colour mode: colour per item
  const [, setTick] = useState(0);
  const revealT0 = useRef(null);
  const sceneDoneRef = useRef(false);
  const soundRef = useRef({});

  useEffect(() => {
    if (!isDisplay || !isActive || !onVideoStartedAt) return;
    const t = gameClock.setTimeout(() => onVideoStartedAt(), 300);
    return () => gameClock.clearTimeout(t);
  }, [isDisplay, isActive, onVideoStartedAt]);

  useEffect(() => {
    if (!socket) return;
    const offsetOf = (d) => Number(d?.serverNow ?? gameClock.now()) - gameClock.now();
    const onGo = (d) => {
      if (!d || !Number.isFinite(Number(d.showAt))) return;
      setGo({
        showAt: +d.showAt,
        answerAt: +d.answerAt,
        endAt: +d.endAt,
        count: +d.count || 5,
        level: d.level || null,
        palette: Array.isArray(d.palette) && d.palette.length ? d.palette : COLOR_IDS,
        offset: offsetOf(d),
      });
    };
    const onShow = (d) => {
      if (Array.isArray(d?.lineup)) {
        setLineup(d.lineup);
        d.lineup.forEach((it) => tintedUrl(it, it.color).catch(() => {}));
      }
    };
    const onTask = (d) => {
      if (!d?.mode || !Array.isArray(d.items)) return;
      setTask(d);
      setOrder((o) => (o.length === d.items.length ? o : Array(d.items.length).fill(null)));
      setColors((c) => (c.length === d.items.length ? c : Array(d.items.length).fill(null)));
      if (d.mode === "color") preloadTints(d.items, [null, ...(d.colors || COLOR_IDS)]); // the picture changes as the player picks
      else d.items.forEach((it) => tintedUrl(it, it.color || null).catch(() => {}));
    };
    const onProgress = (d) => setProgress({ done: +d?.done || 0, total: +d?.total || 0 });
    const onAck = (d) => d?.locked && setLocked(true);
    socket.on("mem:go", onGo);
    socket.on("mem:show", onShow);
    socket.on("mem:task", onTask);
    socket.on("mem:progress", onProgress);
    socket.on("mem:ack", onAck);
    return () => {
      socket.off("mem:go", onGo);
      socket.off("mem:show", onShow);
      socket.off("mem:task", onTask);
      socket.off("mem:progress", onProgress);
      socket.off("mem:ack", onAck);
    };
  }, [socket]);

  const amContestant = contestantIds.includes(myPlayerId);
  useEffect(() => {
    if (isDisplay || !isActive || !socket || !amContestant) return;
    socket.emit("minigameEvent", { name: "mem:hello", data: {} });
  }, [isDisplay, isActive, socket, amContestant]);

  useEffect(() => {
    const id = gameClock.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => gameClock.clearInterval(id);
  }, []);

  const isResults = !!results && results.minigameId === "memory" && !!results.memory;
  if (isResults && revealT0.current == null) revealT0.current = gameClock.now();
  const sinceReveal = isResults ? gameClock.now() - revealT0.current : 0;

  const now = go ? gameClock.now() + go.offset : 0;
  const phase = !go ? "wait" : now < go.showAt ? "prep" : now < go.answerAt ? "show" : now < go.endAt ? "answer" : "over";
  const countdown = phase === "prep" ? Math.max(1, Math.ceil((go.showAt - now) / 1000)) : null;
  const showLeft = go ? Math.max(0, go.answerAt - now) : 0;
  const answerLeft = go ? Math.max(0, go.endAt - now) : 0;

  // ---------------------------------------------------------------- sounds (TV)
  const musicOn = isDisplay && (isActive || isResults);
  useEffect(() => {
    if (!musicOn) return undefined;
    const a = new Audio(MUSIC);
    a.loop = true;
    a.volume = MUSIC_VOLUME;
    const play = () => a.play().catch(() => {});
    if (!gameClock.isPaused()) play();
    const unsub = gameClock.subscribe((paused) => (paused ? a.pause() : play()));
    return () => {
      unsub();
      const fade = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - MUSIC_VOLUME / 8);
        if (a.volume <= 0.001) {
          window.clearInterval(fade);
          a.pause();
        }
      }, 80);
    };
  }, [musicOn]);
  const soundKey = !isDisplay
    ? null
    : phase === "prep" && countdown <= 3
      ? `c${countdown}`
      : phase === "show"
        ? "show"
        : phase === "answer"
          ? Math.ceil(answerLeft / 1000) <= 3
            ? `e${Math.ceil(answerLeft / 1000)}`
            : "answer"
          : null;
  useEffect(() => {
    if (!soundKey || soundRef.current[soundKey]) return;
    soundRef.current[soundKey] = true;
    if (soundKey === "show") {
      sfx("/assets/sounds/bell.mp3", 0.45);
      for (let i = 0; i < 5; i++) gameClock.setTimeout(() => sfx("/assets/sounds/click-sound.mp3", 0.35), 150 + i * 140);
    } else if (soundKey === "answer") sfx("/assets/sounds/notification.mp3", 0.45);
    else sfx("/assets/sounds/beep.mp3", 0.4);
  }, [soundKey]);

  const amLoser = isResults && (results.loserIds || []).includes(myPlayerId);
  const revealStage = isResults ? (sinceReveal < REVEAL.BOARD ? 0 : 1) : null;
  useEffect(() => {
    if (revealStage == null || soundRef.current[`r${revealStage}`]) return;
    soundRef.current[`r${revealStage}`] = true;
    if (isDisplay && revealStage === 0) sfx("/assets/sounds/result.mp3", 0.45);
    if (revealStage === 1) {
      if (isDisplay) {
        sfx("/assets/sounds/win.mp3", 0.35);
        if ((results.loserIds || []).length) gameClock.setTimeout(() => sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8), 1500);
      } else if (amLoser) sfx(LOSE_SOUNDS[Math.floor(Math.random() * 4)], 0.8);
    }
  }, [revealStage, isDisplay, amLoser, results]);
  useEffect(() => {
    if (!isResults || !isDisplay || sceneDoneRef.current) return;
    const t = gameClock.setTimeout(() => {
      sceneDoneRef.current = true;
      onSceneDone?.();
    }, REVEAL.BOARD + REVEAL.HOLD);
    return () => gameClock.clearTimeout(t);
  }, [isResults, isDisplay, onSceneDone]);

  // ---------------------------------------------------------------- phone answers
  const send = (answer, final = false) => socket?.emit("minigameEvent", { name: "mem:answer", data: { ...answer, final } });
  const canAnswer = phase === "answer" && !locked && !!task;
  const placeItem = (id) => {
    if (!canAnswer) return;
    const i = order.indexOf(null);
    if (i < 0 || order.includes(id)) return;
    const next = [...order];
    next[i] = id;
    setOrder(next);
    send({ order: next });
  };
  const unplace = (slot) => {
    if (!canAnswer || !order[slot]) return;
    const next = [...order];
    next[slot] = null;
    setOrder(next);
    send({ order: next });
  };
  const resetOrder = () => {
    if (!canAnswer) return;
    const next = order.map(() => null);
    setOrder(next);
    send({ order: next });
  };
  const pickColor = (i, c) => {
    if (!canAnswer) return;
    const next = [...colors];
    next[i] = c;
    setColors(next);
    send({ colors: next });
  };
  const confirm = () => {
    if (!canAnswer) return;
    send(task.mode === "order" ? { order } : { colors }, true);
  };
  const itemById = useMemo(() => Object.fromEntries((task?.items || []).map((it) => [it.id, it])), [task]);

  const nm = (id) => namesById[id] || "Гравець";
  const cls = `mm-root ${isDisplay ? "mm-display" : "mm-mobile"}`;

  // ================================================================== results
  if (isResults) {
    const m = results.memory;
    const loserIds = results.loserIds || [];
    const allEqual = loserIds.length === 0;
    const place = (id) => 1 + m.ranked.filter((x) => m.scores[x] > m.scores[id]).length;

    if (!isDisplay) {
      if (!m.ranked.includes(myPlayerId)) {
        return (
          <section className={cls}>
            <Splash />
            <Title small />
            <p className="mm-muted">Дивись результати на головному екрані!</p>
          </section>
        );
      }
      const score = m.scores[myPlayerId] || 0;
      const lost = loserIds.includes(myPlayerId);
      const top = m.topIds.includes(myPlayerId);
      return (
        <section className={`${cls} ${revealStage === 1 ? (lost ? "lost" : top ? "won" : "") : ""}`}>
          <Splash />
          <Title small />
          {revealStage === 0 ? (
            <p className="mm-big">Дивись на екран…</p>
          ) : (
            <>
              <p className="mm-score">
                <b>{score}</b>/{m.max}
              </p>
              <p className="mm-place">
                {place(myPlayerId)} місце з {m.ranked.length}
              </p>
              <p className={`mm-big ${lost ? "bad" : top ? "good" : ""}`}>{lost ? "МІНУС ЖИТТЯ" : top ? "НАЙКРАЩА ПАМ'ЯТЬ!" : allEqual ? "НІЧИЯ — ВСІ ЖИВІ" : "ТИ В БЕЗПЕЦІ"}</p>
              {lost && (
                <>
                  <p className="mm-life">−1 ❤</p>
                  {/* the server takes the life only after this scene, so count it in here */}
                  <Lives n={Number(results.livesById?.[myPlayerId]) - 1} />
                </>
              )}
              <div className="mm-mini-row">
                {m.lineup.map((it) => (
                  <TintedItem key={it.id} item={it} color={it.color} className="mm-mini-item" />
                ))}
              </div>
            </>
          )}
        </section>
      );
    }

    // TV: the right answer, then the scoreboard
    return (
      <section className={`${cls} mm-results stage-${revealStage}`}>
        <Splash />
        <div className="mm-results-top">
          <Title small />
          <p className="mm-answer-label">
            {MODE_TEXT[m.mode].icon} Правильна відповідь · {m.mode === "order" ? "порядок" : "кольори"}
            {m.level ? ` · ${m.level.name.toLowerCase()} рівень` : ""}
          </p>
        </div>
        <div className="mm-row reveal">
          {m.lineup.map((it, i) => (
            <div key={it.id} className="mm-card shown" style={{ "--i": i, "--c": MEMORY_COLORS[it.color].css }}>
              <span className="mm-num">{i + 1}</span>
              <TintedItem item={it} color={it.color} className="mm-item" />
              <span className="mm-name">{it.name}</span>
            </div>
          ))}
        </div>
        {revealStage === 1 && (
          <div className="mm-board">
            {m.ranked.map((id, k) => {
              const ans = m.answers[id];
              const lost = loserIds.includes(id);
              const top = m.topIds.includes(id);
              return (
                <div key={id} className={`mm-board-row ${lost ? "lost" : ""} ${top ? "top" : ""}`} style={{ "--k": k }}>
                  <span className="mm-board-place">{place(id)}</span>
                  <img className="mm-board-ava" src={SPRITE(slotsById[id])} alt="" />
                  <span className="mm-board-name">
                    {top && "👑 "}
                    {nm(id)}
                  </span>
                  <span className="mm-board-answer">
                    {m.lineup.map((it, i) => {
                      if (m.mode === "order") {
                        const got = ans?.order?.[i] || null;
                        const gotItem = got ? m.lineup.find((x) => x.id === got) : null;
                        const ok = got === it.id;
                        return (
                          <span key={i} className={`mm-cell ${ok ? "ok" : "bad"}`}>
                            {gotItem ? <TintedItem item={gotItem} color={gotItem.color} className="mm-cell-item" /> : <em>—</em>}
                          </span>
                        );
                      }
                      const got = ans?.colors?.[i] || null;
                      const ok = got === it.color;
                      return (
                        <span key={i} className={`mm-cell ${ok ? "ok" : "bad"}`}>
                          {got ? <ColorDot color={got} /> : <em>—</em>}
                        </span>
                      );
                    })}
                  </span>
                  <span className="mm-board-score">
                    <b>{m.scores[id]}</b>/{m.max}
                  </span>
                  {lost && <span className="mm-board-minus">−1 ❤</span>}
                </div>
              );
            })}
            <p className={`mm-verdict ${allEqual ? "draw" : ""}`}>
              {allEqual
                ? "Однаковий результат у всіх — ніхто не втрачає життя!"
                : `Найслабша пам'ять: ${loserIds.map(nm).join(", ")} — мінус життя!`}
            </p>
          </div>
        )}
      </section>
    );
  }

  // ================================================================== phone
  if (!isDisplay) {
    if (!amContestant) {
      return (
        <section className={cls}>
          <Splash />
          <Title />
          <p className="mm-muted">Ти відповів правильно — цього разу ти глядач. Дивись на головний екран!</p>
        </section>
      );
    }
    if (phase === "wait" || phase === "prep") {
      return (
        <section className={cls}>
          <Splash />
          <Title />
          <div className="mm-phone-hint">
            <b>👀 Дивись на головний екран</b>
            <span>Запам'ятай предмети, їхній порядок і кольори. Потім — завдання на телефоні.</span>
            {go?.level && (
              <span className="mm-phone-palette">
                {go.level.name} рівень:{" "}
                {(go.palette || COLOR_IDS).map((c) => (
                  <ColorDot key={c} color={c} small />
                ))}
              </span>
            )}
          </div>
          {countdown != null && countdown <= 3 && (
            <div className="mm-countdown" key={countdown}>
              {countdown}
            </div>
          )}
        </section>
      );
    }
    if (phase === "show") {
      return (
        <section className={`${cls} mm-phone-watch`}>
          <Splash />
          <div className="mm-eyes" aria-hidden="true">
            <i />
            <i />
          </div>
          <p className="mm-big">ДИВИСЬ НА ЕКРАН!</p>
          <TimeBar msLeft={showLeft} totalMs={go.answerAt - go.showAt} />
        </section>
      );
    }
    if (!task) {
      return (
        <section className={cls}>
          <Splash />
          <p className="mm-muted">Завантаження завдання…</p>
        </section>
      );
    }
    const done = task.mode === "order" ? order.every(Boolean) : colors.every(Boolean);
    const head = (
      <div className="mm-phone-head">
        <span className="mm-phone-mode">
          {MODE_TEXT[task.mode].icon} {MODE_TEXT[task.mode].phone}
        </span>
        <TimeBar msLeft={answerLeft} totalMs={go.endAt - go.answerAt} />
      </div>
    );
    if (locked || phase === "over") {
      return (
        <section className={`${cls} mm-phone-locked`}>
          <Splash />
          {head}
          <div className="mm-lock-card">
            <span className="mm-lock-icon">{locked ? "✅" : "⏰"}</span>
            <b>{locked ? "Відповідь прийнята!" : "Час вийшов"}</b>
            <small>{locked ? "Чекаємо на інших…" : "Зараховано те, що встиг"}</small>
          </div>
          <div className="mm-mini-row">
            {task.mode === "order"
              ? order.map((id, i) => (id ? <TintedItem key={i} item={itemById[id]} color={itemById[id]?.color} className="mm-mini-item" /> : <span key={i} className="mm-mini-empty">?</span>))
              : task.items.map((it, i) => <TintedItem key={it.id} item={it} color={colors[i]} className="mm-mini-item" />)}
          </div>
        </section>
      );
    }
    if (task.mode === "order") {
      return (
        <section className={`${cls} mm-phone-order`}>
          <Splash />
          {head}
          <div className="mm-slots">
            {order.map((id, i) => (
              <button key={i} type="button" className={`mm-slot ${id ? "filled" : ""}`} onClick={() => unplace(i)} aria-label={`Позиція ${i + 1}`}>
                <span className="mm-slot-num">{i + 1}</span>
                {id && <TintedItem item={itemById[id]} color={itemById[id]?.color} className="mm-slot-item" />}
              </button>
            ))}
          </div>
          <p className="mm-tip">Тисни предмети по черзі: перший → у позицію 1. Тисни на позицію, щоб прибрати.</p>
          <div className="mm-pool">
            {task.items.map((it) => {
              const used = order.includes(it.id);
              return (
                <button key={it.id} type="button" className={`mm-pick ${used ? "used" : ""}`} disabled={used} onClick={() => placeItem(it.id)}>
                  <TintedItem item={it} color={it.color} className="mm-pick-item" />
                </button>
              );
            })}
          </div>
          <div className="mm-actions">
            <button type="button" className="mm-btn ghost" onClick={resetOrder} disabled={!order.some(Boolean)} aria-label="Скинути" title="Скинути">
              ↺
            </button>
            <button type="button" className="mm-btn" onClick={confirm} disabled={!done}>
              ПІДТВЕРДИТИ
            </button>
          </div>
        </section>
      );
    }
    return (
      <section className={`${cls} mm-phone-color`}>
        <Splash />
        {head}
        <div className="mm-color-rows">
          {task.items.map((it, i) => (
            <div key={it.id} className={`mm-color-row ${colors[i] ? "set" : ""}`}>
              <span className="mm-row-num">{i + 1}</span>
              <TintedItem item={it} color={colors[i]} className="mm-color-item" />
              <div className={`mm-swatches n${(task.colors || COLOR_IDS).length}`}>
                {(task.colors || COLOR_IDS).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`mm-swatch ${colors[i] === c ? "on" : ""}`}
                    style={{ "--c": MEMORY_COLORS[c].css }}
                    onClick={() => pickColor(i, c)}
                    aria-label={`${it.name}: ${MEMORY_COLORS[c].label}`}
                    title={MEMORY_COLORS[c].label}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mm-actions">
          <button type="button" className="mm-btn" onClick={confirm} disabled={!done}>
            ПІДТВЕРДИТИ
          </button>
        </div>
      </section>
    );
  }

  // ================================================================== TV
  if (phase === "wait" || phase === "prep") {
    return (
      <section className={`${cls} mm-prep`}>
        <Splash />
        <Title />
        <div className="mm-rules">
          <div className="mm-rule" style={{ "--i": 0 }}>
            <b>👀</b>
            <span>
              Запам'ятай <u>предмети</u>, їхній <u>порядок</u> і <u>кольори</u>
              {go ? ` — ${Math.round((go.answerAt - go.showAt) / 1000)} секунд` : ""}
            </span>
          </div>
          <div className="mm-rule" style={{ "--i": 1 }}>
            <b>🎲</b>
            <span>
              Потім випадкове завдання: <u>розставити по порядку</u> або <u>пригадати кольори</u>
            </span>
          </div>
          <div className="mm-rule" style={{ "--i": 2 }}>
            <b>⭐</b>
            <span>+1 бал за кожну правильну позицію{go ? ` · ${Math.round((go.endAt - go.answerAt) / 1000)} секунд на відповідь` : ""}</span>
          </div>
          <div className="mm-rule bad" style={{ "--i": 3 }}>
            <b>💀</b>
            <span>Найменше балів — мінус життя. Однаково в усіх — ніхто не програє</span>
          </div>
        </div>
        <div className="mm-level">
          {go?.level && (
            <span className={`mm-level-badge ${go.level.id}`}>
              Рівень: {go.level.name} · {go.level.colors} кольори
            </span>
          )}
          <div className="mm-palette">
            {(go?.palette || COLOR_IDS).map((c) => (
              <span key={c} style={{ "--c": MEMORY_COLORS[c].css }}>
                {MEMORY_COLORS[c].label}
              </span>
            ))}
          </div>
        </div>
        {countdown != null && countdown <= 3 ? (
          <div className="mm-countdown" key={countdown}>
            {countdown}
          </div>
        ) : (
          <p className="mm-getready">{countdown != null ? `Приготуйтесь… ${countdown}` : "Готуємо предмети…"}</p>
        )}
      </section>
    );
  }

  if (phase === "show") {
    return (
      <section className={`${cls} mm-show`}>
        <Splash />
        <p className="mm-banner">ЗАПАМ'ЯТАЙ ПРЕДМЕТИ ТА ЇХНІ КОЛЬОРИ!</p>
        <div className="mm-row">
          {(lineup || []).map((it, i) => (
            <div key={it.id} className="mm-card shown" style={{ "--i": i, "--c": MEMORY_COLORS[it.color].css }}>
              <span className="mm-num">{i + 1}</span>
              <TintedItem item={it} color={it.color} className="mm-item" />
            </div>
          ))}
        </div>
        <TimeBar msLeft={showLeft} totalMs={go.answerAt - go.showAt} big />
      </section>
    );
  }

  // answer phase (and the moment between its end and the results)
  const mode = task?.mode;
  return (
    <section className={`${cls} mm-answer`}>
      <Splash />
      <p className="mm-banner mode" key={mode || "x"}>
        {mode ? `${MODE_TEXT[mode].icon} ${MODE_TEXT[mode].tv}` : "…"}
      </p>
      <div className="mm-row">
        {Array.from({ length: go.count }, (_, i) => {
          const it = mode === "color" ? task.items[i] : null;
          return (
            <div key={i} className={`mm-card hidden ${it ? "grey" : ""}`} style={{ "--i": i }}>
              <span className="mm-num">{i + 1}</span>
              {it ? <TintedItem item={it} color={null} className="mm-item" /> : <span className="mm-q">?</span>}
            </div>
          );
        })}
      </div>
      <TimeBar msLeft={phase === "answer" ? answerLeft : 0} totalMs={go.endAt - go.answerAt} big />
      <div className="mm-progress">
        {contestantIds.map((id) => (
          <span key={id} className="mm-player">
            <img src={SPRITE(slotsById[id])} alt="" />
            <b>{nm(id)}</b>
          </span>
        ))}
        <em>
          Готово: {progress.done}/{progress.total || contestantIds.length}
        </em>
      </div>
    </section>
  );
}
