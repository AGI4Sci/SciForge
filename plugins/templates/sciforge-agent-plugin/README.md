# SciForge Agent Plugin Template

This template is the smallest supported development-mode renderer plugin. It
keeps the backend in an isolated DSH process, serves the UI from a versioned
host URL, and communicates with SciForge through the iframe SDK.

Replace `@sciforge/example-plugin` and the sample UI, then run:

```bash
npm run check
npm test
npm run build
```

The three scripts are intentionally dependency-free so an Agent can run them
inside a prepared candidate directory. The host still validates the manifest,
adapter declaration, entry paths, permissions, and the immutable build digest
before any update is applied.

The UI SDK only sends `ready`, `invoke`, and `dispose` messages. It does not
expose Electron, Node.js, filesystem access, or model credentials to the
iframe. Add a host-approved capability id before using `invoke` in a real
plugin.
