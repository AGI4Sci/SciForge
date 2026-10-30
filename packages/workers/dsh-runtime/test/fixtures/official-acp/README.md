# Official ACP safety test inputs

These inert YAML fixtures are the configuration dumps recorded in the pinned SciForge source listed in `provenance.json`. The source ledger identifies DeepSeek Harness 0.2.0-rc.2 at the pinned upstream commit. They are not executable runtime payloads or user configuration.

The upstream commit's MIT license is retained in `LICENSE.deepseek`. The default dump is byte-identical to the recorded source; the safe dump removes only developer-local patch-file paths from YAML comments. No YAML values or safety assertions are removed. Hashes bind both source and delivered bytes. The model-router test independently checks the production canonical config digest.

`!!js` values remain inert data in the tests; they are never evaluated. Environment variable names are configuration references, not supplied credentials. The telemetry URL is an upstream default retained for safety-overlay testing; telemetry is disabled by the tested overlay. No private SciForge endpoints or credential values are included. This narrow provenance/license review does not approve all runtime dependencies or authorize public release.
