# DSH plugin test fixtures

These two packages are **test fixtures, not products**. They are no longer
published in `market/index.json` and are not part of any product registration.

| Fixture | Former product role | Still used for |
| --- | --- | --- |
| `text-stats/` | `@sciforge/plugin-text-stats` market listing | installer, signature, capability, disable/re-enable, restart and uninstall acceptance (`scripts/packaged-market-acceptance.mjs`, `scripts/packaged-agent-chat.mjs`) |
| `unit-conversion/` | `@sciforge/plugin-unit-conversion` market listing | the same acceptance battery plus the refusal path (cross-dimension conversion) |

Why they stayed: the packaged market acceptance needs at least one real,
installable artifact to prove packaging → signature → install → activate →
call → disable → restart → uninstall. Deleting them would delete that test
assurance, so they were moved out of `plugins/` (the product plugin directory
that `scripts/dsh-plugin-market-batch.mjs` scans) and kept as fixtures.

## Building a fixture catalogue

The fixture catalogue is generated, exactly like the product one, from the
fixture directories into `tests/fixtures/dsh-plugins/market/`:

```sh
SCIFORGE_TEST_KEY_DIR=<repo-external test keys> npm run market:fixtures
```

It writes `market/index.json` plus `market/artifacts/` next to this README. Point
the packaged acceptance at that catalogue instead of the bundled one:

```sh
node scripts/packaged-market-acceptance.mjs \
  --app dist/mac-arm64/SciForge.app \
  --keyring <repo-external test keyring json> \
  --index tests/fixtures/dsh-plugins/market/index.json
```

Nothing in the fixture catalogue ships: `market/index.json` (the product
catalogue) never lists these packages, and only the fixture run reads this
directory.