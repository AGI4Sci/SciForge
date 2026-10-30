

> 素材说明 / Asset note: 未确认权属的文档素材不随本源码候选分发；操作文字保留。Unconfirmed documentation media are omitted. See [asset status](docs/ASSET-PUBLICATION-STATUS.md).

# Third Party Notices

Last updated: 2026-10-30

This file records the third-party license and distribution boundary for the current SciForge source tree. It is an engineering compliance index, not legal advice. The intended npm dependency graph is recorded by `package-lock.json`; the exact-artifact evidence and remaining license-text/runtime limitations below are not proof of a complete distributable dependency closure.

## SciForge Source Boundary

The SciForge source code in this repository is distributed under the Apache
License 2.0 in `LICENSE`, except where a file or package says otherwise.

Package metadata policy:

| Scope | Package metadata | Distribution policy |
| --- | --- | --- |
| Root desktop app | `private: true`, `license: Apache-2.0` | Not published as a public npm package. Source release follows root `LICENSE`. |
| `packages/full-trace` | package-local license field absent | Project-owned workspace package; source release follows root `LICENSE`. |
| `packages/domains/*` | Package-specific MIT or Apache-2.0 | Follow each package.json and accompanying LICENSE; backend and optional UI ship at one version. |
| `packages/workers/*` | `license: Apache-2.0` | Project-owned non-domain worker packages. |

## Reference-Only Upstream Inspiration

The following are historical project provenance declarations, not a newly completed source-origin audit. The owner has confirmed authority over first-party contributions for this source release; that confirmation does not relicense third-party content or turn these historical declarations into an independent source-origin audit or installer clearance:

| Project | Current use in SciForge | Audit statement |
| --- | --- | --- |
| Reasonix | Historical runtime and cache-design reference retained for provenance. SciForge no longer distributes a custom agent runtime. | Reference/inspiration only. No Reasonix source code, tests, fixtures, event contracts, binaries, or assets are copied into this repository. |
| OpenHanako | Write-mode interaction ideas such as Markdown live editing, writing-space organization, and selected-text inline agent UX. | Reference/inspiration only. No OpenHanako source code, tests, fixtures, binaries, or assets are copied into this repository. |
| LobsterAI | Connect phone product-flow ideas such as IM management, QR binding, agent binding, and customizable agent profiles. | Reference/inspiration only. No LobsterAI source code, tests, fixtures, binaries, or assets are copied into this repository. |

If future work copies implementation code, generated code, tests, protocol fixtures, media, or brand assets from any of these projects, the copied material must be replaced or listed here with the upstream copyright, license, and redistribution conditions before release.

Reference-version policy: the entries above are design-reference provenance
only. They do not make the upstream repositories part of the SciForge source
distribution. If an upstream project later changes license terms, SciForge
must treat only the audited revision below as the referenced material; newer
upstream code, tests, fixtures, media, or assets must not be copied unless a
separate license review confirms the applicable rights.

Audited reference anchors:

| Project | Upstream repository | Audited reference revision | License at audited revision | Historical license status recorded on 2026-07-02 | SciForge boundary |
| --- | --- | --- | --- | --- | --- |
| Reasonix | `https://github.com/esengine/DeepSeek-Reasonix` | `v1.15.0` / `484bca854f4e669eaa21716939ad7d5b323b4962` | MIT (`LICENSE`, copyright Reasonix Contributors) | MIT; `main-v2` HEAD checked at `d5ba463964a025ed37e1771a686eaa2ef303f026` | Design reference only. No Reasonix source, tests, fixtures, event contracts, binaries, or assets are copied. |
| Kun / historical DeepSeek-GUI lineage | `https://github.com/KunAgent/Kun` | `363fdf566657cd4d60801f62b0b8f3aa8dfbf2fc`, the parent of the relicense commit | MIT (`LICENSE`, copyright xingyu). `package.json` at this revision had no explicit package-license field, so the root `LICENSE` is the controlling evidence for that audited source tree. | Relicensed at `5472bed3b878854d296851820834145f5fe1a353` to `PolyForm-Noncommercial-1.0.0`; current GitHub license detection reports `Other`. | Historical lineage record only. SciForge must not treat `5472bed3` or later Kun source/assets as MIT-licensed material. Kun source, tests, fixtures, binaries, and assets are not included in the current SciForge source distribution or packaged application. |
| OpenHanako | `https://github.com/liliMozi/openhanako` | `v0.36.0` / `92a727959f75e556df5013d37037a5007a5c5e16` | Apache-2.0. The `LICENSE` history begins at this initial open-source release as Apache-2.0; no MIT-to-Apache transition was observed in the upstream `LICENSE` history. | Apache-2.0; current `v0.350.2` checked at `2c3691c31043004e2b72cf3851faed9a8f584658` | Interaction reference only. No OpenHanako source, tests, fixtures, binaries, or assets are copied. |
| LobsterAI | `https://github.com/netease-youdao/LobsterAI` | `2026.6.30` / `7d02d107fa46d0801c0a2d6b14b4b34c37ac943a` | MIT (`LICENSE`, copyright NetEase Youdao). Initial open-source `LICENSE` commit `3ab5afbc53b6eea8cdbcd9370ca115f5a32fb16f` is also MIT. | MIT | Product-flow reference only. No LobsterAI source, tests, fixtures, binaries, or assets are copied. |

## Delivery-specific obligations and approved source scope

The owner has authorized publication of project-owned source under its existing
licenses and confirmed contributor/institutional authority. This authorization
excludes third-party material. The present minimal source scope retains features,
dependency declarations, lockfiles and executable security fixtures, but excludes
node_modules, dependency archives, generated runtime/build bundles, and the
unconfirmed documentation media recorded in [asset status](docs/ASSET-PUBLICATION-STATUS.md).
New minimal geometric runtime icons and plain-text SVG layouts are expressly
approved project-authored replacements, not clearance of the old artwork.

The former blanket tldraw source-publication hold is superseded by the owner's
source-only decision. Mere dependency declarations and first-party integration
source do not distribute tldraw code. Its own code/artifact redistribution and
production use still require the applicable license conditions. No feature or
license-key enforcement is removed. This notice is not a claim that an installer,
website deployment or production service is approved, and does not itself publish
this candidate or authorize an agent to push it.

Classify obligations against the actual release manifest, not everything a build
could download:

| Delivery | Included surface to audit | Required evidence / conditional obligations |
| --- | --- | --- |
| Pure client source | Reviewed tracked source, tests/fixtures, documentation, media, package declarations and lockfiles; not installed dependencies or generated runtime artifacts | Preserve root and package licenses, NOTICE and copied-material provenance. Confirm contributor/material rights and privacy. Bind dependency declarations to reproducible artifacts without pretending those artifacts are shipped. tldraw code/artifact distribution and production use remain separately conditional; a dependency declaration is not a blanket first-party source hold. No final Electron installer notices are required merely to publish a manifest that excludes Electron binaries. |
| Website | Published HTML/JS/CSS, fonts, images, data and any distributed site server/container, selected from the site's own build and dependency graph | Audit `docs/research-agent-needs-site/package-lock.json` separately. Browser-delivered dependencies require applicable notices/attribution/source availability. A build-only native library is not automatically shipped to website visitors; inspect output. A server/container distribution that includes it adds binary obligations. Publicly deployed tldraw functionality requires applicable production rights if actually included. |
| Desktop installer / runtime bundle | Actual platform-selected Electron/Chromium/Node/V8, SDK/CLI, native libraries, fonts, workers and generated Workspace Host artifacts | Inspect each final artifact, include exact license/notice texts, and satisfy applicable LGPL/MPL source and replacement/relinking requirements. Confirm SDK/product terms and signing/platform acceptance separately. Source approval is not binary-release approval. |

### tldraw

The root lock resolves `tldraw` to `4.5.12`; npm records source revision
`1e5bcd97cd09d2c58a60c4edbcc5fb64c67e375a`. Its archive LICENSE is a link to
upstream main, not the full pinned license. The
[exact-revision license](https://github.com/tldraw/tldraw/blob/1e5bcd97cd09d2c58a60c4edbcc5fb64c67e375a/LICENSE.md)
permits internal development, modification and bundling subject to conditions,
but excludes production use absent applicable trial/commercial permission. It
requires verbatim license inclusion when distributing the software, preservation
of notices, no standalone distribution, no license-key interference, and passing
on its disclaimer and liability limitation. Some same-version `@tldraw/*`
packages declare MIT; that does not license the editor/UI as a whole.
The owner must provide rights covering the version, intended use and recipients;
technical staff must separately assemble the correct notice texts for any bundle.

### Anthropic SDK / Claude Code

The exact `@anthropic-ai/claude-agent-sdk@0.3.185` archive LICENSE states
“© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements
outlined here”; it is not MIT/Apache. Official
[legal documentation](https://code.claude.com/docs/en/legal-and-compliance.md) and
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms) were retrieved
in the 2026-10-30 audit; the former inaccessible-page claim is no longer a gap.
A source manifest containing only SciForge integration code and dependency
references is not itself redistribution of the installed SDK or CLI. If these
artifacts are preinstalled, hosted or distributed, evaluate that actual mode.

Unless separately agreed, product preinstallation/hosting requires the commercial
terms, an unmodified Claude Code binary with authentication methods intact, and
end-user authentication/direct billing without prohibited resale or intermediation.
Agent SDK applications should use API keys or supported cloud providers, not
collect/store/intermediate Claude.ai session credentials. Product/contract owners
must confirm the applicable mode, agreement, region, credentials, billing and
branding. Engineers must inspect the full authentication path and binary integrity;
Model Router integration alone proves neither compliance nor a violation.

### Missing license text and artifact identity

The exact archives for `dom-walk@0.1.2`, `ev-store@7.0.0`, `individual@3.0.0`,
`khroma@2.1.0`, `string-template@0.2.1`, `x-is-array@0.1.0` and `x-is-string@0.1.0`
contain MIT text despite absent lock license fields. They are not unknown-license
packages. `error@4.4.0` still has only an old `licenses: MIT` declaration; its
archive has no LICENSE/LICENCE and exact-revision lookups returned 404. Before
redistributing its code, obtain reliable version-specific copyright/license text;
do not substitute current master or an owner's checkbox. A lock reference in a
pure source manifest is distinct from shipping that code, but the evidence gap
must remain disclosed for reproducible dependency/installer delivery.

The root lock now declares `@electron/get@5.0.0`, matching the resolved archive,
its verified SHA-512 integrity and the archive's own package manifest. Across the
root and website locks, 924 previously missing registry integrity/resolved entries
were populated from exact-version npm registry metadata; workspace links and local
source entries are classified separately, not given invented archive hashes.
Registry metadata evidence is not independent verification of every archive on
every platform. The root isolated `npm ci --offline` completed after a network
prefetch with scripts disabled, but npm reported four unapproved dependency
lifecycle scripts and the optional node-pty prebuild fetch fell back to bundled
binaries. Native runtime, website installation and installer acceptance remain
separate checks; installation exit 0 is not a full-product pass.

## npm Dependency Notices

The authoritative npm evidence source is `package-lock.json`. A release audit should preserve the dependency license files that npm installs under each package and should regenerate this section when dependencies change.

Direct root dependencies below are reconciled with `package.json` and the root
lock. Ranges, resolved versions and license metadata are separate facts; metadata
is not the license text or evidence of redistribution permission. Workspace links
are resolved to their package entries. Other workspaces and the website have
additional dependencies and must be audited separately.

| Package | Declared range | Locked version | License metadata |
| --- | --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.185` | `0.3.185` | `SEE LICENSE IN README.md` |
| `@aws-sdk/client-s3` | `^3.1049.0` | `3.1049.0` | `Apache-2.0` |
| `@codemirror/commands` | `^6.10.3` | `6.10.3` | `MIT` |
| `@codemirror/lang-markdown` | `^6.5.0` | `6.5.0` | `MIT` |
| `@codemirror/language` | `^6.12.3` | `6.12.3` | `MIT` |
| `@codemirror/language-data` | `^6.5.2` | `6.5.2` | `MIT` |
| `@codemirror/state` | `^6.6.0` | `6.6.0` | `MIT` |
| `@codemirror/view` | `^6.43.0` | `6.43.0` | `MIT` |
| `@modelcontextprotocol/sdk` | `^1.29.0` | `1.29.0` | `MIT` |
| `@napi-rs/canvas` | `^0.1.100` | `0.1.100` | `MIT` |
| `@sciforge/collaboration-contracts` | `8.0.0` | `8.0.0` | `Apache-2.0` |
| `@sciforge/codex-runtime` | `0.1.25` | `0.1.25` | `Apache-2.0` |
| `@sciforge/dsh-runtime` | `0.1.0` | `0.1.0` | Package-local license field absent; inspect package/root license |
| `@sciforge/full-trace` | `0.1.0` | `0.1.0` | Package-local license field absent; inspect package/root license |
| `@sciforge/workspace-egress` | `0.1.25` | `0.1.25` | `Apache-2.0` |
| `@shikijs/rehype` | `^3.23.0` | `3.23.0` | `MIT` |
| `@tiptap/core` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/extension-image` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/extension-list` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/extension-mathematics` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/extension-table` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/markdown` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/pm` | `3.26.0` | `3.26.0` | `MIT` |
| `@tiptap/starter-kit` | `3.26.0` | `3.26.0` | `MIT` |
| `@xterm/addon-fit` | `^0.11.0` | `0.11.0` | `MIT` |
| `@xterm/addon-web-links` | `^0.12.0` | `0.12.0` | `MIT` |
| `@xterm/xterm` | `^6.0.0` | `6.0.0` | `MIT` |
| `@xyflow/react` | `^12.11.0` | `12.11.0` | `MIT` |
| `electron-store` | `^10.1.0` | `10.1.0` | `MIT` |
| `electron-updater` | `^6.8.9` | `6.8.9` | `MIT` |
| `fractional-indexing` | `^3.2.0` | `3.4.0` | `CC0-1.0` |
| `html-to-docx` | `^1.8.0` | `1.8.0` | `MIT` |
| `html2canvas-pro` | `^2.3.3` | `2.3.3` | `MIT` |
| `i18next` | `^25.4.2` | `25.4.2` | `MIT` |
| `jszip` | `^3.10.1` | `3.10.1` | `(MIT OR GPL-3.0-or-later)` |
| `juice` | `^12.1.1` | `12.1.1` | `MIT` |
| `katex` | `^0.16.22` | `0.16.22` | `MIT` |
| `lucide-react` | `^0.544.0` | `0.544.0` | `ISC` |
| `mermaid` | `11.15.0` | `11.15.0` | `MIT` |
| `molstar` | `5.10.1` | `5.10.1` | `MIT` |
| `node-pty` | `^1.1.0` | `1.1.0` | `MIT` |
| `pdf-lib` | `^1.17.1` | `1.17.1` | `MIT` |
| `pdfjs-dist` | `5.4.394` | `5.4.394` | `Apache-2.0` |
| `playwright-core` | `1.61.1` | `1.61.1` | `Apache-2.0` |
| `proxy-from-env` | `^2.1.0` | `2.1.0` | `MIT` |
| `qrcode.react` | `^4.2.0` | `4.2.0` | `ISC` |
| `react` | `^19.0.0` | `19.2.6` | `MIT` |
| `react-dom` | `^19.0.0` | `19.2.6` | `MIT` |
| `react-i18next` | `^15.7.4` | `15.7.4` | `MIT` |
| `react-markdown` | `^10.1.0` | `10.1.0` | `MIT` |
| `rehype-katex` | `^7.0.1` | `7.0.1` | `MIT` |
| `rehype-mathjax` | `^7.1.0` | `7.1.0` | `MIT` |
| `rehype-parse` | `^9.0.1` | `9.0.1` | `MIT` |
| `rehype-raw` | `^7.0.0` | `7.0.0` | `MIT` |
| `rehype-sanitize` | `^6.0.0` | `6.0.0` | `MIT` |
| `rehype-stringify` | `^10.0.1` | `10.0.1` | `MIT` |
| `remark-gfm` | `^4.0.1` | `4.0.1` | `MIT` |
| `remark-math` | `^6.0.0` | `6.0.0` | `MIT` |
| `remark-parse` | `^11.0.0` | `11.0.0` | `MIT` |
| `remark-rehype` | `^11.1.2` | `11.1.2` | `MIT` |
| `shiki` | `^3.23.0` | `3.23.0` | `MIT` |
| `streamdown` | `^2.5.0` | `2.5.0` | `Apache-2.0` |
| `tldraw` | `^4.2.0` | `4.5.12` | `SEE LICENSE IN LICENSE.md` |
| `unified` | `^11.0.5` | `11.0.5` | `MIT` |
| `unist-util-visit` | `^5.0.0` | `5.0.0` | `MIT` |
| `ws` | `^8.21.1` | `8.21.1` | `MIT` |
| `zod` | `^4.4.3` | `4.4.3` | `MIT` |
| `zustand` | `^5.0.3` | `5.0.13` | `MIT` |

Development dependencies and transitive packages are part of the dependency audit,
not automatically part of every shipped artifact. Preserve OR/AND expressions
unchanged: OR permits an applicable option; AND requires all indicated terms.
`jszip` is used under its MIT option. The client/site graphs also contain LGPL,
MPL-2.0 and CC-BY-4.0 material; do not collapse them into MIT/Apache.

Current `SEE LICENSE IN ...` entries are Anthropic and tldraw-family packages,
not the previously claimed Tiptap/ProseMirror set. Read the exact package's
README/LICENSE and pinned upstream text where it is only a link. Missing fields
and the recovered MIT texts are discussed above; this index is not a complete
third-party notice bundle.

## Electron, Chromium, and Node Runtime Notices

The desktop app uses Electron. Electron itself is MIT-licensed, and an Electron distribution also contains Chromium, Node.js, V8, and other third-party components with their own notices. A final app bundle must include or make available the Electron and Chromium notice artifacts from the packaged Electron distribution, including the Chromium license notice file shipped with Electron.

Release evidence should capture:

- The Electron version from `package-lock.json`.
- Electron's own license file from the installed package.
- Chromium third-party notices from the installed Electron distribution.
- Any platform-specific Electron Builder artifacts included in the installer.

## Native Modules and Binaries

Current source dependencies that may include native code or platform binaries:

| Component | Source | License metadata |
| --- | --- | --- |
| `@napi-rs/canvas` | npm dependency | `MIT` |
| `node-pty` | npm dependency | `MIT` |
| sharp / libvips platform packages | Root dependency graph: sharp 0.35.4 / libvips package 1.3.3; website: sharp 0.34.5 / libvips package 1.2.4 | sharp Apache-2.0 does not replace libvips LGPL-3.0-or-later and bundled-component terms |
| Electron/Chromium/Node/V8 | Electron runtime | See Electron and Chromium notices above. |

The ignored, build-generated Linux x64 Workspace Host deployment artifact also
contains fixed redistributable runtime components:

| Component | Pinned version | Distribution evidence |
| --- | --- | --- |
| Node.js Linux x64 runtime | `22.18.0` | Node distribution license is bundled as `runtime/LICENSE`; the build verifies the pinned archive integrity before extracting `runtime/node`. |
| OpenAI Codex Linux x64 cohort | `0.146.0` | Apache-2.0 license and package metadata are bundled under `codex/`; the build verifies the pinned package archive and license integrity before including the CLI and helper executables. |

The Workspace Host artifact builder can acquire these components during local
preparation/build, or use approved cached artifacts in offline mode. They are
build-generated rather than tracked source. Its manifest records SHA-256/size/mode;
verify the actual artifact and license texts before distribution. An offline
Workspace Host setting does not disable downloads elsewhere in the build chain.

A tracked-path suffix scan at this update found no `.node`, `.dylib`, `.so`, `.dll`, `.wasm`, `.exe`, `.tgz` or `.zip` files. This is not content-level binary detection, a complete archive inventory, or a claim about generated/installed content. Final installers must be scanned separately because native binaries can be introduced by packaging.

## Fonts and Rendered Content Assets

SciForge uses `katex` for math rendering. KaTeX is MIT-licensed and may install web fonts under `node_modules/katex/dist/fonts`. If those fonts are bundled in the final app, include the KaTeX license evidence with the app notices.

`pdfjs-dist` is Apache-2.0 and may include worker files, CMaps, standard fonts, or WASM assets depending on the build path. If included in the final app bundle, preserve the `pdfjs-dist` license and notice files.

## Source Media and Brand Assets

The 61 previously reviewed media entries have a single current disposition:
54 unconfirmed documentation/promotional assets are excluded, including the
PDF, screenshots, GIF, unused illustrations and historical brand artwork;
7 assets are replaced from scratch: two runtime PNG icons and five plain-text
ppt-master SVG layouts. No original asset bytes remain in those entries.

`src/asset/img/sciforge.png` and `sciforge_tray.png` are new nested-square
geometric placeholders. Their historical paths preserve application imports,
tray loading and packaging configuration, not brand provenance. The five SVG
layouts retain their filenames, template tokens and research-presentation roles,
including a caller-supplied figure slot, callouts and source footers, with no
inherited drawings. They are not screenshots or scientific evidence.

The owner expressly approved these newly authored project assets for this source
release under Apache-2.0. They are reproducible with the stdlib-only
`scripts/generate-source-assets.py`, which reads no old artwork or font files.
See [asset status](docs/ASSET-PUBLICATION-STATUS.md) and
[icon provenance](src/asset/img/README.md). Old artwork ownership remains
unconfirmed and is not converted to project ownership by this replacement.
External figures supplied by users and future media still require their own rights.

## Python and Sidecar Worker Dependencies

Python workers are not governed by npm lockfiles. Their dependency files are separate release evidence sources:

| Worker | Dependency file | Distribution note |
| --- | --- | --- |
| `packages/workers/gui-owl-computer-use` | `requirements.txt` | Currently declares `requests>=2.31.0` and `Pillow>=10.0.0`; range constraints are not an exact dependency closure. Audit actual Python packages before bundling. |
| `packages/workers/sci-modality-router/provider` | `requirements.txt` | Provider source and requirements are retained here; installed GPU libraries and model weights are separate. Audit actual inclusion rather than treating this source directory as absent. |

## Model Capability and Provider Notices

SciForge's distribution policy is that model and LLM capabilities go through Model Router. Users configure their own providers or remote services. The desktop package must not bundle model weights or default connections for models whose redistribution or target-use rights are unclear.

Current model capability notes:

| Capability | Distribution note |
| --- | --- |
| GUI-Owl / vision computer use | Do not bundle model weights by default. Use Model Router or a user-configured remote service. |
| Qwen/VLM style routing | Use Model Router. Users are responsible for provider terms and API credentials. |
| Esm2Text, Prot2Text, BioT5+, C2S-Scale, and related sci-modality experts | Server-side or user-provided expert services only unless each model's license permits the target use and redistribution. |
| Anthropic/OpenAI-compatible providers | Access must be mediated by Model Router. Provider SDK/API terms are separate from the SciForge source license. |

## Release Audit Checklist

### Pure source candidate

- Freeze a clean source manifest without private history, installed dependencies or generated runtime bundles; verify bytes/modes and actual exclusions.
- Preserve root/package licenses, NOTICE and copied-source/test/fixture provenance. A prior “reference only” declaration is not an independent source-origin audit or proof for a future package.
- Owner confirmation covers first-party contributions and the newly authored minimal replacement assets only. Keep all excluded unconfirmed media out; preserve separately applicable third-party licenses and fixture provenance.
- Keep the tldraw feature and declarations. Review applicable rights before distributing its code/artifacts or using it in production; do not infer a blanket first-party source prohibition from declarations alone.
- Reconcile dependency identity and license-evidence gaps technically; distinguish declared dependencies from third-party files actually included. Do not mark unperformed build/runtime checks as passed.

### Website publication

- Inventory actual generated HTML/JS/CSS, media, fonts and any site server/container; use the website lock rather than desktop dependency versions.
- Include notices/attribution and applicable MPL source availability for browser-distributed code. Inspect whether native build dependencies are absent from static output or included in a distributed server/container.
- Review externally loaded content, embedded identities, third-party marks and any public tldraw functionality before deployment.

### Installer / runtime distribution (only when included)

- Capture Electron, Chromium, Node/V8, SDK/CLI, native module, Python and font licenses from each final artifact, including nested notices.
- For included sharp/libvips, preserve component notices and applicable LGPL/GPL text; verify the corresponding-source delivery path and the actual shared-library replacement or relinking mechanism, including installation information where required. Do not restrict permitted library modification/debugging. A source homepage link alone is not proof of compliance; LGPL does not automatically relicense all SciForge under GPL.
- Handle MPL-covered files/source availability and CC-BY attribution according to actual distribution and modifications. See the [MPL](https://www.mozilla.org/en-US/MPL/2.0/) and [LGPL](https://www.gnu.org/licenses/lgpl-3.0.html) texts and the pinned libvips [1.3.3](https://github.com/lovell/sharp-libvips/blob/v1.3.3/THIRD-PARTY-NOTICES.md) / [1.2.4](https://github.com/lovell/sharp-libvips/blob/v1.2.4/THIRD-PARTY-NOTICES.md) component notices.
- Confirm SDK/Claude Code product mode and applicable agreements separately from source licensing; inspect authentication and bundled binary integrity technically.
- Confirm no unauthorized model weights, default service connections or credentials enter the bundle. Verify platform behavior/signing separately; no installer acceptance is claimed here.

Owners provide actual rights, contracts, consent and release-scope decisions.
They cannot substitute for missing license text, contradictory artifact versions,
unperformed media inspection or unverified notice/source-delivery mechanisms.

## SiYuan integration

The SiYuan domain package runs in server mode: it connects to a SiYuan service the
user runs or subscribes to, and neither bundles nor redistributes any SiYuan
binary. This service-only integration does not by itself establish redistribution of the
SiYuan runtime. Recheck any future bundle rather than treating it as permanently
exempt from upstream notices. Users who install or operate SiYuan themselves are
bound by its own license (AGPL-3.0-or-later, https://github.com/siyuan-note/siyuan),
which is their relationship with that project, not with this distribution.
