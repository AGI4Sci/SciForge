# 市场网站（本地静态站）

与应用内市场共用 `market/index.json` 与 `market/artifacts/`，没有第二份手工数据，
也没有构建步骤：一个 HTML + 一个 JS。

## 本地预览（复制即用）

```bash
cd <repo>/market
python3 -m http.server 8788
# 打开 http://127.0.0.1:8788/site/
```

必须用 HTTP 打开：`fetch('../index.json')` 在 `file://` 下会被浏览器拦截。

## 页面展示什么

- 可安装插件：标题、包名、版本、分类、发布者、**权限（工具 id + 效果）**、宿主依赖、
  制品大小与 SHA-256 前 16 位、制品下载链接。
- 暂不可安装插件：包名、版本、**不提供安装的具体原因**（未声明工具授权、构建失败、
  命名空间不符、宿主未激活等），不做任何"可安装"暗示。
- 顶部显示索引生成时间、DSH 运行时版本、可安装/不可安装数量。

## 它不做什么

- 不在浏览器里安装插件（浏览器没有验签与安装能力）。页面明确写出这一点，并指向
  SciForge 的「扩展中心 → 市场」。
- 不承诺"网页一键唤起客户端"。这件事本次没有实现，页面也就不这么写。
- 不维护第二份插件数据、不建数据库、不做排行榜。

## 部署说明（本次未发布）

静态站点可以直接用 GitHub Pages 托管；沿用仓库既有 Pages 方式即可，步骤如下，**未执行**：

1. 把 `market/` 目录（含 `index.json`、`artifacts/`、`site/`）作为发布根，或把
   `site/` 作为站点根、`index.json` 与 `artifacts/` 放到其相邻路径（页面按
   `../index.json`、`../artifacts/<file>` 取资源，换路径需同步改 `app.js`）。
2. 新增一个 Pages workflow（或复用现有 Pages 流程），仅在手动触发时发布，避免
   推送即发布。
3. 若要更换索引来源（例如 CDN），改 `app.js` 里的索引路径，或让客户端设置
   `SCIFORGE_MARKET_INDEX` 指向同一 URL；两边必须同源同版本。

发布前需要老师确认的事项：域名/CNAME、是否走现有站点还是新建站、证书与 CDN 凭据。

## 制品与索引的生成

```bash
cd <repo>
# 1) 逐个构建 + 签名打包 + 装进临时 profile 激活（测试密钥放在仓库外）
node --import tsx scripts/dsh-plugin-market-batch.mjs \
  --key-dir <repo 外的测试密钥目录>
# 2) 按上架条件生成索引，并把制品复制到 market/artifacts/
node --import tsx scripts/dsh-plugin-market-index.mjs
```

上架条件（由 `scripts/dsh-plugin-market-index.mjs` 强制，不是约定）：

1. 有制品且能被真实校验器读通；
2. 制品**自己声明**了工具授权与效果（声明为空 → 不上架，因为装上等于什么都没授权）；
3. 声明的宿主依赖都是本构建提供的；
4. 宿主能真实激活它；
5. 制品带可信发布者签名。