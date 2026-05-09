# packages/presentation/interactive-views

本目录是 `packages/presentation/components` 的非破坏性别名和长期迁移目标，用于表达更准确的能力边界：interactive artifact views/renderers。

当前实现不移动任何 renderer，也不改变 registry 真相源。`packages/presentation/components` 继续提供现有 `uiComponentManifests`、兼容别名和历史 package registry；本目录只重新导出相同 manifest，并暴露 `interactiveViewManifests` 这个语义化名称。

## 边界

- 输入：artifact、view props、object references 和可选 workspace refs。
- 输出：人类或 agent 可读的交互式渲染表面、选择事件、批注事件、导出/编辑意图和 object references。
- 不负责：执行环境动作、文件写入、远程调用、verifier verdict 或 reward 计算。
- 可承载：human verification 交互，例如 accept、reject、revise、score、comment，但这些事件必须由上层 verifier contract 转换成标准 VerificationResult。

## 迁移规则

- 新代码可以 import `packages/presentation/interactive-views` 来表达长期语义。
- 现有代码继续 import `packages/presentation/components`，不需要迁移。
- 若未来迁移真实目录，必须保留 `packages/presentation/components` registry 兼容层，并确保旧 componentId、alias 和 renderer contract 可用。
