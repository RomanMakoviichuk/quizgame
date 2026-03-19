import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import HorrorTimer from "./components/HorrorTimer";
import MainScene from "./components/MainScene";
import TypewriterSubtitles from "./components/TypewriterSubtitles";
import MinigamePlaceholder from "./components/MinigamePlaceholder";
import { GAME_PHASE } from "./game/constants";
import IntroScene from "./components/IntroScene";
import FireTitle from "./components/FireTitle";
import "./App.css";

const SOCKET_URL =
  process.env.REACT_APP_SERVER_URL ||
  (typeof window !== "undefined"
    ? `http://${window.location.hostname}:3001`
    : "http://localhost:3001");

const isMobile = () =>
  typeof window !== "undefined" &&
  (window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent));

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
  const [roundIndex, setRoundIndex] = useState(1);
  const [hasPlayedRulesVideo, setHasPlayedRulesVideo] = useState(false);
  const [rulesNeedsClick, setRulesNeedsClick] = useState(false);
  const [rulesEnding, setRulesEnding] = useState(false);
  const [rulesFadeOutMs, setRulesFadeOutMs] = useState(450);
  const [rulesSkipFadeIn, setRulesSkipFadeIn] = useState(false);
  const [rulesActiveMobile, setRulesActiveMobile] = useState(false);
  const [roundIntroVideo, setRoundIntroVideo] = useState(null); // null | "round1_intro" | "round1_question"
  const [questionPlayData, setQuestionPlayData] = useState(null);
  const questionAudioRef = useRef(null);
  const questionPlayDoneRef = useRef(false);
  const rulesVideoRef = useRef(null);
  const roundIntroVideoRef = useRef(null);
  const round1IntroDoneRef = useRef(false);
  const menuAudioRef = useRef(null);
  const chainAudioRef = useRef(null);
  const clickAudioRef = useRef(null);
  const knifeSliceRef = useRef(null);
  const bellRef = useRef(null);
  const notificationRef = useRef(null);
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
  const isDisplayRef = useRef(isDisplay);
  isDisplayRef.current = isDisplay;
  const pendingRulesSeekRef = useRef(null);
  const rulesSkipFadeRafRef = useRef(null);

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
    const gamePhases = [
      GAME_PHASE.MAIN_SCENE,
      GAME_PHASE.QUESTION_ANNOUNCE,
      GAME_PHASE.QUESTION_PLAY,
      GAME_PHASE.ANSWER_PHASE,
      GAME_PHASE.SCORES,
      GAME_PHASE.MINIGAME,
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
      const seekTo = 51;
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
    socket.on("mainScene", (d) => {
      setPlayers(d.players || []);
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.MAIN_SCENE);
      setRulesActiveMobile(false);
      // Екран ведучого переходить у гру тільки після кастомного інтро (handleIntroEnded).
      // Для телефонів перехід у 'game' відбувається через effect по gameState.
    });
    socket.on("questionAnnounce", (d) => {
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.QUESTION_ANNOUNCE);
    });
    socket.on("questionPlay", (d) => {
      setQuestion({ ...d.question, index: d.roundIndex, total: 10 });
      setQuestionPlayData(d);
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.QUESTION_PLAY);
    });
    socket.on("answerPhase", (d) => {
      setQuestion({ ...d.question, index: d.roundIndex, total: 10 });
      setQuestionPlayData(null);
      setSelectedAnswer(null);
      setAnswerResult(null);
      setGameState(GAME_PHASE.ANSWER_PHASE);
      setAnswerTimeLeft(15);
    });
    socket.on("answerResult", (d) => setAnswerResult(d));
    socket.on("scores", (d) => {
      setPlayers(d.players || []);
      setGameState(GAME_PHASE.SCORES);
    });
    socket.on("minigame", (d) => {
      setPlayers(d.players || []);
      setRoundIndex(d.roundIndex || 1);
      setGameState(GAME_PHASE.MINIGAME);
    });
    socket.on("gameFinished", (d) => {
      setPlayers(d.players || []);
      setGameState(GAME_PHASE.FINISHED);
      setQuestion(null);
      setAnswerResult(null);
    });
    return () => {
      socket.off("playerJoined", handlers.playerJoined);
      socket.off("playerLeft", handlers.playerLeft);
      socket.off("adminChanged", handlers.adminChanged);
      socket.off("playersUpdate", handlers.playersUpdate);
      socket.off("showIntro", handlers.showIntro);
      socket.off("skipRules");
      socket.off("rulesStarted");
    };
  }, [socket]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.ANSWER_PHASE || !question) return;
    const t = setInterval(() => {
      setAnswerTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [gameState, question?.id]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_ANNOUNCE || !isDisplay) return;
    // Блок: раунд 1 не можна стартувати, поки не завершилось rulesmovie (на дисплеї).
    if (roundIndex === 1 && !hasPlayedRulesVideo) return;
    // Round 1: show presentation video -> question video, then start question
    if (roundIndex === 1 && !round1IntroDoneRef.current) {
      setRoundIntroVideo("round1_intro");
      return;
    }
    const t = setTimeout(() => socket?.emit("questionAnnounceDone"), 2000);
    return () => clearTimeout(t);
  }, [gameState, isDisplay, socket, roundIndex, hasPlayedRulesVideo]);

  useEffect(() => {
    if (!isDisplay) return;
    if (gameState !== GAME_PHASE.QUESTION_ANNOUNCE) {
      setRoundIntroVideo(null);
      return;
    }
    if (roundIndex !== 1) return;
    if (!hasPlayedRulesVideo) return;
    if (round1IntroDoneRef.current) return;
    if (!roundIntroVideo) return;

    const v = roundIntroVideoRef.current;
    if (!v) return;

    const startQuestion = () => {
      if (round1IntroDoneRef.current) return;
      round1IntroDoneRef.current = true;
      window.setTimeout(() => {
        setRoundIntroVideo(null);
        socket?.emit("questionAnnounceDone");
      }, 50);
    };

    const onEnded = () => {
      if (roundIntroVideo === "round1_intro") {
        setRoundIntroVideo("round1_question");
        return;
      }
      // If "question.mp4" ends quickly, still start the question.
      startQuestion();
    };

    const tryPlay = () => {
      v.play().catch(() => {});
      if (roundIntroVideo === "round1_question") {
        // As soon as question video starts, begin question.
        startQuestion();
      }
    };

    v.onended = onEnded;
    v.onloadedmetadata = tryPlay;
    tryPlay();

    return () => {
      if (v) {
        v.onended = null;
        v.onloadedmetadata = null;
      }
    };
  }, [roundIntroVideo, isDisplay, gameState, roundIndex, hasPlayedRulesVideo, socket]);

  useEffect(() => {
    // Reset per-game/round intro when leaving round 1
    if (roundIndex !== 1) {
      round1IntroDoneRef.current = false;
      setRoundIntroVideo(null);
    }
  }, [roundIndex]);

  useEffect(() => {
    if (gameState !== GAME_PHASE.QUESTION_PLAY || !questionPlayData || !isDisplay) return;
    questionPlayDoneRef.current = false;
    const audio = questionPlayData.audioSrc;
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
    if (!questionPlayData?.audioSrc) {
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
    if (idx === answerResult.correctIndex) return "option option-correct";
    if (idx === selectedAnswer && !answerResult.correct) return "option option-wrong";
    return "option option-disabled";
  };

  return (
    <>
      <audio ref={menuAudioRef} src="/assets/sounds/mainmenu.mp3" preload="auto" />
      <audio ref={clickAudioRef} src="/assets/sounds/click-sound.mp3" preload="auto" />
      <audio ref={knifeSliceRef} src="/assets/sounds/knife-slice.mp3" preload="auto" />
      <audio ref={bellRef} src="/assets/sounds/bell.mp3" preload="auto" />
      <audio ref={notificationRef} src="/assets/sounds/notification.mp3" preload="auto" />
      <audio ref={questionAudioRef} preload="auto" />
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
                Підключилось гравців {players.length}/8
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
              <h3>Гравці ({players.length}/7)</h3>
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

  {screen === "introScene" && (
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
    <div className={`app ${!isMobile() ? "app-game-with-video" : "app-game-mobile app-mobile-bg"}`}>
      {!isMobile() && (
        <video
          className="game-background-video"
          src="/assets/videos/main.mp4"
          autoPlay
          loop
          playsInline
          onLoadedMetadata={(e) => { e.target.volume = 0.1; }}
        />
      )}
      {!isMobile() && isDisplay && gameState === GAME_PHASE.QUESTION_ANNOUNCE && roundIndex === 1 && roundIntroVideo && (
        <div className="round-video-overlay">
          <video
            ref={roundIntroVideoRef}
            className="round-video"
            src={
              roundIntroVideo === "round1_intro"
                ? "/assets/questions/video/introround1.mp4"
                : "/assets/questions/video/question.mp4"
            }
            autoPlay
            playsInline
            preload="auto"
          />
        </div>
      )}
      <div className={`app-inner ${!isMobile() ? "app-inner-over-video" : ""}`}>
      <header className="app-header">
        {!isMobile() && <span className="room-code-badge">{roomCode}</span>}
      </header>
      <section className={`players-panel compact ${!isDisplay ? "players-panel-player" : ""}`}>
        <ul className="players-list">
          {players.map((p) => (
            <li key={p.id} className="player-item">
              <span className="player-name">{p.name}</span>
              <span className="player-score">{p.score}</span>
            </li>
          ))}
        </ul>
      </section>

      {gameState === GAME_PHASE.MAIN_SCENE && (
        <MainScene players={players} />
      )}

      {gameState === GAME_PHASE.QUESTION_ANNOUNCE && (
        <section className="question-announce">
          <h2 className="question-announce-text">Раунд {roundIndex}</h2>
        </section>
      )}

      {gameState === GAME_PHASE.QUESTION_PLAY && questionPlayData?.question && (
        <section className="question-play-screen">
          <TypewriterSubtitles
            key={questionPlayData.question.id ?? `round-${questionPlayData.roundIndex}`}
            text={questionPlayData.question.text}
            active={true}
            speed={60}
            onComplete={handleSubtitlesComplete}
          />
        </section>
      )}

      {gameState === GAME_PHASE.ANSWER_PHASE && question && (
        <section className={`question-screen ${isDisplay ? "question-screen-host" : ""}`}>
          <div className="question-header">Раунд {question.index} з 10</div>
          <h2 className="question-text">{question.text}</h2>
          <div className="bomb-timer-wrap">
            <HorrorTimer
              timeLeft={answerTimeLeft}
              questionId={question?.id}
              totalSeconds={15}
            />
          </div>
          {isDisplay ? (
            <p className="host-waiting">Очікування відповідей на телефонах...</p>
          ) : (
            <>
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
              {answerResult && (
                <div className={`result-message ${answerResult.correct ? "correct" : "wrong"}`}>
                  {answerResult.correct ? "Правильно! +10 балів" : "Неправильно"}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {gameState === GAME_PHASE.MINIGAME && (
        <MinigamePlaceholder
          roundIndex={roundIndex}
          isDisplay={isDisplay}
          onDone={() => socket?.emit("minigameDone")}
        />
      )}

      {gameState === GAME_PHASE.SCORES && (
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
