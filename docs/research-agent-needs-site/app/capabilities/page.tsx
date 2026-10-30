import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import {
  crossCuttingInvariants,
  domainContributions,
  engineeringModules,
} from "@/lib/site-data";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "6 个工程模块",
  description: "用容易理解的方式说明科研 Agent 六个工程模块需要解决的问题和完成标准。",
};

const architectureLevels = [
  {
    number: "01",
    title: "基础不变量",
    label: "不是功能",
    description: "版本、身份、幂等、审计等必须贯穿每个模块，不能单独包装成交付物。",
  },
  {
    number: "02",
    title: "六个工程模块",
    label: "工程师直接负责",
    description: "每个模块只定义需要解决的问题、第一阶段范围和完成标准。",
  },
  {
    number: "03",
    title: "领域适配包",
    label: "按科研场景安装",
    description: "PDF、HPC、样本、仪器和临床等专业语义通过 package 贡献，不写进平台核心。",
  },
];

export default function CapabilitiesPage() {
  return (
    <main id="main-content">
      <PageIntro
        eyebrow="REQUIREMENT MODULES"
        title="6 个模块，先把需求说清楚"
        lead="这里只说明科研用户遇到什么问题、系统需要提供什么，以及怎样才算满足需求。技术方案、接口和工程拆分由工程团队决定。"
        meta="F1–F6 · 问题 → 需求 → 完成标准"
      />

      <section className="section shell">
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">先校正层级</p>
            <h2>自然约束不再占一个“功能”名额</h2>
          </div>
          <p>
            “隔离后才能安全执行”“审批要绑定版本”“动作要有回执”都应自然成立。
            我们把它们作为跨模块不变量；只有能形成明确服务边界和交付物的部分，才称为工程模块。
          </p>
        </div>

        <div className="architecture-levels">
          {architectureLevels.map((level) => (
            <article key={level.number}>
              <div className="level-number">{level.number}</div>
              <span>{level.label}</span>
              <h3>{level.title}</h3>
              <p>{level.description}</p>
            </article>
          ))}
        </div>

        <div className="implementation-boundaries">
          <div>
            <p className="eyebrow">跨模块不变量</p>
            <div className="invariant-grid">
              {crossCuttingInvariants.map((item) => (
                <article key={item.title}>
                  {item.title === "幂等与动作回执" ? (
                    <Link href="#idempotency">
                      <strong>{item.title}</strong>
                      <span>解释一下 ↓</span>
                    </Link>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow">不同科研场景会补充</p>
            <ul className="check-list">
              {domainContributions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <section className="plain-language-concept" id="idempotency">
          <header>
            <p className="eyebrow">概念解释</p>
            <h2>“幂等”是什么意思？</h2>
            <p>
              同一个操作无论请求一次还是重复请求多次，最终只产生一次效果。
              它解决的是：系统没收到成功回执时，如何安全重试而不重复做事。
            </p>
          </header>

          <div className="idempotency-example">
            <article>
              <span>01</span>
              <strong>第一次提交</strong>
              <p>Agent 提交一个 HPC 训练任务，并携带唯一幂等键。</p>
              <code>key = experiment-42-submit-v3</code>
            </article>
            <i aria-hidden="true">→</i>
            <article>
              <span>02</span>
              <strong>任务成功，但回执丢失</strong>
              <p>训练任务已经进入队列，只是网络断开，Agent 不知道是否成功。</p>
            </article>
            <i aria-hidden="true">→</i>
            <article>
              <span>03</span>
              <strong>携带同一个 key 重试</strong>
              <p>服务端返回第一次的任务 ID，不会再创建第二个训练任务。</p>
              <code>result = existing job-781</code>
            </article>
          </div>

          <div className="idempotency-compare">
            <div>
              <span>没有幂等</span>
              <strong>重试 3 次 → 可能启动 3 个训练任务</strong>
            </div>
            <div>
              <span>支持幂等</span>
              <strong>重试 3 次 → 仍然只有 1 个训练任务</strong>
            </div>
          </div>

          <p className="concept-caution">
            <strong>幂等不等于“出错就直接再点一次”。</strong>
            如果外部系统不支持幂等键，或者无法确认第一次是否生效，必须先查询和核对外部状态；
            状态仍不确定时，应交给人处理，不能盲目重复执行。
          </p>
        </section>
      </section>

      <section className="section section-tint">
        <div className="shell">
          <div className="section-heading split-heading">
            <div>
              <p className="eyebrow">六个需求模块</p>
              <h2>说清楚为什么需要、需要什么</h2>
            </div>
            <p>
              每个模块采用同一种表达方式，避免把技术名词、实现方案和用户需求混在一起。
            </p>
          </div>

          <div className="engineering-module-list">
            {engineeringModules.map((module) => (
              <article
                className={`engineering-module ${module.id === "F2" ? "module-featured" : ""}`}
                id={module.id}
                key={module.id}
              >
                <header className="module-header">
                  <span>{module.id}</span>
                  <div>
                    <h2>{module.title}</h2>
                    <p>{module.outcome}</p>
                  </div>
                </header>

                <div className="module-grid">
                  <section className="module-problem">
                    <h3>为什么需要</h3>
                    <p>{module.problem}</p>
                  </section>
                  <section>
                    <h3>第一阶段覆盖</h3>
                    <ul>
                      {module.scope.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3>系统需要做到</h3>
                    <ul>
                      {module.requirements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="module-acceptance">
                    <h3>怎样算满足需求</h3>
                    <ul>
                      {module.acceptance.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell final-callout">
        <div>
          <p className="eyebrow">这页的边界</p>
          <h2>需求由科研用户确认，实现方式由工程团队决定。</h2>
        </div>
        <div>
          <p>
            后续可以把每个模块放进真实科研闭环验证，但不在需求定义中提前规定技术栈和内部实现。
          </p>
          <Link className="text-link" href="/loops">
            查看真实科研闭环 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
