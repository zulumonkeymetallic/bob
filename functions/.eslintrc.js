/* eslint-env node */
module.exports = {
  root: true,
  env: { es6: true, node: true },
  parserOptions: { ecmaVersion: 2022 },
  extends: ["eslint:recommended"],
  rules: {
    "max-len": ["error", { code: 120 }],
    "no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }]
  }
};
