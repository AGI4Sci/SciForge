# Template for site secrets used by 启动-sciforge-computer-use.ps1.
# Copy this to  启动-secrets.local.ps1  (which is git-ignored) and fill in real
# values. The launcher dot-sources 启动-secrets.local.ps1 if it exists; otherwise
# it falls back to the matching environment variables shown in [brackets].
$GpuHost = 'root@YOUR_GPU_HOST'           # [CUA_GPU_HOST]  SSH target serving GUI-Owl
$GpuPort = 2222                           # [CUA_GPU_PORT]
$BoxDir  = '/path/to/cua'                 # [CUA_BOX_DIR]    dir on the box with the serve script
$DS_URL  = 'http://YOUR_GATEWAY:3888/v1'  # [SCIFORGE_GATEWAY_URL]  OpenAI-compatible gateway
$KEY     = 'sk-REPLACE_ME'                # [SCIFORGE_GATEWAY_KEY]  gateway API key
