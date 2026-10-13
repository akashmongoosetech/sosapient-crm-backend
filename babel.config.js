// Jest-only transform: converts the few pure-ESM transitive dependencies
// (htmlparser2 chain behind sanitize-html) to CJS. Production runtime
// uses native Node ESM/CJS interop and is unaffected.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
