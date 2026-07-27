import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: {
    default: "科研 Agent 需求地图",
    template: "%s · 科研 Agent 需求地图",
  },
  description:
    "面向科研 Agent 工程实施的需求地图：44 个真实需求、6 个工程模块与 3 个 AI 研究闭环。",
  openGraph: {
    title: "科研 Agent 需求地图",
    description: "从真实科研需求走向清晰、可验收的工程模块。",
    type: "website",
    locale: "zh_CN",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到正文
        </a>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
