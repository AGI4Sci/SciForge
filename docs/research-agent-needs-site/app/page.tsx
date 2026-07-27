import Link from "next/link";
import {
  engineeringModules,
  homeSignals,
  loops,
} from "@/lib/site-data";
import { taxonomyDimensions } from "@/lib/needs-data";

export const dynamic = "force-static";

export default function Home() {
  return (
    <main id="main-content">
      <section className="hero">
        <div className="hero-glow hero-glow-a" />
        <div className="hero-glow hero-glow-b" />
        <div className="shell hero-grid">
          <div className="hero-copy">
            <p className="eyebrow eyebrow-light">SCIENCE AGENT · ENGINEERING MAP</p>
            <h1>
              科研 Agent 的难点，
              <br />
              <span>不是再多一个聊天框。</span>
            </h1>
            <p className="hero-lead">
              这份地图把 44 个真实需求收敛成 6 个可开工模块：证据版本、线程隔离
              Computer Use、持久任务、多人工作区、多端同步与外部写入。
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/needs">
                探索需求地图
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="button button-ghost-light" href="/capabilities">
                查看 6 个工程模块
              </Link>
            </div>
          </div>
          <div className="hero-model" aria-label="科研 Agent 分层模型">
            <div className="model-label">建议的平台分工</div>
            <div className="model-layer model-layer-top">
              <span>研究者看到的</span>
              <strong>结论 · 图表 · 决策 · 进度</strong>
            </div>
            <div className="model-connector" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="model-layer model-layer-core">
              <span>工程师交付的</span>
              <strong>F1–F6 六个明确模块</strong>
            </div>
            <div className="model-connector" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="model-layer model-layer-base">
              <span>每个模块必须满足的</span>
              <strong>版本 · 身份 · 幂等 · 审计</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="signal-strip">
        <div className="shell signal-grid">
          {homeSignals.map((signal) => (
            <div className="signal" key={signal.value}>
              <strong>{signal.value}</strong>
              <span>{signal.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section shell">
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">先看大局</p>
            <h2>六个可以直接拆工的工程模块</h2>
          </div>
          <p>
            不再用 Pack 或抽象“能力”包装自然约束。每个模块只说明科研用户遇到的问题、
            系统需要提供什么，以及怎样才算满足需求。
          </p>
        </div>
        <div className="module-preview-grid">
          {engineeringModules.map((module) => (
            <article className="module-preview-card" key={module.id}>
              <div className="module-preview-id">{module.id}</div>
              <h3>{module.title}</h3>
              <p>{module.outcome}</p>
              <ul className="clean-list">
                {module.requirements.slice(0, 3).map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Link className="text-link" href={`/capabilities#${module.id}`}>
                查看完整需求 <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-tint">
        <div className="shell">
          <div className="section-heading split-heading">
            <div>
              <p className="eyebrow">正交分类</p>
              <h2>不用一个“Agent 名称”概括复杂需求</h2>
            </div>
            <p>
              每项需求分别标注生命周期、操作对象、风险、时效、协作、证据和人类责任，
              再与 F1–F6 工程模块建立映射。
            </p>
          </div>
          <div className="home-taxonomy-grid">
            {taxonomyDimensions.map((dimension) => (
              <article key={dimension.id}>
                <span>{dimension.id}</span>
                <strong>{dimension.title}</strong>
                <p>{dimension.question}</p>
              </article>
            ))}
          </div>
          <div className="center-action">
            <Link className="button button-secondary" href="/needs">
              查看分类法和 44 个需求 →
            </Link>
          </div>
        </div>
      </section>

      <section className="section shell">
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">把模块放进真实闭环</p>
            <h2>三个从 AI 研究开始的闭环</h2>
          </div>
          <Link className="button button-secondary" href="/loops">
            查看完整闭环
          </Link>
        </div>
        <div className="loop-preview">
          {loops.map((loop, index) => (
            <Link className="loop-row" href={`/loops#${loop.id}`} key={loop.id}>
              <span className="loop-number">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{loop.title}</h3>
                <p>{loop.why}</p>
              </div>
              <span className={`priority priority-${loop.priority.toLowerCase()}`}>
                {loop.priority}
              </span>
              <span className="row-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section shell final-callout">
        <div>
          <p className="eyebrow">共同补全需求地图</p>
          <h2>遇到真实科研痛点？把它提交进来。</h2>
        </div>
        <div>
          <p>
            用统一格式说明需求、必须由人参与的环节和验收标准。提交后将保存为 SciForge
            的公开 GitHub Issue，供产品和工程团队讨论。
          </p>
          <Link className="button button-primary" href="/submit">
            提交科研需求 →
          </Link>
        </div>
      </section>
    </main>
  );
}
