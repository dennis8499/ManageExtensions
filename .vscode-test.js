const { defineConfig } = require('@vscode/test-cli');
const fs = require('node:fs');
const path = require('node:path');

const userDataDir = path.join(__dirname, '.vscode-test', 'user-data');
const userSettingsDir = path.join(userDataDir, 'User');
fs.mkdirSync(userSettingsDir, { recursive: true });
fs.writeFileSync(path.join(userSettingsDir, 'settings.json'), JSON.stringify({ 'manageExtensions.checkUpdatesOnStartup': false }));

module.exports = defineConfig({
  files: 'out/test/vscode/**/*.test.js',
  version: 'stable',
  workspaceFolder: path.join(__dirname, 'test', 'vscode', 'workspace'),
  launchArgs: ['--disable-workspace-trust', '--user-data-dir', userDataDir]
});
