import type { Metadata } from "next";
import { NeedExplorer } from "@/components/NeedExplorer";
import { PageIntro } from "@/components/PageIntro";
import { TaxonomyOverview } from "@/components/TaxonomyOverview";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "44 个真实科研需求",
  description: "使用九维正交分类法、需求领域和工程模块探索 44 个真实科研 Agent 需求。",
};

export default function NeedsPage() {
  return (
    <main id="main-content">
      <PageIntro
        eyebrow="REAL NEEDS"
        title="44 个真实需求，不按“Agent 名称”分类"
        lead="每一项都是一件需要有人负责、能改变真实状态、并且必须留下完成证明的科研工作。展开需求即可看到闭环、人类责任、验收证据和普通 Codex 的系统级缺口。"
        meta="九维正交分类 · 6 个需求组 · 6 个工程模块"
      />
      <section className="section shell page-section">
        <TaxonomyOverview />
        <NeedExplorer />
      </section>
    </main>
  );
}
