# Computer Use Action Provider

`packages/actions/computer-use` 是 `sciforge-computer-use` 的目标 provider 位置。当前迁移采用兼容外壳：稳定实现仍保留在 [`packages/computer-use`](../../computer-use/README.md)，旧 Python 包名、pytest 入口和导入路径不变。

本目录先提供 action provider manifest，供未来 capability broker 按 `actions` 类别发现 Computer Use。后续迁移可以逐步把实现、测试和发布配置移动到本目录，但每一步都必须保留旧路径兼容层，直到所有 registry 和测试入口完成切换。

## 当前兼容关系

- 新 provider id：`sciforge.computer-use`
- 新 provider manifest：[`action-provider.manifest.json`](action-provider.manifest.json)
- 兼容实现包：`packages/computer-use/sciforge_computer_use`
- 兼容测试入口：`packages/computer-use/tests`
- 旧包职责：sense-agnostic GUI action loop，不依赖 `vision-sense`，也不依赖 UI components。

## 迁移边界

- Computer Use 是 action provider，不是 sense。
- 它可以消费 vision、OCR、窗口元数据、远程桌面帧等 sense 输出，但不把 sense 实现并入 action provider。
- 它只通过目标窗口、动作 schema、安全闸门、trace refs 和 verifier contract 与 runtime 交互。
- 高风险 GUI 动作默认 fail closed，需要显式 approval policy 和 verifier/human approval。

