import "./FireTitle.css";

export default function FireTitle({ text = "" }) {
  return (
    <span className="fire-text">
      <span className="fire-glow" aria-hidden="true">
        {text}
      </span>
      <span className="fire-fill">{text}</span>
    </span>
  );
}
