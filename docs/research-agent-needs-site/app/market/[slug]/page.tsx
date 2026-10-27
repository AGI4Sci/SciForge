import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageIntro } from "@/components/PageIntro";
import { PluginActions } from "@/components/PluginActions";
import {
  categoryLabels,
  effectLabels,
  formatBytes,
  getPlugin,
  marketSnapshot,
  plugins,
} from "@/lib/market-data";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return plugins.map((plugin) => ({ slug: plugin.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const plugin = getPlugin(slug);
  if (!plugin) return { title: "插件不存在" };
  return {
    title: `${plugin.title}（审阅预览版）`,
    description: plugin.summary,
  };
}

export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plugin = getPlugin(slug);
  if (!plugin) notFound();

  return (
    <main id="main-content">
      <div className="market-preview-banner">
        <div className="shell">
          <strong>审阅预览版</strong>
          <span>数据快照 {marketSnapshot.generatedAt} · 不提供制品下载 · 安装以桌面端市场为准</span>
        </div>
      </div>

      <PageIntro
        eyebrow={`PLUGIN · ${plugin.name}`}
        title={plugin.title}
        lead={plugin.summary}
        meta={`版本 ${plugin.version} · 发布者 ${plugin.publisher} · ${plugin.categories
          .map((item) => categoryLabels[item] ?? item)
          .join(" / ")}`}
      />

      <section className="section">
        <div className="shell market-detail">
          <nav className="market-breadcrumb" aria-label="面包屑">
            <Link href="/market">← 返回插件市场</Link>
          </nav>

          <div className="market-detail-grid">
            <article className="market-panel">
              <h2>用途</h2>
              <p>{plugin.summary}</p>

              <h2>适用场景</h2>
              <ul>
                {plugin.useCases.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h2>真实示例</h2>
              {plugin.examples.map((example) => (
                <figure key={example.title} className="market-example">
                  <figcaption>{example.title}</figcaption>
                  <pre>
                    <code>{example.body}</code>
                  </pre>
                </figure>
              ))}

              <h2>兼容版本</h2>
              <p>{plugin.compatibility}</p>

              <h2>权限</h2>
              <table className="market-table">
                <thead>
                  <tr>
                    <th scope="col">工具</th>
                    <th scope="col">能力 ID</th>
                    <th scope="col">效果</th>
                  </tr>
                </thead>
                <tbody>
                  {plugin.tools.map((tool) => (
                    <tr key={tool.id}>
                      <td>
                        <code>{tool.name}</code>
                      </td>
                      <td>
                        <code>{tool.id}</code>
                      </td>
                      <td>{effectLabels[tool.effect]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="market-note">
                宿主依赖：{plugin.hostDependencies.join("、")} · 安装时需在桌面端核对并批准以上权限。
              </p>
            </article>

            <aside className="market-panel market-panel-side">
              <h2>包信息</h2>
              <dl className="market-meta">
                <div>
                  <dt>包大小</dt>
                  <dd>{formatBytes(plugin.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>插件 ID</dt>
                  <dd>
                    <code>{plugin.name}</code>
                  </dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd className="market-sha">{plugin.sha256}</dd>
                </div>
                <div>
                  <dt>签名</dt>
                  <dd>
                    {plugin.signature.algorithm} · 发布者 {plugin.signature.publisherId}
                    （由桌面端安装时校验）
                  </dd>
                </div>
                <div>
                  <dt>许可证</dt>
                  <dd>{plugin.license}</dd>
                </div>
              </dl>

              <h2>操作</h2>
              <PluginActions pluginId={plugin.name} />
              <p className="market-note">
                审阅预览版不提供制品下载。安装请打开桌面端：扩展中心 → 市场 → 选择插件 → 核对权限 → 批准并安装。
              </p>
              <p className="market-note">
                <Link href="/market/install">查看完整安装指引 →</Link>
              </p>

              {plugin.notes.length > 0 ? (
                <>
                  <h2>说明</h2>
                  <ul className="market-notes">
                    {plugin.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}