/**
 * The round phase machine.
 *
 *   WAITING
 *     -> startGame()                     (after intro + rules)
 *   QUESTION_ANNOUNCE  emit "questionAnnounce"
 *     -> display: "questionAnnounceDone" -> emitQuestionPlay()
 *   QUESTION_PLAY      emit "questionPlay"
 *     -> round 1: fixed timer            -> startAnswerPhase()
 *     -> rounds 2-10: "questionPlayDone" -> startAnswerPhase()
 *   ANSWER_PHASE       emit "answerPhase" + 15s timer
 *     -> all answered OR timeout         -> checkAnswers() -> emitScores()
 *   SCORES            emit "scores"; a minigame contest is armed here
 *     -> display: "scoresDone"           -> handleScoresDone()
 *          - minigame pending  -> startMinigame()
 *          - minigame resolved -> wait for "trueFalseResultsSceneDone"
 *          - no minigame       -> advanceRound()
 *   ...loop x TOTAL_ROUNDS, then FINISHED emit "gameFinished"
 *
 * Exported as a factory so `io` is injected, not global.
 */
const {
  GAME_STATE,
  TOTAL_ROUNDS,
  SCORE_CORRECT,
  LIVES_PER_PLAYER,
  ANSWER_TIMER_MS,
  ROUND1_ANSWER_DELAY_MS,
  FINAL_BATTLE_PLACEHOLDER_MS,
} = require("./config");
const { getRounds, normalizeDifficulty } = require("./questions");
const {
  serializePlayer,
  getPlayersList,
  resetPlayersAnswered,
} = require("./rooms");
const minigames = require("./minigames");

module.exports = function createPhases(io) {
  const to = (room) => io.to(room.code);

  // ---------------------------------------------------------------- round flow

  function startGame(room) {
    room.currentRoundIndex = 0;
    room.selectedDifficulty = normalizeDifficulty(room.selectedDifficulty);
    room.rounds = getRounds(room.selectedDifficulty);
    emitQuestionAnnounce(room);
  }

  function emitQuestionAnnounce(room) {
    room.gameState = GAME_STATE.QUESTION_ANNOUNCE;
    to(room).emit("questionAnnounce", { roundIndex: room.currentRoundIndex + 1 });
  }

  function emitQuestionPlay(room) {
    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return emitScores(room);

    room.gameState = GAME_STATE.QUESTION_PLAY;
    to(room).emit("questionPlay", {
      roundIndex: room.currentRoundIndex + 1,
      question: roundData.question,
      audioSrc: roundData.audioSrc,
    });

    // Round 1: answer phase starts on a fixed delay from the question video start.
    if (room.currentRoundIndex === 0) {
      if (room.preAnswerTimer) clearTimeout(room.preAnswerTimer);
      room.preAnswerTimer = setTimeout(() => {
        if (room.gameState !== GAME_STATE.QUESTION_PLAY) return;
        room.preAnswerTimer = null;
        startAnswerPhase(room);
      }, ROUND1_ANSWER_DELAY_MS);
    }
  }

  function startAnswerPhase(room) {
    if (room.preAnswerTimer) {
      clearTimeout(room.preAnswerTimer);
      room.preAnswerTimer = null;
    }
    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return emitScores(room);

    room.gameState = GAME_STATE.ANSWER_PHASE;
    resetPlayersAnswered(room);
    to(room).emit("answerPhase", {
      question: roundData.question,
      roundIndex: room.currentRoundIndex + 1,
    });
    room.questionTimer = setTimeout(() => checkAnswers(room), ANSWER_TIMER_MS);
  }

  function checkAnswers(room) {
    if (room.gameState !== GAME_STATE.ANSWER_PHASE) return;
    if (room.questionTimer) {
      clearTimeout(room.questionTimer);
      room.questionTimer = null;
    }
    emitScores(room);
  }

  function submitAnswer(room, socketId, answerIndex) {
    const player = room.players.get(socketId);
    if (
      !player ||
      room.gameState !== GAME_STATE.ANSWER_PHASE ||
      player.hasAnswered
    )
      return;

    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return;

    const isCorrect = answerIndex === roundData.question.correctIndex;
    player.hasAnswered = true;
    player.lastAnswerIndex = answerIndex;
    if (isCorrect) player.score += SCORE_CORRECT;

    io.to(socketId).emit("answerResult", {
      correct: isCorrect,
      correctIndex: roundData.question.correctIndex,
      score: player.score,
    });
    to(room).emit("playersUpdate", { players: getPlayersList(room) });
    to(room).emit("answerBeep");

    if ([...room.players.values()].every((p) => p.hasAnswered)) {
      checkAnswers(room);
    }
  }

  function emitScores(room) {
    room.gameState = GAME_STATE.SCORES;
    room.scoresVideoDone = false;
    room.roundAdvanced = false;

    const roundData = room.rounds[room.currentRoundIndex];
    const correctIndex = roundData?.question?.correctIndex ?? 0;
    const roundIndex = room.currentRoundIndex + 1;

    const playersList = [...room.players.values()]
      .map((p) => ({
        ...serializePlayer(p),
        lastCorrect: p.hasAnswered && p.lastAnswerIndex === correctIndex,
      }))
      .sort((a, b) => b.score - a.score);

    to(room).emit("scores", { players: playersList, roundIndex });

    armMinigame(room, correctIndex, roundIndex);
  }

  function advanceRound(room) {
    if (!room || room.roundAdvanced) return;
    room.roundAdvanced = true;
    room.currentRoundIndex++;

    if (room.currentRoundIndex >= TOTAL_ROUNDS) {
      startFinalBattle(room);
    } else {
      emitQuestionAnnounce(room);
    }
  }

  // --------------------------------------------------------------- final battle

  /**
   * After round 9. Placeholder for now: the display shows a "ФІНАЛЬНА БИТВА"
   * caption, then either the display emits "finalBattleDone" or the server
   * fallback timer fires — both call finishGame(). Real mechanics + video go here.
   */
  function startFinalBattle(room) {
    room.gameState = GAME_STATE.FINAL_BATTLE;
    room.finalBattleDone = false;
    to(room).emit("finalBattle", {
      players: getPlayersList(room).sort((a, b) => b.score - a.score),
    });
    if (room.finalBattleTimer) clearTimeout(room.finalBattleTimer);
    room.finalBattleTimer = setTimeout(
      () => finishGame(room),
      FINAL_BATTLE_PLACEHOLDER_MS + 1500
    );
  }

  function handleFinalBattleDone(room) {
    if (room.gameState !== GAME_STATE.FINAL_BATTLE) return;
    finishGame(room);
  }

  function finishGame(room) {
    if (room.gameState === GAME_STATE.FINISHED) return;
    if (room.finalBattleTimer) {
      clearTimeout(room.finalBattleTimer);
      room.finalBattleTimer = null;
    }
    room.gameState = GAME_STATE.FINISHED;
    to(room).emit("gameFinished", {
      players: getPlayersList(room).sort((a, b) => b.score - a.score),
    });
  }

  // ------------------------------------------------------------------ minigame
  //
  // phases.js drives a generic lifecycle; the behaviour lives in
  // server/minigames/<id>.js. A minigame def may implement any of:
  //   buildContest(ctx)  onStart(mg,ctx)  onSync(mg,nowTs,ctx)
  //   onClientEvent(mg,playerId,name,data,ctx)  resolveLosers(mg)  buildResults(mg)
  //   clientScored: true   (phones report a final score via "trueFalseScore")

  /** Helpers handed to minigame hooks so they can emit + schedule without `io`. */
  function minigameCtx(room) {
    return {
      now: () => Date.now(),
      players: () =>
        [...room.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          lives: p.lives ?? LIVES_PER_PLAYER,
          characterSlot: p.characterSlot ?? 1,
        })),
      emitAll: (event, data) => to(room).emit(event, data),
      emitPlayer: (playerId, event, data) => {
        for (const [sid, p] of room.players) {
          if (p.id === playerId) {
            io.to(sid).emit(event, data);
            return;
          }
        }
      },
      // one pending minigame timer at a time (cleared on room teardown)
      setTimer: (fn, ms) => {
        if (!room.minigame) return;
        if (room.minigame.playTimer) clearTimeout(room.minigame.playTimer);
        room.minigame.playTimer = setTimeout(fn, Math.max(0, ms));
      },
      scheduleResolve: (ms) => {
        if (!room.minigame) return;
        if (room.minigame.playTimer) clearTimeout(room.minigame.playTimer);
        room.minigame.playTimer = setTimeout(
          () => resolveMinigame(room),
          Math.max(0, ms)
        );
      },
      resolveNow: () => resolveMinigame(room),
    };
  }

  function clearMinigame(room) {
    const mg = room.minigame;
    if (mg?.timeoutHandle) clearTimeout(mg.timeoutHandle);
    if (mg?.playTimer) clearTimeout(mg.playTimer);
    room.minigame = null;
  }

  /** Build (but don't start) the first matching minigame for the round that ended. */
  function armMinigame(room, correctIndex, roundIndex) {
    clearMinigame(room);

    for (const def of minigames.selectForRound(roundIndex)) {
      const contest = def.buildContest({
        players: [...room.players.values()],
        correctIndex,
        roundIndex,
      });
      if (!contest || !contest.contestantIds || contest.contestantIds.length === 0) {
        continue;
      }
      room.minigame = {
        ...contest,
        def,
        scores: new Map(), // playerId -> score (clientScored path)
        resolved: false,
        startEmitted: false,
        syncReceived: false,
        livesApplied: false,
        pendingLoserIds: [],
        startedAtTs: null,
        timeoutHandle: null,
        playTimer: null,
      };
      def.onStart?.(room.minigame, minigameCtx(room));
      return;
    }
  }

  function startMinigame(room) {
    const mg = room.minigame;
    if (!mg || mg.resolved || mg.startEmitted) return;
    mg.startEmitted = true;

    to(room).emit("trueFalseStart", {
      minigameId: mg.minigameId,
      roundIndex: mg.roundIndex,
      contestantIds: mg.contestantIds,
      mode: mg.mode,
    });

    if (!mg.timeoutHandle) {
      mg.timeoutHandle = setTimeout(
        () => resolveMinigame(room),
        mg.def.TOTAL_DURATION_MS
      );
    }
  }

  /** Display asks for a shared clock so every device runs the same 3-2-1. */
  function syncMinigame(room) {
    const mg = room.minigame;
    if (!mg || mg.resolved || mg.syncReceived) return;
    mg.syncReceived = true;
    const now = Date.now();
    mg.startedAtTs = now;
    to(room).emit("trueFalseSync", { startedAtTs: now, serverTime: now });
    mg.def.onSync?.(mg, now, minigameCtx(room));
  }

  /** clientScored minigames (True/False): a phone reports its final score. */
  function submitMinigameScore(room, playerId, rawScore) {
    const mg = room.minigame;
    if (!mg || mg.resolved || !mg.def.clientScored || !playerId) return;
    if (!mg.contestantIds.includes(playerId)) return;

    const score = Number.isFinite(Number(rawScore))
      ? Math.max(0, Math.floor(Number(rawScore)))
      : 0;
    mg.scores.set(playerId, score);

    if (mg.scores.size >= mg.contestantIds.length) resolveMinigame(room);
  }

  /** Server-authoritative minigames: a "minigame:*" event from a player. */
  function handleMinigameEvent(room, playerId, name, data) {
    const mg = room.minigame;
    if (!mg || mg.resolved || !mg.def.onClientEvent || !playerId) return;
    if (!mg.contestantIds.includes(playerId)) return;
    mg.def.onClientEvent(mg, playerId, name, data || {}, minigameCtx(room));
  }

  /** Score the contest and broadcast results. Lives are NOT applied yet. */
  function resolveMinigame(room) {
    const mg = room.minigame;
    if (!mg || mg.resolved) return;
    if (mg.timeoutHandle) {
      clearTimeout(mg.timeoutHandle);
      mg.timeoutHandle = null;
    }
    if (mg.playTimer) {
      clearTimeout(mg.playTimer);
      mg.playTimer = null;
    }
    mg.resolved = true;
    mg.pendingLoserIds = mg.def.resolveLosers(mg) || [];

    const namesById = {};
    const livesById = {};
    for (const p of room.players.values()) {
      namesById[p.id] = p.name;
      livesById[p.id] = p.lives ?? LIVES_PER_PLAYER;
    }
    const extra = mg.def.buildResults ? mg.def.buildResults(mg) : {};

    to(room).emit("trueFalseResults", {
      minigameId: mg.minigameId,
      roundIndex: mg.roundIndex,
      mode: mg.mode,
      contestantIds: mg.contestantIds,
      loserIds: mg.pendingLoserIds,
      namesById,
      livesById,
      minigameScores: extra.minigameScores || {},
      ...extra,
    });
    to(room).emit("playersUpdate", { players: getPlayersList(room) });
  }

  /** After the aftermath scene: take the lives, then advance the round. */
  function applyMinigameLives(room) {
    const mg = room.minigame;
    if (!mg || !mg.resolved || mg.livesApplied) return;
    mg.livesApplied = true;

    for (const id of mg.pendingLoserIds) {
      for (const p of room.players.values()) {
        if (p.id === id) {
          p.lives = Math.max(0, (p.lives ?? LIVES_PER_PLAYER) - 1);
          break;
        }
      }
    }
    to(room).emit("playersUpdate", { players: getPlayersList(room) });

    const scoresVideoWasDone = room.scoresVideoDone;
    clearMinigame(room);
    if (scoresVideoWasDone) advanceRound(room);
  }

  /** Display finished the score video. */
  function handleScoresDone(room) {
    if (room.gameState !== GAME_STATE.SCORES) return;
    room.scoresVideoDone = true;

    const mg = room.minigame;
    if (mg && !mg.resolved) return startMinigame(room);
    if (mg && mg.resolved && !mg.livesApplied) return; // waiting on aftermath scene
    advanceRound(room);
  }

  return {
    startGame,
    emitQuestionAnnounce,
    emitQuestionPlay,
    startAnswerPhase,
    checkAnswers,
    submitAnswer,
    emitScores,
    advanceRound,
    handleFinalBattleDone,
    handleScoresDone,
    startMinigame,
    syncMinigame,
    submitMinigameScore,
    handleMinigameEvent,
    resolveMinigame,
    applyMinigameLives,
  };
};
