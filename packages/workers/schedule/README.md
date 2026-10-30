# @sciforge/schedule

Shared SciForge schedule worker package.

The worker exposes a stdio MCP server for agent-facing schedule tools and
resources. It does not depend on Electron; it talks to the running app through
the schedule internal HTTP endpoints owned by the main process runtime.

```bash
node --import tsx src/cli.ts --base-url http://127.0.0.1:8788 --secret "$SECRET"
```

Useful environment variables:

- `SCIFORGE_SCHEDULE_INTERNAL_BASE_URL`
- `SCIFORGE_SCHEDULE_INTERNAL_SECRET`
- `SCIFORGE_SCHEDULE_INTERNAL_TIMEOUT_MS`

