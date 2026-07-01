import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const e2eRoot = join(repoRoot, 'temp', 'long-horizon-e2e')
const compiledRoot = join(e2eRoot, '.compiled')
const requiredPlanModePromptFragments = [
  '# Plan Mode Prompt',
  '## Acceptance Criteria',
  '## Plan Mode Policy',
  'Do not implement',
  'until the user approves the plan',
  'request_user_input',
  'create_plan',
  '## Iterative Planning Workflow',
  '## Asking Good Questions',
  '## Clarifying Question Triage',
  '## Plan Structure'
]

const tasks = [
  {
    id: 'task-01-deepseek-r1-paper-plan',
    prompt: '整理 DeepSeek-R1 论文的核心发现，并生成一份可复用的实验设计总结；如果论文原文不在工作区，先问我要来源，验收标准是输出能复用到后续模型复现实验。',
    files: {
      'notes/research-brief.md': `# Research brief\nNeed a reusable experiment-design summary for a reasoning-model paper. Source PDF is intentionally absent so plan mode should ask for source material before source-dependent work.\n`,
      'expected-output.md': `# Expected artifact\n- Core findings\n- Training pipeline summary\n- Evaluation setup\n- Reusable experiment design checklist\n`
    }
  },
  {
    id: 'task-02-plan-mode-ui-entry',
    prompt: '把聊天输入框里的“计划模式”做成真正的 plan mode 入口，而不是只包一层 prompt；要求点击后进入只读计划流程，最终通过计划面板审批后再执行。',
    files: {
      'src/renderer/src/components/Workbench.tsx': `// fixture: Workbench owns composer state, mode switching, and sendPlanTurn.\n`,
      'src/renderer/src/components/chat/FloatingComposer.tsx': `// fixture: FloatingComposer renders the plan-mode toggle.\n`,
      'src/renderer/src/components/workbench-plan-controller.ts': `// fixture: sendPlanTurn creates GUI plan context and opens PlanPanel.\n`
    }
  },
  {
    id: 'task-03-runtime-plan-tool-policy',
    prompt: '审计本地 runtime 的 plan mode 工具白名单，确保计划模式只能使用 read/grep/find/ls/web_search/web_fetch/request_user_input/create_plan，不能执行 bash/edit/write。',
    files: {
      'kun/src/adapters/tool/capability-registry.ts': `// fixture: plan mode allowed tool names are filtered here.\n`,
      'kun/src/adapters/tool/local-tool-host.ts': `// fixture: request_user_input and create_plan are registered here.\n`,
      'kun/tests/agent-loop-sandbox.test.ts': `// fixture: sandbox policy tests live here.\n`
    }
  },
  {
    id: 'task-04-structured-clarification',
    prompt: '优化计划模式的反问体验：只有缺少用户才能回答的需求、偏好、取舍时才用结构化问题；不要把“是否批准计划”作为普通问题问用户。',
    files: {
      'src/shared/long-horizon-prompt.ts': `// fixture: plan-mode policy and question triage live here.\n`,
      'src/renderer/src/plan/plan-prompts.ts': `// fixture: GUI plan prompts should mention request_user_input and create_plan.\n`
    }
  },
  {
    id: 'task-05-api-key-rotation',
    prompt: '设计 API key 轮换设置页：支持新增、吊销、复制、过期提醒和错误态；验收标准包括键盘可访问性、i18n 文案、不会影响现有登录流程。',
    files: {
      'src/renderer/src/components/settings/README.md': `# Settings area\nSettings pages share i18n keys, keyboard navigation, and existing auth state.\n`,
      'src/renderer/src/locales/en/common.json': `{"settings":"Settings"}\n`,
      'src/renderer/src/locales/zh/common.json': `{"settings":"设置"}\n`
    }
  },
  {
    id: 'task-06-electron-startup-crash',
    prompt: '排查 npm run dev 启动 Electron 时 main process 找不到 @anthropic-ai/claude-agent-sdk 的问题，要求找出依赖、构建产物和 package-lock 的根因，并给出验证步骤。',
    files: {
      'package.json': `{"dependencies":{"@anthropic-ai/claude-agent-sdk":"^0.3.185"},"scripts":{"dev":"npm run build:local-runtime && electron-vite dev"}}\n`,
      'electron.vite.config.ts': `// fixture: Electron main and renderer build config.\n`,
      'src/main/index.ts': `// fixture: main process imports local runtime and SDK-backed adapters.\n`
    }
  },
  {
    id: 'task-07-session-archive-migration',
    prompt: '为会话归档设计数据库迁移方案：sessions 增加 archived_at、archive_reason，要求有回滚策略、索引影响说明、旧数据兼容和验证 SQL。',
    files: {
      'kun/src/adapters/file/schema.sql': `CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL);\n`,
      'docs/database.md': `# Database notes\nMigrations must be reversible and safe for existing local workspaces.\n`
    }
  },
  {
    id: 'task-08-research-memory-sync',
    prompt: '设计 Research Memory 后台同步管线：支持断点续传、冲突检测、失败重试、离线队列和可观测性；验收标准包括端到端测试和不会阻塞 UI。',
    files: {
      'packages/workers/research-memory/src/index.ts': `// fixture: worker entry point for research-memory sync.\n`,
      'src/renderer/src/stores/research-memory.ts': `// fixture: renderer state should stay responsive while sync runs.\n`,
      'docs/research-memory.md': `# Research Memory\nLocal-first research notes with optional background sync.\n`
    }
  },
  {
    id: 'task-09-sci-plotting-regression',
    prompt: '制定 scientific plotting 样式回归测试计划：覆盖 SVG/PNG 导出、字体、图例、坐标轴、暗色主题和论文图尺寸，要求给出自动化验证命令。',
    files: {
      'packages/workers/scientific-plotting/src/index.ts': `// fixture: plotting worker exports figure generation APIs.\n`,
      'scripts/scientific-plotting-style-regression.mjs': `// fixture: existing smoke regression command.\n`,
      'docs/plot-style.md': `# Plot style\nPublication figures must preserve labels, legends, and export dimensions.\n`
    }
  },
  {
    id: 'task-10-multi-agent-paper-review',
    prompt: '设计一个多 agent 论文评审流程：一个 agent 做方法总结，一个做实验可复现性检查，一个做引用/claim audit，最后主 agent 汇总风险和验收标准。',
    files: {
      'packages/workers/multi-agent/src/index.ts': `// fixture: multi-agent worker can coordinate bounded sub-agent jobs.\n`,
      'docs/paper-review-workflow.md': `# Paper review workflow\nSeparate method summary, reproducibility, citation audit, and final synthesis.\n`
    }
  }
]

function assertInsideE2eRoot(target) {
  const resolved = resolve(target)
  if (!resolved.startsWith(resolve(e2eRoot))) {
    throw new Error(`Refusing to write outside e2e root: ${resolved}`)
  }
}

function writeTaskFile(taskDir, relativePath, content) {
  const target = join(taskDir, relativePath)
  assertInsideE2eRoot(target)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

async function loadPromptBuilder() {
  mkdirSync(compiledRoot, { recursive: true })
  execFileSync(
    process.execPath,
    [
      join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--target',
      'ES2022',
      '--module',
      'ES2022',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
      '--outDir',
      compiledRoot,
      'src/shared/long-horizon-prompt.ts'
    ],
    { cwd: repoRoot, stdio: 'inherit' }
  )
  return import(`${pathToFileURL(join(compiledRoot, 'long-horizon-prompt.js')).href}?v=${Date.now()}`)
}

async function setup() {
  if (existsSync(e2eRoot)) {
    assertInsideE2eRoot(join(e2eRoot, 'sentinel'))
    rmSync(e2eRoot, { recursive: true, force: true })
  }
  mkdirSync(e2eRoot, { recursive: true })
  const { buildLongHorizonPrompt } = await loadPromptBuilder()

  for (const task of tasks) {
    const taskDir = join(e2eRoot, task.id)
    mkdirSync(taskDir, { recursive: true })
    for (const [relativePath, content] of Object.entries(task.files)) {
      writeTaskFile(taskDir, relativePath, content)
    }
    const promptResult = buildLongHorizonPrompt({
      userPrompt: task.prompt,
      mode: 'agent',
      workspaceRoot: taskDir,
      fileReferences: Object.keys(task.files).map((path) => ({ relativePath: path, kind: 'file' }))
    })
    writeTaskFile(
      taskDir,
      'PLAN_MODE_PROMPT.md',
      `${promptResult.text}\n\n## E2E Harness Boundary\n- This is a plan-mode start test. Do not implement the task yet.\n- Work only inside this task directory if the user later approves implementation: ${taskDir}\n- For this test, the expected end state is an approval-ready plan, not code changes.\n- If implementation is later approved, run \`node test.mjs\` from this task directory before reporting completion.\n`
    )
    writeTaskFile(
      taskDir,
      'PLAN_MODE_START.json',
      JSON.stringify({
        id: task.id,
        originalQuery: task.prompt,
        schemaVersion: promptResult.metadata.schemaVersion,
        needsClarification: promptResult.needsClarification,
        clarifyingQuestions: promptResult.clarifyingQuestions,
        expectedFirstBehavior: 'Explore read-only context, ask only blocking questions, produce an approval-ready plan, and wait for approval before implementation.'
      }, null, 2)
    )
  }

  writeFileSync(join(e2eRoot, 'TASKS.json'), JSON.stringify(tasks.map(({ id, prompt }) => ({ id, prompt })), null, 2))
  console.log(`Prepared ${tasks.length} plan-mode e2e start tasks at ${e2eRoot}`)
}

function validatePlanStart() {
  const failures = []
  for (const task of tasks) {
    const taskDir = join(e2eRoot, task.id)
    const promptPath = join(taskDir, 'PLAN_MODE_PROMPT.md')
    const startPath = join(taskDir, 'PLAN_MODE_START.json')
    try {
      if (!existsSync(promptPath)) throw new Error('PLAN_MODE_PROMPT.md missing')
      if (!existsSync(startPath)) throw new Error('PLAN_MODE_START.json missing')
      const prompt = execFileSync('node', ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(promptPath)}, 'utf8'))`], { cwd: taskDir, encoding: 'utf8' })
      for (const fragment of requiredPlanModePromptFragments) {
        if (!prompt.includes(fragment)) throw new Error(`prompt missing fragment: ${fragment}`)
      }
      if (!prompt.includes(task.prompt)) throw new Error('prompt missing original query')
      const start = JSON.parse(execFileSync('node', ['-e', `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(startPath)}, 'utf8'))`], { cwd: taskDir, encoding: 'utf8' }))
      if (start.originalQuery !== task.prompt) throw new Error('start metadata originalQuery mismatch')
      if (!Array.isArray(start.clarifyingQuestions)) throw new Error('start metadata clarifyingQuestions must be an array')
      console.log(`${task.id}: plan mode started`)
    } catch (error) {
      failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`${task.id}: failed`)
    }
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`All ${tasks.length} plan-mode e2e start tasks passed.`)
}

function validateImplementation() {
  const failures = []
  for (const task of tasks) {
    const taskDir = join(e2eRoot, task.id)
    try {
      execFileSync('node', ['test.mjs'], { cwd: taskDir, stdio: 'pipe' })
      if (!existsSync(join(taskDir, 'RESULT.md'))) {
        throw new Error('RESULT.md missing')
      }
      console.log(`${task.id}: implementation passed`)
    } catch (error) {
      failures.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`${task.id}: implementation failed`)
    }
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`All ${tasks.length} implementation e2e tasks passed.`)
}

function list() {
  for (const task of tasks) {
    console.log(`${task.id}: ${join(e2eRoot, task.id)}`)
  }
}

const command = process.argv[2] ?? 'list'
if (command === 'setup') await setup()
else if (command === 'validate' || command === 'validate-plan') validatePlanStart()
else if (command === 'validate-implementation') validateImplementation()
else if (command === 'list') list()
else {
  console.error('Usage: node scripts/long-horizon-e2e.mjs <setup|validate|validate-plan|validate-implementation|list>')
  process.exit(1)
}
