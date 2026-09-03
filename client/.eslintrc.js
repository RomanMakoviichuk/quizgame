/* eslint-env node */
/**
 * Лише eslint-config-react-app/base (як у react-scripts webpack) — без react-app/jest,
 * щоб не завантажувати eslint-plugin-jest (на частині середовищ папка lib/rules не читається).
 */
module.exports = {
  root: true,
  extends: [require.resolve("eslint-config-react-app/base")],
  plugins: ["react-hooks"],
  rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
};
