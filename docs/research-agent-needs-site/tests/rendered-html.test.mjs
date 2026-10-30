import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

function outputUrl(path) {
  const outputPath = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
  return new URL(`../dist/client/${outputPath}`, import.meta.url);
}

async function render(path) {
  return readFile(outputUrl(path), "utf8");
}

test("exports the finished research map homepage for GitHub Pages", async () => {
  const html = await render("/");
  assert.match(html, /<title>科研 Agent 需求地图<\/title>/i);
  assert.match(html, /科研 Agent 的难点/);
  assert.match(html, /44/);
  assert.match(html, /6/);
  assert.match(html, /3/);
  assert.match(html, /href="\/SciForge\/submit"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|SkeletonPreview/i);
});

test("exports every remaining top-level knowledge route", async () => {
  const routes = [
    ["/needs", /44 个真实需求/],
    ["/needs", /用九个维度描述一项科研需求/],
    ["/capabilities", /6 个模块/],
    ["/capabilities", /“幂等”是什么意思/],
    ["/loops", /三个闭环/],
    ["/submit", /提交一项真实科研需求/],
  ];

  for (const [path, expected] of routes) {
    assert.match(await render(path), expected, path);
  }
});

test("removed concept and roadmap routes are absent from the export", async () => {
  for (const path of ["/concepts", "/concepts/evidence", "/roadmap"]) {
    await assert.rejects(access(outputUrl(path)), { code: "ENOENT" }, path);
  }
});
