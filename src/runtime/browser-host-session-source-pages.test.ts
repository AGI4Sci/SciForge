import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { persistBrowserHostSourcePage } from './browser-host-session-source-pages.js';

test('OpenAI API changelog source pages store concise update summaries', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-source-page-'));
  try {
    const sourcePage = await persistBrowserHostSourcePage({
      sessionId: 'local',
      sessionDir,
      result: {
        title: 'OpenAI API changelog',
        url: 'https://platform.openai.com/docs/changelog',
        snippet: 'Official OpenAI API changelog.',
      },
      resultIndex: 0,
      finalUrl: 'https://developers.openai.com/api/docs/changelog',
      openedAt: '2026-06-07T00:00:00.000Z',
      text: [
        'Home API Codex ChatGPT Resources Start searching API Dashboard Get started Overview Quickstart Models Pricing SDKs and CLI',
        'Changelog Upcoming deprecations can be found on the deprecations page. June, 2026',
        'Jun 4 Feature omni-moderation-latest v1/responses v1/chat/completions Added moderation scores to the Responses API and Chat Completions API.',
        'Jun 3 Update Announced the deprecation of reusable prompt objects, the Evals platform, and Agent Builder.',
      ].join(' '),
    });
    const textPath = join(sessionDir, sourcePage.textRef!.replace(/^browser-host-session:local\//, ''));
    const persistedText = await readFile(textPath, 'utf8');

    assert.match(sourcePage.textSummary ?? '', /Jun 4.*Responses API and Chat Completions API/);
    assert.doesNotMatch(sourcePage.textSummary ?? '', /Home API Codex/);
    assert.match(persistedText, /OpenAI API changelog source summary/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test('arXiv search source pages store structured paper result summaries', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-source-page-arxiv-'));
  try {
    const sourcePage = await persistBrowserHostSourcePage({
      sessionId: 'local',
      sessionDir,
      result: {
        title: 'arXiv search: agentic rl',
        url: 'https://arxiv.org/search/?query=agentic+rl&searchtype=all&abstracts=show&order=-announced_date_first&size=25',
        snippet: 'Official arXiv search results.',
      },
      resultIndex: 0,
      finalUrl: 'https://arxiv.org/search/?query=agentic+rl&searchtype=all&abstracts=show&order=-announced_date_first&size=25',
      openedAt: '2026-06-07T00:00:00.000Z',
      text: [
        'Skip to main content Donate Help Advanced Search Login Showing 1-25 of 6,080 results for all: agentic rl Search term or terms All fields Show abstracts Sort results by Announcement date newest first',
        'arXiv:2606.05784 [pdf, ps, other] cs.AI TAPO: Tool-Aware Policy Optimization via Credit Transfer for Multimodal Search Agents Authors: Chengqi Dong, Chuhuai Yue, Hang He, yandong liu, Fenghe Tang, S Kevin Zhou, Xiaohan Wang, Jiajun Chai, Guojun Yin Abstract: We identify and formally characterize credit misassignment as a systematic failure mode of GRPO in tool-augmented multimodal search agents. Submitted 4 June, 2026; originally announced June 2026.',
        'arXiv:2606.05296 [pdf, ps, other] cs.LG cs.AI Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents Authors: Dae Yon Hwang, Raunaq Suri, Valentin Villecroze, Anthony L. Caterini, Jesse C. Cresswell, Noel Vouitsis, Brendan Leigh Ross Abstract: LLM agents operate in two distinct regimes: open-weight agents where gradients are available and black-box agents where only interaction traces are observable. Submitted 3 June, 2026; originally announced June 2026. Comments: Accepted by ICML 2026',
        'Search v0.5.6 About Help Contact Subscribe',
      ].join(' '),
    });
    const textPath = join(sessionDir, sourcePage.textRef!.replace(/^browser-host-session:local\//, ''));
    const persistedText = await readFile(textPath, 'utf8');

    assert.equal(sourcePage.textArtifactKind, 'structured-summary');
    assert.match(sourcePage.textSummary ?? '', /TAPO: Tool-Aware Policy Optimization/);
    assert.match(sourcePage.textSummary ?? '', /Chengqi Dong/);
    assert.match(sourcePage.textSummary ?? '', /https:\/\/arxiv\.org\/abs\/2606\.05784/);
    assert.deepEqual(sourcePage.discoveredSourceUrls, [
      'https://arxiv.org/abs/2606.05784',
      'https://arxiv.org/abs/2606.05296',
    ]);
    assert.match(sourcePage.textSummary ?? '', /Agentic Monte Carlo/);
    assert.match(sourcePage.textSummary ?? '', /submitted: 3 June, 2026/);
    assert.doesNotMatch(sourcePage.textSummary ?? '', /Skip to main content|Donate Help|Search term/);
    assert.match(persistedText, /arXiv search result source summary/);
    assert.doesNotMatch(persistedText, /Skip to main content/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test('arXiv abstract source pages store structured single-paper summaries', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-source-page-arxiv-abs-'));
  try {
    const sourcePage = await persistBrowserHostSourcePage({
      sessionId: 'local',
      sessionDir,
      result: {
        title: 'Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents',
        url: 'https://arxiv.org/abs/2606.05296',
        snippet: 'arXiv abstract page.',
      },
      resultIndex: 0,
      finalUrl: 'https://arxiv.org/abs/2606.05296',
      openedAt: '2026-06-07T00:00:00.000Z',
      text: [
        'Title: Agentic Monte Carlo: Simulating Reinforcement Learning for Black-Box Agents',
        'Authors: Dae Yon Hwang, Raunaq Suri',
        '[Submitted on 3 Jun 2026]',
        'Abstract: Simulates reinforcement learning-style exploration for black-box LLM agents.',
        'Subjects: Artificial Intelligence (cs.AI)',
      ].join(' '),
    });

    assert.equal(sourcePage.textArtifactKind, undefined);
    assert.equal(sourcePage.discoveryOnly, undefined);
    assert.match(sourcePage.textSummary ?? '', /Agentic Monte Carlo/);
    assert.match(sourcePage.textSummary ?? '', /authors: Dae Yon Hwang, Raunaq Suri/);
    assert.match(sourcePage.textSummary ?? '', /submitted: 3 June, 2026/);
    assert.match(sourcePage.textSummary ?? '', /https:\/\/arxiv\.org\/abs\/2606\.05296/);
    assert.match(sourcePage.textSummary ?? '', /Simulates reinforcement learning-style exploration/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test('arXiv abstract source pages structure readable page text without explicit labels', async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-source-page-arxiv-readable-'));
  try {
    const sourcePage = await persistBrowserHostSourcePage({
      sessionId: 'local',
      sessionDir,
      result: {
        title: '[2509.02547] The Landscape of Agentic Reinforcement Learning ...',
        url: 'https://arxiv.org/abs/2509.02547',
        snippet: 'arXiv abstract page.',
      },
      resultIndex: 0,
      finalUrl: 'https://arxiv.org/abs/2509.02547',
      openedAt: '2026-06-07T00:00:00.000Z',
      text: [
        'Skip to main content Computer Science > Artificial Intelligence arXiv:2509.02547 (cs) [Submitted on 2 Sep 2025 (v1), last revised 17 Apr 2026 (this version, v5)]',
        'The Landscape of Agentic Reinforcement Learning for LLMs: A Survey',
        'Guibin Zhang, Hejia Geng, Xiaohang Yu, Zhenfei Yin, Zaibin Zhang',
        'View PDF HTML (experimental)',
        'The emergence of agentic reinforcement learning (Agentic RL) marks a paradigm shift from conventional reinforcement learning applied to large language models.',
        'Comments: Published on Transactions on Machine Learning Research',
        'Subjects: Artificial Intelligence (cs.AI); Computation and Language (cs.CL)',
      ].join(' '),
    });

    assert.match(sourcePage.textSummary ?? '', /The Landscape of Agentic Reinforcement Learning for LLMs: A Survey/);
    assert.match(sourcePage.textSummary ?? '', /authors: Guibin Zhang, Hejia Geng, Xiaohang Yu/);
    assert.match(sourcePage.textSummary ?? '', /submitted: 2 September, 2025/);
    assert.match(sourcePage.textSummary ?? '', /https:\/\/arxiv\.org\/abs\/2509\.02547/);
    assert.match(sourcePage.textSummary ?? '', /marks a paradigm shift from conventional reinforcement learning/);
    assert.doesNotMatch(sourcePage.textSummary ?? '', /Skip to main content|View PDF/);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
