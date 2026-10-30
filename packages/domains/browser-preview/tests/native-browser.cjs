console.log('Starting isolated native browser integration')
require('electron').app.on('window-all-closed', () => {})
require('tsx/cjs')
require('../src/browser-input.integration.ts').runNativeBrowserTests().then(
  () => process.stdout.write('NATIVE_BROWSER_TEST_PASSED\n', () => require('electron').app.exit(0)),
  error => process.stderr.write(String(error.stack || error) + '\n', () => require('electron').app.exit(1))
)
