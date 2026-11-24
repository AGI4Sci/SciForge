# Migration fixture third-party notices

These notices apply only to the nine immutable fixture inputs enumerated in
[THIRD_PARTY.provenance.json](THIRD_PARTY.provenance.json), not to the full app
or all declared/transitive dependencies. No fixture byte is modified.
When redistributing an individual fixture, carry this notice, its provenance
entry, and the complete applicable copyright/license texts with that fixture.

The JavaScript fixtures contain third-party code, so dependency metadata alone
is not sufficient notice. The following full upstream license texts, including
original copyright notices, are reproduced verbatim from the recorded exact
registry archives. Registry integrity validates those retrieved archives; it
is not a retroactive attestation of the old build machine. The provenance file
distinguishes embedded-version evidence, historical exact-lock records and
static retained-code anchors. No complete original rebuild or uniquely proven
installed patch version is claimed.

| Component | Recorded version | Role | License | Full text |
|---|---|---|---|---|
| zod | 4.4.3 | inlined-third-party-code | MIT | [copyright and license](licenses/zod-4.4.3.LICENSE.txt) |
| @modelcontextprotocol/sdk | 1.29.0 | inlined-third-party-code | MIT | [copyright and license](licenses/modelcontextprotocol--sdk-1.29.0.LICENSE.txt) |
| ajv | 8.20.0 | inlined-third-party-code | MIT | [copyright and license](licenses/ajv-8.20.0.LICENSE.txt) |
| ajv-formats | 3.0.1 | inlined-third-party-code | MIT | [copyright and license](licenses/ajv-formats-3.0.1.LICENSE.txt) |
| fast-deep-equal | 3.1.3 | inlined-third-party-code | MIT | [copyright and license](licenses/fast-deep-equal-3.1.3.LICENSE.txt) |
| fast-uri | 3.1.2 | inlined-third-party-code | BSD-3-Clause | [copyright and license](licenses/fast-uri-3.1.2.LICENSE.txt) |
| json-schema-traverse | 1.0.0 | inlined-third-party-code | MIT | [copyright and license](licenses/json-schema-traverse-1.0.0.LICENSE.txt) |
| zod-to-json-schema | 3.25.2 | inlined-third-party-code | ISC | [copyright and license](licenses/zod-to-json-schema-3.25.2.LICENSE.txt) |
| esbuild | 0.25.12 | generated-helper-attribution | MIT | [copyright and license](licenses/esbuild-0.25.12.LICENSE.txt) |

The esbuild entry is conservative attribution for generated helper boilerplate,
not a claim that the esbuild executable is shipped here. Node builtin imports
and browser platform APIs are not bundled npm packages. The local unit
conversion, sidebar, bounded echo/delay, fixed two-task DAG and failure fixtures
retain the project's existing source declaration. Their standalone historical
TypeScript worktree sources were not retained; names such as Unitverse are not
used as proof of third-party copying or as proof of project originality.

The package dependency maps in the provenance file are declarations only. Only
packages with observed emitted modules are counted as inlined code. Future
changes must review newly observed module/package names, keep full applicable
license/copyright texts and update the exact blob/hash mapping; unknown packages
must not silently inherit the project MIT/Apache license.
