# 开发流程

[English](./DEVELOPMENT.md)

这份文档定义了本仓库的开发协作方式，重点说明默认分支、PR 流程，以及贡献质量标准。

## 开发基线

- `gui` 是唯一长期主分支，也是桌面、云端和手机协作集成的共同事实源
- 日常功能开发和缺陷修复从最新 `gui` 创建短期分支
- 桌面、云端和未来原生手机端按目录与 package 分离，不维护永久的端专用源码分支
- 各端从同一个精确 commit 独立构建、测试、打 tag 和发布

## 推荐流程

1. 先同步本地仓库。
2. 切换到 `gui`。
3. 拉取 `gui` 最新代码。
4. 从 `gui` 拉出短期功能分支开展开发。
5. 在本地完成实现并做好校验。
6. 提交 PR 回到 `gui`。
7. 在通过评审和检查后合并。

## 示例命令

### 同步 `gui`

```bash
git checkout gui
git pull --ff-only origin gui
```

### 从 `gui` 拉功能分支

```bash
git checkout gui
git pull --ff-only origin gui
git checkout -b feat/short-description
```

### 推送分支

```bash
git push origin feat/short-description
```

## Pull Request 流程

默认目标分支：

- `gui`

典型流程如下：

1. 在从 `gui` 拉出的短期功能分支上开发
2. 将分支推送到远端
3. 发起指向 `gui` 的 PR
4. 根据 Review 意见继续修改
5. 在通过校验并获得认可后合并

## PR 前必须做的校验

至少执行：

```bash
npm run typecheck
npm run build
npm run test
```

如果改动影响运行时行为或 UI，额外建议执行：

```bash
npm run dev
```

并手动验证受影响流程后再发起 PR。

### 协作服务开发

涉及手机 Zulip、云端协作服务、Session 投影或双向消息时，按
[协作服务开发启动、香港 ECS 部署与运维手册](./operations/zulip-aliyun-deployment.zh-CN.md)
使用独立开发数据库启动，并运行 collaboration 类型检查与测试。真实手机/桌面验收方法见
[手机与多人协作使用手册](./collaboration-user-guide.zh-CN.md)。开发环境不得连接生产数据库、复用生产
Bot 或把 provider credential 写入仓库。

### 多端目录与发布边界

所有端都在 `gui` 的同一 commit 上协同：`src/` 与 `packages/domains/collaboration/` 属于桌面端，
`packages/collaboration-server/` 与 `packages/collaboration-provider-zulip/` 属于云端部署，
`packages/collaboration-contracts/` 是两端共同协议。当前手机端使用官方 Zulip App；未来如增加原生应用，
应在独立目录中实现，但仍从 `gui` 集成，而不是建立永久 mobile 分支。

部署目标必须按产物隔离：Electron release 不打入云端 secret；ECS 只安装版本匹配的 contracts、provider
和 server tarball；手机应用只使用公开 API。每次发布记录目标端版本、Git commit 和合同版本。修改共享
合同后必须运行 `npm run collaboration:test`，并同时验证桌面和 packed server 路径。

## PR 质量标准

代码不难，难得的是好品味。评审要守住产品体验，而不只是实现是否能跑。

一个合格的 PR 应当：

- 目标明确，只围绕一个主要主题
- 易于审阅
- 有明确的校验结果支撑
- 行为变更时同步更新文档

PR 描述建议至少包含：

- 改了什么
- 为什么要改
- 如何验证
- 如果涉及 UI，附上视频或 GIF
- 如果涉及项目逻辑，列出新增或更新的单元测试

## 改动范围标准

推荐：

- 一个 PR 聚焦一个主题
- 尽量减少无关格式化改动
- 非必要不要顺手做大范围重构

避免：

- 没有解释就把文档、重构、功能改动混在一起
- 大范围行为变化却没有文档说明
- 对高风险改动绕过正常评审流程

## 本地化标准

如果修改了用户可见文案：

- 尽量同步更新中英文内容
- 保持文档和 UI 用词一致

## 文档标准

当改动影响以下内容时，应同步更新文档：

- 安装或初始化方式
- 命令使用方式
- 运行时要求
- 分支策略
- 发布流程
- 贡献者协作方式

## 合并建议

贡献改动只有在满足以下条件后，才应该合入 `gui`：

- Review 意见已处理
- 检查项通过
- 改动已经达到适合进入唯一集成主分支的稳定程度

不要用 desktop/cloud/mobile 长期分支表达发布状态；使用目标端 tag、GitHub Release 和不可变构建产物。

## 自动发布

稳定版本由维护者手动触发 GitHub Actions；workflow 输入的 ref 默认是 `gui`，也可填写 `gui` 历史中的
获批完整 commit。工作流先验证来源属于 `origin/gui`，再固定其 SHA 供所有平台构建。发布完成后使用
目标端 tag 和 release metadata 记录来源，不通过合并长期发布分支触发。

发布 workflow 会：

- 校验维护者输入的三段式 semver，并生成对应 `vX.Y.Z` tag
- 如果 rerun 时相同来源 commit 已经有目标 tag，则安全复用该 tag
- 构建已签名并公证的 macOS arm64/x64 包、Windows x64 安装器、Linux x64 AppImage
- 将发布产物和更新元数据上传到 GitHub Releases 与 R2 `stable` 渠道
- 只有在全部平台上传成功后，才会 promote R2 `stable/latest`

首次自动发布前，维护者需要配置这些 GitHub Actions secrets：

- R2：`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_PUBLIC_BASE_URL`，以及 `R2_ACCOUNT_ID` 或 `R2_ENDPOINT`
- 可选 R2 覆盖项：`R2_RELEASE_PREFIX`
- macOS 签名：`MAC_CODESIGN_P12_BASE64`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`

仓库的 Actions 设置还需要允许 `GITHUB_TOKEN` 写入 repository contents，这样 workflow 才能创建 tag 并发布 Release。

本地 `npm run release:mac` 和 `npm run release:win` 命令保留为手动兜底工具。

## 分支命名建议

示例：

- `feat/runtime-settings`
- `fix/connection-probe`
- `docs/bilingual-readme`
- `refactor/chat-store`

## 维护者说明

如果后续仓库调整受保护分支、强制 Reviewer、自动化测试门禁等规则，应同步更新本文件，保持与真实仓库规则一致。
