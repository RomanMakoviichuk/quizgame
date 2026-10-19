/**
 * Dev-only stand-in for the server in `?finalPreview=display|mobile` — lets the
 * final race scene be styled without playing 9 rounds. It fakes the wire
 * events of server/phases.js with a scripted, simplified race. Not game logic:
 * the real rules live in server/finalBattle.js.
 */
const QUESTIONS = [
  ["Столиця Франції?", ["Париж", "Ліон", "Марсель", "Ніцца"], 0],
  ["Скільки ніг у павука?", ["6", "8", "10", "12"], 1],
  ["Найбільший океан?", ["Атлантичний", "Індійський", "Тихий", "Північний"], 2],
  ["Хімічний символ золота?", ["Ag", "Au", "Fe", "Gd"], 1],
  ["Яка планета червона?", ["Венера", "Юпітер", "Марс", "Сатурн"], 2],
];

export const FINAL_PREVIEW_PLAYERS = [
  { id: "fp-1", name: "Оксана", characterSlot: 1, wasGhost: false, score: 61 },
  { id: "fp-2", name: "Тарас", characterSlot: 2, wasGhost: false, score: 40 },
  { id: "fp-3", name: "Марко", characterSlot: 3, wasGhost: true, score: 21 },
  { id: "fp-4", name: "Ліна", characterSlot: 4, wasGhost: false, score: 90 },
  { id: "fp-5", name: "Денис", characterSlot: 5, wasGhost: true, score: 0 },
  { id: "fp-6", name: "Ірина", characterSlot: 6, wasGhost: false, score: 30 },
];

const startCell = (score) => 6 + Math.floor((Math.min(1000, Math.round((score / 99) * 1000)) * 9) / 1001);

export function createFinalPreview({ answerMs = 6000, revealMs = 3500 } = {}) {
  const handlers = {};
  const fire = (ev, data) => (handlers[ev] || []).forEach((fn) => fn(data));
  const participants = FINAL_PREVIEW_PLAYERS.map((p) => ({
    ...p,
    start: startCell(p.score),
    pos: startCell(p.score),
    status: "racing",
    consumedAtStep: null,
    disconnected: false,
  }));
  const race = { step: 0, exit: 30, darkness: 2, participants, winnerId: null, ending: null };
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const snapshot = () => ({ ...race, participants: race.participants.map((p) => ({ ...p })) });
  let current = null;

  function ask() {
    race.step += 1;
    const [text, options, correctIndex] = QUESTIONS[(race.step - 1) % QUESTIONS.length];
    current = { correctIndex, answered: [] };
    const now = Date.now();
    fire("finalQuestion", { step: race.step, text, options, endsAt: now + answerMs, answerMs, serverNow: now });
    race.participants
      .filter((p) => p.status === "racing")
      .forEach((p, i) =>
        later(() => {
          current.answered.push(p.id);
          fire("finalAnswerProgress", { step: race.step, answeredIds: [...current.answered] });
        }, 600 + i * 450)
      );
    later(resolve, answerMs);
  }

  function resolve() {
    const racing = race.participants.filter((p) => p.status === "racing");
    const correct = racing.filter(() => Math.random() < 0.6).sort(() => Math.random() - 0.5);
    const movers = correct.map((p, rank) => {
      const from = p.pos;
      p.pos = Math.min(race.exit, p.pos + ([4, 3, 2][rank] ?? 1));
      return { id: p.id, rank: rank + 1, from, to: p.pos };
    });
    const result = {
      step: race.step,
      correctIndex: current.correctIndex,
      correctIds: correct.map((p) => p.id),
      answeredIds: current.answered,
      movers,
      darkness: { from: race.darkness, to: race.darkness },
      consumed: [],
      winnerId: null,
      ending: null,
    };
    const finisher = movers.find((m) => m.to >= race.exit);
    if (finisher) {
      race.participants.find((p) => p.id === finisher.id).status = "escaped";
      race.winnerId = result.winnerId = finisher.id;
      race.ending = result.ending = "escaped";
    } else {
      if (race.step > 2) race.darkness += race.step > 6 ? 3 : 2;
      result.darkness.to = race.darkness;
      for (const p of racing) {
        if (p.pos <= race.darkness) {
          p.status = "consumed";
          p.consumedAtStep = race.step;
          result.consumed.push(p.id);
        }
      }
      if (!race.participants.some((p) => p.status === "racing")) race.ending = result.ending = "all_consumed";
    }
    fire("finalStepResult", { ...result, ...snapshot() });
    if (!race.ending) later(ask, revealMs);
  }

  const socket = {
    on: (ev, fn) => ((handlers[ev] = handlers[ev] || []).push(fn)),
    off: (ev, fn) => (handlers[ev] = (handlers[ev] || []).filter((h) => h !== fn)),
    emit: (ev, data) => {
      if (ev === "finalBattleIntroDone" && race.step === 0) ask();
      if (ev === "finalAnswer" && current) {
        fire("finalAnswerAck", { step: race.step, answerIndex: data?.answerIndex });
      }
    },
  };

  return {
    socket,
    intro: { stage: "intro", ...snapshot(), rules: { exit: 30, moves: [4, 3, 2], otherMove: 1, answerMs } },
    /** phone preview skips the TV intro handshake */
    startNow: () => later(ask, 1500),
    stop: () => timers.forEach(clearTimeout),
  };
}
