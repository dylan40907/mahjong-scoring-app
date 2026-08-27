const expoConfig = require('eslint-config-expo/flat');

/**
 * Written by hand because `expo lint` bootstraps its config over the network,
 * which this environment blocks. Same base config, pinned locally.
 */
module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', 'screenshots/*', 'node_modules/*', 'tools/*', 'eslint.config.js'],
  },
];
