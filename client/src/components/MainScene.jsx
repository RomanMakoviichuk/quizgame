import "./MainScene.css";

/**
 * Main scene: characters in center with nicknames and hearts.
 */
export default function MainScene({ players }) {
  return (
    <div className="main-scene">
      <div className="main-scene-characters">
        {players.map((p, idx) => (
          <div key={p.id} className="main-scene-char">
            <span className="main-scene-name">{p.name}</span>
            <div className="main-scene-avatar">
              <img
                src={`/assets/images/Characters/alivecharacters/${p.characterSlot ?? (idx % 8) + 1}.png`}
                alt=""
              />
            </div>
            <div className="main-scene-hearts">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`main-scene-heart ${i <= (p.lives ?? 3) ? "" : "lost"}`}
                >
                  ♥
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
