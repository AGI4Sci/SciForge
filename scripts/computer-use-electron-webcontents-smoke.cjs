'use strict'

// Electron treats the first positional argument as its app entry. Register
// tsx inside that main process so TypeScript `.js` specifiers resolve to the
// repository sources without accidentally launching the root SciForge app.
require('tsx/cjs')
require('./computer-use-electron-webcontents-smoke.ts')
