import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { loops } from "@/lib/site-data";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "3 个 AI 研究闭环",
  description: "从数据清洗、Baseline 复现和证据审查三个 AI 研究场景验证工程模块。",
};

export default function LoopsPage() {
  return (
    <main id="main-content">
      <PageIntro
        eyebrow="END-TO-END PILOTS"
        title="三个闭环，先从 AI 研究开始"
        lead="先用数据清洗、论文复现和证据审查验证需求是否真实成立。每个闭环都从真实输入开始，经过人机协作，到可检查的结果和完成证明。"
        meta="实验数据清洗 · Baseline + HPC · 独立证据审查"
      />

      <section className="section shell">
        <nav className="loop-jump" aria-label="闭环快速导航">
          {loops.map((loop, index) => (
            <Link href={`#${loop.id}`} key={loop.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {loop.title}
            </Link>
          ))}
        </nav>

        <div className="loop-details">
          {loops.map((loop, loopIndex) => (
            <article className="loop-detail-card" id={loop.id} key={loop.id}>
              <header>
                <div className="loop-title-block">
                  <span className="loop-big-number">
                    {String(loopIndex + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="loop-title-meta">
                      <span className={`priority priority-${loop.priority.toLowerCase()}`}>
                        {loop.priority}
                      </span>
                      <span>{loop.capabilities.join(" · ")}</span>
                    </div>
                    <h2>{loop.title}</h2>
                    <p>{loop.why}</p>
                  </div>
                </div>
              </header>

              <div className="loop-body">
                <section className="workflow-column">
                  <span className="detail-label">端到端路径</span>
                  <div className="workflow-track">
                    {loop.stages.map((stage, index) => (
                      <div className="workflow-step" key={stage}>
                        <span>{index + 1}</span>
                        <p>{stage}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <aside className="loop-evidence">
                  <div>
                    <span className="detail-label">人类闸门</span>
                    <ul>
                      {loop.human.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="detail-label">硬验收</span>
                    <ul className="check-list">
                      {loop.acceptance.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </aside>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-dark">
        <div className="shell loop-bottom">
          <div>
            <p className="eyebrow eyebrow-light">选试点原则</p>
            <h2>不要按“演示漂亮度”排序</h2>
          </div>
          <p>
            优先选择能覆盖至少三类需求、消除一个高风险人工断点、
            有真实用户和真实失败样例，并能量化验收的场景。
          </p>
          <Link className="button button-primary" href="/capabilities">
            查看工程模块 →
          </Link>
        </div>
      </section>
    </main>
  );
}
