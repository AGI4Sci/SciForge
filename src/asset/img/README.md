# Minimal runtime asset provenance

Only two PNG assets remain in this directory:

| Asset | Current bytes and purpose |
| --- | --- |
| `sciforge.png` | New 512×512 transparent nested-square icon; preserves app, title bar, working indicator and packaging inputs. |
| `sciforge_tray.png` | New 32×32 black nested-square tray placeholder on transparent background. |

Both are newly authored programmatic geometry expressly approved by the project
owner for this source release under Apache-2.0. No historical logo pixels, external
artwork, embedded font files or third-party marks were used. Retaining historical
filenames is import compatibility, not a claim that the old logos were cleared.

Reproduce with `python3 scripts/generate-source-assets.py` from the repository
root. It uses only Python stdlib. The old GIF, unused illustrations and all former
SVG/logo sources are excluded, not relicensed. These icons are not runtime evidence.
See [current asset status](../../../docs/ASSET-PUBLICATION-STATUS.md).
