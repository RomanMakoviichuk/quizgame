import "./RoundIntro.css";
import FireTitle from "./FireTitle";

/**
 * Placeholder title card shown on the display during QUESTION_ANNOUNCE for rounds
 * without a bespoke intro video, and for the final battle. Swap for a video later.
 *
 * - <RoundIntro roundIndex={4} />            -> "РАУНД" / "4"
 * - <RoundIntro title="ФІНАЛЬНА БИТВА" label="…" />
 */
export default function RoundIntro({ roundIndex, title, label }) {
  return (
    <div className="round-intro-overlay">
      <div className="round-intro-inner">
        {title ? (
          <div className="round-intro-title">
            <FireTitle text={title} />
          </div>
        ) : (
          <>
            <p className="round-intro-kicker">Раунд</p>
            <div className="round-intro-number">
              <FireTitle text={String(roundIndex)} />
            </div>
          </>
        )}
        {label ? <p className="round-intro-label">{label}</p> : null}
      </div>
    </div>
  );
}
