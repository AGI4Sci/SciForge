import type { Metadata } from "next";
import { MarketCatalog } from "@/components/MarketCatalog";
import { PageIntro } from "@/components/PageIntro";
import { marketSnapshot, plugins } from "@/lib/market-data";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "插件市场（审阅预览版）",
  description: "浏览 SciForge 官方插件：用途、权限、兼容版本与安装方式。审阅预览版，不提供制品下载。",
};

export default function MarketPage() {
  return (
    <main id="main-content">
      <div className="market-preview-banner">
        <div className="shell">
          <strong>审阅预览版</strong>
          <span>
            数据快照 {marketSnapshot.generatedAt} · 桌面端市场为安装入口 · 本页不提供制品下载
          </span>
        </div>
      </div>

      <PageIntro
        eyebrow="PLUGIN MARKET · REVIEW PREVIEW"
        title="SciForge 插件市场"
        lead="官方插件的能力、权限与兼容范围，一页看清。这里只展示可安装插件；网页不执行安装，安装与验签以桌面端市场为准。"
        meta={`共 ${plugins.length} 个插件 · 索引 ${marketSnapshot.sourceFile} @ ${marketSnapshot.sourceCommit.slice(0, 7)}`}
      />

      <section className="section">
        <div className="shell">
          <MarketCatalog />

          <div className="market-callout">
            <h2>关于这份预览</h2>
            <ul>
              <li>
                数据来源与应用内市场同一生成来源：{marketSnapshot.sourceFile}（生成于{" "}
                {marketSnapshot.generatedAt}，记录运行时 {marketSnapshot.dshRuntimeVersion}）。
              </li>
              <li>不是线上索引：当前没有对外发布的索引地址，本页为构建时快照。</li>
              <li>不含未上架插件及其内部原因；不展示本机路径、凭据或发布密钥信息。</li>
              <li>页面不提供插件制品下载，也不在浏览器里安装插件。</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}