# Desktop Native 改动验证契约

最后更新：2026-06-06

## 范围

本文只定义 Desktop native 改动需要怎样验证，不定义产品职责。产品职责以 [`../PROJECT.md`](../PROJECT.md) 和 [`Architecture.md`](Architecture.md) 为准。

## 当前规则

- Desktop native evidence 可以支撑 Browser / Computer Use 用户级验收，但不能替代 Codex backend completion truth。
- Web 截图、Vite 截图、iframe / proxy render、snapshot replay、frame stream、外部浏览器、raw screenshot 和 base64 payload 都只能作为诊断材料。
- evidence 必须 refs-first、有边界。
- 高风险动作必须进入 approval。

## 必需证据

| 改动类型 | 必需证据 |
| --- | --- |
| Browser native surface | BrowserHostSession-backed native surface、session refs、page / source evidence refs，且没有第二真相源。 |
| Annotation / capture | refs-only annotation、screenshot / crop / window metadata，不包含 raw image payload。 |
| Window Action | target refs、before evidence、grounding refs、executor event、after evidence、stale invalidation、stop / cancel path。 |
| Artifact output | final artifact refs 和 validator refs。 |

## 验收边界

Desktop native verification 是 native path 改动的必要证据，但不是用户级验收的充分条件。用户级验收仍需要普通聊天入口、Codex backend completion truth 和 final answer。
