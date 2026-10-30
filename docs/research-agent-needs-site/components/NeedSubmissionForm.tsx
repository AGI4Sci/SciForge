"use client";

import { FormEvent, useMemo, useState } from "react";

const ISSUE_URL = "https://github.com/AGI4Sci/SciForge/issues/new";

type NeedDraft = {
  title: string;
  context: string;
  action: string;
  outcome: string;
  pain: string;
  mustConfirm: string;
  humanJudgment: string;
  done: string;
  hardRequirements: string;
};

const initialDraft: NeedDraft = {
  title: "",
  context: "",
  action: "",
  outcome: "",
  pain: "",
  mustConfirm: "",
  humanJudgment: "",
  done: "",
  hardRequirements: "",
};

function buildBody(draft: NeedDraft) {
  return `## 1. 需求
- 一句话需求：当 ${draft.context} 时，希望 Agent 帮我 ${draft.action}，得到 ${draft.outcome}。
- 当前痛点：${draft.pain}。

## 2. 人类参与
Agent 自动完成所有处理，仅以下环节需要人：
- 必须由人确认：${draft.mustConfirm}。
- 需要人判断：${draft.humanJudgment}。

## 3. 验收标准
- 怎样算完成：${draft.done}。
- 硬性要求：${draft.hardRequirements}。（不能做什么、时间限制等）`;
}

export function NeedSubmissionForm() {
  const [draft, setDraft] = useState(initialDraft);
  const [copied, setCopied] = useState(false);
  const body = useMemo(() => buildBody(draft), [draft]);

  function update(field: keyof NeedDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setCopied(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams({
      title: `[科研需求] ${draft.title}`,
      body,
      labels: "research-need",
    });
    window.open(`${ISSUE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function copyBody() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
  }

  return (
    <form className="need-submit-form" onSubmit={submit}>
      <section className="submit-section">
        <header>
          <span>01</span>
          <div>
            <h2>需求</h2>
            <p>先说清楚发生了什么、希望 Agent 做什么，以及最终要得到什么。</p>
          </div>
        </header>

        <label className="field field-wide">
          <span>需求标题</span>
          <input
            required
            maxLength={100}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder="例如：自动复现论文中的 Baseline"
          />
        </label>

        <fieldset className="sentence-builder">
          <legend>一句话需求</legend>
          <label>
            <span>当</span>
            <textarea
              required
              maxLength={500}
              rows={3}
              value={draft.context}
              onChange={(event) => update("context", event.target.value)}
              placeholder="例如：我拿到一篇只有论文和仓库链接的 AI 论文"
            />
          </label>
          <label>
            <span>希望 Agent 帮我</span>
            <textarea
              required
              maxLength={500}
              rows={3}
              value={draft.action}
              onChange={(event) => update("action", event.target.value)}
              placeholder="例如：准备环境、运行代码并定位复现差异"
            />
          </label>
          <label>
            <span>得到</span>
            <textarea
              required
              maxLength={500}
              rows={3}
              value={draft.outcome}
              onChange={(event) => update("outcome", event.target.value)}
              placeholder="例如：可检查的指标、日志和差异说明"
            />
          </label>
        </fieldset>

        <label className="field field-wide">
          <span>当前痛点</span>
          <textarea
            required
            maxLength={1500}
            rows={5}
            value={draft.pain}
            onChange={(event) => update("pain", event.target.value)}
            placeholder="现在需要怎样处理？最耗时、最容易出错或最难交接的地方是什么？"
          />
        </label>
      </section>

      <section className="submit-section">
        <header>
          <span>02</span>
          <div>
            <h2>人类参与</h2>
            <p>Agent 自动完成所有处理，仅以下环节需要人。</p>
          </div>
        </header>
        <div className="submit-two-column">
          <label className="field">
            <span>必须由人确认</span>
            <textarea
              required
              maxLength={1000}
              rows={5}
              value={draft.mustConfirm}
              onChange={(event) => update("mustConfirm", event.target.value)}
              placeholder="例如：正式使用复现结果前，由研究者确认实验口径"
            />
          </label>
          <label className="field">
            <span>需要人判断</span>
            <textarea
              required
              maxLength={1000}
              rows={5}
              value={draft.humanJudgment}
              onChange={(event) => update("humanJudgment", event.target.value)}
              placeholder="例如：结果偏差是否影响论文结论"
            />
          </label>
        </div>
      </section>

      <section className="submit-section">
        <header>
          <span>03</span>
          <div>
            <h2>验收标准</h2>
            <p>用可检查的结果定义完成，并写清不能突破的边界。</p>
          </div>
        </header>
        <div className="submit-two-column">
          <label className="field">
            <span>怎样算完成</span>
            <textarea
              required
              maxLength={1500}
              rows={5}
              value={draft.done}
              onChange={(event) => update("done", event.target.value)}
              placeholder="例如：在指定环境运行成功，指标差异有明确解释，过程可重复"
            />
          </label>
          <label className="field">
            <span>硬性要求</span>
            <textarea
              required
              maxLength={1500}
              rows={5}
              value={draft.hardRequirements}
              onChange={(event) => update("hardRequirements", event.target.value)}
              placeholder="例如：不能修改原始数据；最多使用 8 张 GPU；24 小时内完成"
            />
          </label>
        </div>
      </section>

      <section className="submission-boundary">
        <div>
          <span className="detail-label">数据怎样保存</span>
          <h2>提交后保存为公开 GitHub Issue</h2>
          <ol>
            <li>点击下方按钮，打开一条已经填好内容的 GitHub Issue。</li>
            <li>登录 GitHub，检查内容并点击“Submit new issue”。</li>
            <li>提交成功后，需求会长期保存在 SciForge 仓库中，可继续讨论和跟踪。</li>
          </ol>
          <p>
            当前页面不会自动上传或保存你输入的内容。未在 GitHub 完成最终提交前，刷新或关闭页面会丢失输入。
          </p>
        </div>
        <aside>
          <strong>请勿提交敏感信息</strong>
          <p>GitHub Issue 对所有人公开。请勿填写未公开研究数据、个人信息、患者数据、账号密钥或保密材料。</p>
        </aside>
      </section>

      <div className="submit-actions">
        <button className="button button-secondary" type="button" onClick={copyBody}>
          {copied ? "已复制" : "复制需求文本"}
        </button>
        <button className="button button-primary" type="submit">
          去 GitHub 确认并提交 →
        </button>
      </div>
    </form>
  );
}
