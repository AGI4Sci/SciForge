import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <p className="footer-brand">科研 Agent 需求地图</p>
          <p>把真实科研痛点翻译成可拆工、可验收的工程模块。</p>
        </div>
        <div className="footer-links">
          <Link href="/needs">44 个需求</Link>
          <Link href="/capabilities">6 个工程模块</Link>
          <Link href="/loops">3 个 AI 研究闭环</Link>
          <Link href="/submit">提交新需求</Link>
        </div>
        <p className="footer-note">Research map · 2026</p>
      </div>
    </footer>
  );
}
