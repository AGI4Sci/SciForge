import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { marketSnapshot } from "@/lib/market-data";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "安装指引（审阅预览版）",
  description: "如何在 SciForge 桌面端安装插件：入口、权限确认、校验与常见问题。",
};

export default function InstallHelpPage() {
  return (
    <main id="main-content">
      <div className="market-preview-banner">
        <div className="shell">
          <strong>审阅预览版</strong>
          <span>本页是安装说明，不执行安装、不提供制品下载</span>
        </div>
      </div>

      <PageIntro
        eyebrow="INSTALL · REVIEW PREVIEW"
        title="安装指引"
        lead="插件在 SciForge 桌面端安装并运行。网页只做说明：浏览器没有验签和安装能力，也不应该拿到你的工作区权限。"
        meta={`索引 ${marketSnapshot.sourceFile} @ ${marketSnapshot.sourceCommit.slice(0, 7)} · 运行时 ${marketSnapshot.dshRuntimeVersion}`}
      />

      <section className="section">
        <div className="shell market-detail">
          <article className="market-panel">
            <h2>四步安装</h2>
            <ol className="market-steps">
              <li>
                <strong>打开桌面端</strong>：启动 SciForge，进入左侧栏「扩展中心」。
              </li>
              <li>
                <strong>进入市场</strong>：在扩展中心打开「市场」，看到可用插件列表。
              </li>
              <li>
                <strong>核对权限</strong>：选择插件后，安装前会列出它将获得的工具与效果（读取、计算、
                写入工作区、写入外部、破坏性）。只批准你理解的权限。
              </li>
              <li>
                <strong>批准并安装</strong>：确认后由桌面端下载制品，校验大小与 SHA-256，再验证发布者签名；
                校验不通过会拒绝安装。安装完成后可启用、禁用或卸载。
              </li>
            </ol>

            <h2>安装前请确认</h2>
            <ul>
              <li>桌面端使用的 DSH 运行时版本与插件声明的兼容范围匹配（详情页「兼容版本」）。</li>
              <li>插件声明的宿主依赖在你的环境中可用。</li>
              <li>你理解插件的权限范围；未声明的能力不会被授予。</li>
            </ul>

            <h2>安全说明</h2>
            <ul>
              <li>安装时的完整性校验：制品字节数 + SHA-256 必须与市场索引一致，否则拒绝。</li>
              <li>发布者签名：桌面端用本机信任的公钥校验 Ed25519 签名；未知密钥或签名不符会拒绝安装（fail-closed）。</li>
              <li>本页不提供制品下载，也不代替桌面端的校验与权限确认。</li>
            </ul>

            <h2>常见问题</h2>
            <dl className="market-faq">
              <div>
                <dt>网页能直接安装吗？</dt>
                <dd>不能。浏览器没有验签与本地安装能力；安装只在桌面端完成。</dd>
              </div>
              <div>
                <dt>为什么看不到下载按钮？</dt>
                <dd>审阅预览版只发布资料页，不发布插件制品；下载能力要等正式发布方案确定后再开放。</dd>
              </div>
              <div>
                <dt>安装失败怎么办？</dt>
                <dd>按桌面端提示核对：制品校验失败、签名不受信任或权限不匹配都会拒绝安装，不会降级放行。</dd>
              </div>
            </dl>

            <p className="market-note">
              <Link href="/market">← 返回插件市场</Link>
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}