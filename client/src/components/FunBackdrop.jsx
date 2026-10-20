import "./FunBackdrop.css";

/**
 * The cheerful backdrop of the phone's entry screens (join, pick a character,
 * lobby, waiting): a soft sky with drifting clouds and crayon doodles around
 * the edges, in the style of the «Хто є хто!» logo. Purely decorative.
 */
const DOODLES = [
  { kind: "sun", x: 4, y: 3, s: 17, c: "#f5c518", d: 0 },
  { kind: "star", x: 82, y: 6, s: 9, c: "#e53935", d: 0.6 },
  { kind: "heart", x: 86, y: 30, s: 8, c: "#e91e63", d: 1.2 },
  { kind: "star", x: 7, y: 34, s: 7, c: "#7e57c2", d: 1.8 },
  { kind: "flower", x: 3, y: 80, s: 13, c: "#e53935", d: 0.4 },
  { kind: "squiggle", x: 74, y: 86, s: 18, c: "#43a047", d: 1 },
  { kind: "star", x: 88, y: 64, s: 6, c: "#1e88e5", d: 2.2 },
  { kind: "heart", x: 14, y: 60, s: 6, c: "#fb8c00", d: 2.8 },
  { kind: "squiggle", x: 40, y: 94, s: 14, c: "#8e24aa", d: 1.6 },
];

function Doodle({ kind, c }) {
  const crayon = { fill: "none", stroke: c, strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (kind) {
    case "sun":
      return (
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="20" {...crayon} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <line key={i} x1={50 + Math.cos(a) * 30} y1={50 + Math.sin(a) * 30} x2={50 + Math.cos(a) * 42} y2={50 + Math.sin(a) * 42} {...crayon} />;
          })}
          <circle cx="43" cy="46" r="2.5" fill="#3a2a00" />
          <circle cx="57" cy="46" r="2.5" fill="#3a2a00" />
          <path d="M41 55 Q50 63 59 55" fill="none" stroke="#3a2a00" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 100 100">
          <path d="M50 8 L61 38 L93 38 L67 57 L77 90 L50 70 L23 90 L33 57 L7 38 L39 38 Z" {...crayon} fill={c} fillOpacity="0.35" />
        </svg>
      );
    case "heart":
      return (
        <svg viewBox="0 0 100 100">
          <path d="M50 86 C10 58 8 30 28 20 C40 14 48 22 50 30 C52 22 60 14 72 20 C92 30 90 58 50 86 Z" {...crayon} fill={c} fillOpacity="0.35" />
        </svg>
      );
    case "flower":
      return (
        <svg viewBox="0 0 100 100">
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return <circle key={i} cx={50 + Math.cos(a) * 18} cy={38 + Math.sin(a) * 18} r="12" {...crayon} fill={c} fillOpacity="0.3" />;
          })}
          <circle cx="50" cy="38" r="9" fill="#f5c518" />
          <path d="M50 58 L50 96 M50 80 Q36 70 30 76" fill="none" stroke="#43a047" strokeWidth="7" strokeLinecap="round" />
        </svg>
      );
    default: // squiggle
      return (
        <svg viewBox="0 0 120 40">
          <path d="M5 25 Q20 5 35 25 T65 25 T95 25 T115 20" {...crayon} />
        </svg>
      );
  }
}

/** `calm`: the in-game version — paler, nothing moves, so it never distracts from a question. */
export default function FunBackdrop({ calm = false }) {
  return (
    <div className={`fun-backdrop ${calm ? "calm" : ""}`} aria-hidden>
      <span className="fun-cloud c1" />
      <span className="fun-cloud c2" />
      <span className="fun-cloud c3" />
      {DOODLES.map((d, i) => (
        <span
          key={i}
          className={`fun-doodle ${d.kind}`}
          style={{ left: `${d.x}%`, top: `${d.y}%`, width: `${d.s}vh`, animationDelay: `${-d.d}s` }}
        >
          <Doodle kind={d.kind} c={d.c} />
        </span>
      ))}
    </div>
  );
}
