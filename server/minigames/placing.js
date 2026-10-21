/**
 * Shared scoring for the "closest to the target wins" minigames played over a
 * few rounds («Ідеальна секунда», «До міліметра!»).
 *
 * A round: every contestant has a value (or none); the error is |value - target|.
 * Equal errors share the place; 1st +5, 2nd +3, 3rd +2, every other value +1,
 * no value 0. Over the rounds: the most points wins, ties broken by the smaller
 * summed error (a missing value counts `missErr`). The lowest loses ONE life;
 * everybody exactly equal -> nobody.
 */
const PLACE_POINTS = [5, 3, 2];
const OTHER_POINTS = 1;

/** One round's table, best first: { id, [key]: value|null, err, place, points }. */
function placeRows(ids, values, target, key = "value") {
  const rows = ids.map((id) => {
    const v = Number.isFinite(values[id]) ? values[id] : null;
    return { id, [key]: v, err: v == null ? null : Math.abs(v - target), place: null, points: 0 };
  });
  const done = rows.filter((r) => r.err != null);
  for (const r of done) {
    r.place = 1 + done.filter((o) => o.err < r.err).length;
    r.points = PLACE_POINTS[r.place - 1] ?? OTHER_POINTS;
  }
  return rows.sort((a, b) => (a.err ?? Infinity) - (b.err ?? Infinity) || (a.id < b.id ? -1 : 1));
}

/** Totals over the rounds played: points and the summed error. */
function totalsOf(ids, roundRows, missErr) {
  const points = Object.fromEntries(ids.map((id) => [id, 0]));
  const errSum = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const rows of roundRows) {
    for (const r of rows) {
      if (!(r.id in points)) continue;
      points[r.id] += r.points;
      errSum[r.id] += r.err ?? missErr;
    }
  }
  return { points, errSum };
}

/** Best first: more points, then the smaller summed error. */
function rankIds(ids, { points, errSum }) {
  return [...ids].sort((a, b) => points[b] - points[a] || errSum[a] - errSum[b] || (a < b ? -1 : 1));
}

/** The final standing: totals, ranking, the one loser and the one clear winner (if any). */
function outcomeOf(ids, roundRows, missErr) {
  const totals = totalsOf(ids, roundRows, missErr);
  const ranked = rankIds(ids, totals);
  const key = (id) => `${totals.points[id]}|${totals.errSum[id]}`;
  const allEqual = ranked.every((id) => key(id) === key(ranked[0]));
  const [best, second] = ranked;
  return {
    ...totals,
    ranked,
    loserIds: allEqual || !ranked.length ? [] : [ranked[ranked.length - 1]],
    winnerId: ranked.length >= 2 && totals.points[best] > 0 && key(best) !== key(second) ? best : null,
  };
}

module.exports = { PLACE_POINTS, OTHER_POINTS, placeRows, totalsOf, rankIds, outcomeOf };
