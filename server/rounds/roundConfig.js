/**
 * Per-round script/configuration.
 * Extend each round with custom scenario data.
 */
const { TOTAL_ROUNDS } = require("../gameStates");

const roundConfigs = {};
for (let i = 1; i <= TOTAL_ROUNDS; i++) {
  roundConfigs[i] = {
    roundIndex: i,
    questionAnnounceDelay: 1000,
    questionPlayDelay: 2000,
  };
}

module.exports = roundConfigs;
