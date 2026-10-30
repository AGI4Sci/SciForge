import Link from "next/link";

const nav = [
  { href: "/needs", label: "需求地图" },
  { href: "/capabilities", label: "工程模块" },
  { href: "/loops", label: "真实闭环" },
  { href: "/submit", label: "提交需求" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label="科研 Agent 需求地图首页">
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span>
            <strong>科研 Agent</strong>
            <small>需求与工程地图</small>
          </span>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          {nav.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link className="header-cta" href="/submit">
          提交需求
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </header>
  );
}
