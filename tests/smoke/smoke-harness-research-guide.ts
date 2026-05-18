import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const architecture = await readFile('docs/Architecture.md', 'utf8');
const protocol = await readFile('docs/TuiGuiProtocol.md', 'utf8');
const codexMigration = await readFile('docs/CodexRuntimeMigration.md', 'utf8');

for (const required of [
  'Native Extension Model',
  'SciForge 不再定义 `registerCommand`',
  'Capability Discovery',
  'Harness / Policy 属于 TUI 原生扩展',
  'React/UI 只做 presentation behavior',
  'TUI 感知 GUI：只读虚拟资源树',
  'GUI 智能边界',
  '不需要独立 AgentServer',
  'deepseek-v4-flash',
]) {
  assert.ok(architecture.includes(required), `Architecture should include consolidated section: ${required}`);
}

for (const boundary of [
  'GUI 给 TUI 的输入全部是文本',
  '不要求独立 AgentServer',
  'Codex custom provider / proxy',
  'GUI 内部语义事件总线',
  'Progressive GUI Context',
  'Read-Only GUI Resource Tree',
  'gui.list',
  'gui.search',
  'gui.present',
  'gui.ask_user',
  'gui.apply_batch',
  'Tool Results and Negotiation',
  'GUI Presentation Autonomy',
  'GUI 不用 LLM 猜应该调用什么 GUI 函数',
]) {
  assert.ok(protocol.includes(boundary), `TuiGuiProtocol should preserve boundary: ${boundary}`);
}

for (const migrationBoundary of [
  'Phase 1：`codex exec --json`',
  'Phase 2：`AgentCliAdapter`',
  'Dev Codex',
  'Runtime Codex',
  'sciforge-runtime-deepseek',
  'Browser E2E Gate',
]) {
  assert.ok(codexMigration.includes(migrationBoundary), `CodexRuntimeMigration should preserve boundary: ${migrationBoundary}`);
}

console.log([
  '[ok] consolidated GUI/TUI docs smoke passed',
  '- architecture=single-concept-entry',
  '- protocol=intent-tools-with-hot-region',
  '- inputBoundary=text-only',
].join('\n'));
