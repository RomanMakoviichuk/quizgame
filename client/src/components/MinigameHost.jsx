import TrueFalseMinigame from "./TrueFalseMinigame";
import MathRushMinigame from "./MathRushMinigame";
import RockPaperScissorsMinigame from "./RockPaperScissorsMinigame";
import HotBombMinigame from "./HotBombMinigame";
import TugOfWarMinigame from "./TugOfWarMinigame";
import RatMinigame from "./RatMinigame";
import MemoryMinigame from "./MemoryMinigame";
import NameThatTuneMinigame from "./NameThatTuneMinigame";

/**
 * Renders the active minigame by id — the single switch point for every minigame.
 * The server registry (server/minigames/) decides which one runs after a round;
 * `minigameId` arrives in the `trueFalseStart` / `trueFalseResults` payloads.
 *
 * Props are forwarded verbatim; each component picks what it needs
 * (socket, uiMode, isActive, roundIndex, syncData, myPlayerId, namesById,
 * contestantIds, results, onFinish, onVideoStartedAt, onSceneDone).
 */
const MINIGAME_COMPONENTS = {
  trueFalse: TrueFalseMinigame,
  mathRush: MathRushMinigame,
  rps: RockPaperScissorsMinigame,
  hotBomb: HotBombMinigame,
  tugOfWar: TugOfWarMinigame,
  rat: RatMinigame,
  memory: MemoryMinigame,
  tune: NameThatTuneMinigame,
};

export default function MinigameHost({ minigameId = "trueFalse", ...props }) {
  const Component = MINIGAME_COMPONENTS[minigameId] || TrueFalseMinigame;
  return <Component {...props} />;
}
