# Computer Use Action Provider

本目录提供 Computer Use 的 action provider manifest，供 capability broker 按 `actions` 类别发现。实现仍保留在 [`packages/computer-use`](../../computer-use/README.md)，迁移期间必须保持旧路径兼容。

## 边界

- Computer Use 是 action provider，不是 sense。
- 它可以消费 vision、OCR、窗口元数据、远程桌面帧等 sense 输出。
- 它不把 `vision-sense`、UI components 或具体应用 shortcut 写入 action provider 主路径。
- 它只执行通用 GUI action schema，并输出可验证 trace。

## Manifest

Provider manifest 位于：

```text
packages/actions/computer-use/action-provider.manifest.json
```

该 manifest 声明 action schema、environment targets、safety gates、confirmation rules、trace contract、verifier contract 和 failure modes。
