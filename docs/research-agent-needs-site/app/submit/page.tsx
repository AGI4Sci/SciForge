import type { Metadata } from "next";
import { NeedSubmissionForm } from "@/components/NeedSubmissionForm";
import { PageIntro } from "@/components/PageIntro";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "提交科研需求",
  description: "用统一格式向 SciForge 提交真实科研 Agent 需求。",
};

export default function SubmitNeedPage() {
  return (
    <main id="main-content">
      <PageIntro
        eyebrow="OPEN RESEARCH NEEDS"
        title="提交一项真实科研需求"
        lead="不要先描述功能。请从真实情境、当前痛点、人类必须参与的环节和可检查的完成标准出发。"
        meta="公开提交 · GitHub 保存 · 可持续讨论"
      />
      <section className="section shell submit-layout">
        <div className="submit-guidance">
          <p className="eyebrow">填写原则</p>
          <h2>写清需求，不替工程师设计方案</h2>
          <p>
            好需求能让研究者确认“这正是我的问题”，也能让工程师判断结果是否真的解决了问题。
            不需要指定技术栈、接口或系统架构。
          </p>
        </div>
        <NeedSubmissionForm />
      </section>
    </main>
  );
}
