# Production v7 migration fixture

These three SQL files are byte-for-byte copies of the deployed `24ee8c4f`
Phone Link migrations. Stage 3 uses them only to materialize the admitted
production-v7 source catalog and prove its forward migration to the single
current v16 schema. They are not replayed as current application migrations.
