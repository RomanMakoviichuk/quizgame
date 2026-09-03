import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import HorrorTimer from "./components/HorrorTimer";
import TypewriterSubtitles from "./components/TypewriterSubtitles";
import { GAME_PHASE, TOTAL_ROUNDS } from "./game/constants";
import IntroScene from "./components/IntroScene";
import FireTitle from "./components/FireTitle";
import RoundIntro from "./components/RoundIntro";
import MinigameHost from "./components/MinigameHost";
import TrueFalseAftermath from "./components/TrueFalseAftermath";
import "./App.css";

const SOCKET_URL =
  process.env.REACT_APP_SERVER_URL ||
  (typeof window !== "undefined"
    ? `http://${window.location.hostname}:3001`
    : "http://localhost:3001");

const isMobile = () =>
  typeof window !== "undefined" &&
  (window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent));

const ROUND_DEBUG_STORAGE_KEY = "quizgame_round_debug";
const SCORES_DEBUG_STORAGE_KEY = "quizgame_scores_debug";

/** Максимум гравців у кімнаті (узгоджено з server/server.js MAX_PLAYERS) */
const MAX_ROOM_PLAYERS = 8;

const isDevEnvironment = () => {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "development") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

const readRoundDebugFlag = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("roundDebug");
  if (q === "1") {
    window.localStorage.setItem(ROUND_DEBUG_STORAGE_KEY, "1");
    return true;
  }
  if (q === "0") {
    window.localStorage.removeItem(ROUND_DEBUG_STORAGE_KEY);
    return false;
  }
  return window.localStorage.getItem(ROUND_DEBUG_STORAGE_KEY) === "1";
};

/** roundDebug=scores → екран підрахунку балів після 1 раунду */
const readRoundDebugScoresVariant = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("roundDebug");
  if (q === "scores") {
    window.localStorage.setItem(ROUND_DEBUG_STORAGE_KEY + "_scores", "1");
    return true;
  }
  if (q === "0" || q === "1") {
    window.localStorage.removeItem(ROUND_DEBUG_STORAGE_KEY + "_scores");
    return false;
  }
  return window.localStorage.getItem(ROUND_DEBUG_STORAGE_KEY + "_scores") === "1";
};

const readScoresDebugFlag = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("scoresDebug");
  if (q === "1") {
    window.localStorage.setItem(SCORES_DEBUG_STORAGE_KEY, "1");
    return true;
  }
  if (q === "0") {
    window.localStorage.removeItem(SCORES_DEBUG_STORAGE_KEY);
    return false;
  }
  return window.localStorage.getItem(SCORES_DEBUG_STORAGE_KEY) === "1";
};

/** Екран підрахунку балів: ?scoresDebug=1 або ?roundDebug=scores */
const isScoresDebugActive = () => readScoresDebugFlag() || readRoundDebugScoresVariant();

/** Сцена після міні-гри (aftermg + таблиця), лише дисплей: ?aftermathDebug=1 — відео зациклено, без переходу далі */
const AFTERMATH_DEBUG_STORAGE_KEY = "quizgame_aftermath_debug";
const readAftermathDebugFlag = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("aftermathDebug");
  if (q === "1") {
    window.localStorage.setItem(AFTERMATH_DEBUG_STORAGE_KEY, "1");
    return true;
  }
  if (q === "0") {
    window.localStorage.removeItem(AFTERMATH_DEBUG_STORAGE_KEY);
    return false;
  }
  return window.localStorage.getItem(AFTERMATH_DEBUG_STORAGE_KEY) === "1";
};

const AFTERMATH_DEBUG_MOCK = {
  minigameScores: {
    "dbg-1": 7,
    "dbg-3": 5,
    "dbg-2": 4,
    "dbg-4": 2,
  },
  namesById: {
    "dbg-1": "Гравець 1",
    "dbg-2": "Гравець 2",
    "dbg-3": "Гравець 3",
    "dbg-4": "Гравець 4",
  },
  livesById: {
    "dbg-1": 3,
    "dbg-2": 2,
    "dbg-3": 3,
    "dbg-4": 1,
  },
  contestantIds: ["dbg-1", "dbg-2", "dbg-3", "dbg-4"],
  loserIds: ["dbg-2", "dbg-4"],
  mode: "multi_wrong_compete",
  roundIndex: 1,
};

/** Міні-гра «Правда/Брехня» на мобільному: ?minigameDebug=1 (міні-гра відкриється одразу, без очікування) */
const MINIGAME_DEBUG_KEY = "quizgame_minigame_debug";
const readMinigameDebugFlag = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const q = params.get("minigameDebug");
  if (q === "1") {
    window.localStorage.setItem(MINIGAME_DEBUG_KEY, "1");
    return true;
  }
  if (q === "0") {
    window.localStorage.removeItem(MINIGAME_DEBUG_KEY);
    return false;
  }
  return window.localStorage.getItem(MINIGAME_DEBUG_KEY) === "1";
};

/**
 * Styling preview for a minigame end screen (display only, dev/localhost):
 *   ?mgPreview=mathRush   ?mgPreview=rps   ?mgPreview=trueFalse
 * Mounts the minigame with a mock results payload so you can tune the visuals
 * without playing a full game. Does not talk to the server.
 */
const readMgPreview = () => {
  if (typeof window === "undefined") return null;
  const id = new URLSearchParams(window.location.search).get("mgPreview");
  return ["mathRush", "rps", "trueFalse"].includes(id) ? id : null;
};

const MG_PREVIEW_PLAYERS = [
  { id: "pv-1", name: "Гравець 1", score: 10, characterSlot: 1, lives: 3 },
  { id: "pv-2", name: "Гравець 2", score: 0, characterSlot: 2, lives: 2 },
  { id: "pv-3", name: "Гравець 3", score: 10, characterSlot: 3, lives: 3 },
  { id: "pv-4", name: "Гравець 4", score: 0, characterSlot: 4, lives: 1 },
];

const buildMgPreviewResults = (id) => {
  const names = Object.fromEntries(MG_PREVIEW_PLAYERS.map((p) => [p.id, p.name]));
  const lives = Object.fromEntries(MG_PREVIEW_PLAYERS.map((p) => [p.id, p.lives]));
  if (id === "mathRush") {
    return {
      minigameId: "mathRush",
      roundIndex: 2,
      namesById: names,
      livesById: lives,
      contestantIds: ["pv-1", "pv-2", "pv-3", "pv-4"],
      minigameScores: { "pv-1": 12, "pv-2": 7, "pv-3": 9, "pv-4": 5 },
      ranked: ["pv-1", "pv-3", "pv-2", "pv-4"],
      loserIds: ["pv-4"],
      quizFailerIds: ["pv-2"],
      savedFailerIds: ["pv-2"],
    };
  }
  if (id === "rps") {
    return {
      minigameId: "rps",
      roundIndex: 3,
      namesById: names,
      livesById: lives,
      contestantIds: ["pv-2", "pv-4"],
      loserIds: ["pv-4"],
      winnerId: "pv-2",
      lifeLoserId: "pv-4",
      finalEliminated: ["pv-4"],
    };
  }
  return {
    minigameId: "trueFalse",
    roundIndex: 1,
    namesById: names,
    livesById: lives,
    contestantIds: ["pv-2", "pv-4"],
    minigameScores: { "pv-2": 6, "pv-4": 3 },
    loserIds: ["pv-4"],
    mode: "multi_wrong_compete",
  };
};

/**
 * Конфіг персонажів у лобі — можна змінювати позиції, нахил і тип анімації.
 * top, left — позиція в %
 * rotate — нахил у градусах (-30 до 30)
 * anim — номер анімації 1-8 (кожна трохи відрізняється)
 */
const LOBBY_CHAR_CONFIG = [
  { top: "10%", left: "12%", rotate: -6, anim: 1 },
  { top: "7%", left: "78%", rotate: 5, anim: 2 },
  { top: "42%", left: "6%", rotate: 8, anim: 3 },
  { top: "38%", left: "82%", rotate: -4, anim: 4 },
  { top: "68%", left: "18%", rotate: -8, anim: 5 },
  { top: "62%", left: "75%", rotate: -15, anim: 6 },
  { top: "50%", left: "35%", rotate: -6, anim: 7 },
  { top: "76%", left: "58%", rotate: 5, anim: 8 },
];

function App() {
  const [socket, setSocket] = useState(null);
  const [screen, setScreen] = useState(isMobile() ? "join" : "menu");
  const [roomCode, setRoomCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState(null);
  const [players, setPlayers] = useState([]);
  const [gameState, setGameState] = useState("waiting");
  const [question, setQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [connected, setConnected] = useState(false);
  const [isDisplay, setIsDisplay] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const DIFFICULTIES = [
    { id: "easy", name: "Легкий" },
    { id: "medium", name: "Середній" },
    { id: "hard", name: "Важкий" },
  ];
  const [selectedDifficulty, setSelectedDifficulty] = useState("easy");
  const [lobbyDifficulty, setLobbyDifficulty] = useState("easy");
  const [showMenuDifficulty, setShowMenuDifficulty] = useState(false);
  const [musicStarted, setMusicStarted] = useState(true);
  const [musicMuted, setMusicMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIntroFade, setShowIntroFade] = useState(false);
  const [countdownNum, setCountdownNum] = useState(null);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(15);
  const [round1SubtitleActive, setRound1SubtitleActive] = useState(false);
  const [showRoundResultIcons, setShowRoundResultIcons] = useState(false);
  const [scoresTransitioning, setScoresTransitioning] = useState(false);
  const [roundIndex, setRoundIndex] = useState(1);
  const [hasPlayedRulesVideo, setHasPlayedRulesVideo] = useState(false);
  const [rulesNeedsClick, setRulesNeedsClick] = useState(false);
  const [rulesEnding, setRulesEnding] = useState(false);
  const [rulesFadeOutMs, setRulesFadeOutMs] = useState(450);
  const [rulesSkipFadeIn, setRulesSkipFadeIn] = useState(false);
  const [rulesActiveMobile, setRulesActiveMobile] = useState(false);
  const [roundIntroVideo, setRoundIntroVideo] = useState(null); // null | "round1_intro" | "round1_question" | "round2_intro"
  const [questionPlayData, setQuestionPlayData] = useState(null);
  const questionAudioRef = useRef(null);
  const questionPlayDoneRef = useRef(false);
  const rulesVideoRef = useRef(null);
  const roundIntroVideoRef = useRef(null);
  const roundIntroQuestionVideoRef = useRef(null); // preloads question.mp4 during introround1
  const round2IntroVideoRef = useRef(null);
  const round1IntroDoneRef = useRef(false);
  const round2IntroDoneRef = useRef(false);
  const menuAudioRef = useRef(null);
  const chainAudioRef = useRef(null);
  const clickAudioRef = useRef(null);
  const knifeSliceRef = useRef(null);
  const bellRef = useRef(null);
  const notificationRef = useRef(null);
  const answerBeepRef = useRef(null);
  const resultAudioRef = useRef(null);
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const isDisplayRef = useRef(isDisplay);
  isDisplayRef.current = isDisplay;
  const pendingRulesSeekRef = useRef(null);
  const rulesSkipFadeRafRef = useRef(null);
  const roundDebugEnabledRef = useRef(false);
  const gameBackgroundVideoRef = useRef(null);
  const scoresVideoRef = useRef(null);
  const scoresDoneEmittedRef = useRef(false);
  const trueFalseSubmittedRef = useRef(false);
  const resultSoundPlayedRef = useRef(false);

  const myPlayerId = playerId ?? players?.[0]?.id ?? null;
  const playerNamesById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  // Minigame runs after every round (server/minigames/ decides which one).
  const [minigameId, setMinigameId] = useState("trueFalse");
  const [trueFalseStart, setTrueFalseStart] = useState(false);
  const [trueFalseContestantIds, setTrueFalseContestantIds] = useState([]);
  const [trueFalseSyncData, setTrueFalseSyncData] = useState(null); // { startedAtTs, serverTime, receivedAt }
  /** Після міні-гри: дані для сцени з aftermg.mp4 + таблиця + втрата життя */
  const [trueFalseResultsPayload, setTrueFalseResultsPayload] = useState(null);

  const isTrueFalseActive =
    isMobile() &&
    gameState === GAME_PHASE.SCORES &&
    trueFalseStart &&
    trueFalseContestantIds.length > 0;

  const isMinigameContestant = trueFalseContestantIds.includes(myPlayerId);

  useEffect(() => {
    if (gameState === GAME_PHASE.SCORES) {
      trueFalseSubmittedRef.current = false;
    }
  }, [gameState, roundIndex]);

  // Debug helper: auto-start minigame UI when using ?scoresDebug=1 / ?roundDebug=scores / ?minigameDebug=1
  useEffect(() => {
    if (!isMobile()) return;
    if (!isScoresDebugActive() && !readMinigameDebugFlag()) return;
    if (gameState !== GAME_PHASE.SCORES || roundIndex !== 1) return;
    const anyWrong = players.some((p) => p.lastCorrect === false);
    if (!anyWrong && !readMinigameDebugFlag()) {
      setTrueFalseStart(false);
      setTrueFalseContestantIds([]);
      setTrueFalseSyncData(null);
      return;
    }
    setTrueFalseStart(true);
    setTrueFalseContestantIds(players.map((p) => p.id));
    const now = Date.now();
    if (readMinigameDebugFlag()) {
      const past = now - 20000;
      setTrueFalseSyncData({ startedAtTs: past, serverTime: past, receivedAt: now });
    } else {
      setTrueFalseSyncData({ startedAtTs: now, serverTime: now, receivedAt: now });
    }
  }, [gameState, roundIndex, players]);

  const handleTrueFalseFinish = (minigameScore) => {
    if (!isTrueFalseActive) return;
    if (isMinigameContestant && trueFalseSubmittedRef.current) return;
    if (isMinigameContestant) trueFalseSubmittedRef.current = true;
    socket?.emit("trueFalseScore", {
      roundIndex,
      score: minigameScore ?? 0,
    });
  };

  const playClickSound = () => {
    if (isMobile()) return;
    const a = clickAudioRef.current;
    if (a) {
      a.currentTime = 0;
      a.volume = 0.4;
      a.play().catch(() => {});
    }
  };

  const withClick = (fn) => (e) => {
    playClickSound();
    fn?.(e);
  };

  const requestFullscreen = async () => {
    try {
      const el = document.documentElement;
      if (document.fullscreenElement) return;
      await el.requestFullscreen?.();
    } catch {}
  };

  const exitFullscreen = async () => {
    try {
      if (!document.fullscreenElement) return;
      await document.exitFullscreen?.();
    } catch {}
  };


  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket", "polling"] });
    setSocket(s);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    return () => s.close();
  }, []);

  useEffect(() => {
    if (!isDevEnvironment()) return;

    if (readAftermathDebugFlag()) {
      setConnected(true);
      setScreen("game");
      setIsDisplay(true);
      setIsAdmin(false);
      setRoomCode("9999");
      setSelectedDifficulty("easy");
      setLobbyDifficulty("easy");
      setRoundIndex(1);
      setHasPlayedRulesVideo(true);
      setGameState(GAME_PHASE.SCORES);
      setQuestion(null);
      setQuestionPlayData(null);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setShowRoundResultIcons(false);
      setTrueFalseStart(false);
      setTrueFalseContestantIds([]);
      setTrueFalseSyncData(null);
      setTrueFalseResultsPayload(AFTERMATH_DEBUG_MOCK);
      setPlayers([
        { id: "dbg-1", name: "Гравець 1", score: 10, characterSlot: 1, lives: 3, lastCorrect: true },
        { id: "dbg-2", name: "Гравець 2", score: 0, characterSlot: 2, lives: 2, lastCorrect: false },
        { id: "dbg-3", name: "Гравець 3", score: 10, characterSlot: 3, lives: 3, lastCorrect: true },
        { id: "dbg-4", name: "Гравець 4", score: 0, characterSlot: 4, lives: 1, lastCorrect: false },
      ]);
      // eslint-disable-next-line no-console
      console.info(
        "[AftermathDebug] Сцена після міні-гри (підгін стилів). Вимкнути: ?aftermathDebug=0 (лише dev / localhost)."
      );
      return;
    }

    if (isScoresDebugActive() || readMinigameDebugFlag()) {
      setConnected(true);
      setScreen("game");
      setIsDisplay(true);
      setIsAdmin(false);
      setRoomCode("9999");
      setSelectedDifficulty("easy");
      setLobbyDifficulty("easy");
      setRoundIndex(1);
      setHasPlayedRulesVideo(true);
      setGameState(GAME_PHASE.SCORES);
      setQuestion(null);
      setQuestionPlayData(null);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setShowRoundResultIcons(false);
      setPlayers([
        { id: "dbg-1", name: "Гравець 1", score: 10, characterSlot: 1, lives: 3, lastCorrect: true },
        { id: "dbg-3", name: "Гравець 3", score: 10, characterSlot: 3, lives: 3, lastCorrect: true },
        { id: "dbg-5", name: "Гравець 5", score: 10, characterSlot: 5, lives: 2, lastCorrect: true },
        { id: "dbg-7", name: "Гравець 7", score: 10, characterSlot: 7, lives: 3, lastCorrect: true },
        { id: "dbg-2", name: "Гравець 2", score: 0, characterSlot: 2, lives: 2, lastCorrect: false },
        { id: "dbg-4", name: "Гравець 4", score: 0, characterSlot: 4, lives: 3, lastCorrect: false },
        { id: "dbg-6", name: "Гравець 6", score: 0, characterSlot: 6, lives: 3, lastCorrect: false },
        { id: "dbg-8", name: "Гравець 8", score: 0, characterSlot: 8, lives: 1, lastCorrect: false },
      ]);
      // eslint-disable-next-line no-console
      console.info(
        "[ScoresDebug] Екран підрахунку балів після 1 раунду. Міні-гра на мобільному: ?minigameDebug=1 (відкриється одразу). Вимкн.: ?scoresDebug=0 ?minigameDebug=0"
      );
      return;
    }

    if (!readRoundDebugFlag()) return;

    roundDebugEnabledRef.current = true;
    setConnected(true);
    setScreen("game");
    setIsDisplay(true);
    setIsAdmin(false);
    setRoomCode("9999");
    setSelectedDifficulty("easy");
    setLobbyDifficulty("easy");
    setRoundIndex(1);
    setHasPlayedRulesVideo(true);
    setRulesNeedsClick(false);
    setRulesEnding(false);
    setRulesActiveMobile(false);
    setGameState(GAME_PHASE.QUESTION_ANNOUNCE);
    setQuestion(null);
    setQuestionPlayData(null);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setPlayers([
      { id: "dbg-1", name: "Гравець 1", score: 0, characterSlot: 1 },
      { id: "dbg-2", name: "Гравець 2", score: 0, characterSlot: 2 },
      { id: "dbg-3", name: "Гравець 3", score: 0, characterSlot: 3 },
      { id: "dbg-4", name: "Гравець 4", score: 0, characterSlot: 4 },
      { id: "dbg-5", name: "Гравець 5", score: 0, characterSlot: 5 },
      { id: "dbg-6", name: "Гравець 6", score: 0, characterSlot: 6 },
      { id: "dbg-7", name: "Гравець 7", score: 0, characterSlot: 7 },
      { id: "dbg-8", name: "Гравець 8", score: 0, characterSlot: 8 },
    ]);

    // eslint-disable-next-line no-console
    console.info(
      "[RoundDebug] Enabled: post-rules Round 1 scene with 8 mocked players. Disable via ?roundDebug=0"
    );
  }, []);

  useEffect(() => {
    const gamePhases = [
      GAME_PHASE.QUESTION_ANNOUNCE,
      GAME_PHASE.QUESTION_PLAY,
      GAME_PHASE.ANSWER_PHASE,
      GAME_PHASE.SCORES,
      GAME_PHASE.FINAL_BATTLE,
      GAME_PHASE.FINISHED,
    ];
    if (
      gamePhases.includes(gameState) &&
      (screen === "lobby" || screen === "countdown" || screen === "mobileWait")
    ) {
      setScreen("game");
    }
  }, [gameState, screen]);

  useEffect(() => {
    if (isMobile()) return;
    const audio = menuAudioRef.current;
    if (!audio || !musicStarted) return;
    audio.loop = true;
    audio.volume = musicMuted ? 0 : 0.1;
    audio.muted = musicMuted;
    if (screen === "menu" || screen === "lobby") {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    return () => audio.pause();
  }, [screen, musicStarted, musicMuted]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Logo chain sound on menu enter
  useEffect(() => {
    if (isMobile()) return;
    if (screen !== "menu") return;
    const a = chainAudioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.volume = 0.6;
    a.play().catch(() => {});
  }, [screen]);


  useEffect(() => {
    if (!socket) return;
    const handlers = {
      playerJoined: (d) => {
        setPlayers(d.players || []);
        if (!isMobile() && notificationRef.current) {
          notificationRef.current.currentTime = 0;
          notificationRef.current.play().catch(() => {});
        }
      },
      playerLeft: (d) => setPlayers(d.players || []),
      adminChanged: (d) => setPlayers(d.players || []),
      playersUpdate: (d) => setPlayers(d.players || []),
      showIntro: () => {
        if (!isMobile() && !isAdminRef.current) knifeSliceRef.current?.play().catch(() => {});
        setShowIntroFade(true);
        if (isMobile()) {
          setCountdownNum(null);
          setScreen("mobileWait");
        } else {
          const startCountdown = () => {
            setScreen("countdown");
            setCountdownNum(3);
          };
          setTimeout(startCountdown, 800);
        }
      },
    };
    socket.on("playerJoined", handlers.playerJoined);
    socket.on("playerLeft", handlers.playerLeft);
    socket.on("adminChanged", handlers.adminChanged);
    socket.on("playersUpdate", handlers.playersUpdate);
    socket.on("showIntro", handlers.showIntro);
    socket.on("skipRules", () => {
      // Admin pressed "skip rules" on mobile:
      // jump rulesmovie to 49s on the display.
      if (!isDisplayRef.current) return;
      const seekTo = 49.5;
      pendingRulesSeekRef.current = seekTo;
      const v = rulesVideoRef.current;
      try {
        if (!v) return;
        setRulesSkipFadeIn(true);
        if (rulesSkipFadeRafRef.current) cancelAnimationFrame(rulesSkipFadeRafRef.current);

        const safeSeek = Number.isFinite(v.duration)
          ? Math.min(seekTo, Math.max(0, v.duration - 0.05))
          : seekTo;
        v.volume = 0;
        v.currentTime = safeSeek;
        v.play().catch(() => {});

        const clamp01 = (x) => Math.min(1, Math.max(0, x));
        const start = performance.now();
        const fadeMs = 1500;
        const tick = (now) => {
          const t = Math.min(1, (now - start) / Math.max(1, fadeMs));
          try {
            v.volume = clamp01(t);
          } catch {}
          if (t < 1) rulesSkipFadeRafRef.current = requestAnimationFrame(tick);
        };
        rulesSkipFadeRafRef.current = requestAnimationFrame(tick);

        window.setTimeout(() => {
          setRulesSkipFadeIn(false);
        }, fadeMs);

        pendingRulesSeekRef.current = null;
      } catch {}
    });
    socket.on("rulesStarted", () => {
      setRulesActiveMobile(true);
    });
    socket.on("questionAnnounce", (d) => {
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.QUESTION_ANNOUNCE);
    });
    socket.on("questionPlay", (d) => {
      setQuestion({ ...d.question, index: d.roundIndex, total: TOTAL_ROUNDS });
      setQuestionPlayData(d);
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.QUESTION_PLAY);
    });
    socket.on("answerPhase", (d) => {
      setQuestion({ ...d.question, index: d.roundIndex, total: TOTAL_ROUNDS });
      setQuestionPlayData(null);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setGameState(GAME_PHASE.ANSWER_PHASE);
      setAnswerTimeLeft(15);
    });
    socket.on("answerResult", (d) => setAnswerResult(d));
    socket.on("answerBeep", () => {
      if (isMobile()) return; // sound only on the display
      const a = answerBeepRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
    });
    socket.on("scores", (d) => {
      setTrueFalseStart(false);
      setTrueFalseContestantIds([]);
      setTrueFalseSyncData(null);
      setTrueFalseResultsPayload(null);
      setScoresTransitioning(true);
      setTimeout(() => {
        setPlayers(d.players || []);
        setRoundIndex(d.roundIndex ?? 1);
        setGameState(GAME_PHASE.SCORES);
        setShowRoundResultIcons(false);
        setScoresTransitioning(false);
      }, 450);
    });
    socket.on("trueFalseStart", (d) => {
      setMinigameId(d?.minigameId || "trueFalse");
      setTrueFalseStart(true);
      setTrueFalseContestantIds(d?.contestantIds || []);
      setTrueFalseSyncData(null);
    });
    socket.on("trueFalseSync", (d) => {
      if (!d || !Number.isFinite(Number(d.startedAtTs))) return;
      const serverTime = Number(d.serverTime ?? d.startedAtTs);
      setTrueFalseSyncData({
        startedAtTs: Number(d.startedAtTs),
        serverTime,
        receivedAt: Date.now(),
      });
    });
    socket.on("trueFalseResults", (d) => {
      if (!d || !d.contestantIds) return;
      setTrueFalseStart(false);
      setTrueFalseResultsPayload(d);
    });
    socket.on("finalBattle", (d) => {
      setPlayers(d.players || []);
      setGameState(GAME_PHASE.FINAL_BATTLE);
      setQuestion(null);
      setQuestionPlayData(null);
      setAnswerResult(null);
      setTrueFalseStart(false);
      setTrueFalseResultsPayload(null);
    });
    socket.on("gameFinished", (d) => {
      setPlayers(d.players || []);
      setGameState(GAME_PHASE.FINISHED);
      setQuestion(null);
      setAnswerResult(null);
      setTrueFalseResultsPayload(null);
    });
    return () => {
      socket.off("playerJoined", handlers.playerJoined);
      socket.off("playerLeft", handlers.playerLeft);
      socket.off("adminChanged", handlers.adminChanged);
      socket.off("playersUpdate", handlers.playersUpdate);
      socket.off("showIntro", handlers.showIntro);
      socket.off("skipRules");
      socket.off("rulesStarted");
      socket.off("trueFalseStart");
      socket.off("trueFalseSync");
      socket.off("trueFalseResults");
      socket.off("finalBattle");
      socket.off("answerBeep");
    };
  }, [socket]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.SCORES) {
      setShowRoundResultIcons(false);
      resultSoundPlayedRef.current = false;
      return;
    }
    if (resultSoundPlayedRef.current) return;
    const allCorrect =
      players.length > 0 && players.every((p) => p.lastCorrect === true);
    const delayMs = allCorrect ? 2000 : 5000;
    const id = window.setTimeout(() => {
      if (resultSoundPlayedRef.current) return;
      resultSoundPlayedRef.current = true;
      setShowRoundResultIcons(true);
      if (isMobile()) return; // sound only on the display
      const a = resultAudioRef.current;
      if (a) {
        a.currentTime = 0;
        a.play().catch(() => {});
      }
    }, delayMs);
    return () => window.clearTimeout(id);
  }, [gameState, roundIndex]);

  useEffect(() => {
    if (gameState === GAME_PHASE.SCORES) {
      scoresDoneEmittedRef.current = false;
    }
  }, [gameState]);

  useEffect(() => {
    if (!isDisplay || roundIndex !== 1) {
      setRound1SubtitleActive(false);
      return;
    }
    if (gameState !== GAME_PHASE.QUESTION_PLAY) {
      setRound1SubtitleActive(false);
      return;
    }
    setRound1SubtitleActive(false);
    const id = window.setTimeout(() => setRound1SubtitleActive(true), 3000);
    return () => window.clearTimeout(id);
  }, [gameState, isDisplay, roundIndex, questionPlayData?.question?.id]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.ANSWER_PHASE || !question) return;
    const t = setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [gameState, question?.id]);

  // Final battle (after round 9). Placeholder: the display shows the caption for
  // a few seconds, then tells the server to finish. Real video/rules go here later.
  useEffect(() => {
    if (gameState !== GAME_PHASE.FINAL_BATTLE || !isDisplay) return;
    const t = setTimeout(() => socket?.emit("finalBattleDone"), 6000);
    return () => clearTimeout(t);
  }, [gameState, isDisplay, socket]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_ANNOUNCE || !isDisplay) return;
    // Блок: раунд 1 не можна стартувати, поки не завершилось rulesmovie (на дисплеї).
    if (roundIndex === 1 && !hasPlayedRulesVideo) return;
    // Round 1: show presentation video -> question video, then start question
    if (roundIndex === 1 && !round1IntroDoneRef.current) {
      setRoundIntroVideo("round1_intro");
      return;
    }
    // Round 2: інтро перед стартом раунду (introround2.mp4)
    if (roundIndex === 2 && !round2IntroDoneRef.current) {
      setRoundIntroVideo("round2_intro");
      return;
    }
    // Rounds 3-9: show the "РАУНД N" caption (RoundIntro) for a beat, then start.
    const t = setTimeout(() => socket?.emit("questionAnnounceDone"), 3200);
    return () => clearTimeout(t);
  }, [gameState, isDisplay, socket, roundIndex, hasPlayedRulesVideo]);

  useEffect(() => {
    if (!isDisplay) return;
    if (gameState !== GAME_PHASE.QUESTION_ANNOUNCE) {
      setRoundIntroVideo(null);
      return;
    }
    if (roundIndex === 2) {
      if (round2IntroDoneRef.current) return;
      if (roundIntroVideo !== "round2_intro") return;

      const v = round2IntroVideoRef.current;
      if (!v) return;

      const finishRound2Intro = () => {
        if (round2IntroDoneRef.current) return;
        round2IntroDoneRef.current = true;
        window.setTimeout(() => {
          setRoundIntroVideo(null);
          socket?.emit("questionAnnounceDone");
        }, 120);
      };

      v.onended = () => {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
        finishRound2Intro();
      };
      v.play().catch(() => finishRound2Intro());
      return () => {
        v.onended = null;
      };
    }

    if (roundIndex !== 1) return;
    if (!hasPlayedRulesVideo) return;
    if (round1IntroDoneRef.current) return;
    if (!roundIntroVideo) return;

    const vIntro = roundIntroVideoRef.current;
    const vQuestion = roundIntroQuestionVideoRef.current;
    if (!vIntro || !vQuestion) return;

    const startQuestion = () => {
      if (round1IntroDoneRef.current) return;
      round1IntroDoneRef.current = true;
      window.setTimeout(() => {
        setRoundIntroVideo(null);
        if (roundDebugEnabledRef.current) {
          const debugQuestion = {
            id: "dbg-r1-q1",
            text: "DEBUG: Раунд 1 запущено. Тут буде текст питання з round1.",
            options: ["A", "B", "C", "D"],
            correctIndex: 0,
          };
          setQuestion({
            ...debugQuestion,
            index: 1,
            total: TOTAL_ROUNDS,
          });
          setQuestionPlayData({
            roundIndex: 1,
            question: debugQuestion,
            audioSrc: null,
          });
          setGameState(GAME_PHASE.QUESTION_PLAY);
          return;
        }
        socket?.emit("questionAnnounceDone");
      }, 120);
    };

    if (roundIntroVideo === "round1_intro") {
      let onReady = null;
      vIntro.onended = () => {
        vIntro.pause();
        vQuestion.currentTime = 0;
        onReady = () => {
          vQuestion.removeEventListener("canplay", onReady);
          vQuestion.removeEventListener("playing", onReady);
          setRoundIntroVideo("round1_question");
          startQuestion();
        };
        vQuestion.addEventListener("canplay", onReady);
        vQuestion.addEventListener("playing", onReady);
        vQuestion.play().catch(() => onReady());
      };
      vIntro.play().catch(() => {});
      return () => {
        vIntro.onended = null;
        if (onReady) {
          vQuestion.removeEventListener("canplay", onReady);
          vQuestion.removeEventListener("playing", onReady);
        }
      };
    }

    // round1_question: vQuestion is visible and already playing.
    try {
      vIntro.pause();
    } catch {}
    return () => {};
  }, [roundIntroVideo, isDisplay, gameState, roundIndex, hasPlayedRulesVideo, socket]);

  useEffect(() => {
    if (roundIndex !== 1) {
      round1IntroDoneRef.current = false;
    }
    if (roundIndex !== 2) {
      round2IntroDoneRef.current = false;
    }
    if (roundIndex !== 1 && roundIndex !== 2) {
      setRoundIntroVideo(null);
    }
  }, [roundIndex]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_PLAY || !questionPlayData || !isDisplay) return;
    questionPlayDoneRef.current = false;
    const audio = questionPlayData.question?.audioSrc ?? questionPlayData.audioSrc;
    const checkDone = () => {
      if (questionPlayDoneRef.current) return;
      questionPlayDoneRef.current = true;
      socket?.emit("questionPlayDone");
    };
    if (audio && questionAudioRef.current) {
      questionAudioRef.current.src = audio;
      questionAudioRef.current.onended = checkDone;
      questionAudioRef.current.play().catch(() => {});
    }
    return () => {
      if (questionAudioRef.current) questionAudioRef.current.onended = null;
    };
  }, [gameState, questionPlayData, isDisplay, socket]);

  const handleSubtitlesComplete = () => {
    if (!isDisplay || gameState !== GAME_PHASE.QUESTION_PLAY) return;
    const audioSrc = questionPlayData?.question?.audioSrc ?? questionPlayData?.audioSrc;
    if (!audioSrc) {
      questionPlayDoneRef.current = true;
      socket?.emit("questionPlayDone");
    } else {
      setTimeout(() => {
        if (questionPlayDoneRef.current) return;
        questionPlayDoneRef.current = true;
        socket?.emit("questionPlayDone");
      }, 800);
    }
  };

  const completeRules = () => {
    setHasPlayedRulesVideo(true);
    setRulesEnding(false);
    setRulesNeedsClick(false);
    setRulesActiveMobile(false);
    // Тільки після rulesmovie запускаємо гру на сервері
    if (socket && isDisplay) socket.emit("introEnded");
    setScreen("game");
  };

  const finishRules = (fadeMs = 450) => {
    setRulesFadeOutMs(fadeMs);
    setRulesEnding(true);
    window.setTimeout(() => {
      completeRules();
    }, fadeMs);
  };

  const handleRulesVideoEnded = () => {
    finishRules(450);
  };


  const tryStartRulesVideo = async () => {
    const v = rulesVideoRef.current;
    if (!v) return;
    try {
      // Some browsers will block unmuted autoplay; fall back to user click.
      await v.play();
      setRulesNeedsClick(false);
    } catch {
      setRulesNeedsClick(true);
    }
  };

  useEffect(() => {
    if (!(screen === "rules" && isDisplay && roundIndex === 1 && !hasPlayedRulesVideo)) return;
    setRulesEnding(false);
    setRulesNeedsClick(false);
    setRulesFadeOutMs(450);
    setRulesSkipFadeIn(false);
    // Wait a tick so ref is attached.
    const id = window.setTimeout(() => {
      tryStartRulesVideo();
    }, 50);
    return () => {
      window.clearTimeout(id);
      if (rulesSkipFadeRafRef.current) cancelAnimationFrame(rulesSkipFadeRafRef.current);
      rulesSkipFadeRafRef.current = null;
    };
  }, [screen, isDisplay, roundIndex, hasPlayedRulesVideo]);

  useEffect(() => {
    if (!(screen === "rules" && isDisplay && roundIndex === 1 && !hasPlayedRulesVideo)) return;
    socket?.emit("rulesStarted");
  }, [screen, isDisplay, roundIndex, hasPlayedRulesVideo, socket]);

  // No "finish on skip" anymore: skip seeks to 49s.

  useEffect(() => {
    if (screen !== "countdown") return;
    const playBell = () => {
      const b = bellRef.current;
      if (b && !isMobile()) {
        b.currentTime = 0;
        b.play().catch(() => {});
      }
    };
    let n = 3;
    setCountdownNum(3);
    playBell();

    const id = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(id);
        if (isDisplay) {
          setScreen("introScene");
        } else {
          setScreen("lobby");
        }
        setCountdownNum(null);
        return;
      }
      setCountdownNum(n);
      playBell();
    }, 1000);
    return () => clearInterval(id);
  }, [screen]);

  const handleCreateRoom = () => {
    setMusicStarted(true);
    if (!socket) return;
    if (!socket.connected) {
      alert("Немає з'єднання з сервером. Перевірте, що сервер запущений на порту 3001.");
      return;
    }
    setShowMenuDifficulty(false);
    socket.emit("createRoom", { selectedDifficulty }, (data) => {
      if (!data || !data.roomCode) {
        alert("Помилка створення кімнати. Спробуйте ще раз.");
        return;
      }
      setRoomCode(data.roomCode);
      setPlayers(data.players || []);
      setGameState(data.gameState || "waiting");
      setLobbyDifficulty(data.selectedDifficulty || "easy");
      setIsDisplay(true);
      setIsAdmin(false);
      setScreen("lobby");
    });
  };

  const handleMenuStartClick = () => {
    if (!connected) return;
    setShowMenuDifficulty(true);
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    setJoinError("");
    if (!socket || !connected) return;
    const code = (joinCodeInput || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
    const name = (playerName || "Гравець").trim();
    if (!joinCodeInput.trim()) {
      setJoinError("Введіть код кімнати");
      return;
    }
    socket.emit("joinRoom", { roomCode: code, playerName: name }, (data) => {
      if (data.error) {
        setJoinError(data.error);
        return;
      }
      setRoomCode(data.roomCode);
      setPlayers(data.players || []);
      setGameState(data.gameState || "waiting");
      setPlayerId(data.playerId);
      setLobbyDifficulty(data.selectedDifficulty || "easy");
      setIsDisplay(false);
      setIsAdmin(data.isAdmin || false);
      setScreen("lobby");
    });
  };

  const handleStartGame = () => {
    if (!socket || !isAdmin) return;
    if (!isMobile()) knifeSliceRef.current?.play().catch(() => {});
    socket.emit("startIntro", { selectedDifficulty: lobbyDifficulty });
  };

  const handleIntroEnded = () => {
    if (!socket) return;
    // Дисплей: спочатку rulesmovie, і тільки потім запускаємо 1-й раунд
    if (isDisplay) {
      setScreen("rules");
      socket.emit("rulesStarted");
      return;
    }
    // Телефони: rules не показуємо
    if (isAdmin) socket.emit("startGame");
    setScreen("game");
  };

  const handleMobileIntroSkip = () => {
    if (socket && isAdmin) socket.emit("startGame");
  };

  const handleAnswer = (i) => {
    if (socket && question && selectedAnswer === null) {
      setSelectedAnswer(i);
      socket.emit("answer", { answerIndex: i });
    }
  };

  const handleExit = () => {
    if (socket && roomCode) socket.emit("leaveRoom");
    setScreen(isMobile() ? "join" : "menu");
    setRoomCode("");
    setPlayers([]);
    setLobbyDifficulty("easy");
    setQuestion(null);
    setAnswerResult(null);
    setPlayerId(null);
    setIsDisplay(false);
    setIsAdmin(false);
    setRulesActiveMobile(false);
    setShowIntroFade(false);
  };


  const getOptionClass = (idx) => {
    if (!answerResult) return "option";
    if (isMobile()) return "option option-disabled";
    if (idx === answerResult.correctIndex) return "option option-correct";
    if (idx === selectedAnswer && !answerResult.correct) return "option option-wrong";
    return "option option-disabled";
  };

  const mgPreview = isDevEnvironment() ? readMgPreview() : null;
  if (mgPreview) {
    return (
      <div className="app app-game-with-video">
        <MinigameHost
          minigameId={mgPreview}
          uiMode="display"
          isActive={false}
          roundIndex={buildMgPreviewResults(mgPreview).roundIndex}
          myPlayerId="pv-1"
          namesById={Object.fromEntries(MG_PREVIEW_PLAYERS.map((p) => [p.id, p.name]))}
          contestantIds={buildMgPreviewResults(mgPreview).contestantIds}
          results={buildMgPreviewResults(mgPreview)}
          onSceneDone={() => {}}
        />
      </div>
    );
  }

  return (
    <>
      {/* All game audio lives on the display / desktop screen only — the phone
          controllers are silent. Do not render these on mobile. */}
      {!isMobile() && (
        <>
          <audio ref={menuAudioRef} src="/assets/sounds/mainmenu.mp3" preload="auto" />
          <audio ref={clickAudioRef} src="/assets/sounds/click-sound.mp3" preload="auto" />
          <audio ref={knifeSliceRef} src="/assets/sounds/knife-slice.mp3" preload="auto" />
          <audio ref={bellRef} src="/assets/sounds/bell.mp3" preload="auto" />
          <audio ref={notificationRef} src="/assets/sounds/notification.mp3" preload="auto" />
          <audio ref={answerBeepRef} src="/assets/sounds/beep.mp3" preload="auto" />
          <audio ref={resultAudioRef} src="/assets/sounds/result.mp3" preload="auto" />
          <audio ref={questionAudioRef} preload="auto" />
        </>
      )}
  {isMobile() && screen === "join" && (
      <div className="app app-mobile-bg">
        <div className="join-screen-full">
          <form onSubmit={handleJoinRoom} className="join-form-simple">
            <input
              type="text"
              inputMode="numeric"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Код кімнати"
              maxLength={4}
              className="code-input"
            />
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Ваш нікнейм"
              maxLength={20}
            />
            {joinError && <p className="join-error">{joinError}</p>}
            <button type="submit" disabled={!connected || !joinCodeInput.trim()} onClick={playClickSound}>
              Приєднатися
            </button>
          </form>
        </div>
      </div>
  )}

  {screen === "menu" && (
      <div className={`app ${!isMobile() ? "menu-with-video" : ""}`}>
        {!isMobile() && (
          <video
            className="menu-background-video"
            src="/assets/videos/waitroom.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        {/* Без overlay затемнення для головного меню */}
        <div className="main-menu">

          {!connected && <p className="menu-hint">Очікування з&apos;єднання з сервером...</p>}
          {!isMobile() && (
            <div className="menu-top-right">
              <button
                type="button"
                className={`sound-toggle ${musicMuted ? "sound-toggle-off" : "sound-toggle-on"}`}
                onClick={withClick(() => setMusicMuted((prev) => !prev))}
                aria-label={musicMuted ? "Увімкнути звук" : "Вимкнути звук"}
              >
                <span className="sound-icon" />
              </button>
              <button
                type="button"
                className={`fullscreen-toggle ${isFullscreen ? "fullscreen-toggle-on" : ""}`}
                onClick={withClick(() => (isFullscreen ? exitFullscreen() : requestFullscreen()))}
                aria-label={isFullscreen ? "Вийти з повного екрана" : "Повний екран"}
              >
                <span className="fullscreen-icon" />
              </button>
            </div>
          )}
          {!showMenuDifficulty && (
            <nav className="menu-nav">
              <button
                className="glowing-btn menu-glowing-btn menu-glowing-btn-play"
                onClick={withClick(handleMenuStartClick)}
                disabled={!connected}
                aria-label="Грати"
                type="button"
              >
                <span className="glowing-txt">
                  Г<span className="faulty-letter">Р</span>АТИ
                </span>
              </button>
              <button
                className="glowing-btn menu-glowing-btn menu-glowing-btn-exit"
                onClick={withClick(() => window.close())}
                type="button"
              >
                <span className="glowing-txt">
                  ВИ<span className="faulty-letter">Й</span>ТИ
                </span>
              </button>
            </nav>
          )}
        </div>

        {showMenuDifficulty && (
          <div className="modal-overlay" onClick={() => setShowMenuDifficulty(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="modal-back-btn"
                onClick={withClick(() => setShowMenuDifficulty(false))}
                aria-label="Назад"
              >
                <span className="modal-back-icon" />
              </button>
              <h2>Оберіть складність гри</h2>
              {DIFFICULTIES.map((d) => (
                <label key={d.id} className="category-check difficulty-check">
                  <input
                    type="radio"
                    name="menu-difficulty"
                    checked={selectedDifficulty === d.id}
                    onChange={() => setSelectedDifficulty(d.id)}
                  />
                  {d.name}
                </label>
              ))}
              <div className="modal-buttons modal-buttons-single">
                <button
                  type="button"
                  className="btn modal-btn-lobby-btn"
                  onClick={withClick(handleCreateRoom)}
                  aria-label="В лобі"
                >
                  <span className="btn__inner">
                    <span className="btn__text">В лоббі</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  )}

  {screen === "lobby" && (
      <div className={`app lobby-screen ${!isMobile() ? "lobby-with-video" : "lobby-mobile app-mobile-bg"} ${showIntroFade ? "lobby-fade-out" : ""}`}>
        {!isMobile() ? (
          <>
            <video
              className="lobby-background-video"
              src="/assets/videos/waitroom.mp4"
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="lobby-overlay" />
            <div className="lobby-ui-overlay">
              <p className="lobby-wait-text">
                Переходьте на{" "}
                <span className="lobby-wait-highlight">site.fun</span>
                <br />
                якщо не боїтесь!
              </p>
              <section className="lobby-room-code">
                <p className="room-code-label">Код кімнати:</p>
                <p className="room-code-value">
                  <FireTitle text={roomCode} />
                </p>
                <p className="room-code-hint">Введіть код на телефоні</p>
              </section>
              <p className="lobby-connected-count">
                Підключилось гравців {players.length}/{MAX_ROOM_PLAYERS}
              </p>
              <section className="lobby-actions">
                {gameState === "waiting" && isAdmin && (
                  <button className="btn-start" onClick={withClick(handleStartGame)}>
                    Розпочати гру
                  </button>
                )}
                <button
                  className="spiderverse-button spiderverse-exit lobby-exit-spiderverse"
                  onClick={withClick(handleExit)}
                  type="button"
                >
                  Вийти
                  <div className="glitch-layers" aria-hidden="true">
                    <div className="glitch-layer layer-1">Вийти</div>
                    <div className="glitch-layer layer-2">Вийти</div>
                  </div>
                  <div className="noise" aria-hidden="true" />
                  <div className="glitch-slice" aria-hidden="true" />
                </button>
              </section>
            </div>
          </>
        ) : (
          <div className="app-inner lobby-inner lobby-mobile-inner">
            <section className="players-panel lobby-players-panel">
              <h3>
                Гравці ({players.length}/{MAX_ROOM_PLAYERS})
              </h3>
              <ul className="players-list">
                {players.map((p) => (
                  <li key={p.id} className="player-item">
                    <span className="player-name">{p.name}{p.isAdmin ? " ★" : ""}</span>
                  </li>
                ))}
              </ul>
              {gameState === "waiting" && isAdmin && (
                <button className="btn-start" onClick={withClick(handleStartGame)}>
                  Розпочати гру
                </button>
              )}
              <button
                className="spiderverse-button spiderverse-exit lobby-exit-spiderverse"
                onClick={withClick(handleExit)}
                type="button"
              >
                Вийти
                <div className="glitch-layers" aria-hidden="true">
                  <div className="glitch-layer layer-1">Вийти</div>
                  <div className="glitch-layer layer-2">Вийти</div>
                </div>
                <div className="noise" aria-hidden="true" />
                <div className="glitch-slice" aria-hidden="true" />
              </button>
            </section>
          </div>
        )}
      </div>
  )}

  {screen === "countdown" && countdownNum > 0 && (
    <div className={`app countdown-screen ${isMobile() ? "app-mobile-bg" : ""}`}>
      <div className="countdown-number countdown-paper" key={countdownNum}>
        {countdownNum}
      </div>
    </div>
  )}

  {isMobile() && screen === "mobileWait" && (
    <div className="app app-mobile-bg mobile-wait-screen">
      <div className="mobile-wait-card">
        <div className="mobile-wait-title">Зачекайте…</div>
        <div className="mobile-wait-subtitle">
          Гра запускається на телевізорі / основному екрані
        </div>
        {isAdmin && rulesActiveMobile && (
          <button
            type="button"
            className="btn-skip-rules"
            onClick={withClick(() => {
              setRulesActiveMobile(false);
              socket?.emit("skipRules");
            })}
          >
            Пропустити правила
          </button>
        )}
      </div>
    </div>
  )}

  {screen === "introScene" && !isMobile() && (
    <IntroScene players={players} onFinished={handleIntroEnded} />
  )}

  {screen === "rules" && (
    <div className="rules-screen-root">
      <section
        className={`rules-video-screen ${rulesSkipFadeIn ? "rules-video-screen-skipfade" : ""} ${rulesEnding ? "rules-video-screen-ending" : ""} ${rulesNeedsClick ? "rules-video-screen-needs-click" : ""}`}
        onClick={() => {
          if (rulesNeedsClick) tryStartRulesVideo();
        }}
        style={rulesEnding ? { animationDuration: `${rulesFadeOutMs}ms` } : undefined}
      >
        <video
          ref={rulesVideoRef}
          className="rules-video"
          src="/assets/videos/rulesmovie.mp4"
          autoPlay
          playsInline
          preload="auto"
          onCanPlay={() => {
            if (!rulesNeedsClick) tryStartRulesVideo();
          }}
          onLoadedMetadata={() => {
            const seekTo = pendingRulesSeekRef.current;
            const v = rulesVideoRef.current;
            if (v && typeof seekTo === "number" && Number.isFinite(v.duration)) {
              try {
                v.currentTime = Math.min(seekTo, Math.max(0, v.duration - 0.05));
                v.play().catch(() => {});
                pendingRulesSeekRef.current = null;
              } catch {}
            }
          }}
          onEnded={handleRulesVideoEnded}
        />
      </section>
    </div>
  )}

  {screen === "game" && (
    <div
      className={`app ${!isMobile() ? "app-game-with-video" : "app-game-mobile app-mobile-bg"} ${
        !isMobile() &&
        isDisplay &&
        (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE)
          ? "question-scene-fadein"
          : ""
      }`}
    >
      {!isMobile() && (
        <video
          ref={gameBackgroundVideoRef}
          className="game-background-video"
          src={
            isDisplay && gameState === GAME_PHASE.SCORES
              ? "/assets/videos/main.mp4"
              : isDisplay &&
                (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE)
                ? "/assets/questions/video/question.mp4"
                : "/assets/videos/main.mp4"
          }
          autoPlay
          loop
          playsInline
          muted={false}
          onLoadedMetadata={(e) => {
            const isQuestionPhase =
              isDisplay &&
              (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE);
            e.target.volume = isQuestionPhase ? 0.35 : 0.1;
          }}
        />
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        !trueFalseStart &&
        !trueFalseResultsPayload && (
        <div className="scores-video-overlay">
          <video
            ref={scoresVideoRef}
            className="round-video"
            src={
              players.length > 0 && players.every((p) => p.lastCorrect === true)
                ? "/assets/questions/video/score2.mp4"
                : "/assets/questions/video/score.mp4"
            }
            autoPlay
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              e.target.volume = 0.35;
            }}
            onEnded={() => {
              if (scoresDoneEmittedRef.current || !socket) return;
              if (isScoresDebugActive() || !roomCode) return;
              scoresDoneEmittedRef.current = true;
              socket.emit("scoresDone");
            }}
          />
        </div>
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        (trueFalseStart ||
          (trueFalseResultsPayload &&
            (trueFalseResultsPayload.minigameId || "trueFalse") !== "trueFalse")) && (
        <MinigameHost
          key={`mg-${roundIndex}-${minigameId}`}
          minigameId={minigameId}
          uiMode="display"
          isActive={trueFalseStart}
          canAnswer={true}
          roundIndex={roundIndex}
          syncData={trueFalseSyncData}
          socket={socket}
          myPlayerId={myPlayerId}
          namesById={playerNamesById}
          results={trueFalseResultsPayload}
          onVideoStartedAt={() => socket?.emit("trueFalseSync", { roundIndex })}
          onSceneDone={() => {
            setTrueFalseResultsPayload(null);
            socket?.emit("trueFalseResultsSceneDone");
          }}
        />
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        trueFalseResultsPayload &&
        (trueFalseResultsPayload.minigameId || "trueFalse") === "trueFalse" && (
        <TrueFalseAftermath
          data={trueFalseResultsPayload}
          stylingDebug={isDevEnvironment() && readAftermathDebugFlag()}
          onComplete={() => {
            if (isDevEnvironment() && readAftermathDebugFlag()) return;
            setTrueFalseResultsPayload(null);
            socket?.emit("trueFalseResultsSceneDone");
          }}
        />
      )}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.QUESTION_ANNOUNCE && roundIndex === 1 && roundIntroVideo && (
        <div className="round-video-overlay">
          <video
            ref={roundIntroVideoRef}
            className={`round-video round-video-intro ${roundIntroVideo === "round1_intro" ? "round-video-visible" : "round-video-hidden"}`}
            src="/assets/questions/video/introround1.mp4"
            autoPlay
            playsInline
            preload="auto"
          />
          <video
            ref={roundIntroQuestionVideoRef}
            className={`round-video round-video-question ${roundIntroVideo === "round1_question" ? "round-video-visible" : "round-video-hidden"}`}
            src="/assets/questions/video/question.mp4"
            playsInline
            preload="auto"
          />
        </div>
      )}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.QUESTION_ANNOUNCE && roundIndex === 2 && roundIntroVideo === "round2_intro" && (
        <div className="round-video-overlay">
          <video
            ref={round2IntroVideoRef}
            className="round-video round-video-intro round-video-visible"
            src="/assets/questions/video/introround2.mp4"
            autoPlay
            playsInline
            preload="auto"
          />
        </div>
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.QUESTION_ANNOUNCE &&
        roundIndex >= 3 && <RoundIntro roundIndex={roundIndex} />}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.FINAL_BATTLE && (
        <RoundIntro title="ФІНАЛЬНА БИТВА" label="Відео та правила — скоро" />
      )}
      <div className={`app-inner ${!isMobile() ? "app-inner-over-video" : ""}`}>

      <section
        className={`players-panel compact ${!isDisplay ? "players-panel-player" : ""} ${
          gameState === GAME_PHASE.SCORES && !isMobile() ? "players-panel-scores" : ""
        }`}
        style={!isMobile() ? { ["--players-count"]: Math.max(1, players.length) } : undefined}
      >
        {gameState === GAME_PHASE.SCORES && !isMobile() && (
          <h2 className="scores-panel-title">Перевірка результатів</h2>
        )}
        <ul className="players-list">
          {players.map((p, idx) => (
            <li key={p.id} className="player-item">
              <span className="player-name">{p.name}</span>
              <img
                className="player-sprite"
                src={`/assets/images/Characters/alivecharacters/${
                  p.characterSlot && p.characterSlot >= 1 && p.characterSlot <= 8
                    ? p.characterSlot
                    : (idx % 8) + 1
                }.png`}
                alt={`Персонаж ${p.name}`}
              />
              <span className="player-lives" aria-label={`Життів: ${Number.isFinite(Number(p.lives)) ? Math.max(0, Number(p.lives)) : 3}`}>
                {"❤".repeat(Math.max(0, Math.min(10, Number.isFinite(Number(p.lives)) ? Number(p.lives) : 3)))}
              </span>
              {gameState === GAME_PHASE.SCORES && showRoundResultIcons && (
                <span className={`player-result-icon ${p.lastCorrect ? "result-correct" : "result-wrong"}`} aria-hidden>
                  {p.lastCorrect ? "✓" : "✕"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isDisplay &&
        (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE) &&
        (questionPlayData?.question || question) && (
          <section
            className={`question-play-screen question-play-screen-round1 question-hold-round1 ${
              scoresTransitioning ? "question-fade-out" : ""
            }`}
          >
            {gameState === GAME_PHASE.QUESTION_PLAY ? (
              <TypewriterSubtitles
                key={questionPlayData?.question?.id ?? `round-${questionPlayData?.roundIndex ?? roundIndex}`}
                text={questionPlayData?.question?.text}
                active={roundIndex === 1 ? round1SubtitleActive : true}
                speed={60}
                onComplete={handleSubtitlesComplete}
              />
            ) : (
              <div className="typewriter-subtitles typewriter-subtitles-static">
                <span className="typewriter-text">{question?.text}</span>
              </div>
            )}
            {gameState === GAME_PHASE.ANSWER_PHASE && (
              <>
                <p className="host-waiting host-waiting-round1">Очікування відповідей на телефонах...</p>
                <div className="bomb-timer-wrap">
                  <HorrorTimer
                    timeLeft={answerTimeLeft}
                    questionId={question?.id}
                    totalSeconds={15}
                  />
                </div>
              </>
            )}
          </section>
        )}

      {gameState === GAME_PHASE.ANSWER_PHASE && question && !isDisplay && (
        <section className="question-screen">
          <div className="question-header">Раунд {question.index} з {question.total ?? TOTAL_ROUNDS}</div>
          <h2 className="question-text">{question.text}</h2>
          <div className="bomb-timer-wrap">
            <HorrorTimer
              timeLeft={answerTimeLeft}
              questionId={question?.id}
              totalSeconds={15}
            />
          </div>
          <div className="options">
            {question.options.map((opt, idx) => (
              <button
                key={idx}
                className={getOptionClass(idx)}
                onClick={() => { playClickSound(); handleAnswer(idx); }}
                disabled={selectedAnswer !== null}
              >
                {opt}
              </button>
            ))}
          </div>
          {answerResult && !isMobile() && (
            <div className={`result-message ${answerResult.correct ? "correct" : "wrong"}`}>
              {answerResult.correct ? "Правильно! +10 балів" : "Неправильно"}
            </div>
          )}
        </section>
      )}

      {gameState === GAME_PHASE.SCORES && isMobile() && (
        <>
          <section className="scores-screen">
            <h2>Бали після раунду</h2>
            <ol className="scores-list">
              {players.map((p, i) => (
                <li key={p.id} className="score-item">
                  <span className="rank">{i + 1}.</span>
                  <span className="name">{p.name}</span>
                  <span className="score">{p.score}</span>
                </li>
              ))}
            </ol>
          </section>

          {(trueFalseStart && trueFalseContestantIds.length > 0
            ? true
            : players.some((p) => p.lastCorrect === false)) && (
            <MinigameHost
              minigameId={minigameId}
              key={`minigame-${roundIndex}-${minigameId}`}
              uiMode="mobile"
              isActive={trueFalseStart && trueFalseContestantIds.length > 0}
              canAnswer={isTrueFalseActive}
              roundIndex={roundIndex}
              onFinish={handleTrueFalseFinish}
              syncData={trueFalseSyncData}
              socket={socket}
              myPlayerId={myPlayerId}
              namesById={playerNamesById}
              contestantIds={trueFalseContestantIds}
              results={trueFalseResultsPayload}
            />
          )}
        </>
      )}

      {gameState === GAME_PHASE.FINAL_BATTLE && isMobile() && (
        <section className="mobile-wait-card final-battle-mobile">
          <div className="mobile-wait-title">ФІНАЛЬНА БИТВА</div>
          <div className="mobile-wait-subtitle">Дивіться на головний екран</div>
        </section>
      )}

      {gameState === GAME_PHASE.FINISHED && (
        <section className="final-screen">
          <h2>Фінальні результати</h2>
          <ol className="scores-list final">
            {players.map((p, i) => (
              <li key={p.id} className="score-item">
                <span className="rank">{i + 1}.</span>
                <span className="name">{p.name}</span>
                <span className="score">{p.score}</span>
              </li>
            ))}
          </ol>
          <p className="final-message">Гра завершена. Дякуємо!</p>
          <button className="btn-exit-lobby" onClick={withClick(handleExit)}>
            Вийти
          </button>
        </section>
      )}
      </div>
    </div>
  )}
    </>
  );
}

export default App;
