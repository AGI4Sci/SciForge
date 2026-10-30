# 客户端开发流程

[English](./DEVELOPMENT.md) · [安装说明](../INSTALL.md)

## 仓库与分支基线

本源码候选包含桌面客户端、本地 worker、域/插件和共享协作协议；不包含云端服务、
数据库迁移、Zulip 服务端适配、部署运维与 remote-ssh。不要为启动客户端恢复私有单仓材料。

既有 `AGI4Sci/SciForge-client` 仓库目前是 private；未来公开源码目的地尚未创建，
这里不承诺可公开克隆的 URL。使用获授权的 checkout，或在目的地就绪后将下列变量替换为
维护者批准且你有权访问的地址。不能用直接公开旧仓及其历史来替代审定的干净源码导出。

```bash
# 先将 SCIFORGE_CLIENT_REPOSITORY_URL 设为获授权的客户端仓库地址。
: "${SCIFORGE_CLIENT_REPOSITORY_URL:?Set an authorized client repository URL}"
git clone "$SCIFORGE_CLIENT_REPOSITORY_URL" SciForge-client
cd SciForge-client
```

当前客户端集成分支为 `main`。从它建立短期分支，PR 回到 `main`，评审和必需检查通过后
再合并。如果未来公开目的地选择其他默认分支，应以该仓库规则为准。

```bash
git checkout main
git pull --ff-only origin main
git checkout -b feat/short-description
```

仅向自己有贡献权限的仓库推送：

```bash
git push origin feat/short-description
```

## 本地准备与验证

使用 Node.js 22.12+ 和当前平台原生编译工具，详见 [INSTALL.md](../INSTALL.md)。
所有命令在客户端仓库根目录运行。本地开发不要求云端凭据或闭源仓库权限；模型执行另需
用户配置受支持的 runtime/provider。手动验证时使用新建空 workspace。

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

这些命令对应实际根 package 脚本，不代表本候选已经通过安装、编译或运行时验收。
安装与 lifecycle hook 可能下载制品、编译原生模块；test、typecheck、build 也会执行前置
构建，运行前须审查完整脚本链。获准的离线构建可以设置
`SCIFORGE_WORKSPACE_HOST_ARTIFACT_OFFLINE=1`，但它仅禁用 Workspace Host 制品构建器的
下载，并非全局网络沙箱。缺失获批准制品时应报告阻断，不能静默下载。

取得启动应用权限后，手动验证受影响的 UI/运行时流程：

```bash
npm run dev
```

仅文档、禁止安装的审查应验证本地链接和 npm 命令对应脚本，不执行安装、生命周期、构建或
应用。未跑的验收项必须明确标记，不能当作通过。

## 协作边界

[客户端协作域](../packages/domains/collaboration/) 使用
[共享协议](../packages/collaboration-contracts/)。客户端与闭源云端分别记录 commit 和版本，
不再要求来自单仓同一 commit。协议变更需执行保留的客户端检查，并另行授权云端使用固定
客户端协议/输入做跨边界验证：

```bash
npm run contracts:test
```

参见[协作测试准备](../COLLABORATION_TEST_SETUP_GUIDE.md)与
[问题及证据模板](../COLLABORATION_TEST_ISSUE_TEMPLATE.md)。云端运维方另行提供当前私有
运维手册、隔离测试服务与账号；本候选不提供云端部署手册或服务端运行命令。
开发不得连接生产数据库、复用生产 Bot 或凭据。未取得获授权测试服务时保持云端配置为空；
这不构成真实云端验收。

## PR 质量

每个 PR 聚焦一个目的，避免无关格式化或重构。说明：

- 改了什么、为什么改；
- 精确验证命令、结果和未跑/阻断项目；
- 逻辑变更的回归测试；
- 必要且已脱敏、可见内容有使用权限的 UI 证据；
- 同步更新的中英文文档与用户文案。

行为变化时同步更新安装、命令、边界及发布说明。分支命名示例：
`feat/runtime-settings`、`fix/connection-probe`、`docs/bilingual-readme`、`refactor/chat-store`。

## 发布边界

当前保留的是[客户端 CI](../.github/workflows/client-ci.yml)与
[协作 CI](../.github/workflows/collaboration-ci.yml)，不包含旧的跨平台自动发布工作流。
CI 通过不等于公开授权、签名/公证验收或法律放行。本地准备不要求配置部署密钥，
不要附带运行上传、promote 或 release 命令。

纯源码公开、网站部署和安装包分发分别建立 manifest 并履行实际包含内容的义务，见
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。tldraw 保留功能但适用授权尚未确认，
且源码/素材权利证据仍待补齐，公开发布继续阻断。制品或许可证的技术缺口须技术修复，
不能用负责人签字代替。记录客户端精确 commit、协议版本、交付 manifest 和验证结果；
云端兼容性另行验收。
