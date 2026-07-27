import { taxonomyDimensions } from "@/lib/needs-data";

export function TaxonomyOverview() {
  return (
    <section className="taxonomy-overview" aria-labelledby="taxonomy-title">
      <div className="section-heading split-heading">
        <div>
          <p className="eyebrow">正交分类法</p>
          <h2 id="taxonomy-title">用九个维度描述一项科研需求</h2>
        </div>
        <p>
          不用“论文 Agent”“实验 Agent”给需求贴单一名称，而是分别说明它处于什么阶段、
          操作什么对象、风险多高、怎样协作以及需要什么证据。
        </p>
      </div>

      <div className="taxonomy-formula" aria-label="科研需求正交分类公式">
        <strong>Need</strong>
        <span>=</span>
        {taxonomyDimensions.map((dimension, index) => (
          <span className="taxonomy-factor" key={dimension.id}>
            <b>{dimension.id}</b>
            {dimension.title}
            {index < taxonomyDimensions.length - 1 ? <i>×</i> : null}
          </span>
        ))}
      </div>

      <div className="taxonomy-grid">
        {taxonomyDimensions.map((dimension) => (
          <details key={dimension.id}>
            <summary>
              <span>{dimension.id}</span>
              <div>
                <strong>{dimension.title}</strong>
                <small>{dimension.question}</small>
              </div>
              <i aria-hidden="true">+</i>
            </summary>
            <div className="taxonomy-values">
              {dimension.values.map(([code, label]) => (
                <span key={code}>
                  <b>{code}</b>
                  {label}
                </span>
              ))}
            </div>
          </details>
        ))}
      </div>

      <p className="taxonomy-example">
        <strong>例：数据清洗质检</strong>
        <span>L4 采集/质控</span>
        <span>C1 代码/计算</span>
        <span>R3 改变数据</span>
        <span>K1 共同收敛</span>
        <span>E3 可复现</span>
        <span>H3 写入前批准</span>
      </p>
    </section>
  );
}
