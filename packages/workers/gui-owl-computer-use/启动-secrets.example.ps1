# =============================================================================
#  GUI-Owl computer-use — secrets / machine-specific config (TEMPLATE)
#
#  复制本文件为  启动-secrets.local.ps1  并填入真实值。
#  启动-secrets.local.ps1 已被 .gitignore 忽略，不会提交。
#
#  Copy this file to  启动-secrets.local.ps1  and fill in real values.
#  (启动-secrets.local.ps1 is gitignored — never committed.)
# =============================================================================

# --- GUI-Owl 模型部署所在的 GPU 服务器 (用于自动建 SSH 隧道) -----------------
# GUI-Owl is served by vLLM on this box; the launcher forwards a local port to it.
$env:CUA_SSH_HOST       = "101.126.157.149"   # GPU 服务器地址
$env:CUA_SSH_PORT       = "2222"              # SSH 端口
$env:CUA_SSH_USER       = "root"
$env:CUA_REMOTE_PORT    = "4243"              # 远端 vLLM 监听端口 (见 serve-gui-owl.sh)
$env:CUA_LOCAL_PORT     = "4243"              # 本地转发端口

# --- 模型端点 (worker 真正调用的地址) ----------------------------------------
# 默认指向上面的本地隧道端口。生产环境应改为 SciForge model router 的
# OpenAI 兼容网关 (PROJECT_mcp.md: LLM/VLM 流量必须走 model router)。
$env:CUA_MODEL_BASE_URL = "http://127.0.0.1:$($env:CUA_LOCAL_PORT)/v1"
$env:CUA_MODEL          = "gui-owl"
$env:CUA_MODEL_API_KEY  = "EMPTY"             # vLLM 无需鉴权; 走网关时填真实 key

# --- 循环 / 安全 -------------------------------------------------------------
$env:CUA_MAX_STEPS      = "12"
$env:CUA_REFLECT        = "true"
$env:CUA_PORT           = "3900"              # HTTP sidecar 端口
$env:CUA_SHOW_OVERLAY   = "true"              # 真机执行时显示鼠标高亮 (仅 Windows)

# 注意: CUA_ALLOW_EXECUTE 由启动脚本的 -Execute 开关控制, 不在这里设置,
#       以免误开真机执行。
# Note: CUA_ALLOW_EXECUTE is controlled by the launcher's -Execute switch.
