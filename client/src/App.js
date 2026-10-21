import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { io } from "socket.io-client";
import HorrorTimer from "./components/HorrorTimer";
import TypewriterSubtitles from "./components/TypewriterSubtitles";
import { GAME_PHASE, TOTAL_ROUNDS } from "./game/constants";
import IntroScene from "./components/IntroScene";
import FireTitle from "./components/FireTitle";
import RoundIntro from "./components/RoundIntro";
import CinemaClip from "./components/CinemaClip";
import FadeVideo from "./components/FadeVideo";

// game difficulty (server: questions.normalizeGameDifficulty)
const GAME_DIFFICULTIES = [
  { id: "easy", icon: "🙂", label: "Легка", hint: "прості питання" },
  { id: "medium", icon: "🤔", label: "Середня", hint: "доведеться подумати" },
  { id: "hard", icon: "💀", label: "Складна", hint: "для знавців" },
  { id: "mixed", icon: "📈", label: "Наростаюча", hint: "від легких до складних" },
];
// the clips end with 1-2s of black of their own, so these dark beats stay short
const ROUND_GAP_MS = 700; // rounds 2-9: a pause in the dark before the round announcement
const MINIGAME_GAP_MS = 1200;
const PRE_ROUND_DARK_MS = 1500; // after the welcome, before round 1
const PHONE_MG_RESULT_MS = 6500; // phone: how long a minigame's result screen stays // a pause in the dark between the round's results and its minigame
const QUESTION_REVEAL_MS = 2500; // the question scene's video plays alone this long before the question appears
import DarkPause from "./components/DarkPause";
import FunBackdrop from "./components/FunBackdrop";
import RoundResults from "./components/RoundResults";
import WelcomePlayers from "./components/WelcomePlayers";
import MinigameHost from "./components/MinigameHost";
import TrueFalseAftermath from "./components/TrueFalseAftermath";
import FinalBattle, { FinalCredits, FinalResults } from "./components/FinalBattle";
import { createFinalPreview } from "./components/finalBattlePreview";
import "./App.css";
import gameClock from "./game/gameClock";
import PauseOverlay from "./components/PauseOverlay";
import { playKillAndDeath, preloadDeathSounds } from "./game/deathSounds";

// The game server serves this page itself (production build on :3001, or a
// domain through a tunnel/proxy), so it is the same origin. Only the CRA dev
// server (:3000) talks to the game server on :3001.
const SOCKET_URL =
  process.env.REACT_APP_SERVER_URL ||
  (typeof window === "undefined"
    ? "http://localhost:3001"
    : window.location.port === "3000"
      ? `${window.location.protocol}//${window.location.hostname}:3001`
      : window.location.origin);
// the game's public address: shown on the main menu and in the lobby (players open it on their phones)
const PUBLIC_SITE = process.env.REACT_APP_PUBLIC_HOST || "whoiswho.top";

const isMobile = () =>
  typeof window !== "undefined" &&
  (window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent));

// The phone remembers its seat (room, player, token) to come back after a reload
// or a dropped connection (server: "resumeSession").
const SESSION_KEY = "quizgame_session";
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const readSession = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return s && s.token && Date.now() - (s.at || 0) < SESSION_MAX_AGE_MS ? s : null;
  } catch {
    return null;
  }
};
const saveSession = (s) => {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, at: Date.now() }));
  } catch {
    /* private mode: no coming back, the game still works */
  }
};
// The TV remembers its room the same way (server: "resumeDisplay"), so a dropped
// connection or a reload doesn't end the game for everybody.
const DISPLAY_KEY = "quizgame_display";
const readDisplaySession = () => {
  try {
    const s = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "null");
    return s && s.token && Date.now() - (s.at || 0) < SESSION_MAX_AGE_MS ? s : null;
  } catch {
    return null;
  }
};
const saveDisplaySession = (s) => {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify({ ...s, at: Date.now() }));
  } catch {
    /* private mode: the TV just can't come back after a reload */
  }
};
const clearDisplaySession = () => {
  try {
    localStorage.removeItem(DISPLAY_KEY);
  } catch {
    /* nothing to clear */
  }
};
const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
};
const CHARACTER_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

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

/** Сцена після міні-гри (aftermath.mp4 + таблиця), лише дисплей: ?aftermathDebug=1 — відео зациклено, без переходу далі */
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
/** Dev-only: ?finalPreview=display | ?finalPreview=mobile — scripted final race. */
const readFinalPreview = () => {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("finalPreview");
  if (!v) return null;
  return v === "mobile" ? "mobile" : "display";
};

function FinalBattlePreview({ mode }) {
  const [pv] = useState(() => createFinalPreview());
  useEffect(() => {
    if (mode === "mobile") pv.startNow();
    return () => pv.stop();
  }, [pv, mode]);
  return (
    <div className={`app ${mode === "mobile" ? "app-game-mobile app-mobile-bg" : "app-game-with-video"}`}>
      <FinalBattle uiMode={mode} socket={pv.socket} intro={pv.intro} myPlayerId="fp-3" />
    </div>
  );
}

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
  const ghostIdsRef = useRef(new Set());
  const [gameState, setGameState] = useState("waiting");
  const [question, setQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  /** Final race: intro payload ("finalBattle") and outcome ("gameFinished"). */
  const [finalIntro, setFinalIntro] = useState(null);
  const [finalResult, setFinalResult] = useState(null);
  const [creditsDone, setCreditsDone] = useState(false);
  /** Admin pause: server freezes its timers, every client freezes gameClock + media. */
  const [paused, setPaused] = useState(false);
  const [pausedBy, setPausedBy] = useState(null);
  const [introStarted, setIntroStarted] = useState(false);
  const pausedMediaRef = useRef([]);
  const [joinError, setJoinError] = useState("");
  const [tabClosed, setTabClosed] = useState(false); // main menu "Вийти" when the tab can't close
  // phone join: "form" (code + name) -> "character" (pick a doll) -> joined
  const [joinStep, setJoinStep] = useState("form");
  const [takenSlots, setTakenSlots] = useState([]);
  const [pickedSlot, setPickedSlot] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [isDisplay, setIsDisplay] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Quiz categories come from the content store (managed in /admin).
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState("mixed"); // chosen with the category
  const [lobbyDifficulty, setLobbyDifficulty] = useState("");
  const [lobbyCategoryName, setLobbyCategoryName] = useState("");
  const [showMenuDifficulty, setShowMenuDifficulty] = useState(false); // category picker modal
  const [musicStarted, setMusicStarted] = useState(true);
  const [musicMuted, setMusicMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIntroFade, setShowIntroFade] = useState(false);
  const [countdownNum, setCountdownNum] = useState(null);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(15);
  // TV: the question appears a beat after its scene starts (QUESTION_REVEAL_MS), every round
  const [questionRevealed, setQuestionRevealed] = useState(false);
  const [showRoundResultIcons, setShowRoundResultIcons] = useState(false);
  /**
   * Results sequence on the display (clips picked by the server, server/media.js):
   *   "afterRound"  host clip after the round
   *   "reveal"      ✓/✕ appear on the players + result sound, a short beat
   *   "afterResult" host reaction: all correct / partial / all wrong
   * then "scoresDone" goes to the server (minigame or next round).
   */
  const [scoresVideos, setScoresVideos] = useState(null);
  const [scoresStage, setScoresStage] = useState(null);
  const [scoresTransitioning, setScoresTransitioning] = useState(false);
  const [roundIndex, setRoundIndex] = useState(1);
  const [hasPlayedRulesVideo, setHasPlayedRulesVideo] = useState(false);
  const [rulesNeedsClick, setRulesNeedsClick] = useState(false);
  const [rulesEnding, setRulesEnding] = useState(false);
  // TV between the rules and round 1: "welcome" (the players' tags) -> "dark" (3s in the dark) -> null
  const [preRoundStage, setPreRoundStage] = useState(null);
  const [rulesFadeOutMs, setRulesFadeOutMs] = useState(450);
  const [rulesSkipFadeIn, setRulesSkipFadeIn] = useState(false);
  const [rulesActiveMobile, setRulesActiveMobile] = useState(false);
  const [introActiveMobile, setIntroActiveMobile] = useState(false); // the cinematic intro runs on the TV
  const introSkippedRef = useRef(false);
  const [roundIntroVideo, setRoundIntroVideo] = useState(null); // the announcement clip on screen now (URL) or null
  const [questionPlayData, setQuestionPlayData] = useState(null);
  const questionAudioRef = useRef(null);
  const questionPlayDoneRef = useRef(false);
  const rulesVideoRef = useRef(null);
  const announceDoneRef = useRef(false); // this round's announcement finished (questionAnnounceDone sent)
  const roundGapDoneRef = useRef(false); // the dark pause before this round is over
  const [roundGap, setRoundGap] = useState(false); // showing that pause now
  const [minigameNext, setMinigameNext] = useState(false); // the server armed a minigame for this round
  const [minigameGap, setMinigameGap] = useState(false); // the dark pause before it, showing now
  // this round's announcement clip from the server (assets/rounds/announce/round-N/, in turn); null = caption only
  const [announceVideo, setAnnounceVideo] = useState(null);
  // this round's question background (assets/rounds/question/, random); null = game/background.mp4
  const [questionVideo, setQuestionVideo] = useState(null);
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
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const resetToStartRef = useRef(null); // set once resetToStart is defined below
  const pendingRulesSeekRef = useRef(null);
  const rulesSkipFadeRafRef = useRef(null);
  const roundDebugEnabledRef = useRef(false);
  const gameBackgroundVideoRef = useRef(null);
  const scoresDoneEmittedRef = useRef(false);
  const trueFalseSubmittedRef = useRef(false);
  const resultSoundPlayedRef = useRef(false);

  const myPlayerId = playerId ?? players?.[0]?.id ?? null;
  const myPlayer = players.find((p) => p.id === myPlayerId) || null;
  // phone: after a minigame's result has been shown for a while, back to "my" screen
  const [phoneMgDone, setPhoneMgDone] = useState(false);
  const playerNamesById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.name])), [players]);
  const playerSlotsById = useMemo(
    () => Object.fromEntries(players.map((p) => [p.id, p.characterSlot])),
    [players]
  );
  const playerLivesById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.lives])), [players]);

  // Death in the main game: a player just lost the last life (became a ghost).
  // The display plays a random kill + death sound pair for each new ghost.
  useEffect(() => {
    const ghosts = new Set(players.filter((p) => p.isGhost).map((p) => p.id));
    const fresh = [...ghosts].filter((id) => !ghostIdsRef.current.has(id));
    ghostIdsRef.current = ghosts;
    if (!fresh.length || !isDisplay || isMobile()) return;
    fresh.forEach((_, i) => gameClock.setTimeout(() => playKillAndDeath(0.95), i * 900));
  }, [players, isDisplay]);

  useEffect(() => {
    if (isDisplay && !isMobile()) preloadDeathSounds();
  }, [isDisplay]);

  // Minigame runs after every round (server/minigames/ decides which one).
  const [minigameId, setMinigameId] = useState("trueFalse");
  const [trueFalseStart, setTrueFalseStart] = useState(false);
  const [trueFalseContestantIds, setTrueFalseContestantIds] = useState([]);
  const [trueFalseStatements, setTrueFalseStatements] = useState(null); // «Правда/Брехня»: from the server
  const [roundAnswer, setRoundAnswer] = useState(null); // { question, index, text } — shown after the round
  const [trueFalseSyncData, setTrueFalseSyncData] = useState(null); // { startedAtTs, serverTime, receivedAt }
  /** Після міні-гри: дані для сцени з true-false/aftermath.mp4 + таблиця + втрата життя */
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
    const now = gameClock.now();
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

  /** Freeze this device: game timers, CSS animations, and every playing video/audio. */
  function applyPause(by) {
    gameClock.pause();
    document.documentElement.classList.add("game-paused");
    const playing = [...document.querySelectorAll("video, audio")].filter((m) => !m.paused && !m.ended);
    playing.forEach((m) => m.pause());
    pausedMediaRef.current = playing;
    setPausedBy(by);
    setPaused(true);
  }

  function applyResume() {
    gameClock.resume();
    document.documentElement.classList.remove("game-paused");
    pausedMediaRef.current.forEach((m) => {
      if (m.isConnected) m.play().catch(() => {});
    });
    pausedMediaRef.current = [];
    setPaused(false);
    setPausedBy(null);
  }

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
    s.on("connect", () => {
      setConnected(true);
      // the TV: take its room back (socket.io's own reconnect, or a reload mid-game)
      const tv = !isMobile() ? readDisplaySession() : null;
      if (tv) {
        s.emit("resumeDisplay", tv, (r) => {
          if (!r || r.error) {
            clearDisplaySession();
            // this TV was running a game that is gone: back to the menu instead of a frozen scene
            if (isDisplayRef.current) resetToStartRef.current?.();
            return;
          }
          saveDisplaySession({ roomCode: r.roomCode, token: tv.token });
          setIsDisplay(true);
          setIsAdmin(false);
          setRoomCode(r.roomCode);
          setPlayers(r.players || []);
          setLobbyCategoryName(r.categoryName || "");
          setRoundIndex(r.roundIndex || 1);
          // after a reload the TV starts on the menu: open the game; a TV that only
          // reconnected keeps its screen, the next server event moves it on
          if (screenRef.current === "menu") {
            setGameState(r.gameState || GAME_PHASE.WAITING);
            setScreen(!r.gameState || r.gameState === GAME_PHASE.WAITING ? "lobby" : "game");
          }
        });
        return;
      }
      // a phone with a seat: take it back (after a reload, or socket.io's own reconnect)
      const saved = isMobile() && !isDisplayRef.current ? readSession() : null;
      if (!saved) return;
      setResuming(true);
      s.emit("resumeSession", saved, (r) => {
        setResuming(false);
        if (!r || r.error) {
          clearSession();
          setJoinCodeInput((v) => v || saved.roomCode || "");
          return;
        }
        saveSession({ roomCode: r.roomCode, playerId: r.playerId, token: r.token });
        setRoomCode(r.roomCode);
        setPlayers(r.players || []);
        setPlayerId(r.playerId);
        setIsAdmin(!!r.isAdmin);
        setIsDisplay(false);
        setLobbyCategoryName(r.categoryName || "");
        setRoundIndex(r.roundIndex || 1);
        setGameState(r.gameState || GAME_PHASE.WAITING);
        if (!r.gameState || r.gameState === GAME_PHASE.WAITING) {
          setScreen("lobby");
          return;
        }
        setScreen("game");
        if (r.gameState === GAME_PHASE.ANSWER_PHASE && r.question) {
          setQuestion({ ...r.question, index: r.roundIndex, total: TOTAL_ROUNDS });
          setAnswerTimeLeft(Math.max(0, Math.ceil((r.answerMsLeft || 0) / 1000)));
          setSelectedAnswer(r.answered ? r.answerIndex : null);
          setAnswerResult(null);
        }
        if (r.minigame) {
          setMinigameId(r.minigame.minigameId);
          setTrueFalseContestantIds(r.minigame.contestantIds || []);
          setTrueFalseStatements(Array.isArray(r.minigame.statements) ? r.minigame.statements : null);
          setTrueFalseResultsPayload(null);
          setTrueFalseStart(true);
        }
      });
    });
    s.on("disconnect", () => setConnected(false));
    return () => s.close();
  }, []);

  const loadCategories = () => {
    setCategoriesLoading(true);
    setCategoriesError("");
    fetch(`${SOCKET_URL}/api/categories`)
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d?.categories) ? d.categories : [];
        setCategories(list);
        setSelectedCategoryId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          const firstPlayable = list.find((c) => c.playable);
          return (firstPlayable || list[0] || {}).id || null;
        });
      })
      .catch(() => setCategoriesError("Не вдалося завантажити категорії"))
      .finally(() => setCategoriesLoading(false));
  };

  // Load categories once for the host (display) menu.
  useEffect(() => {
    if (isMobile()) return;
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDevEnvironment()) return;

    if (readAftermathDebugFlag()) {
      setConnected(true);
      setScreen("game");
      setIsDisplay(true);
      setIsAdmin(false);
      setRoomCode("9999");
      setLobbyCategoryName("");
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
      setLobbyCategoryName("");
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
    setLobbyCategoryName("");
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
    audio.volume = musicMuted ? 0 : 1; // level set by game/loudness.js
    audio.muted = musicMuted;
    if ((screen === "menu" || screen === "lobby") && !tabClosed) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    return () => audio.pause();
  }, [screen, musicStarted, musicMuted, tabClosed]);

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
        setIntroStarted(true);
        introSkippedRef.current = false;
        setIntroActiveMobile(true);
        if (!isMobile() && !isAdminRef.current) knifeSliceRef.current?.play().catch(() => {});
        setShowIntroFade(true);
        if (isMobile()) {
          setCountdownNum(null);
          setScreen("mobileWait");
        } else {
          const startCountdown = () => {
            if (introSkippedRef.current) return;
            setScreen("countdown");
            setCountdownNum(3);
          };
          gameClock.setTimeout(startCountdown, 800);
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

        gameClock.setTimeout(() => {
          setRulesSkipFadeIn(false);
        }, fadeMs);

        pendingRulesSeekRef.current = null;
      } catch {}
    });
    socket.on("rulesStarted", () => {
      setIntroActiveMobile(false);
      setRulesActiveMobile(true);
    });
    socket.on("skipIntro", () => {
      // Admin pressed "skip intro" on the phone: the display goes straight to the rules video.
      setIntroActiveMobile(false);
      if (!isDisplayRef.current) return;
      introSkippedRef.current = true;
      setCountdownNum(null);
      setScreen((s) => (s === "countdown" || s === "introScene" || s === "lobby" ? "rules" : s));
    });
    socket.on("questionAnnounce", (d) => {
      if (d.skipIntroVideos) setHasPlayedRulesVideo(true);
      setAnnounceVideo(d.introVideo || null);
      setQuestionVideo(d.questionVideo || null);
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
      gameClock.setTimeout(() => {
        setPlayers(d.players || []);
        setRoundIndex(d.roundIndex ?? 1);
        setGameState(GAME_PHASE.SCORES);
        setShowRoundResultIcons(false);
        setScoresTransitioning(false);
        setScoresVideos(d.videos || null);
        setRoundAnswer(d.answer || null);
        setMinigameNext(!!d.minigameNext);
        setMinigameGap(false);
        setScoresStage(d.videos?.afterRound ? "afterRound" : "reveal");
      }, 450);
    });
    socket.on("trueFalseStart", (d) => {
      setMinigameId(d?.minigameId || "trueFalse");
      setTrueFalseStart(true);
      setTrueFalseContestantIds(d?.contestantIds || []);
      setTrueFalseStatements(Array.isArray(d?.statements) ? d.statements : null);
      setTrueFalseSyncData(null);
    });
    socket.on("trueFalseSync", (d) => {
      if (!d || !Number.isFinite(Number(d.startedAtTs))) return;
      const serverTime = Number(d.serverTime ?? d.startedAtTs);
      setTrueFalseSyncData({
        startedAtTs: Number(d.startedAtTs),
        serverTime,
        receivedAt: gameClock.now(),
      });
    });
    socket.on("trueFalseResults", (d) => {
      if (!d || !d.contestantIds) return;
      setTrueFalseStart(false);
      setTrueFalseResultsPayload(d);
    });
    socket.on("finalBattle", (d) => {
      setFinalIntro(d || null);
      setFinalResult(null);
      setCreditsDone(false);
      setGameState(GAME_PHASE.FINAL_BATTLE);
      setQuestion(null);
      setQuestionPlayData(null);
      setAnswerResult(null);
      setTrueFalseStart(false);
      setTrueFalseResultsPayload(null);
    });
    socket.on("gameFinished", (d) => {
      setPlayers(d.players || []);
      setFinalResult(d || null);
      setGameState(GAME_PHASE.FINISHED);
      setQuestion(null);
      setAnswerResult(null);
      setTrueFalseResultsPayload(null);
    });
    socket.on("categorySelected", (d) => {
      setLobbyCategoryName(d?.categoryName || "");
      if (d?.categoryId) setSelectedCategoryId(d.categoryId);
    });
    socket.on("gamePaused", (d) => {
      applyPause(d?.by || null);
    });
    socket.on("gameResumed", () => {
      applyResume();
    });
    // the admin ended the game from the pause screen: TV -> main menu, phones -> join
    socket.on("gameAborted", (d) => {
      resetToStart();
      if (isMobile()) setJoinError(d?.by ? `${d.by} завершив гру` : "Гру завершено");
    });
    socket.on("gameError", (d) => {
      const msg = d?.message || "Не вдалося розпочати гру.";
      setGameState(GAME_PHASE.WAITING);
      setShowIntroFade(false);
      setScreen("lobby");
      setCountdownNum(null);
      alert(msg);
    });
    return () => {
      socket.off("playerJoined", handlers.playerJoined);
      socket.off("playerLeft", handlers.playerLeft);
      socket.off("adminChanged", handlers.adminChanged);
      socket.off("playersUpdate", handlers.playersUpdate);
      socket.off("showIntro", handlers.showIntro);
      socket.off("skipRules");
      socket.off("rulesStarted");
      socket.off("skipIntro");
      socket.off("trueFalseStart");
      socket.off("trueFalseSync");
      socket.off("trueFalseResults");
      socket.off("finalBattle");
      socket.off("gameFinished");
      socket.off("gamePaused");
      socket.off("gameResumed");
      socket.off("gameAborted");
      socket.off("answerBeep");
      socket.off("categorySelected");
      socket.off("gameError");
    };
  }, [socket]);

  // Results sequence step "reveal": show ✓/✕, play the result sound, hold a
  // beat, then the reaction clip (or straight to the server if there is none).
  useEffect(() => {
    if (gameState !== GAME_PHASE.SCORES) {
      setShowRoundResultIcons(false);
      resultSoundPlayedRef.current = false;
      setScoresStage(null);
      return undefined;
    }
    if (scoresStage !== "reveal") return undefined;
    if (!resultSoundPlayedRef.current) {
      resultSoundPlayedRef.current = true;
      setShowRoundResultIcons(true);
      if (!isMobile()) {
        const a = resultAudioRef.current;
        if (a) {
          a.currentTime = 0;
          a.play().catch(() => {});
        }
      }
    }
    // the display moves on when its results screen (RoundResults, ~10s) is over: finishResultsCheck()
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, scoresStage, isDisplay]);

  // the reaction clip already played under the results board (RoundResults); a minigame
  // next gets a few seconds in the dark first, otherwise straight on
  function finishResultsCheck() {
    if (minigameNext) setMinigameGap(true);
    else emitScoresDone();
  }

  function emitScoresDone() {
    if (scoresDoneEmittedRef.current || !socket) return;
    if (isScoresDebugActive() || !roomCode) return;
    scoresDoneEmittedRef.current = true;
    setScoresStage("done");
    socket.emit("scoresDone");
  }

  useEffect(() => {
    if (gameState === GAME_PHASE.SCORES) {
      scoresDoneEmittedRef.current = false;
    }
  }, [gameState]);

  // The question scene opens on its video alone; the question (text + reading) comes 2.5s later.
  useEffect(() => {
    if (!isDisplay || gameState !== GAME_PHASE.QUESTION_PLAY) {
      setQuestionRevealed(gameState === GAME_PHASE.ANSWER_PHASE);
      return undefined;
    }
    setQuestionRevealed(false);
    const id = gameClock.setTimeout(() => setQuestionRevealed(true), QUESTION_REVEAL_MS);
    return () => gameClock.clearTimeout(id);
  }, [gameState, isDisplay, roundIndex, questionPlayData?.question?.id]);


  useEffect(() => {
    if (gameState !== GAME_PHASE.ANSWER_PHASE || !question) return;
    const t = gameClock.setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => gameClock.clearInterval(t);
  }, [gameState, question?.id]);

  // ---------------------------------------------------------------- round announcement (display)
  // The round's clip (assets/rounds/announce/round-N/, a different one every game) fades
  // in from black and out to black; without a clip the "РАУНД N" caption holds
  // for a beat. Then the question scene fades in over its own video.
  function finishAnnounce() {
    if (announceDoneRef.current) return;
    announceDoneRef.current = true;
    setRoundIntroVideo(null);
    if (roundIndex === 1 && roundDebugEnabledRef.current) {
      const debugQuestion = {
        id: "dbg-r1-q1",
        text: "DEBUG: Раунд 1 запущено. Тут буде текст питання з round1.",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
      };
      setQuestion({ ...debugQuestion, index: 1, total: TOTAL_ROUNDS });
      setQuestionPlayData({ roundIndex: 1, question: debugQuestion, audioSrc: null });
      setGameState(GAME_PHASE.QUESTION_PLAY);
      return;
    }
    socket?.emit("questionAnnounceDone");
  }

  // Phone: the minigame's own result screen stays PHONE_MG_RESULT_MS, then the phone goes
  // back to the player's screen (character, lives, points) while the TV finishes its scene.
  useEffect(() => {
    if (!isMobile() || isDisplay) return undefined;
    if (!trueFalseResultsPayload) {
      setPhoneMgDone(false);
      return undefined;
    }
    const t = gameClock.setTimeout(() => setPhoneMgDone(true), PHONE_MG_RESULT_MS);
    return () => gameClock.clearTimeout(t);
  }, [trueFalseResultsPayload, isDisplay]);
  useEffect(() => {
    if (trueFalseStart) setPhoneMgDone(false);
  }, [trueFalseStart]);

  // phone: during the game nothing scrolls — every screen fits the visible height, so the page
  // is locked (no scrollbar, no rubber-band); the join form stays scrollable for the keyboard
  useEffect(() => {
    const lock = isMobile() && !isDisplay && (screen === "game" || screen === "lobby" || screen === "mobileWait");
    document.documentElement.classList.toggle("phone-locked", lock);
    return () => document.documentElement.classList.remove("phone-locked");
  }, [screen, isDisplay]);

  // the phone's admin role follows the server (it moves on when the admin leaves or drops out)
  useEffect(() => {
    if (isDisplay || !playerId) return;
    const me = players.find((p) => p.id === playerId);
    if (me) setIsAdmin(!!me.isAdmin);
  }, [players, playerId, isDisplay]);

  // a new round: its announcement hasn't run yet (declared first: runs before the effect below)
  useEffect(() => {
    announceDoneRef.current = false;
    roundGapDoneRef.current = false;
    setRoundGap(false);
    setRoundIntroVideo(null);
  }, [roundIndex]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_ANNOUNCE || !isDisplay) return undefined;
    // round 1 waits for the rules video on the display
    if (roundIndex === 1 && !hasPlayedRulesVideo) return undefined;
    if (announceDoneRef.current) return undefined;
    // rounds 2-9 start with a few seconds in the dark (round 1 already had one after the welcome)
    if (roundIndex >= 2 && !roundGapDoneRef.current) {
      setRoundGap(true);
      return undefined;
    }
    if (announceVideo) {
      setRoundIntroVideo(announceVideo);
      return undefined;
    }
    const t = gameClock.setTimeout(finishAnnounce, 3200);
    return () => gameClock.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, isDisplay, roundIndex, hasPlayedRulesVideo, announceVideo, roundGap]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_PLAY || !questionPlayData || !isDisplay || !questionRevealed) return;
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
  }, [gameState, questionPlayData, isDisplay, socket, questionRevealed]);

  const handleSubtitlesComplete = () => {
    if (!isDisplay || gameState !== GAME_PHASE.QUESTION_PLAY) return;
    const audioSrc = questionPlayData?.question?.audioSrc ?? questionPlayData?.audioSrc;
    if (!audioSrc) {
      questionPlayDoneRef.current = true;
      socket?.emit("questionPlayDone");
    } else {
      gameClock.setTimeout(() => {
        if (questionPlayDoneRef.current) return;
        questionPlayDoneRef.current = true;
        socket?.emit("questionPlayDone");
      }, 800);
    }
  };

  const completeRules = () => {
    setRulesEnding(false);
    setRulesNeedsClick(false);
    setRulesActiveMobile(false);
    setScreen("game");
    if (!isDisplay) {
      setHasPlayedRulesVideo(true);
      return;
    }
    // a breather before round 1: welcome the players, a pause in the dark, then the game starts on the server
    setPreRoundStage("welcome");
  };

  const finishPreRound = () => {
    setPreRoundStage(null);
    setHasPlayedRulesVideo(true);
    // Тільки після rulesmovie (і паузи) запускаємо гру на сервері
    socket?.emit("introEnded");
  };

  const finishRules = (fadeMs = 450) => {
    setRulesFadeOutMs(fadeMs);
    setRulesEnding(true);
    gameClock.setTimeout(() => {
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
    const id = gameClock.setTimeout(() => {
      tryStartRulesVideo();
    }, 50);
    return () => {
      gameClock.clearTimeout(id);
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

    const id = gameClock.setInterval(() => {
      n--;
      if (n <= 0) {
        gameClock.clearInterval(id);
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
    return () => gameClock.clearInterval(id);
  }, [screen]);

  const handleCreateRoom = () => {
    setMusicStarted(true);
    if (!socket) return;
    if (!socket.connected) {
      alert("Немає з'єднання з сервером. Перевірте, що сервер запущений на порту 3001.");
      return;
    }
    setShowMenuDifficulty(false);
    socket.emit("createRoom", { categoryId: selectedCategoryId, difficulty: selectedDifficulty }, (data) => {
      if (!data || !data.roomCode) {
        alert("Помилка створення кімнати. Спробуйте ще раз.");
        return;
      }
      if (data.displayToken) saveDisplaySession({ roomCode: data.roomCode, token: data.displayToken });
      setRoomCode(data.roomCode);
      setPlayers(data.players || []);
      setGameState(data.gameState || "waiting");
      setLobbyCategoryName(data.categoryName || "");
      setLobbyDifficulty(data.difficulty || "");
      if (data.categoryId) setSelectedCategoryId(data.categoryId);
      setIsDisplay(true);
      setIsAdmin(false);
      setScreen("lobby");
    });
  };

  const handleMenuStartClick = () => {
    if (!connected) return;
    setShowMenuDifficulty(true);
  };

  const joinCode = () => (joinCodeInput || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);

  // step 1: code + name -> see which characters are still free
  const handleJoinRoom = (e) => {
    e.preventDefault();
    setJoinError("");
    if (!socket || !connected) return;
    if (!joinCodeInput.trim()) {
      setJoinError("Введіть код кімнати");
      return;
    }
    socket.emit("roomSlots", { roomCode: joinCode() }, (d) => {
      if (!d || d.error) {
        setJoinError(d?.error || "Кімнату не знайдено");
        return;
      }
      setTakenSlots(d.taken || []);
      setPickedSlot(null);
      setJoinStep("character");
    });
  };

  // while choosing, keep the taken characters fresh (someone else may pick first)
  useEffect(() => {
    if (screen !== "join" || joinStep !== "character" || !socket) return undefined;
    const id = window.setInterval(() => {
      socket.emit("roomSlots", { roomCode: joinCode() }, (d) => {
        if (d && !d.error) setTakenSlots(d.taken || []);
      });
    }, 2000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, joinStep, socket]);

  // step 2: the picked character -> join
  const handleJoinWithCharacter = () => {
    if (!socket || !connected) return;
    const name = (playerName || "Гравець").trim();
    socket.emit("joinRoom", { roomCode: joinCode(), playerName: name, characterSlot: pickedSlot }, (data) => {
      if (data.error) {
        setJoinError(data.error);
        setJoinStep("form");
        return;
      }
      saveSession({ roomCode: data.roomCode, playerId: data.playerId, token: data.token });
      setJoinStep("form");
      setRoomCode(data.roomCode);
      setPlayers(data.players || []);
      setGameState(data.gameState || "waiting");
      setPlayerId(data.playerId);
      setLobbyCategoryName(data.categoryName || "");
      setIsDisplay(false);
      setIsAdmin(data.isAdmin || false);
      setScreen("lobby");
    });
  };

  // TEST MODE: the admin adds bots to the lobby (server/bots.js)
  const [botError, setBotError] = useState("");
  const handleAddBot = () => {
    if (!socket || !isAdmin) return;
    setBotError("");
    socket.emit("addBot", {}, (r) => r?.error && setBotError(r.error));
  };
  const handleRemoveBot = (id) => socket?.emit("removeBot", { playerId: id });

  // TV -> server handshakes of a minigame. The minigames restart their "sync" (0.3 s) and
  // "scene done" (~9 s) timers whenever these props change, so they keep one identity:
  // inline arrows changed on every render, and a busy TV could push the results timer
  // back again and again — the game then waited forever.
  const roundIndexRef = useRef(roundIndex);
  roundIndexRef.current = roundIndex;
  const minigameSyncCb = useCallback(
    () => socket?.emit("trueFalseSync", { roundIndex: roundIndexRef.current }),
    [socket]
  );
  const minigameSceneDoneCb = useCallback(() => {
    setTrueFalseResultsPayload(null);
    socket?.emit("trueFalseResultsSceneDone");
  }, [socket]);
  // TEST MODE: straight from the lobby into the final (made-up ratings, a few ghosts)
  const handleTestFinal = () => isAdmin && socket?.emit("debugStartFinal");

  const handleStartGame = () => {
    if (!socket || !isAdmin) return;
    if (!isMobile()) knifeSliceRef.current?.play().catch(() => {});
    socket.emit("startIntro", {});
  };

  const handleIntroEnded = () => {
    if (!socket) return;
    // Дисплей: спочатку rulesmovie, і тільки потім запускаємо 1-й раунд
    if (isDisplay) {
      setScreen("rules"); // the rules effect above announces "rulesStarted" (once)
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
    resetToStart();
  };

  /** Back to the start screen (TV: main menu, phone: join), all game state dropped. */
  function resetToStart() {
    clearSession(); // left on purpose: no coming back to this seat
    clearDisplaySession();
    if (gameClock.isPaused()) applyResume();
    setIntroStarted(false);
    setGameState(GAME_PHASE.WAITING);
    setTrueFalseStart(false);
    setTrueFalseResultsPayload(null);
    setQuestionPlayData(null);
    setScreen(isMobile() ? "join" : "menu");
    setRoomCode("");
    setPlayers([]);
    setLobbyCategoryName("");
    setQuestion(null);
    setAnswerResult(null);
    setFinalIntro(null);
    setFinalResult(null);
    setPlayerId(null);
    setIsDisplay(false);
    setIsAdmin(false);
    setRulesActiveMobile(false);
    setShowIntroFade(false);
  }

  resetToStartRef.current = resetToStart;

  // main menu "Вийти": close the tab. Browsers only let a page close a tab that was
  // opened by a script or never navigated; otherwise a goodbye screen stays.
  const handleCloseTab = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
    } catch {
      /* not fullscreen */
    }
    window.close();
    setTimeout(() => setTabClosed(true), 300);
  };


  const getOptionClass = (idx) => {
    if (!answerResult) return "option";
    if (isMobile()) return "option option-disabled";
    if (idx === answerResult.correctIndex) return "option option-correct";
    if (idx === selectedAnswer && !answerResult.correct) return "option option-wrong";
    return "option option-disabled";
  };

  const finalPreview = isDevEnvironment() ? readFinalPreview() : null;
  if (finalPreview) return <FinalBattlePreview mode={finalPreview} />;

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
          slotsById={Object.fromEntries(MG_PREVIEW_PLAYERS.map((p) => [p.id, p.characterSlot]))}
          contestantIds={buildMgPreviewResults(mgPreview).contestantIds}
          results={buildMgPreviewResults(mgPreview)}
          onSceneDone={() => {}}
        />
      </div>
    );
  }

  const amAdmin = isAdmin || !!players.find((p) => p.id === myPlayerId && p.isAdmin);
  const canPause =
    !!roomCode &&
    gameState !== GAME_PHASE.FINISHED &&
    (gameState !== GAME_PHASE.WAITING || introStarted);

  return (
    <>
      <PauseOverlay
        paused={paused}
        pausedBy={pausedBy}
        canPause={canPause}
        isAdmin={amAdmin}
        isDisplay={isDisplay}
        onPause={() => socket?.emit("pauseGame")}
        onResume={() => socket?.emit("resumeGame")}
        onAbort={() => socket?.emit("abortGame")}
      />
      {tabClosed && (
        <div className="tab-closed" role="dialog" aria-modal="true">
          <p className="tab-closed-title">Дякуємо за гру!</p>
          <p className="tab-closed-hint">Браузер не дозволив сайту закрити вкладку сам — закрийте її (Ctrl+W)</p>
          <button type="button" className="tab-closed-back" onClick={() => setTabClosed(false)}>
            Повернутися в меню
          </button>
        </div>
      )}
      {/* All game audio lives on the display / desktop screen only — the phone
          controllers are silent. Do not render these on mobile. */}
      {!isMobile() && (
        <>
          <audio ref={menuAudioRef} src="/assets/menu/music.mp3" preload="auto" />
          <audio ref={clickAudioRef} src="/assets/sounds/click.mp3" preload="auto" />
          <audio ref={knifeSliceRef} src="/assets/sounds/knife-slice.mp3" preload="auto" />
          <audio ref={bellRef} src="/assets/sounds/bell.mp3" preload="auto" />
          <audio ref={notificationRef} src="/assets/sounds/notification.mp3" preload="auto" />
          <audio ref={answerBeepRef} src="/assets/sounds/beep.mp3" preload="auto" />
          <audio ref={resultAudioRef} src="/assets/sounds/result.mp3" preload="auto" />
          <audio ref={questionAudioRef} preload="auto" />
        </>
      )}
  {isMobile() && screen === "join" && joinStep === "character" && (
      <div className="app app-mobile-bg fun-screen">
        <FunBackdrop />
        <section className="pick-screen">
          <header className="pick-head">
            <button type="button" className="pick-back" onClick={withClick(() => setJoinStep("form"))} aria-label="Назад">
              ←
            </button>
            <div>
              <p className="pick-kicker">Кімната {joinCode()}</p>
              <h2 className="pick-title">Обери свого персонажа</h2>
            </div>
          </header>
          <div className="pick-grid">
            {CHARACTER_SLOTS.map((slot) => {
              const taken = takenSlots.includes(slot);
              return (
                <button
                  key={slot}
                  type="button"
                  className={`pick-card ${pickedSlot === slot ? "picked" : ""} ${taken ? "taken" : ""}`}
                  disabled={taken}
                  onClick={withClick(() => setPickedSlot(slot))}
                >
                  <img src={`/assets/characters/alive/${slot}.png`} alt="" />
                  {taken && <span className="pick-taken">зайнято</span>}
                </button>
              );
            })}
          </div>
          {joinError && <p className="join-error">{joinError}</p>}
          <button
            type="button"
            className="pick-go"
            disabled={!connected || !pickedSlot || takenSlots.includes(pickedSlot)}
            onClick={withClick(handleJoinWithCharacter)}
          >
            {pickedSlot ? "Грати за цього!" : "Торкнись персонажа"}
          </button>
        </section>
      </div>
  )}
  {isMobile() && screen === "join" && resuming && (
      <div className="app app-mobile-bg fun-screen">
        <FunBackdrop />
        <section className="pick-screen pick-resume">
          <p className="pick-title">Повертаємо тебе в гру…</p>
        </section>
      </div>
  )}
  {isMobile() && screen === "join" && joinStep === "form" && !resuming && (
      <div className="app app-mobile-bg fun-screen">
        <FunBackdrop />
        <div className="join-screen-full">
          <div className="fun-logo">
            <img src="/assets/ui/logo-fun.png" alt="Хто є хто!" />
          </div>
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
              Далі: обрати персонажа
            </button>
          </form>
        </div>
      </div>
  )}

  {screen === "menu" && (
      <div className={`app ${!isMobile() ? "menu-with-video" : ""}`}>
        {!isMobile() && (
          <FadeVideo
            className="menu-background-video"
            src="/assets/menu/background.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        {/* Без overlay затемнення для головного меню */}
        <div className="main-menu">
          <a className="menu-site" href={`https://${PUBLIC_SITE}`} onClick={(e) => e.preventDefault()}>
            {PUBLIC_SITE}
          </a>

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
                onClick={withClick(() => { loadCategories(); handleMenuStartClick(); })}
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
                onClick={withClick(handleCloseTab)}
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
              <h2>Оберіть категорію вікторини</h2>
              {categoriesLoading && <p className="menu-hint">Завантаження категорій…</p>}
              {categoriesError && <p className="join-error">{categoriesError}</p>}
              {!categoriesLoading && !categoriesError && categories.length === 0 && (
                <p className="menu-hint">
                  Немає активних категорій. Додайте їх в адмін-панелі (/admin).
                </p>
              )}
              <div className="category-list">
                {categories.map((c) => (
                  <label
                    key={c.id}
                    className={`category-check ${!c.playable ? "category-check-disabled" : ""}`}
                  >
                    <input
                      type="radio"
                      name="menu-category"
                      disabled={!c.playable}
                      checked={selectedCategoryId === c.id}
                      onChange={() => setSelectedCategoryId(c.id)}
                    />
                    {(c.icon ? c.icon + " " : "") + c.name}
                    {!c.playable && (
                      <span className="category-count">
                        {" "}— мало питань ({c.questionCount}/{c.minQuestions})
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <h3 className="difficulty-heading">Складність</h3>
              <div className="difficulty-picker" role="radiogroup" aria-label="Складність">
                {GAME_DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedDifficulty === d.id}
                    className={`difficulty-option ${d.id} ${selectedDifficulty === d.id ? "selected" : ""}`}
                    onClick={withClick(() => setSelectedDifficulty(d.id))}
                  >
                    <span className="difficulty-icon">{d.icon}</span>
                    <b>{d.label}</b>
                    <small>{d.hint}</small>
                  </button>
                ))}
              </div>
              <div className="modal-buttons modal-buttons-single">
                <button
                  type="button"
                  className="btn modal-btn-lobby-btn"
                  onClick={withClick(handleCreateRoom)}
                  disabled={
                    !selectedCategoryId ||
                    !(categories.find((c) => c.id === selectedCategoryId) || {}).playable
                  }
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
      <div className={`app lobby-screen ${!isMobile() ? "lobby-with-video" : "lobby-mobile app-mobile-bg fun-screen"} ${showIntroFade ? "lobby-fade-out" : ""}`}>
        {isMobile() && <FunBackdrop />}
        {!isMobile() ? (
          <>
            <FadeVideo
              className="lobby-background-video"
              src="/assets/menu/background.mp4"
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="lobby-overlay" />
            <div className="lobby-ui-overlay">
              <p className="lobby-wait-text">
                Переходьте на{" "}
                <span className="lobby-wait-highlight">{PUBLIC_SITE}</span>{" "}
                якщо не боїтесь!
              </p>
              <section className="lobby-room-code">
                <p className="room-code-label">Код кімнати</p>
                <p className="room-code-value">
                  <FireTitle text={roomCode} />
                </p>
                <p className="room-code-hint">Введіть код на телефоні</p>
              </section>
              <div className="lobby-info">
                <div className="lobby-chip">
                  <span className="lobby-chip-label">Гравці</span>
                  <span className="lobby-chip-value">
                    {players.length}/{MAX_ROOM_PLAYERS}
                  </span>
                </div>
                {lobbyCategoryName && (
                  <div className="lobby-chip">
                    <span className="lobby-chip-label">Категорія</span>
                    <span className="lobby-chip-value">{lobbyCategoryName}</span>
                  </div>
                )}
                {lobbyDifficulty && (
                  <div className="lobby-chip">
                    <span className="lobby-chip-label">Складність</span>
                    <span className="lobby-chip-value">
                      {(GAME_DIFFICULTIES.find((d) => d.id === lobbyDifficulty) || {}).label || lobbyDifficulty}
                    </span>
                  </div>
                )}
              </div>
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
                  <li
                    key={p.id}
                    className={`player-item ${p.id === playerId ? "me" : ""} ${p.disconnected ? "offline" : ""}`}
                  >
                    <img
                      className="lobby-row-sprite"
                      src={`/assets/characters/alive/${p.characterSlot >= 1 && p.characterSlot <= 8 ? p.characterSlot : 1}.png`}
                      alt=""
                    />
                    <span className="player-name">{p.name}{p.isAdmin ? " ★" : ""}</span>
                    {p.disconnected && <span className="lobby-row-off">📵</span>}
                    {p.isBot && isAdmin && gameState === "waiting" && (
                      <button type="button" className="lobby-bot-remove" onClick={() => handleRemoveBot(p.id)} aria-label="Прибрати бота">
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {gameState === "waiting" && isAdmin && players.length < MAX_ROOM_PLAYERS && (
                <button type="button" className="lobby-add-bot" onClick={withClick(handleAddBot)}>
                  🤖 Додати бота
                </button>
              )}
              {gameState === "waiting" && isAdmin && (
                <button type="button" className="lobby-add-bot" onClick={withClick(handleTestFinal)}>
                  🏁 Тест: одразу у фінал
                </button>
              )}
              {botError && <p className="lobby-bot-error">{botError}</p>}
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
    <div className="app app-mobile-bg mobile-wait-screen fun-screen">
      <FunBackdrop />
      <div className="mobile-wait-card">
        <div className="mobile-wait-title">Зачекайте…</div>
        <div className="mobile-wait-subtitle">
          Гра запускається на телевізорі / основному екрані
        </div>
        {isAdmin && introActiveMobile && !rulesActiveMobile && (
          <button
            type="button"
            className="btn-skip-rules"
            onClick={withClick(() => {
              setIntroActiveMobile(false);
              socket?.emit("skipIntro");
            })}
          >
            Пропустити інтро
          </button>
        )}
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
          src="/assets/rules/rules.mp4"
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
      className={`app ${!isMobile() ? "app-game-with-video" : "app-game-mobile app-mobile-bg felt-day"} ${
        !isMobile() &&
        isDisplay &&
        (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE)
          ? "question-scene-fadein"
          : ""
      }`}
    >
      {!isMobile() && (
        <FadeVideo
          ref={gameBackgroundVideoRef}
          className="game-background-video"
          src={
            isDisplay && gameState === GAME_PHASE.SCORES
              ? "/assets/game/background.mp4"
              : isDisplay &&
                (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE)
                ? questionVideo || "/assets/game/background.mp4"
                : "/assets/game/background.mp4"
          }
          autoPlay
          loop
          playsInline
          muted={gameState === GAME_PHASE.FINAL_BATTLE || gameState === GAME_PHASE.FINISHED || (["rps", "hotBomb", "tugOfWar", "mathRush", "rat", "memory", "tune"].includes(minigameId) && !!(trueFalseStart || trueFalseResultsPayload))}
          onLoadedMetadata={(e) => {
            const isQuestionPhase =
              isDisplay &&
              (gameState === GAME_PHASE.QUESTION_PLAY || gameState === GAME_PHASE.ANSWER_PHASE);
            e.target.volume = isQuestionPhase ? 1 : 0.1; // the host speaks over the question video
          }}
        />
      )}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.SCORES && minigameGap && !trueFalseStart && (
        <DarkPause
          key={`mg-gap-${roundIndex}`}
          ms={MINIGAME_GAP_MS}
          onDone={() => {
            setMinigameGap(false);
            emitScoresDone();
          }}
        />
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        !trueFalseStart &&
        !trueFalseResultsPayload &&
        scoresStage === "reveal" && (
          <RoundResults
            key={`results-${roundIndex}`}
            players={players}
            roundIndex={roundIndex}
            answer={roundAnswer}
            videoSrc={scoresVideos?.afterResult || null}
            onDone={finishResultsCheck}
          />
        )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        !trueFalseStart &&
        !trueFalseResultsPayload &&
        (scoresStage === "afterRound" || scoresStage === "afterResult") && (
        <CinemaClip
          key={scoresStage}
          layer="under"
          volume={1}
          src={scoresStage === "afterRound" ? scoresVideos?.afterRound : scoresVideos?.afterResult}
          onDone={() => {
            // after-round clip -> the ✓/✕ reveal -> the reaction clip -> on with the game
            if (scoresStage === "afterRound") setScoresStage("reveal");
            else emitScoresDone();
          }}
        />
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
          slotsById={playerSlotsById}
          livesById={playerLivesById}
          contestantIds={trueFalseContestantIds}
          results={trueFalseResultsPayload}
          onVideoStartedAt={minigameSyncCb}
          onSceneDone={minigameSceneDoneCb}
        />
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.SCORES &&
        trueFalseResultsPayload &&
        (trueFalseResultsPayload.minigameId || "trueFalse") === "trueFalse" && (
        <TrueFalseAftermath
          data={trueFalseResultsPayload}
          slotsById={playerSlotsById}
          stylingDebug={isDevEnvironment() && readAftermathDebugFlag()}
          onComplete={() => {
            if (isDevEnvironment() && readAftermathDebugFlag()) return;
            setTrueFalseResultsPayload(null);
            socket?.emit("trueFalseResultsSceneDone");
          }}
        />
      )}
      {!isMobile() && isDisplay && preRoundStage === "welcome" && (
        <WelcomePlayers players={players} muted={musicMuted} onDone={() => setPreRoundStage("dark")} />
      )}
      {!isMobile() && isDisplay && preRoundStage === "dark" && <DarkPause ms={PRE_ROUND_DARK_MS} onDone={finishPreRound} />}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.QUESTION_ANNOUNCE && roundGap && (
        <DarkPause
          key={`gap-${roundIndex}`}
          ms={ROUND_GAP_MS}
          onDone={() => {
            roundGapDoneRef.current = true;
            setRoundGap(false);
          }}
        />
      )}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.QUESTION_ANNOUNCE && roundIntroVideo && (
        <>
          <CinemaClip key={roundIntroVideo} src={roundIntroVideo} fit="cover" onDone={finishAnnounce} />
          {/* warm up the question video so the question scene starts without a stutter */}
          {questionVideo && <video className="video-preload-only" src={questionVideo} preload="auto" muted aria-hidden />}
        </>
      )}
      {!isMobile() &&
        isDisplay &&
        gameState === GAME_PHASE.QUESTION_ANNOUNCE &&
        !announceVideo &&
        !roundGap &&
        (roundIndex !== 1 || hasPlayedRulesVideo) && <RoundIntro roundIndex={roundIndex} />}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.FINAL_BATTLE && (
        <FinalBattle
          key={`final-${roomCode}`}
          uiMode="display"
          socket={socket}
          intro={finalIntro}
          myPlayerId={null}
        />
      )}
      {isMobile() && !isDisplay && <FunBackdrop calm />}
      <div className={`app-inner ${!isMobile() ? "app-inner-over-video" : ""}`}>
      {isMobile() && !isDisplay && myPlayer && gameState !== GAME_PHASE.FINAL_BATTLE && gameState !== GAME_PHASE.FINISHED && (
        <header className={`m-me ${myPlayer.isGhost ? "ghost" : ""}`}>
          <img
            className="m-me-sprite"
            src={`/assets/characters/${myPlayer.isGhost ? "dead" : "alive"}/${
              myPlayer.characterSlot >= 1 && myPlayer.characterSlot <= 8 ? myPlayer.characterSlot : 1
            }.png`}
            alt=""
          />
          <div className="m-me-info">
            <b className="m-me-name">{myPlayer.name}</b>
            <span className="m-me-lives">
              {myPlayer.isGhost
                ? "👻 привид"
                : "❤".repeat(Math.max(0, Math.min(10, Number.isFinite(Number(myPlayer.lives)) ? Number(myPlayer.lives) : 3)))}
            </span>
          </div>
          <div className="m-me-score">
            <small>Бали</small>
            <b>{myPlayer.score ?? 0}</b>
          </div>
        </header>
      )}
      {isMobile() &&
        !isDisplay &&
        (gameState === GAME_PHASE.QUESTION_ANNOUNCE || gameState === GAME_PHASE.QUESTION_PLAY) && (
          <section className="m-wait">
            <p className="m-wait-round">
              Раунд {roundIndex} з {TOTAL_ROUNDS}
            </p>
            <p className="m-wait-big">👀 Дивись на екран</p>
            <p className="m-wait-hint">Варіанти відповіді з&apos;являться тут за мить</p>
          </section>
        )}

      <section
        className={`players-panel compact ${!isDisplay ? "players-panel-player" : ""} ${
          gameState === GAME_PHASE.SCORES && !isMobile() ? "players-panel-scores" : ""
        } ${
          gameState === GAME_PHASE.FINAL_BATTLE ||
          (gameState === GAME_PHASE.FINISHED && finalResult?.standings?.length) ||
          (gameState === GAME_PHASE.SCORES && isDisplay) // the TV shows RoundResults instead
            ? "players-panel-hidden"
            : ""
        }`}
        style={!isMobile() ? { ["--players-count"]: Math.max(1, players.length) } : undefined}
      >
        {gameState === GAME_PHASE.SCORES && !isMobile() && (
          <h2 className="scores-panel-title">Перевірка результатів</h2>
        )}
        <ul className="players-list">
          {players.map((p, idx) => (
            <li
              key={p.id}
              className={`player-item ${
                gameState === GAME_PHASE.ANSWER_PHASE ? (p.hasAnswered ? "pp-answered" : "pp-thinking") : ""
              } ${p.isGhost ? "pp-ghost" : ""}`}
              style={{ "--i": idx }}
            >
              <span className="pp-peg" aria-hidden />
              {gameState === GAME_PHASE.ANSWER_PHASE && p.hasAnswered && (
                <svg className="pp-done" viewBox="0 0 60 60" aria-label="відповів">
                  <circle cx="30" cy="30" r="26" className="pp-btn" />
                  {[[22, 22], [38, 22], [22, 38], [38, 38]].map(([x, y]) => (
                    <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" className="pp-hole" />
                  ))}
                  <path d="M17 31 L26 40 L44 20" className="pp-tick" />
                </svg>
              )}
              {gameState === GAME_PHASE.ANSWER_PHASE && !p.hasAnswered && <span className="pp-yarn" aria-hidden />}
              <span className="player-name">{p.name}</span>
              <img
                className={`player-sprite ${p.isGhost ? "player-sprite-ghost" : ""}`}
                src={`/assets/characters/${p.isGhost ? "dead" : "alive"}/${
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
        (questionRevealed || gameState === GAME_PHASE.ANSWER_PHASE) &&
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
                active={questionRevealed}
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
          {players.find((p) => p.id === myPlayerId)?.isGhost && (
            <div className="ghost-banner">👻 ТИ ПРИВИД — відповідай далі: бали нараховуються наполовину</div>
          )}
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
                data-picked={selectedAnswer === idx ? "1" : undefined}
              >
                <span className="opt-letter">{"ABCD"[idx]}</span>
                <span className="opt-text">{opt}</span>
              </button>
            ))}
          </div>
          {isMobile() && selectedAnswer !== null && (
            <p className="m-answer-locked">✅ Відповідь прийнято — чекаємо інших</p>
          )}
          {answerResult && !isMobile() && (
            <div className={`result-message ${answerResult.correct ? "correct" : "wrong"}`}>
              {answerResult.correct
                ? answerResult.scoreAwarded > 0
                  ? `Правильно! +${answerResult.scoreAwarded} балів`
                  : "Правильно! (привид — половина балів)"
                : "Неправильно"}
            </div>
          )}
        </section>
      )}

      {gameState === GAME_PHASE.SCORES && isMobile() && (
        <>
          <section className="scores-screen">
            {roundAnswer?.text && (
              <div className={`m-answer ${(() => {
                const me = players.find((p) => p.id === myPlayerId);
                return me ? (me.lastCorrect ? "ok" : "bad") : "";
              })()}`}>
                <small>Правильна відповідь</small>
                <b>
                  {"ABCD"[roundAnswer.index] || ""} · {roundAnswer.text}
                </b>
                {(() => {
                  const me = players.find((p) => p.id === myPlayerId);
                  if (!me) return null;
                  return <em>{me.lastCorrect ? "✓ Ви вгадали!" : "✗ Цього разу ні"}</em>;
                })()}
              </div>
            )}
            <h2>Бали після раунду</h2>
            <ol className="scores-list">
              {players.map((p, i) => (
                <li key={p.id} className={`score-item ${p.id === myPlayerId ? "me" : ""}`}>
                  <span className="rank">{i + 1}.</span>
                  <span className="name">
                    {p.name}
                    {p.isGhost ? " 👻" : ""}
                  </span>
                  <span className="score">{p.score}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* the minigame takes the phone only once it has really started (until then the
              phone shows the scores), and keeps it for its result screen for a while */}
          {!phoneMgDone && ((trueFalseStart && trueFalseContestantIds.length > 0) || !!trueFalseResultsPayload) && (
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
              slotsById={playerSlotsById}
              livesById={playerLivesById}
              contestantIds={trueFalseContestantIds}
              results={trueFalseResultsPayload}
              statements={trueFalseStatements}
            />
          )}
        </>
      )}

      {!isMobile() && isDisplay && gameState === GAME_PHASE.FINISHED && finalResult?.standings?.length > 0 && !creditsDone && (
        <FinalCredits result={finalResult} onDone={() => setCreditsDone(true)} />
      )}

      {gameState === GAME_PHASE.FINAL_BATTLE && isMobile() && (
        <FinalBattle
          key={`final-m-${roomCode}`}
          uiMode="mobile"
          socket={socket}
          intro={finalIntro}
          myPlayerId={myPlayerId}
        />
      )}

      {gameState === GAME_PHASE.FINISHED && finalResult?.standings?.length > 0 && (
        <FinalResults result={finalResult} myPlayerId={isDisplay ? null : myPlayerId} onExit={withClick(handleExit)} />
      )}

      {gameState === GAME_PHASE.FINISHED && !(finalResult?.standings?.length > 0) && (
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
