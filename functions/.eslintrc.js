/* eslint-env node */
module.exports={root:true,env:{es6:true,node:true},parserOptions:{ecmaVersion:2022},extends:["eslint:recommended"],rules:{"max-len":["error",{code:120}],"no-unused-vars":["error",{args:"none",ignoreRestSiblings:true}]},
// Without this every *.test.js reports describe/it/expect/jest as no-undef, which
// made lint useless for the test suite — scoring.test.js alone accounted for 23
// phantom errors.
overrides:[{files:["**/*.test.js"],env:{jest:true}}]};
