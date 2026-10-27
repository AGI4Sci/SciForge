"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  categoryLabels,
  formatBytes,
  plugins,
  type MarketPlugin,
} from "@/lib/market-data";

function CopyPluginId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand("copy");
        document.body.removeChild(area);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="market-action market-action-quiet" onClick={copy}>
      {copied ? "已复制" : "复制插件 ID"}
    </button>
  );
}

function matches(plugin: MarketPlugin, query: string) {
  if (query.length === 0) return true;
  const haystack = [
    plugin.name,
    plugin.title,
    plugin.summary,
    plugin.publisher,
    ...plugin.categories.map((category) => categoryLabels[category] ?? category),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function MarketCatalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set(plugins.flatMap((plugin) => plugin.categories))),
    [],
  );

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return plugins.filter(
      (plugin) =>
        matches(plugin, normalized) &&
        (category === "all" || plugin.categories.includes(category)),
    );
  }, [query, category]);

  return (
    <div className="market-catalog">
      <div className="market-toolbar">
        <label className="market-search">
          <span className="market-search-label">搜索</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、用途或标签，例如“单位”"
            aria-label="搜索插件"
          />
        </label>
        <div className="market-chips" role="group" aria-label="按分类筛选">
          <button
            type="button"
            className={`market-chip${category === "all" ? " is-active" : ""}`}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`market-chip${category === item ? " is-active" : ""}`}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >
              {categoryLabels[item] ?? item}
            </button>
          ))}
        </div>
      </div>

      <p className="market-result-line" aria-live="polite">
        共 {visible.length} 个插件 · 数据为构建时快照，桌面端安装为准
      </p>

      {visible.length === 0 ? (
        <p className="market-empty">没有匹配的插件。换个关键词或选择“全部”。</p>
      ) : (
        <ul className="market-grid">
          {visible.map((plugin) => (
            <li className="market-card" key={plugin.slug}>
              <div className="market-card-head">
                <h2>
                  <Link href={`/market/${plugin.slug}`}>{plugin.title}</Link>
                </h2>
                <span className="market-version">v{plugin.version}</span>
              </div>
              <p className="market-summary">{plugin.summary}</p>
              <p className="market-publisher">发布者：{plugin.publisher}</p>
              <ul className="market-tags" aria-label="标签">
                {plugin.categories.map((item) => (
                  <li key={item}>{categoryLabels[item] ?? item}</li>
                ))}
              </ul>
              <p className="market-size">包大小 {formatBytes(plugin.sizeBytes)}</p>
              <div className="market-card-actions">
                <Link className="market-action market-action-primary" href={`/market/${plugin.slug}`}>
                  查看详情
                </Link>
                <Link className="market-action market-action-quiet" href="/market/install">
                  安装指引
                </Link>
                <CopyPluginId value={plugin.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}