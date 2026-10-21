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
 *   ...loop x TOTAL_ROUNDS
 *   FINAL_BATTLE      emit "finalBattle" (intro) -> display: "finalBattleIntroDone"
 *     -> loop: "finalQuestion" -> answers / 10s -> "finalStepResult"
 *     -> someone escaped / darkness took everyone -> FINISHED emit "gameFinished"
 *
 * Rating: only awardScore() changes player.score; a ghost (lives hit 0 in
 * applyMinigameLives) gets GHOST_SCORE_SHARE (half) of every award.
 *
 * Exported as a factory so `io` is injected, not global.
 */
const {
  GAME_STATE,
  TOTAL_ROUNDS,
  SCORE_CORRECT,
  MINIGAME_WIN_BONUS,
  MINIGAME_SAFE_POINTS,
  SMALL_GAME_MAX_PLAYERS,
  GHOST_SCORE_SHARE,
  LIVES_PER_PLAYER,
  ANSWER_TIMER_MS,
  ROUND1_ANSWER_DELAY_MS,
  FINAL,
} = require("./config");
const { getRounds, getFinalDeck } = require("./questions");
const finalBattle = require("./finalBattle");
const clock = require("./clock");
const media = require("./media");
const {
  serializePlayer,
  getPlayersList,
  resetPlayersAnswered,
} = require("./rooms");
const minigames = require("./minigames");

module.exports = function createPhases(io) {
  const to = (room) => io.to(room.code);

  function emitToPlayer(room, playerId, event, data) {
    for (const [sid, p] of room.players) {
      if (p.id === playerId) {
        io.to(sid).emit(event, data);
        return;
      }
    }
  }

  /** The only way the rating changes. Ghosts are frozen. Returns points awarded. */
  /** Every rating change. A ghost (lost all lives) still scores, but only half (rounded up). */
  // ------------------------------------------------------------- the TV handshakes
  //
  // The TV moves the round on ("questionAnnounceDone", "scoresDone",
  // "trueFalseSync", "trueFalseResultsSceneDone"…). If one never comes — the TV
  // froze, reloaded mid-scene, its tab was throttled — the game used to wait
  // forever. Every such wait now arms one generous fallback (game clock, so the
  // admin pause stops it too) that moves on by itself and says so in the log.
  const STALL_MS = {
    questionAnnounceDone: 60000,
    firstAnnounceDone: 150000, // round 1: the welcome of every player comes first
    questionPlayDone: 60000,
    scoresDone: 120000, // after-round clip, the reveal board, the reaction clip
    trueFalseSync: 30000,
    trueFalseResultsSceneDone: 60000,
  };

  function step(room, what) {
    if (process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT) return;
    console.log(`[game] room ${room.code} round ${room.currentRoundIndex + 1}: ${what}`);
  }

  function watchTv(room, what, fn, ms = STALL_MS[what]) {
    unwatchTv(room);
    room.stallTimer = clock.schedule(room, () => {
      room.stallTimer = null;
      if (!(process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT))
        console.warn(`[stall] room ${room.code}: no "${what}" from the TV after ${ms / 1000}s — moving on without it`);
      fn();
    }, ms);
  }

  function unwatchTv(room) {
    if (room.stallTimer) clock.cancel(room.stallTimer);
    room.stallTimer = null;
  }

  function awardScore(player, points) {
    if (!player || !(points > 0)) return 0;
    const gained = player.isGhost ? Math.ceil(points * GHOST_SCORE_SHARE) : points;
    player.score += gained;
    return gained;
  }

  // ---------------------------------------------------------------- round flow

  function startGame(room) {
    const result = getRounds(room.categoryId, room.difficulty);
    if (result.error) {
      // Not enough questions / category unavailable — abort back to the lobby.
      room.gameState = GAME_STATE.WAITING;
      to(room).emit("gameError", {
        message: result.error,
        available: result.available,
      });
      return;
    }
    room.currentRoundIndex = 0;
    room.rounds = result.rounds;
    room.minigameHistory = [];
    room.announceVideos = {}; // this game's "РАУНД N" clips (media.announceVideo)
    room.questionVideos = {}; // and question backgrounds (media.questionVideo)
    emitQuestionAnnounce(room);
  }

  function emitQuestionAnnounce(room) {
    room.gameState = GAME_STATE.QUESTION_ANNOUNCE;
    const roundIndex = room.currentRoundIndex + 1;
    // dev/demo (MINIGAME_DEMO): the TV skips the rules and round intro videos
    const skipIntroVideos = !!process.env.MINIGAME_DEMO;
    step(room, "announce");
    watchTv(
      room,
      roundIndex === 1 ? "firstAnnounceDone" : "questionAnnounceDone",
      () => room.gameState === GAME_STATE.QUESTION_ANNOUNCE && emitQuestionPlay(room)
    );
    to(room).emit("questionAnnounce", {
      roundIndex,
      skipIntroVideos,
      introVideo: skipIntroVideos ? null : media.announceVideo(room, roundIndex),
      questionVideo: media.questionVideo(room, roundIndex),
    });
  }

  function emitQuestionPlay(room) {
    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return emitScores(room);

    room.gameState = GAME_STATE.QUESTION_PLAY;
    step(room, "question");
    if (room.currentRoundIndex === 0) unwatchTv(room); // round 1 runs on its own timer
    else watchTv(room, "questionPlayDone", () => room.gameState === GAME_STATE.QUESTION_PLAY && startAnswerPhase(room));
    to(room).emit("questionPlay", {
      roundIndex: room.currentRoundIndex + 1,
      question: roundData.question,
      audioSrc: roundData.audioSrc,
    });

    // Round 1: answer phase starts on a fixed delay from the question video start.
    if (room.currentRoundIndex === 0) {
      if (room.preAnswerTimer) clock.cancel(room.preAnswerTimer);
      room.preAnswerTimer = clock.schedule(room, () => {
        if (room.gameState !== GAME_STATE.QUESTION_PLAY) return;
        room.preAnswerTimer = null;
        startAnswerPhase(room);
      }, ROUND1_ANSWER_DELAY_MS);
    }
  }

  function startAnswerPhase(room) {
    if (room.preAnswerTimer) {
      clock.cancel(room.preAnswerTimer);
      room.preAnswerTimer = null;
    }
    const roundData = room.rounds[room.currentRoundIndex];
    if (!roundData?.question) return emitScores(room);

    room.gameState = GAME_STATE.ANSWER_PHASE;
    unwatchTv(room);
    step(room, "answers open");
    room.answerEndsAt = clock.now(room) + ANSWER_TIMER_MS; // for a phone that comes back mid-question
    resetPlayersAnswered(room);
    to(room).emit("playersUpdate", { players: getPlayersList(room) }); // fresh "answered" marks on the TV
    to(room).emit("answerPhase", {
      question: roundData.question,
      roundIndex: room.currentRoundIndex + 1,
    });
    room.questionTimer = clock.schedule(room, () => checkAnswers(room), ANSWER_TIMER_MS);
  }

  /** Everyone answered, or the answer timer ran out: on to the results. */
  function checkAnswers(room) {
    if (room.gameState !== GAME_STATE.ANSWER_PHASE) return;
    if (room.questionTimer) {
      clock.cancel(room.questionTimer);
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
    const scoreAwarded = isCorrect ? awardScore(player, SCORE_CORRECT) : 0;

    io.to(socketId).emit("answerResult", {
      correct: isCorrect,
      correctIndex: roundData.question.correctIndex,
      score: player.score,
      scoreAwarded,
      isGhost: !!player.isGhost,
    });
    to(room).emit("playersUpdate", { players: getPlayersList(room) });
    to(room).emit("answerBeep");

    // everyone answered: the round ends right away
    if ([...room.players.values()].every((p) => p.hasAnswered)) checkAnswers(room);
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

    // results sequence clips on the display: after-round -> reveal -> reaction
    const videos = media.roundVideos(room, playersList);
    // armed first, so the display knows a minigame follows (a pause in the dark before it)
    armMinigame(room, correctIndex, roundIndex);
    // the right answer, shown on the TV results board and on the phones
    const q = roundData?.question;
    const answer = q ? { question: q.text, index: correctIndex, text: q.options?.[correctIndex] ?? "" } : null;
    to(room).emit("scores", { players: playersList, roundIndex, videos, minigameNext: !!room.minigame, answer });
    step(room, `results (${room.minigame ? `then ${room.minigame.minigameId}` : "no minigame"})`);
    watchTv(room, "scoresDone", () => room.gameState === GAME_STATE.SCORES && !room.scoresVideoDone && handleScoresDone(room));
  }

  function advanceRound(room) {
    if (!room || room.roundAdvanced) return;
    room.roundAdvanced = true;
    room.currentRoundIndex++;

    // Everyone died before the final: nobody is left to play for — a draw.
    const everyone = [...room.players.values()];
    if (everyone.length > 0 && everyone.every((p) => p.isGhost)) {
      return finishGame(room, { ending: finalBattle.ENDING.DRAW });
    }

    if (room.currentRoundIndex >= TOTAL_ROUNDS) {
      startFinalBattle(room);
    } else {
      emitQuestionAnnounce(room);
    }
  }

  // --------------------------------------------------------------- final battle
  //
  // Rules live in finalBattle.js (pure). Here: one timer at a time in
  // room.finalBattleTimer (cleared by clearRoomTimers), stage guards against
  // duplicate events, and the wire events.

  function setFinalTimer(room, fn, ms) {
    if (room.finalBattleTimer) clock.cancel(room.finalBattleTimer);
    room.finalBattleTimer = clock.schedule(room, () => {
      room.finalBattleTimer = null;
      fn();
    }, ms);
  }

  /** After round 9 (its minigame and lives are already settled). Runs once. */
  function startFinalBattle(room) {
    if (room.gameState === GAME_STATE.FINAL_BATTLE || room.gameState === GAME_STATE.FINISHED)
      return;
    room.gameState = GAME_STATE.FINAL_BATTLE;
    unwatchTv(room); // the final has its own fallbacks
    step(room, "final");
    const race = finalBattle.createRace([...room.players.values()]);
    race.stage = "intro";
    room.finalBattle = race;
    room.finalDeck = getFinalDeck(
      room.categoryId,
      (room.rounds || []).map((r) => r.question?.id).filter(Boolean)
    );

    if (race.participants.length === 0 || room.finalDeck.length === 0) {
      race.ending = finalBattle.ENDING.ALL_CONSUMED;
      return finishGame(room);
    }

    to(room).emit("finalBattle", {
      stage: "intro",
      ...finalBattle.publicState(race),
      rules: {
        exit: FINAL.EXIT,
        moves: FINAL.MOVES,
        otherMove: FINAL.MOVE_OTHER_CORRECT,
        answerMs: FINAL.ANSWER_MS,
      },
    });
    setFinalTimer(room, () => startFinalStep(room), FINAL.INTRO_MAX_MS);
  }

  /** Display finished the intro (title, line-up, rules, 3-2-1). */
  function handleFinalIntroDone(room) {
    if (room.gameState !== GAME_STATE.FINAL_BATTLE) return;
    if (room.finalBattle?.stage !== "intro") return;
    startFinalStep(room);
  }

  function startFinalStep(room) {
    const race = room.finalBattle;
    if (room.gameState !== GAME_STATE.FINAL_BATTLE || !race || race.ending) return;
    if (race.stage === "question") return;

    const q = room.finalDeck[race.step % room.finalDeck.length];
    finalBattle.beginStep(race, q.correctIndex);
    race.stage = "question";
    const now = clock.now(room);
    race.question = {
      step: race.step,
      text: q.text,
      options: q.options,
      endsAt: now + FINAL.ANSWER_MS,
      answerMs: FINAL.ANSWER_MS,
    };
    to(room).emit("finalQuestion", { ...race.question, serverNow: now });
    setFinalTimer(room, () => resolveFinalStep(room), FINAL.ANSWER_MS);
  }

  /** A phone answers a final question. Only the index is trusted. */
  function submitFinalAnswer(room, playerId, answerIndex) {
    const race = room.finalBattle;
    if (room.gameState !== GAME_STATE.FINAL_BATTLE || race?.stage !== "question") return;
    const { accepted } = finalBattle.submitAnswer(race, playerId, answerIndex);
    if (!accepted) return;
    emitToPlayer(room, playerId, "finalAnswerAck", {
      step: race.step,
      answerIndex: Number(answerIndex),
    });
    to(room).emit("finalAnswerProgress", {
      step: race.step,
      answeredIds: [...race.answers.keys()],
    });
    if (finalBattle.allAnswered(race)) resolveFinalStep(room);
  }

  function resolveFinalStep(room) {
    const race = room.finalBattle;
    if (room.gameState !== GAME_STATE.FINAL_BATTLE || race?.stage !== "question") return;
    race.stage = "reveal";
    const result = finalBattle.resolveStep(race);
    to(room).emit("finalStepResult", { ...result, ...finalBattle.publicState(race) });

    if (race.ending) {
      race.stage = "done";
      setFinalTimer(room, () => finishGame(room), FINAL.END_SCENE_MS);
    } else {
      setFinalTimer(room, () => startFinalStep(room), FINAL.REVEAL_MS);
    }
  }

  /** A player left mid-final: they stop being waited for (darkness takes them). */
  function handleFinalDeparture(room, playerId) {
    const race = room.finalBattle;
    if (room.gameState !== GAME_STATE.FINAL_BATTLE || !race || !playerId) return;
    finalBattle.markDisconnected(race, playerId);
    if (race.stage !== "question") return;
    const nobodyLeft = race.participants.every((p) => p.status !== "racing" || p.disconnected);
    if (nobodyLeft || finalBattle.allAnswered(race)) resolveFinalStep(room);
  }

  /**
   * The final as one phone should see it right now — for a phone that reloaded or
   * lost its connection mid-final and missed "finalBattle" / "finalQuestion".
   */
  function finalSnapshot(room, playerId) {
    const race = room.finalBattle;
    if (room.gameState !== GAME_STATE.FINAL_BATTLE || !race) return null;
    const open = race.stage === "question" && race.open && race.question;
    const mine = open ? race.answers.get(playerId) : null;
    return {
      stage: race.stage,
      ...finalBattle.publicState(race),
      question: open ? race.question : null,
      myAnswer: mine ? Number(mine.answerIndex) : null,
      serverNow: clock.now(room),
    };
  }

  /** Final standings when the game ends without a race (everyone died before it). */
  function standingsWithoutRace(room) {
    return [...room.players.values()]
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .map((p, i) => ({
        place: i + 1,
        id: p.id,
        name: p.name,
        characterSlot: p.characterSlot ?? 1,
        wasGhost: !!p.isGhost,
        score: p.score,
        start: null,
        pos: 0,
        status: "consumed",
        consumedAtStep: null,
        disconnected: false,
      }));
  }

  function finishGame(room, opts = {}) {
    if (room.gameState === GAME_STATE.FINISHED) return;
    if (room.finalBattleTimer) {
      clock.cancel(room.finalBattleTimer);
      room.finalBattleTimer = null;
    }
    room.gameState = GAME_STATE.FINISHED;
    unwatchTv(room);
    step(room, "game over");
    const race = opts.ending ? null : room.finalBattle;
    to(room).emit("gameFinished", {
      players: getPlayersList(room).sort((a, b) => b.score - a.score),
      winnerId: race?.winnerId || null,
      ending: opts.ending || race?.ending || null,
      standings: race ? finalBattle.standings(race) : standingsWithoutRace(room),
    });
  }

  // ------------------------------------------------------------------ minigame
  //
  // phases.js drives a generic lifecycle; the behaviour lives in
  // server/minigames/<id>.js. A minigame def may implement any of:
  //   buildContest(ctx)  onStart(mg,ctx)  onSync(mg,nowTs,ctx)
  //   onClientEvent(mg,playerId,name,data,ctx)  onDisplayEvent(mg,name,data,ctx)
  //   onPlayerLeft(mg,playerId,ctx)  resolveLosers(mg)  resolveWinner(mg)  buildResults(mg)
  //   clientScored: true   (phones report a final score via "trueFalseScore")

  /** Helpers handed to minigame hooks so they can emit + schedule without `io`. */
  function minigameCtx(room) {
    return {
      now: () => clock.now(room),
      players: () =>
        [...room.players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          lives: p.lives ?? LIVES_PER_PLAYER,
          characterSlot: p.characterSlot ?? 1,
        })),
      emitAll: (event, data) => to(room).emit(event, data),
      // the TV only (e.g. what the players must not see on their phones)
      emitDisplay: (event, data) => {
        if (room.displaySocketId) io.to(room.displaySocketId).emit(event, data);
      },
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
        if (room.minigame.playTimer) clock.cancel(room.minigame.playTimer);
        room.minigame.playTimer = clock.schedule(room, fn, Math.max(0, ms));
      },
      scheduleResolve: (ms) => {
        if (!room.minigame) return;
        if (room.minigame.playTimer) clock.cancel(room.minigame.playTimer);
        room.minigame.playTimer = clock.schedule(room, 
          () => resolveMinigame(room),
          Math.max(0, ms)
        );
      },
      resolveNow: () => resolveMinigame(room),
    };
  }

  function clearMinigame(room) {
    const mg = room.minigame;
    if (mg?.timeoutHandle) clock.cancel(mg.timeoutHandle);
    if (mg?.playTimer) clock.cancel(mg.playTimer);
    room.minigame = null;
  }

  /** Build (but don't start) the first matching minigame for the round that ended. */
  function armMinigame(room, correctIndex, roundIndex) {
    clearMinigame(room);

    // Ghosts sit minigames out (they can't lose a life twice, nor soak up a
    // living player's loss). With a single survivor there is no contest.
    const living = [...room.players.values()].filter((p) => !p.isGhost);
    if (living.length < 2) return;

    // A minigame only follows a round somebody got wrong.
    const wrong = (p) => !(p.hasAnswered && p.lastAnswerIndex === correctIndex);
    if (!living.some(wrong)) return;

    // Up to SMALL_GAME_MAX_PLAYERS alive (today: the whole room) everybody plays —
    // each module sees every living player as "wrong", so all of them take part —
    // but the ones who answered right are protected: the minigame can't take their
    // life. Bigger game: only the wrong ones play — also in the minigames that
    // would otherwise take everybody alive (bomb, tune, math rush).
    const everyonePlays = living.length <= SMALL_GAME_MAX_PLAYERS;
    const protectedIds = everyonePlays ? living.filter((p) => !wrong(p)).map((p) => p.id) : [];
    const pool = everyonePlays
      ? living.map((p) => ({ ...p, hasAnswered: true, lastAnswerIndex: (correctIndex + 1) % 4 }))
      : living.filter(wrong);

    room.minigameHistory ??= [];
    const candidates = minigames.selectForRound(roundIndex, room.minigameHistory);
    for (const def of candidates) {
      const contest = def.buildContest({
        players: pool,
        correctIndex,
        roundIndex,
        difficulty: room.difficulty, // e.g. the memory level follows it
      });
      // e.g. «Перетягни канат» with an odd number of wrong players: try the next one
      if (!contest || !contest.contestantIds || contest.contestantIds.length === 0) continue;
      room.minigame = {
        ...contest,
        def,
        scores: new Map(), // playerId -> score (clientScored path)
        resolved: false,
        startEmitted: false,
        syncReceived: false,
        livesApplied: false,
        pendingLoserIds: [],
        protectedIds, // answered the round right: can't lose a life in this minigame
        startedAtTs: null,
        timeoutHandle: null,
        playTimer: null,
      };
      room.minigameHistory.push(def.ID); // no repeats until every minigame has run
      def.onStart?.(room.minigame, minigameCtx(room));
      logMinigame(room, roundIndex, `${def.ID} (${contest.contestantIds.length} play${everyonePlays ? ", everyone" : ""})`);
      return;
    }
    logMinigame(
      room,
      roundIndex,
      `none — no candidate could start (alive ${living.length}, wrong ${living.filter(wrong).length}, tried: ${candidates.map((d) => d.ID).join(", ") || "-"}, played: ${room.minigameHistory.join(", ") || "-"})`
    );
  }

  /** One line per round in the server log: which minigame, or why none (for chasing "it didn't start"). */
  function logMinigame(room, roundIndex, what) {
    if (process.env.NODE_ENV === "test") return;
    console.log(`[minigame] room ${room.code} round ${roundIndex}: ${what}`);
  }

  function startMinigame(room) {
    const mg = room.minigame;
    if (!mg || mg.resolved || mg.startEmitted) return;
    mg.startEmitted = true;
    step(room, `minigame ${mg.minigameId} starts`);
    watchTv(room, "trueFalseSync", () => syncMinigame(room));

    to(room).emit("trueFalseStart", {
      minigameId: mg.minigameId,
      roundIndex: mg.roundIndex,
      contestantIds: mg.contestantIds,
      mode: mg.mode,
      ...(mg.def.startPayload?.(mg) || {}),
    });

    if (!mg.timeoutHandle) {
      mg.timeoutHandle = clock.schedule(room, 
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
    unwatchTv(room);
    // the minigame's own clock starts now (its 3-2-1, its round): so does its hard stop.
    // Counted from the start event it fired too early whenever the TV took a moment to
    // load its video — e.g. «Правда/Брехня» closed before the phones sent their scores.
    if (mg.timeoutHandle) clock.cancel(mg.timeoutHandle);
    mg.timeoutHandle = clock.schedule(room, () => resolveMinigame(room), mg.def.TOTAL_DURATION_MS);
    step(room, `minigame ${mg.minigameId} running`);
    const now = clock.now(room);
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

  /** The display reports something only it knows (audio loaded / failed…). */
  function handleMinigameDisplayEvent(room, name, data) {
    const mg = room.minigame;
    if (!mg || mg.resolved || !mg.def.onDisplayEvent) return;
    mg.def.onDisplayEvent(mg, name, data || {}, minigameCtx(room));
  }

  /** A contestant left the room while a minigame runs (e.g. the bomb holder). */
  function handleMinigameDeparture(room, playerId) {
    const mg = room.minigame;
    if (!mg || mg.resolved || !mg.def.onPlayerLeft || !playerId) return;
    mg.def.onPlayerLeft(mg, playerId, minigameCtx(room));
  }

  /** Score the contest and broadcast results. Lives are NOT applied yet. */
  function resolveMinigame(room) {
    const mg = room.minigame;
    if (!mg || mg.resolved) return;
    if (mg.timeoutHandle) {
      clock.cancel(mg.timeoutHandle);
      mg.timeoutHandle = null;
    }
    if (mg.playTimer) {
      clock.cancel(mg.playTimer);
      mg.playTimer = null;
    }
    mg.resolved = true;
    unwatchTv(room); // (a minigame that ends before its sync: the sync wait is over)
    watchTv(room, "trueFalseResultsSceneDone", () => room.gameState === GAME_STATE.SCORES && applyMinigameLives(room));
    // who lost the minigame (for the rating) / who actually loses a life (not the protected)
    mg.minigameLoserIds = mg.def.resolveLosers(mg) || [];
    const shielded = new Set(mg.protectedIds || []);
    mg.pendingLoserIds = mg.minigameLoserIds.filter((id) => !shielded.has(id));
    mg.pendingWinnerId = mg.def.resolveWinner?.(mg) || null;

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
      bonusWinnerId: mg.pendingWinnerId,
      bonusPoints: mg.pendingWinnerId ? MINIGAME_WIN_BONUS : 0,
      safePoints: MINIGAME_SAFE_POINTS, // every other contestant who kept their life
    });
    to(room).emit("playersUpdate", { players: getPlayersList(room) });
  }

  /**
   * After the aftermath scene: winner bonus, take the lives (0 -> ghost), then
   * advance the round. Guarded by livesApplied, so it all happens once.
   */
  function applyMinigameLives(room) {
    const mg = room.minigame;
    if (!mg || !mg.resolved || mg.livesApplied) return;
    mg.livesApplied = true;
    unwatchTv(room);
    step(room, `minigame ${mg.minigameId} over (lost a life: ${mg.pendingLoserIds.length})`);

    const playerById = (id) => [...room.players.values()].find((p) => p.id === id);

    // rating: the winner +MINIGAME_WIN_BONUS, every other contestant who kept their life +MINIGAME_SAFE_POINTS
    if (mg.pendingWinnerId) awardScore(playerById(mg.pendingWinnerId), MINIGAME_WIN_BONUS);
    const losers = new Set(mg.minigameLoserIds || mg.pendingLoserIds);
    for (const id of mg.contestantIds || []) {
      if (id === mg.pendingWinnerId || losers.has(id)) continue;
      awardScore(playerById(id), MINIGAME_SAFE_POINTS);
    }

    for (const id of mg.pendingLoserIds) {
      const p = playerById(id);
      if (!p || p.isGhost) continue;
      p.lives = Math.max(0, (p.lives ?? LIVES_PER_PLAYER) - 1);
      if (p.lives === 0) {
        p.isGhost = true;
        p.diedAtRound = mg.roundIndex ?? room.currentRoundIndex + 1;
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
    unwatchTv(room);
    room.scoresVideoDone = true;

    const mg = room.minigame;
    if (mg && !mg.resolved) return startMinigame(room);
    if (mg && mg.resolved && !mg.livesApplied) return; // waiting on aftermath scene
    advanceRound(room);
  }

  /**
   * Everything a phone that came back (reload / dropped connection) needs to
   * draw the current moment: the phase, the open question and its time left,
   * a running minigame. Then the normal events take over.
   */
  function resumeSnapshot(room, player) {
    const snap = {
      gameState: room.gameState,
      roundIndex: room.currentRoundIndex + 1,
      question: null,
      answerMsLeft: 0,
      answered: !!player.hasAnswered,
      answerIndex: player.hasAnswered ? player.lastAnswerIndex : null,
      minigame: null,
    };
    if (room.gameState === GAME_STATE.ANSWER_PHASE) {
      snap.question = room.rounds[room.currentRoundIndex]?.question || null;
      snap.answerMsLeft = Math.max(0, (room.answerEndsAt || 0) - clock.now(room));
    }
    const mg = room.minigame;
    if (room.gameState === GAME_STATE.SCORES && mg && mg.startEmitted && !mg.resolved) {
      snap.minigame = {
        minigameId: mg.minigameId,
        roundIndex: mg.roundIndex,
        contestantIds: mg.contestantIds,
        mode: mg.mode,
        ...(mg.def.startPayload?.(mg) || {}),
      };
    }
    return snap;
  }

  return {
    resumeSnapshot,
    finalSnapshot,
    minigameCtxFor: (room) => minigameCtx(room),
    handleMinigameDeparture,
    startGame,
    emitQuestionAnnounce,
    emitQuestionPlay,
    startAnswerPhase,
    checkAnswers,
    submitAnswer,
    emitScores,
    advanceRound,
    awardScore,
    startFinalBattle,
    handleFinalIntroDone,
    submitFinalAnswer,
    resolveFinalStep,
    handleFinalDeparture,
    finishGame,
    handleScoresDone,
    startMinigame,
    syncMinigame,
    submitMinigameScore,
    handleMinigameEvent,
    handleMinigameDisplayEvent,
    resolveMinigame,
    applyMinigameLives,
  };
};
