# PostgreSQL A-line migration fixtures

These immutable SQL fixtures reproduce the admitted historical PostgreSQL catalogs used by the Stage 3 migration contract.

- Source commit: `fd2225a4`
- `public-v5`: migrations 0001 through 0005
- `staging-v9`: migrations 0001 through 0009

Production migration routing remains owned by `src/migrations.ts`; these files are test inputs only.
