import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const distRoot = new URL("../dist/client/", import.meta.url);

function outputUrl(path) {
  const outputPath = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
  return new URL(outputPath, distRoot);
}

async function render(path) {
  return readFile(outputUrl(path), "utf8");
}

test("exports the market list with preview banner, search and categories", async () => {
  const html = await render("/market");
  assert.match(html, /审阅预览版/);
  assert.match(html, /插件市场/);
  assert.match(html, /文本统计/);
  assert.match(html, /科学单位换算/);
  assert.match(html, /搜索插件/);
  assert.match(html, /按分类筛选/);
  assert.match(html, /复制插件 ID/);
  assert.match(html, /数据为构建时快照/);
  assert.match(html, /market\/index\.json/);
});

test("exports a full plugin detail page for each official plugin", async () => {
  const textStats = await render("/market/text-stats");
  for (const expected of [
    /用途/,
    /适用场景/,
    /真实示例/,
    /兼容版本/,
    /权限/,
    /text_stats_count/,
    /5cf0d386a15451436e1022d87b6e6e153be560e668e3e3bf08c47fa672ac37cd/,
    /ed25519/,
    /下载暂未开放/,
    /审阅预览版/,
  ]) {
    assert.match(textStats, expected);
  }

  const unitConversion = await render("/market/unit-conversion");
  assert.match(unitConversion, /unit_conversion_convert/);
  assert.match(unitConversion, /43ec39579bafc377d00382d5be7cd55d7a44ab14c500a13bd567511589ca42ef/);
});

test("exports the install help page", async () => {
  const html = await render("/market/install");
  assert.match(html, /四步安装/);
  assert.match(html, /扩展中心/);
  assert.match(html, /批准并安装/);
  assert.match(html, /SHA-256/);
  assert.match(html, /浏览器没有验签/);
  assert.match(html, /网页能直接安装吗/);
});

test("does not publish internal diagnostics, local paths or artifact files", async () => {
  const routes = ["/market", "/market/text-stats", "/market/unit-conversion", "/market/install"];
  for (const route of routes) {
    const html = await render(route);
    assert.doesNotMatch(html, /activation failed/i, route);
    assert.doesNotMatch(html, /capability ids are already provided/i, route);
    assert.doesNotMatch(html, /runtimeGap|blocked\b/i, route);
    assert.doesNotMatch(html, /\/Users\//, route);
    assert.doesNotMatch(html, /SCIFORGE_[A-Z_]+/, route);
  }

  const entries = await readdir(distRoot, { recursive: true });
  assert.equal(
    entries.filter((entry) => entry.endsWith(".sciforge-dsh-plugin")).length,
    0,
    "no plugin artifacts may be published",
  );
});

test("keeps the existing site routes intact", async () => {
  const routes = [
    ["/", /科研 Agent 的难点/],
    ["/needs", /44 个真实需求/],
    ["/capabilities", /6 个模块/],
    ["/loops", /三个闭环/],
    ["/submit", /提交一项真实科研需求/],
  ];
  for (const [path, expected] of routes) {
    assert.match(await render(path), expected, path);
  }

  for (const path of ["/concepts", "/roadmap"]) {
    await assert.rejects(access(outputUrl(path)), { code: "ENOENT" }, path);
  }
});