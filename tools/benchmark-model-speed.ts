import { performance } from 'node:perf_hooks';

type BenchmarkResult = {
  caseName: string;
  model: string;
  ok: boolean;
  firstTokenMs?: number;
  totalMs?: number;
  outputChars?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
  chunks?: number;
  usageCompletionTokens?: number;
  error?: string;
};

const DEFAULT_MODELS = [
  'sciforge-router',
];

const DEFAULT_PROMPT = [
  '请用中文简洁总结单细胞 RNA-seq 差异分析的标准流程。',
  '要求输出 5 个编号步骤，每个步骤一句话。',
  '不要输出表格，不要解释你正在做什么。',
].join('\n');

const BENCHMARK_CASES = [
  {
    name: 'single-cell-workflow',
    prompt: [
      '请用中文为一个单细胞 RNA-seq 分析任务制定可执行方案。',
      '输入是假设的 PBMC h5ad 文件，目标是比较 treated vs control，并按 cell_type 分层。',
      '请输出：1) QC 与过滤步骤；2) 标准化、降维、聚类；3) 差异表达；4) marker gene；5) 结果 artifact 与可视化建议。',
      '要求具体、结构化，但不要输出代码。',
    ].join('\n'),
  },
  {
    name: 'literature-evidence',
    prompt: [
      '请用中文设计一个文献证据评估流程，用于判断 TP53 与肺癌预后之间的证据强度。',
      '请说明检索策略、纳入排除标准、证据等级、偏倚风险、最终输出 artifact。',
      '要求结构化输出，避免泛泛而谈。',
    ].join('\n'),
  },
  {
    name: 'biomedical-kg',
    prompt: [
      '请用中文设计一个生物医学知识图谱查询任务：围绕 EGFR、奥希替尼和耐药突变建立节点和边。',
      '请说明数据源、实体类型、关系类型、证据字段、可视化方式和失败时应如何报告。',
    ].join('\n'),
  },
  {
    name: 'structure-analysis',
    prompt: [
      '请用中文设计一个蛋白结构分析任务：给定 PDB 7BZ5 和残基范围 142-158，生成结构摘要、关键残基表和可视化建议。',
      '请说明需要下载哪些数据、如何记录坐标文件、输出 artifact schema、以及哪些任务不应伪造成成功。',
    ].join('\n'),
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrlSource = routerBaseUrlSource(args, process.env);
  const apiKeySource = routerApiKeySource(args, process.env);
  const profileSource = routerProfileSource(args, process.env);
  const baseUrl = cleanRouterBaseUrl(baseUrlSource.value);
  const apiKey = apiKeySource.value;
  const profile = profileSource.value || 'sciforge-runtime-default';
  const models = String(
    stringArg(args.models)
      || stringArg(args.model)
      || process.env.SCIFORGE_MODEL_ROUTER_MODELS
      || process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
      || process.env.SCIFORGE_RUNTIME_MODEL
      || DEFAULT_MODELS.join(','),
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const cases = buildCases(args);
  const rounds = positiveInt(args.rounds, 1);
  const maxTokens = positiveInt(args.maxTokens, 256);
  const temperature = numberArg(args.temperature, 1);

  if (!baseUrl) {
    throw new Error('Missing Model Router base URL. Set SCIFORGE_MODEL_ROUTER_BASE_URL, SCIFORGE_MODEL_ROUTER_URL, SCIFORGE_MODEL_ROUTER_PORT, or --base-url.');
  }
  if (!apiKey) {
    throw new Error('Missing Model Router API key. Set SCIFORGE_RUNTIME_API_KEY, SCIFORGE_MODEL_ROUTER_API_KEY, or --api-key.');
  }
  if (!models.length) throw new Error('No Model Router aliases configured.');

  console.log(`Benchmark endpoint: ${responsesUrl(baseUrl)}`);
  console.log(`Config sources: baseUrl=${baseUrlSource.source}, apiKey=${apiKeySource.source}, profile=${profileSource.source}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Profile: ${profile}`);
  console.log(`Cases: ${cases.map((item) => item.name).join(', ')}`);
  console.log(`Rounds: ${rounds}, max_tokens: ${maxTokens}, temperature: ${temperature}`);
  console.log('');

  const allResults: BenchmarkResult[] = [];
  for (const benchCase of cases) {
    console.log(`Case: ${benchCase.name}`);
    for (const model of models) {
      const modelResults: BenchmarkResult[] = [];
      for (let round = 1; round <= rounds; round += 1) {
        process.stdout.write(`[${benchCase.name}][${model}] round ${round}/${rounds} ... `);
        const result = await benchmarkModel({
          caseName: benchCase.name,
          baseUrl,
          apiKey,
          model,
          profile,
          prompt: benchCase.prompt,
          maxTokens,
          temperature,
        });
        modelResults.push(result);
        allResults.push(result);
        if (result.ok) {
          console.log(`${formatNumber(result.tokensPerSecond)} tok/s, first ${formatNumber(result.firstTokenMs)} ms`);
        } else {
          console.log(`failed: ${result.error}`);
        }
      }
      const summary = summarize(benchCase.name, model, modelResults);
      printSummary(summary);
    }
    console.log('');
  }

  printTable(allResults);
  printAggregateTable(allResults);
}

async function benchmarkModel(input: {
  caseName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  profile: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
}): Promise<BenchmarkResult> {
  const startedAt = performance.now();
  let firstTokenAt: number | undefined;
  let output = '';
  let chunks = 0;
  let usageCompletionTokens: number | undefined;

  try {
    const response = await fetch(responsesUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        instructions: 'You are a concise scientific assistant.',
        input: input.prompt,
        metadata: { profile: input.profile },
        temperature: input.temperature,
        max_tokens: input.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      return {
        caseName: input.caseName,
        model: input.model,
        ok: false,
        error: `HTTP ${response.status}${detail ? ` ${truncate(detail, 500)}` : ''}`,
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseSseLine(line);
        if (!parsed || parsed === '[DONE]') continue;
        const delta = extractDelta(parsed);
        if (delta) {
          if (firstTokenAt === undefined) firstTokenAt = performance.now();
          chunks += 1;
          output += delta;
        }
        const usage = extractUsage(parsed);
        if (usage !== undefined) usageCompletionTokens = usage;
      }
    }

    const totalMs = performance.now() - startedAt;
    if (!output.trim()) {
      return {
        model: input.model,
        caseName: input.caseName,
        ok: false,
        totalMs: performance.now() - startedAt,
        usageCompletionTokens,
        error: 'stream completed without visible output',
      };
    }

    const outputTokens = estimateTokens(output);
    const generationMs = firstTokenAt === undefined ? totalMs : Math.max(1, performance.now() - firstTokenAt);
    return {
      model: input.model,
      caseName: input.caseName,
      ok: true,
      firstTokenMs: firstTokenAt === undefined ? undefined : firstTokenAt - startedAt,
      totalMs,
      outputChars: output.length,
      outputTokens,
      usageCompletionTokens,
      tokensPerSecond: outputTokens / (generationMs / 1000),
      chunks,
    };
  } catch (error) {
    return {
      model: input.model,
      caseName: input.caseName,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseSseLine(line: string): unknown | '[DONE]' | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return undefined;
  if (!trimmed.startsWith('data:')) return undefined;
  const data = trimmed.slice('data:'.length).trim();
  if (data === '[DONE]') return '[DONE]';
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function extractDelta(value: unknown) {
  if (!isRecord(value)) return '';
  if (value.type === 'response.output_text.delta') return stringValue(value.delta);
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0];
  if (!isRecord(first)) return '';
  if (isRecord(first.delta)) {
    return [
      stringValue(first.delta.content),
      stringValue(first.delta.reasoning_content),
      stringValue(first.delta.reasoning),
      stringValue(first.delta.text),
    ].join('');
  }
  return stringValue(first.text);
}

function extractUsage(value: unknown) {
  if (!isRecord(value)) return undefined;
  const usage = isRecord(value.usage)
    ? value.usage
    : isRecord(value.response) && isRecord(value.response.usage)
      ? value.response.usage
      : undefined;
  if (!usage) return undefined;
  if (typeof usage.output_tokens === 'number') return usage.output_tokens;
  return typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const [key, inlineValue] = item.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      args[toCamelCase(key)] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      args[toCamelCase(key)] = argv[index + 1];
      index += 1;
    } else {
      args[toCamelCase(key)] = true;
    }
  }
  return args;
}

function buildCases(args: Record<string, string | boolean>) {
  if (args.suite === true || args.suite === 'sciforge') return BENCHMARK_CASES;
  const prompt = String(args.prompt || process.env.SCIFORGE_MODEL_ROUTER_BENCH_PROMPT || DEFAULT_PROMPT);
  return [{ name: String(args.case || 'default'), prompt }];
}

function summarize(caseName: string, model: string, results: BenchmarkResult[]): BenchmarkResult {
  const ok = results.filter((item) => item.ok);
  if (!ok.length) return { caseName, model, ok: false, error: 'all rounds failed' };
  return {
    caseName,
    model,
    ok: true,
    firstTokenMs: average(ok.map((item) => item.firstTokenMs).filter(isNumber)),
    totalMs: average(ok.map((item) => item.totalMs).filter(isNumber)),
    outputChars: roundOptional(average(ok.map((item) => item.outputChars).filter(isNumber))),
    outputTokens: roundOptional(average(ok.map((item) => item.outputTokens).filter(isNumber))),
    tokensPerSecond: average(ok.map((item) => item.tokensPerSecond).filter(isNumber)),
    chunks: roundOptional(average(ok.map((item) => item.chunks).filter(isNumber))),
    usageCompletionTokens: roundOptional(average(ok.map((item) => item.usageCompletionTokens).filter(isNumber))),
  };
}

function printSummary(result: BenchmarkResult) {
  if (!result.ok) {
    console.log(`summary ${result.model}: failed (${result.error})`);
    return;
  }
  console.log([
    `summary ${result.caseName}/${result.model}:`,
    `${formatNumber(result.tokensPerSecond)} tok/s`,
    `first ${formatNumber(result.firstTokenMs)} ms`,
    `total ${formatNumber(result.totalMs)} ms`,
    `tokens ${result.outputTokens}`,
  ].join(' '));
}

function printTable(results: BenchmarkResult[]) {
  const caseNames = [...new Set(results.map((result) => result.caseName))];
  const models = [...new Set(results.map((result) => result.model))];
  const rows = caseNames.flatMap((caseName) => models.map((model) => (
    summarize(caseName, model, results.filter((result) => result.caseName === caseName && result.model === model))
  )));

  console.log('case,model,ok,tokens_per_second,first_token_ms,total_ms,output_tokens,usage_completion_tokens,output_chars,chunks,error');
  for (const row of rows) {
    console.log([
      csv(row.caseName),
      csv(row.model),
      row.ok ? 'true' : 'false',
      formatNumber(row.tokensPerSecond),
      formatNumber(row.firstTokenMs),
      formatNumber(row.totalMs),
      row.outputTokens ?? '',
      row.usageCompletionTokens ?? '',
      row.outputChars ?? '',
      row.chunks ?? '',
      csv(row.error || ''),
    ].join(','));
  }
}

function printAggregateTable(results: BenchmarkResult[]) {
  const models = [...new Set(results.map((result) => result.model))];
  const rows = models.map((model) => summarize('all-cases', model, results.filter((result) => result.model === model)));
  console.log('aggregate_model,ok,tokens_per_second,first_token_ms,total_ms,output_tokens,usage_completion_tokens,output_chars,chunks,error');
  for (const row of rows) {
    console.log([
      csv(row.model),
      row.ok ? 'true' : 'false',
      formatNumber(row.tokensPerSecond),
      formatNumber(row.firstTokenMs),
      formatNumber(row.totalMs),
      row.outputTokens ?? '',
      row.usageCompletionTokens ?? '',
      row.outputChars ?? '',
      row.chunks ?? '',
      csv(row.error || ''),
    ].join(','));
  }
}

function estimateTokens(text: string) {
  const cjkChars = [...text].filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  const nonCjk = text.replace(/[\u3400-\u9fff]/gu, '');
  const latinTokens = nonCjk.trim() ? nonCjk.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.round(cjkChars * 0.65 + latinTokens * 1.3));
}

function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function cleanRouterBaseUrl(value: string) {
  const cleaned = cleanBaseUrl(value);
  if (!cleaned) return '';
  if (/\/chat\/completions$/i.test(cleaned)) {
    throw new Error('Model Router base URL must point to /v1 or /v1/responses, not a member-model /chat/completions endpoint.');
  }
  if (/\/v1\/responses$/i.test(cleaned)) return cleaned.replace(/\/responses$/i, '');
  if (/\/v1$/i.test(cleaned)) return cleaned;
  return `${cleaned}/v1`;
}

function responsesUrl(baseUrl: string) {
  const cleaned = cleanBaseUrl(baseUrl);
  return /\/responses$/i.test(cleaned) ? cleaned : `${cleaned}/responses`;
}

function routerBaseUrlSource(args: Record<string, string | boolean>, env: NodeJS.ProcessEnv) {
  const cliValue = stringArg(args.baseUrl) || stringArg(args.routerUrl);
  if (cliValue) return { value: cliValue, source: 'cli' };
  if (env.SCIFORGE_MODEL_ROUTER_BASE_URL?.trim()) {
    return { value: env.SCIFORGE_MODEL_ROUTER_BASE_URL.trim(), source: 'env:SCIFORGE_MODEL_ROUTER_BASE_URL' };
  }
  if (env.SCIFORGE_MODEL_ROUTER_URL?.trim()) {
    return { value: env.SCIFORGE_MODEL_ROUTER_URL.trim(), source: 'env:SCIFORGE_MODEL_ROUTER_URL' };
  }
  const fromPort = loopbackRouterBaseUrl(env.SCIFORGE_MODEL_ROUTER_PORT, env.SCIFORGE_MODEL_ROUTER_HOST);
  if (fromPort) return { value: fromPort, source: 'env:SCIFORGE_MODEL_ROUTER_PORT' };
  return { value: '', source: 'missing' };
}

function routerApiKeySource(args: Record<string, string | boolean>, env: NodeJS.ProcessEnv) {
  const cliValue = stringArg(args.apiKey);
  if (cliValue) return { value: cliValue, source: 'cli' };
  if (env.SCIFORGE_RUNTIME_API_KEY?.trim()) {
    return { value: env.SCIFORGE_RUNTIME_API_KEY.trim(), source: 'env:SCIFORGE_RUNTIME_API_KEY' };
  }
  if (env.SCIFORGE_MODEL_ROUTER_API_KEY?.trim()) {
    return { value: env.SCIFORGE_MODEL_ROUTER_API_KEY.trim(), source: 'env:SCIFORGE_MODEL_ROUTER_API_KEY' };
  }
  return { value: '', source: 'missing' };
}

function routerProfileSource(args: Record<string, string | boolean>, env: NodeJS.ProcessEnv) {
  const cliValue = stringArg(args.profile);
  if (cliValue) return { value: cliValue, source: 'cli' };
  if (env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE?.trim()) {
    return { value: env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE.trim(), source: 'env:SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE' };
  }
  if (env.SCIFORGE_MODEL_ROUTER_PROFILE?.trim()) {
    return { value: env.SCIFORGE_MODEL_ROUTER_PROFILE.trim(), source: 'env:SCIFORGE_MODEL_ROUTER_PROFILE' };
  }
  return { value: 'sciforge-runtime-default', source: 'default' };
}

function loopbackRouterBaseUrl(portValue: string | undefined, hostValue: string | undefined) {
  const port = Number(portValue);
  if (!Number.isFinite(port) || port <= 0) return '';
  const host = hostValue?.trim() || '127.0.0.1';
  return `http://${host}:${Math.trunc(port)}/v1`;
}

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function numberArg(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values: number[]) {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOptional(value: number | undefined) {
  return value === undefined ? undefined : Math.round(value);
}

function formatNumber(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? '' : value.toFixed(2);
}

function csv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function stringArg(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
