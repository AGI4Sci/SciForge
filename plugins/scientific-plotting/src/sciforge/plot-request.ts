export interface PlotChatRequest {
  text: string
  mode?: 'data' | 'code' | 'continue'
  filePath?: string
  codePath?: string
  imagePath?: string
  documentId?: string
  codeRevisionId?: string
}

/** User intent plus explicit preservation rules; all authority stays with the host. */
export function plotRequestMessage(input: PlotChatRequest): string {
  return `请通过已安装的 scientific-figures.operation 实际完成绘图，不模拟执行。所有历史代码、每一步数据快照、运行环境、日志、原图和候选图都必须保留，禁止覆盖或删除。数据清洗/筛选/变换若影响下一步，将CSV/TSV/JSON/TXT结果写入 SCIENTIFIC_FIGURES_OUTPUT_DIR，成功运行后会作为不可变产物保存；下一步用返回的保存路径（工作区下 .scientific-figures/加输出path）纳入新代码版本inputPaths，再从冻结输入读取，不依赖临时内存或当前可变文件。每次成功运行会保存 _environment 下依赖版本、环境清单和重建说明；不是带哈希或二进制的完整环境锁，不自动安装包。listCodes/listRuns 用limit和cursor分页，返回items/nextCursor/errors，按需读取单个版本，禁止一次遍历全部日志。若存在recoverable中断记录，executePython同ID只完成已保存结果的提交，不重新执行；无可靠进程结果时先检查，绝不伪造成功或自动重跑。每次修改 saveCode 使用新的 codeRevisionId 并指向真实 parentCodeRevisionId；每次复跑使用新的 runId，运行已有冻结代码时不得重新读取当前文件替代快照。读取数据文件后把路径放入 saveCode.inputPaths，Python 只从 SCIENTIFIC_FIGURES_INPUT_DIR 读取冻结输入，参数从 SCIENTIFIC_FIGURES_PARAMETERS_JSON 读取，输出写 SCIENTIFIC_FIGURES_OUTPUT_DIR。新建成功运行用 publishRun 创建图件；修改前先 read 当前基线，成功输出发布候选，绝不自动接受。\n${input.mode === 'code' ? '本次从用户提供的数据和Python代码开始：读取代码原文，保存完整源文件，用 inputPaths 冻结数据，先实际运行建立基线。图片可选：若提供 imagePath，用 importBaseline 传 codeRevisionId、path=imagePath 及新文档变更参数保存提供原图与代码来源，再把真实运行输出发布为候选；仅标记用户提供，不能未经比较声称复现。没有图片时直接发布实际运行的首图。' : input.mode === 'data' ? '本次从数据开始创建新图件，不修改已有图件；先检查数据结构，再编写Python代码、冻结数据、实际执行并发布首图。' : '本次在指定文档当前图基础上逐步修改；先核实当前图关联代码和输入，继承冻结输入与父子版本：saveCode 不传 inputPaths 时继承父版本快照，只有用户明确更换数据才传新的 inputPaths（[]表示清空）；不要从无关旧候选开始。'}\n请求：${JSON.stringify(input)}`
}
