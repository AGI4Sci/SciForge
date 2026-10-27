/**
 * 插件市场样张数据快照。
 *
 * 数据来源（真实、可回溯）：
 * - 仓库 SciForge_private，commit 00648de3ec4f86eb32bec5206cc09b40119ec477
 * - 索引文件 market/index.json（generatedAt 2026-10-25T04:01:14.212Z）
 * - 插件说明 plugins/<name>/README.md、package.json（同 commit）
 *
 * 本样张与桌面端市场读的是“同一生成来源”（同一份 index.json 的构建时快照），
 * 不是“同一线上索引”：线上还没有发布任何市场索引。
 *
 * 不在本快照中出现的内容：blocked（未上架）清单及其内部诊断、本机路径、
 * 发布者公钥/私钥、任何凭据。缺失字段一律标“待补”，不补造。
 */

export type MarketEffect = "read" | "compute" | "workspace-write" | "external-write" | "destructive";

export type MarketTool = Readonly<{
  name: string;
  id: string;
  effect: MarketEffect;
}>;

export type MarketExample = Readonly<{
  title: string;
  body: string;
}>;

export type MarketPlugin = Readonly<{
  slug: string;
  name: string;
  title: string;
  version: string;
  publisher: string;
  summary: string;
  categories: readonly string[];
  useCases: readonly string[];
  examples: readonly MarketExample[];
  compatibility: string;
  hostDependencies: readonly string[];
  tools: readonly MarketTool[];
  sizeBytes: number;
  sha256: string;
  signature: Readonly<{ algorithm: "ed25519"; keyId: string; publisherId: string }>;
  license: string;
  notes: readonly string[];
}>;

export const marketSnapshot = {
  mode: "same-generation-source",
  sourceFile: "market/index.json",
  sourceCommit: "00648de3ec4f86eb32bec5206cc09b40119ec477",
  generatedAt: "2026-10-25T04:01:14.212Z",
  dshRuntimeVersion: "0.2.0-rc.2",
  appVersionRange: "^1.0.0"
} as const;

export const categoryLabels: Readonly<Record<string, string>> = {
  text: "文本",
  utility: "实用工具",
  science: "科学计算"
};

export const plugins: readonly MarketPlugin[] = [
  {
    slug: "text-stats",
    name: "@sciforge/plugin-text-stats",
    title: "文本统计",
    version: "0.1.0",
    publisher: "sciforge-market",
    summary: "统计字符数、中英文词数、行数、段落数与 UTF-8 字节数；纯本地计算，不联网、不读写文件。",
    categories: ["text", "utility"],
    useCases: [
      "投稿前核对字数口径：中文按字、英文按词，结果与口径一起返回，不用自己猜。",
      "统计审稿意见、基金申请书等长文本的规模与阅读时长估算。",
      "把“字数”写进方法学附录时，附上明确的计数规则与版本号（rulesVersion）。"
    ],
    examples: [
      {
        title: "统计一段中英混排文本",
        body: 'text_stats_count { "text": "SciForge 你好 world" }\n→ characters 17 · cjkCharacters 2 · latinWords 2 · words 4 · utf8Bytes 20'
      },
      {
        title: "查询完整口径与上限",
        body: "text_stats_explain {} → 返回计数规则、1,000,000 码点上限与三个可对照示例"
      }
    ],
    compatibility: "插件声明 DSH ≥0.2.0-rc.2 <0.3.0；索引记录的运行时版本为 0.2.0-rc.2。",
    hostDependencies: ["@deepseek-ai/dsh-tools"],
    tools: [
      { name: "text_stats_count", id: "text-stats.count", effect: "compute" },
      { name: "text_stats_explain", id: "text-stats.explain", effect: "compute" }
    ],
    sizeBytes: 5467,
    sha256: "5cf0d386a15451436e1022d87b6e6e153be560e668e3e3bf08c47fa672ac37cd",
    signature: { algorithm: "ed25519", publisherId: "sciforge-market" },
    license: "待补（包内 package.json 未声明 license；仓库根许可为 Apache-2.0，插件是否单独授权待确认）",
    notes: ["纯本地计算：无网络、无文件读写、无账号要求。"]
  },
  {
    slug: "unit-conversion",
    name: "@sciforge/plugin-unit-conversion",
    title: "科学单位换算",
    version: "0.1.0",
    publisher: "sciforge-market",
    summary: "同维度单位的确定性换算，带维度检查与仿射温标处理；纯本地计算，不联网、不读写文件。",
    categories: ["science", "utility"],
    useCases: [
      "把实验记录里的单位统一到论文口径（如 eV ↔ J、mmHg ↔ kPa）。",
      "跨文献比较数值前先做同维度校验，避免 m → kg 这类静默错误。",
      "温度换算（C ↔ F ↔ K ↔ R）按仿射公式处理，不当作简单比例。"
    ],
    examples: [
      {
        title: "摄氏转华氏",
        body: 'unit_conversion_convert { "value": 100, "from": "C", "to": "F" }\n→ { "ok": true, "result": { "value": 212, "dimension": "temperature", "formatted": "212" } }'
      },
      {
        title: "列出支持的单位",
        body: "unit_conversion_list {} → 返回 7 个维度、各自的基准单位与示例"
      }
    ],
    compatibility: "插件声明 DSH ≥0.2.0-rc.2 <0.3.0；索引记录的运行时版本为 0.2.0-rc.2。",
    hostDependencies: ["@deepseek-ai/dsh-tools"],
    tools: [
      { name: "unit_conversion_convert", id: "unit-conversion.convert", effect: "compute" },
      { name: "unit_conversion_list", id: "unit-conversion.list-units", effect: "compute" }
    ],
    sizeBytes: 7503,
    sha256: "43ec39579bafc377d00382d5be7cd55d7a44ab14c500a13bd567511589ca42ef",
    signature: { algorithm: "ed25519", publisherId: "sciforge-market" },
    license: "待补（包内 package.json 未声明 license；仓库根许可为 Apache-2.0，插件是否单独授权待确认）",
    notes: [
      "权限口径差异待补：插件 README 把 unit_conversion_list 标为 read，市场索引标为 compute；页面按索引声明展示，差异待维护者确认。"
    ]
  }
];

export function getPlugin(slug: string): MarketPlugin | undefined {
  return plugins.find((plugin) => plugin.slug === slug);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const effectLabels: Readonly<Record<MarketEffect, string>> = {
  read: "读取",
  compute: "计算",
  "workspace-write": "写入工作区",
  "external-write": "写入外部",
  destructive: "破坏性"
};