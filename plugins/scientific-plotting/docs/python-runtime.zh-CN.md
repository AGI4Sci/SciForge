# Scientific Figures Python 运行要求

原生 DSH 插件通过 Cordis 配置 `pythonCommand` 选择已有解释器；默认 `python3` 只用于诊断，不保证已经安装 Matplotlib。本包不下载、安装或分发 Python。

先对真实路径执行 `python -c "import sys,matplotlib; print(sys.executable,matplotlib.__version__)"`，成功后写入本机插件配置。代码中不得硬编码本机解释器或工作区路径。工具 action `status` 使用该配置检查运行环境；缺失 Matplotlib 时明确返回 available:false，绘图失败且不替换任何图片。

绘图先由可信 worker 冻结代码和显式输入快照，再由 DSH 正式 sandbox 与 subprocess 直接管理 Python。Python 使用 `-I -u -c` 包装器执行冻结的入口脚本；通过 `SCIENTIFIC_FIGURES_PARAMETERS_JSON` 传参，通过 `SCIENTIFIC_FIGURES_INPUT_DIR` 读取输入，输出 PNG 写入 `SCIENTIFIC_FIGURES_OUTPUT_DIR`。内置模板也先转换为同样的代码修订，再走此流程。运行完先终止托管进程范围，再由可信 worker 校验输出、保存终态日志与运行记录；发布图件单独绑定确切运行输出。

插件始终将脚本文件写权限收窄到本次暂存目录，只读会话拒绝执行，不完整的沙箱实现拒绝执行。公共DSH沙箱同时允许平台临时目录写入，且不限制全局读取或网络，所以只运行可信脚本，不能将它称作恶意代码隔离器。为保护版本存储，位于平台临时目录下的工作区不执行Python。超时、取消或失败运行不发布候选；中断后保留pending记录，不能用同一运行ID静默重跑。

代码修订保存多个源文件、父修订、参数和选定输入快照。运行记录引用代码摘要并保存Python/Matplotlib版本及有界日志；图件引用运行和精确输出。环境记录不是完整依赖锁文件；图片记录也不保证任意科学代码能按字节复现。R仅预留适配器边界，未实现。

Canvas 由构建制品携带其精确 JS 和当前平台二进制，安装不再依赖宿主碰巧存在的模块。跨平台使用必须重新构建对应平台制品。

本机验收记录位于独立验收工作区的 acceptance/python-versions-20261105。用户明确授权安装后，在该工作区的Homebrew Python虚拟环境安装Matplotlib，并验证Python3.14.7+Matplotlib3.11.2真实出原图/子代码候选及新进程恢复。最初DSH管理Python受macOS动态库Team ID校验限制，未修改其签名或宿主。解释器仅在验收配置中指定，不硬编码进插件。真实DSH安装GUI及人工允许接受仍未验收。
