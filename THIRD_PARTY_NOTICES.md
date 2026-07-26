# Third Party Notices

Last updated: 2026-07-21

This file records the third-party license and distribution boundary for the current SciForge source tree. It is an engineering compliance index, not legal advice. The exact npm dependency graph is pinned by `package-lock.json`.

## SciForge Source Boundary

The SciForge source code in this repository is distributed under the MIT
License in `LICENSE`, except where a file or package says otherwise.

Package metadata policy:

| Scope | Package metadata | Distribution policy |
| --- | --- | --- |
| Root desktop app | `private: true`, `license: MIT` | Not published as a public npm package. Source release follows root `LICENSE`. |
| `packages/full-trace` | package-local license field absent | Project-owned workspace package; source release follows root `LICENSE`. |
| `packages/domains/*` | `license: MIT` | Independently owned domain packages; backend and optional UI ship at one version. |
| `packages/workers/*` | `license: MIT` | Project-owned non-domain worker packages. |
| `vendor/openclaw-shim` | `private: true`, `license: MIT` | Project-local compatibility shim for peer imports; not an upstream OpenClaw source distribution. |

## Reference-Only Upstream Inspiration

README and design documentation mention these upstream projects as product or architecture references. They are not bundled third-party source distributions in the current repository:

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

| Project | Upstream repository | Audited reference revision | License at audited revision | Current license status checked on 2026-07-02 | SciForge boundary |
| --- | --- | --- | --- | --- | --- |
| Reasonix | `https://github.com/esengine/DeepSeek-Reasonix` | `v1.15.0` / `484bca854f4e669eaa21716939ad7d5b323b4962` | MIT (`LICENSE`, copyright Reasonix Contributors) | MIT; `main-v2` HEAD checked at `d5ba463964a025ed37e1771a686eaa2ef303f026` | Design reference only. No Reasonix source, tests, fixtures, event contracts, binaries, or assets are copied. |
| Kun / historical DeepSeek-GUI lineage | `https://github.com/KunAgent/Kun` | `363fdf566657cd4d60801f62b0b8f3aa8dfbf2fc`, the parent of the relicense commit | MIT (`LICENSE`, copyright xingyu). `package.json` at this revision had no explicit package-license field, so the root `LICENSE` is the controlling evidence for that audited source tree. | Relicensed at `5472bed3b878854d296851820834145f5fe1a353` to `PolyForm-Noncommercial-1.0.0`; current GitHub license detection reports `Other`. | Historical lineage record only. SciForge must not treat `5472bed3` or later Kun source/assets as MIT-licensed material. Kun source, tests, fixtures, binaries, and assets are not included in the current SciForge source distribution or packaged application. |
| OpenHanako | `https://github.com/liliMozi/openhanako` | `v0.36.0` / `92a727959f75e556df5013d37037a5007a5c5e16` | Apache-2.0. The `LICENSE` history begins at this initial open-source release as Apache-2.0; no MIT-to-Apache transition was observed in the upstream `LICENSE` history. | Apache-2.0; current `v0.350.2` checked at `2c3691c31043004e2b72cf3851faed9a8f584658` | Interaction reference only. No OpenHanako source, tests, fixtures, binaries, or assets are copied. |
| LobsterAI | `https://github.com/netease-youdao/LobsterAI` | `2026.6.30` / `7d02d107fa46d0801c0a2d6b14b4b34c37ac943a` | MIT (`LICENSE`, copyright NetEase Youdao). Initial open-source `LICENSE` commit `3ab5afbc53b6eea8cdbcd9370ca115f5a32fb16f` is also MIT. | MIT | Product-flow reference only. No LobsterAI source, tests, fixtures, binaries, or assets are copied. |

## npm Dependency Notices

The authoritative npm evidence source is `package-lock.json`. A release audit should preserve the dependency license files that npm installs under each package and should regenerate this section when dependencies change.

Direct root dependencies recorded in `package-lock.json`:

| Package | Version range | License metadata |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.185` | `SEE LICENSE IN README.md` |
| `@aws-sdk/client-s3` | `^3.1049.0` | `Apache-2.0` |
| `@codemirror/commands` | `^6.10.3` | `MIT` |
| `@codemirror/lang-markdown` | `^6.5.0` | `MIT` |
| `@codemirror/language` | `^6.12.3` | `MIT` |
| `@codemirror/language-data` | `^6.5.2` | `MIT` |
| `@codemirror/state` | `^6.6.0` | `MIT` |
| `@codemirror/view` | `^6.43.0` | `MIT` |
| `@jbrowse/react-linear-genome-view2` | `4.3.0` | `MIT` |
| `@larksuiteoapi/node-sdk` | `^1.64.0` | `MIT` |
| `@modelcontextprotocol/sdk` | `^1.29.0` | `MIT` |
| `@napi-rs/canvas` | `^0.1.100` | `MIT` |
| `@sciforge/full-trace` | `0.1.0` | Package-local license field absent; project source follows root `LICENSE` |
| `@tencent-weixin/openclaw-weixin` | `2.4.3` | `MIT` |
| `@tiptap/core` | `3.26.0` | `MIT` |
| `@tiptap/extension-image` | `3.26.0` | `MIT` |
| `@tiptap/extension-list` | `3.26.0` | `MIT` |
| `@tiptap/extension-mathematics` | `3.26.0` | `MIT` |
| `@tiptap/extension-table` | `3.26.0` | `MIT` |
| `@tiptap/markdown` | `3.26.0` | `MIT` |
| `@tiptap/pm` | `3.26.0` | `MIT` |
| `@tiptap/starter-kit` | `3.26.0` | `MIT` |
| `@xterm/addon-fit` | `^0.11.0` | `MIT` |
| `@xterm/addon-web-links` | `^0.12.0` | `MIT` |
| `@xterm/xterm` | `^6.0.0` | `MIT` |
| `@xyflow/react` | `^12.11.0` | `MIT` |
| `electron-store` | `^10.1.0` | `MIT` |
| `electron-updater` | `^6.8.3` | `MIT` |
| `fractional-indexing` | `^3.2.0` | `CC0-1.0` |
| `html-to-docx` | `^1.8.0` | `MIT` |
| `i18next` | `^25.4.2` | `MIT` |
| `jszip` | `^3.10.1` | `(MIT OR GPL-3.0-or-later)` |
| `katex` | `^0.16.22` | `MIT` |
| `lucide-react` | `^0.544.0` | `ISC` |
| `molstar` | `5.10.1` | `MIT` |
| `node-pty` | `^1.1.0` | `MIT` |
| `openclaw` | `file:vendor/openclaw-shim` | `MIT`, project-local shim |
| `pdf-lib` | `^1.17.1` | `MIT` |
| `pdfjs-dist` | `5.4.394` | `Apache-2.0` |
| `proxy-from-env` | `^2.1.0` | `MIT` |
| `qrcode.react` | `^4.2.0` | `ISC` |
| `react` | `^19.0.0` | `MIT` |
| `react-dom` | `^19.0.0` | `MIT` |
| `react-i18next` | `^15.7.4` | `MIT` |
| `react-markdown` | `^10.1.0` | `MIT` |
| `rehype-katex` | `^7.0.1` | `MIT` |
| `remark-gfm` | `^4.0.1` | `MIT` |
| `remark-math` | `^6.0.0` | `MIT` |
| `remark-parse` | `^11.0.0` | `MIT` |
| `seqparse` | `0.2.2` | `MIT` |
| `seqviz` | `3.10.22` | `MIT` |
| `shiki` | `^3.23.0` | `MIT` |
| `streamdown` | `^2.5.0` | `Apache-2.0` |
| `tldraw` | `^4.2.0` | `SEE LICENSE IN LICENSE.md` |
| `unified` | `^11.0.5` | `MIT` |
| `ws` | `^8.20.1` | `MIT` |
| `zod` | `^4.4.3` | `MIT` |
| `zustand` | `^5.0.3` | `MIT` |

Direct root development dependencies include `electron`, `electron-vite`, `vite`, `vitest`, `typescript`, ESLint packages, React type packages, Tailwind/PostCSS, and related build tools. Their license metadata in `package-lock.json` is MIT or Apache-2.0 unless the lockfile records a more specific package license.

Transitive license categories currently observed in the root lockfile include MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Unlicense, BlueOak-1.0.0, Python-2.0, CC-BY-4.0, `(MIT OR CC0-1.0)`, `(MIT AND Zlib)`, `(MIT OR WTFPL)`, `(BSD-2-Clause OR MIT OR Apache-2.0)`, `(MPL-2.0 OR Apache-2.0)`, and `SEE LICENSE IN ...` entries. The known dual-license package `jszip` is used under the MIT option.

Packages with `SEE LICENSE IN ...` metadata must have their package README/LICENSE files included in release evidence. At this update, the notable direct package is `@anthropic-ai/claude-agent-sdk`; several transitive Tiptap/ProseMirror-related packages also carry package-local license references in the lockfile.

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
| Electron/Chromium/Node/V8 | Electron runtime | See Electron and Chromium notices above. |

No repository-tracked `.node`, `.dylib`, `.so`, or `.dll` files were found in the source tree outside ignored build/dependency directories during this update. Final installers must be scanned separately because native binaries can be introduced by packaging.

## Fonts and Rendered Content Assets

SciForge uses `katex` for math rendering. KaTeX is MIT-licensed and may install web fonts under `node_modules/katex/dist/fonts`. If those fonts are bundled in the final app, include the KaTeX license evidence with the app notices.

`pdfjs-dist` is Apache-2.0 and may include worker files, CMaps, standard fonts, or WASM assets depending on the build path. If included in the final app bundle, preserve the `pdfjs-dist` license and notice files.

## Source Media and Brand Assets

Current tracked media assets in `src/asset/img` are project brand assets,
project-owned demo media, or self-generated generic UI illustrations. Their
provenance is documented in `src/asset/img/README.md`.

| Asset | Current notice status |
| --- | --- |
| `logo.png` | Legacy SciForge icon restored from project history by owner preference. |
| `sciforge.png` | Transparent legacy SciForge icon restored from project history for app icon usage. |
| `sciforge_tray.png` | Legacy SciForge tray icon restored from project history. |
| `code.gif` | Legacy SciForge Code mode demo restored from project history for README display. |
| `sciforge-icon.svg` | Self-generated project icon source retained for future editable use. |
| `sciforge-tray.svg` | Self-generated tray icon source retained for future editable use. |
| `codemode.svg` | Self-generated generic UI illustration source; no screenshot or third-party mark. |
| `codemode.png` | Generated from `codemode.svg`. |
| `writemode.svg` | Self-generated generic UI illustration source; no screenshot or third-party mark. |
| `writemode.png` | Generated from `writemode.svg`. |
| `connect-phone-mode.svg` | Self-generated generic UI illustration source; no screenshot or third-party mark. |
| `connect-phone-mode.png` | Generated from `connect-phone-mode.svg`. |

Release rule: only project-owned, generated-with-appropriate-rights, or clearly
permissive assets may be bundled. Third-party logos, screenshots, videos, and
trademarks must not be treated as covered by the project license.

## Vendored Code

`vendor/openclaw-shim` is a project-local compatibility shim named `openclaw` so `@tencent-weixin/openclaw-weixin` peer imports can resolve inside SciForge packaging. The shim is marked private and MIT in its package metadata. It is not intended to redistribute upstream OpenClaw source code.

If future changes copy implementation code, generated code, or assets from upstream OpenClaw or Tencent packages into this shim, the copied material must be listed here with its upstream copyright and license.

## Python and Sidecar Worker Dependencies

Python workers are not governed by npm lockfiles. Their dependency files are separate release evidence sources:

| Worker | Dependency file | Distribution note |
| --- | --- | --- |
| `packages/workers/gui-owl-computer-use` | `requirements.txt` | Depends on user/runtime environment packages such as `requests`, `pyautogui`, `mss`, `pyperclip`, `Pillow`, and `mcp`; audit Python package metadata before bundling. |
| `packages/workers/sci-modality-router/provider` | `requirements.txt` | Server-side GPU/provider environment only. Not bundled into the desktop app by default. |

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

Before any source or binary release:

- Regenerate npm dependency evidence from `package-lock.json` and any plugin-local lockfiles.
- Capture Electron, Chromium, Node/V8, and platform installer notices from the final packaged app.
- Capture native module licenses and platform binaries from the final packaged app.
- Confirm or replace all media and brand assets listed above.
- Confirm Python dependency metadata for any sidecar worker actually distributed.
- Confirm that no model weights, default model endpoints, or provider credentials are bundled outside the Model Router policy.
