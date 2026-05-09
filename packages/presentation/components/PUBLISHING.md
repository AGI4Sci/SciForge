# SciForge UI 组件发布边界

把 UI component 当作可独立发布包之前，先运行边界检查：

```sh
npm --workspace @sciforge-ui/components run packages:check
```

从仓库根目录运行更完整的包门禁时，也会在现有 skill/package catalog 检查之后执行 UI component boundary check：

```sh
npm run packages:check
```

检查项会确认每个组件包具备最小发布表面：

- `package.json`、`README.md` 和 `manifest.ts`。
- `README.md` 包含 `Agent quick contract` 或 `Agent 快速契约`。
- `package.json` 的 `files` 覆盖 README、manifest、fixtures、renderer、assets，以及存在时的 workbench demo assets。
- `package.json` 的 `exports` 覆盖 manifest、README、`fixtures/basic`、`fixtures/empty`、renderer、assets，以及存在时的 workbench demo assets。
- 存在 `fixtures/basic` 和 `fixtures/empty`。
- 交互组件包含 selection/open-ref fixture。
- 不存在 app-private imports、兄弟组件相对 imports，或任何越出组件包目录的相对 import。
- `@sciforge-ui/runtime-contract` 作为 dependency 或 peer dependency 声明，确保 manifests、fixtures 和 renderers 不依赖父目录源码文件。
- `packages/presentation/components/index.ts` 是否导出该组件 manifest。

每个子包必须包含发布后运行所需的全部资源。共享 runtime types 应来自 `@sciforge-ui/runtime-contract`；包代码、fixtures、assets 和 workbench demo 文件不得 import 或读取 `packages/presentation/components` 父目录文件。

已发布组件采用严格规则：缺失发布资源会使命令失败。草稿 skeleton package 也纳入同一扫描，但不完整发布资源会报告为 warning，保证草稿组件补齐期间 acceptance gate 仍可使用。

该脚本对组件实现文件只读。它只报告缺失资源，让后续包工作可以补 fixtures、renderers、assets 或 root index exports，而不改动无关组件逻辑。
