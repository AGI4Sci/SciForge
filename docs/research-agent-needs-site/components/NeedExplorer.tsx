"use client";

import { useMemo, useState } from "react";
import {
  flattenNeedClassification,
  getNeedClassification,
  getTaxonomyLabel,
  needGroups,
  needs,
  taxonomyDimensions,
} from "@/lib/needs-data";
import { engineeringModules, mapNeedFeatures } from "@/lib/site-data";

export function NeedExplorer() {
  const [group, setGroup] = useState("all");
  const [capability, setCapability] = useState("all");
  const [taxonomy, setTaxonomy] = useState("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return needs.filter((need) => {
      const features = mapNeedFeatures(need.capabilities);
      const classification = flattenNeedClassification(need.id);
      const groupMatch = group === "all" || need.group === group;
      const capabilityMatch =
        capability === "all" || features.includes(capability);
      const taxonomyMatch = taxonomy === "all" || classification.includes(taxonomy);
      const queryMatch =
        normalized.length === 0 ||
        [
          need.id,
          need.title,
          need.pain,
          need.loop,
          need.human,
          need.acceptance,
          need.gap,
          ...features,
          ...classification,
          ...classification.map(getTaxonomyLabel),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return groupMatch && capabilityMatch && taxonomyMatch && queryMatch;
    });
  }, [capability, group, query, taxonomy]);

  return (
    <div className="need-explorer">
      <div className="filter-panel">
        <div className="filter-search">
          <label htmlFor="need-search">搜索需求、痛点或工程模块</label>
          <input
            id="need-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：盲审、仪器、F2…"
            type="search"
            value={query}
          />
        </div>
        <div className="filter-select">
          <label htmlFor="capability-filter">按工程模块筛选</label>
          <select
            id="capability-filter"
            onChange={(event) => setCapability(event.target.value)}
            value={capability}
          >
            <option value="all">全部 6 个工程模块</option>
            {engineeringModules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.title}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-select">
          <label htmlFor="taxonomy-filter">按正交分类筛选</label>
          <select
            id="taxonomy-filter"
            onChange={(event) => setTaxonomy(event.target.value)}
            value={taxonomy}
          >
            <option value="all">全部分类</option>
            {taxonomyDimensions.map((dimension) => (
              <optgroup
                key={dimension.id}
                label={`${dimension.id} · ${dimension.title}`}
              >
                {dimension.values.map(([code, label]) => (
                  <option key={code} value={code}>
                    {code} · {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="filter-tabs" role="group" aria-label="按需求领域筛选">
        <button
          className={group === "all" ? "active" : ""}
          onClick={() => setGroup("all")}
          type="button"
        >
          全部
          <span>44</span>
        </button>
        {needGroups.map((item) => (
          <button
            className={group === item.id ? "active" : ""}
            key={item.id}
            onClick={() => setGroup(item.id)}
            type="button"
          >
            {item.title}
            <span>{item.range}</span>
          </button>
        ))}
      </div>

      <div className="result-summary">
        <strong>{visible.length}</strong>
        <span>个需求符合当前条件</span>
      </div>

      <div className="need-list">
        {visible.map((need) => {
          const groupMeta = needGroups.find((item) => item.id === need.group);
          const features = mapNeedFeatures(need.capabilities);
          const classification = getNeedClassification(need.id);
          const classificationCodes = flattenNeedClassification(need.id);
          return (
            <details className="need-card" key={need.id}>
              <summary>
                <div className={`need-id need-id-${groupMeta?.color ?? "slate"}`}>
                  {need.id}
                </div>
                <div className="need-summary-copy">
                  <div className="need-group">{groupMeta?.title}</div>
                  <h2>{need.title}</h2>
                  <p>{need.pain}</p>
                  <div className="need-taxonomy-preview" aria-label="需求正交分类">
                    {classificationCodes.map((code) => (
                      <span key={code} title={getTaxonomyLabel(code)}>
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="need-caps">
                  {features.slice(0, 4).map((cap) => (
                    <span key={cap}>{cap}</span>
                  ))}
                  {features.length > 4 ? (
                    <span>+{features.length - 4}</span>
                  ) : null}
                </div>
                <span className="details-toggle" aria-hidden="true">
                  +
                </span>
              </summary>
              <div className="need-detail">
                <div className="need-detail-main">
                  <div>
                    <span className="detail-label">Agent 闭环</span>
                    <p>{need.loop}</p>
                  </div>
                  <div>
                    <span className="detail-label">必须由人完成</span>
                    <p>{need.human}</p>
                  </div>
                  <div>
                    <span className="detail-label">验收证据</span>
                    <p>{need.acceptance}</p>
                  </div>
                </div>
                <aside>
                  <span className="detail-label">为什么普通 Codex 不够</span>
                  <p>{need.gap}</p>
                  <div className="all-caps">
                    {features.map((cap) => (
                      <span key={cap}>{cap}</span>
                    ))}
                  </div>
                </aside>
              </div>
              <div className="need-classification-panel">
                <span className="detail-label">九维正交分类</span>
                <div>
                  {taxonomyDimensions.map((dimension) => (
                    <section key={dimension.id}>
                      <strong>
                        {dimension.id} · {dimension.title}
                      </strong>
                      <p>
                        {classification[dimension.id].map((code) => (
                          <span key={code}>
                            <b>{code}</b>
                            {getTaxonomyLabel(code)}
                          </span>
                        ))}
                      </p>
                    </section>
                  ))}
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <strong>没有匹配项</strong>
          <p>尝试清空关键词，或切换领域和工程模块筛选。</p>
        </div>
      ) : null}
    </div>
  );
}
