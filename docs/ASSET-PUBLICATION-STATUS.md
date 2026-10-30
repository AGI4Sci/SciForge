# Source-only asset status / 最小源码素材状态

This page is the current status for the owner's approved minimal source scope.
It supersedes the prior pending-review notices for the 61-entry media ledger.
It does not claim publication has occurred or authorize an installer/deployment.

- **54 excluded assets**: the multi-user design PDF; documentation screenshots,
  promotional/site images; README GIF; unused illustrations and old brand artwork.
  Their original rights remain unconfirmed. They are not shipped in this candidate.
  Instructions and functional source remain; removed image links are replaced by
  explicit unavailable-in-candidate text rather than broken image requests.
- **2 new runtime PNG assets**: `sciforge.png` (512×512) and `sciforge_tray.png`
  (32×32) in `src/asset/img`. They contain only nested square outlines on a
  transparent background. Existing import paths and packaging configuration remain.
- **5 new plain-text PPT layouts**: all `sciforge_research/layouts` SVGs retain
  every existing template token, canvas, figure/callout role and source footer.
  No original drawings are retained; users supply their own authorized figures.

The project owner has explicitly approved newly authored minimal geometric/text
assets for this release under the existing Apache-2.0 source license. This is not
an ownership claim about the deleted artwork, nor approval for any third-party
images. The replacements are reproducible from
[`scripts/generate-source-assets.py`](../scripts/generate-source-assets.py), using
only Python's standard library and no external artwork or font files.

源码贡献者/单位授权已经项目负责人确认。第三方依赖仍适用其自己的条款；仅保留依赖
声明不等于分发依赖代码、archive 或构建产物。tldraw 代码/制品分发及生产使用条件仍保留，
不以其依赖声明阻断本次自有源码。node_modules、依赖 archive、生成的运行时/构建产物不随
源码分发；现有安全测试 fixture（包括名为 dist 的源码输入）保留。

These resources are placeholders/templates, not captured UI, scientific results,
model-call evidence, collaboration acceptance or installer verification. Never
restore excluded historical media without separate rights/privacy review.
