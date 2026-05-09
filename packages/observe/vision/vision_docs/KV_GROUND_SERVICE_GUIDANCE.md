# KV-Ground API 服务启动与 SciForge 接入指南

本文说明如何启动、访问和维护 KV-Ground API 服务，并说明 SciForge `vision-sense` 如何接入该服务。KV-Ground 只负责 grounding：输入截图和文本目标，输出图像坐标。需要理解截图和规划 GUI action 的环节由 VisionPlanner VLM 完成，例如 `qwen3.6-plus`。

## 职责划分

```text
VisionPlanner: VLM，读取文本 + 截图，输出通用 GUI action
KV-Ground: grounding 模型，读取 image + text_prompt，输出坐标
GuiExecutor: 根据坐标执行 click/scroll/type/press_key
Verifier: 重新截图，检查窗口一致性和视觉变化
```

推荐配置：

- VLM：`qwen3.6-plus`
- Grounder：自部署 KV-Ground API
- 普通文本模型：可以继续给 AgentServer 或其他文本任务使用，不要混用到 VisionPlanner。

## 机器与目录

当前 GPU 服务部署信息：

- SSH：`ssh -p 32361 root@101.126.157.149`
- 服务目录：`/fs-computility-new/upzd_share/shared/agent/kv-ground-service`
- 模型目录：`/fs-computility-new/upzd_share/shared/agent/kv-ground-service/models/KV-Ground-8B-BaseGuiOwl1.5-0315`
- 远端服务端口：`18080`
- 推荐本地转发端口：`18081`

远端服务监听在服务器内部的 `127.0.0.1:18080` / `0.0.0.0:18080`。公网直连端口可能未放通，推荐通过 SSH 隧道从本地访问。

## 启动或重启服务

登录服务器：

```bash
ssh -p 32361 root@101.126.157.149
```

检查服务状态：

```bash
SUP=/nix/store/5mc40v8qa34jyilh5jgsfi1sc42f77hv-python3.8-supervisor-4.2.2/bin/supervisorctl
$SUP -c /mlplatform/supervisord/supervisord.conf status kv-ground
```

如果显示 `RUNNING`，服务已经启动。

如果服务器重启后显示 `no such process`，重新注册 supervisor 配置：

```bash
cd /fs-computility-new/upzd_share/shared/agent/kv-ground-service

python3 - <<'PY'
from pathlib import Path

conf = Path("/mlplatform/supervisord/supervisord.conf")
block = Path("/fs-computility-new/upzd_share/shared/agent/kv-ground-service/kv-ground-supervisor.conf").read_text().rstrip()
text = conf.read_text()
marker = "; BEGIN kv-ground service"

if marker not in text:
    conf.write_text(text.rstrip() + "\n\n" + marker + "\n" + block + "\n; END kv-ground service\n")
    print("appended kv-ground supervisor config")
else:
    print("kv-ground supervisor config already present")
PY

SUP=/nix/store/5mc40v8qa34jyilh5jgsfi1sc42f77hv-python3.8-supervisor-4.2.2/bin/supervisorctl
$SUP -c /mlplatform/supervisord/supervisord.conf reread
$SUP -c /mlplatform/supervisord/supervisord.conf update
```

重启服务：

```bash
SUP=/nix/store/5mc40v8qa34jyilh5jgsfi1sc42f77hv-python3.8-supervisor-4.2.2/bin/supervisorctl
$SUP -c /mlplatform/supervisord/supervisord.conf restart kv-ground
```

查看日志：

```bash
tail -f /fs-computility-new/upzd_share/shared/agent/kv-ground-service/logs/kv-ground.err.log
tail -f /fs-computility-new/upzd_share/shared/agent/kv-ground-service/logs/kv-ground.out.log
```

查看 GPU 和端口：

```bash
nvidia-smi
ss -ltnp | grep 18080
```

## 本地访问方式

如果本地 `18080` 已经被占用，使用 `18081` 建立 SSH 隧道：

```bash
ssh -N -p 32361 -L 18081:127.0.0.1:18080 root@101.126.157.149
```

保持这个命令运行。之后本地访问：

```text
http://127.0.0.1:18081
```

如果想后台运行隧道：

```bash
ssh -f -N -p 32361 -L 18081:127.0.0.1:18080 root@101.126.157.149
```

健康检查：

```bash
curl http://127.0.0.1:18081/health
```

正常返回示例：

```json
{
  "ok": true,
  "model_dir": "/fs-computility-new/upzd_share/shared/agent/kv-ground-service/models/KV-Ground-8B-BaseGuiOwl1.5-0315",
  "cuda_available": true,
  "gpu_count": 1,
  "inline_image_supported": true,
  "max_inline_image_bytes": 20971520
}
```

## 预测接口

接口：

```text
POST /predict/
```

请求字段：

- `image_path`：可选。服务器上的图片路径、服务器可访问的 HTTP/HTTPS 图片 URL，或 `data:image/...;base64,...`。
- `image_base64`：可选。本地图像 bytes 的 base64 字符串；可以带 `data:image/png;base64,` 前缀。
- `image_data`：可选，`image_base64` 的别名。
- `image_mime_type`：可选，内联图片 MIME 类型，例如 `image/png`。
- `text_prompt`：定位指令，例如 `Click the Submit button`。
- `coordinate_space`：可选，SciForge 会传入 `window` / `window-local` / `screen`。
- `window_target`：可选，目标窗口元数据，便于服务端记录或调试。

服务端路径调用示例：

```bash
curl -X POST http://127.0.0.1:18081/predict/ \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/fs-computility-new/upzd_share/shared/agent/kv-ground-service/tests/restart_check.png",
    "text_prompt": "Click the Submit button"
  }'
```

返回示例：

```json
{
  "coordinates": [319.36, 180.0],
  "text": "click(start_box='[499, 500]')",
  "raw_text": "click(start_box='[499, 500]')",
  "image_size": {
    "width": 640,
    "height": 360
  }
}
```

说明：

- `coordinates` 是服务按输入图片原始尺寸换算后的像素坐标。
- `text` 是模型输出的简化文本。
- `raw_text` 是模型原始输出。
- `image_size` 是服务读取到的图片尺寸。

## 使用本地图片

因为 API 运行在服务器上，只传 `image_path` 时它必须是服务器能读取的路径。大多数用户应该直接把本地图像以内联 base64 传给服务，而不是先拷贝图片到服务器再引用服务器路径。

```bash
IMG_B64=$(base64 < /local/path/image.png | tr -d '\n')
curl -X POST http://127.0.0.1:18081/predict/ \
  -H "Content-Type: application/json" \
  -d "{
    \"image_base64\": \"$IMG_B64\",
    \"image_mime_type\": \"image/png\",
    \"text_prompt\": \"Click the target button\"
  }"
```

也可以使用 data URL：

```bash
IMG_B64=$(base64 < /local/path/image.png | tr -d '\n')
curl -X POST http://127.0.0.1:18081/predict/ \
  -H "Content-Type: application/json" \
  -d "{
    \"image_path\": \"data:image/png;base64,$IMG_B64\",
    \"text_prompt\": \"Click the target button\"
  }"
```

如果仍想使用路径方式，需要先上传本地图片：

```bash
scp -P 32361 /local/path/image.png \
  root@101.126.157.149:/fs-computility-new/upzd_share/shared/agent/kv-ground-service/tests/image.png
```

然后调用：

```bash
curl -X POST http://127.0.0.1:18081/predict/ \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/fs-computility-new/upzd_share/shared/agent/kv-ground-service/tests/image.png",
    "text_prompt": "Click the target button"
  }'
```

## SciForge 配置

在 `workspace/.sciforge/config.json` 中添加：

```json
{
  "modelBaseUrl": "http://your-openai-compatible-endpoint/v1",
  "apiKey": "your-api-key",
  "modelName": "bailian/deepseek-v4-flash",
  "visionSense": {
    "plannerModel": "qwen3.6-plus",
    "grounderBaseUrl": "http://127.0.0.1:18081",
    "showVisualCursor": true
  }
}
```

说明：

- `visionSense.plannerModel` 必须是支持图像输入的 VLM，例如 `qwen3.6-plus`。
- `visionSense.grounderBaseUrl` 指向 KV-Ground 服务。
- SciForge `vision-sense` 默认会在没有共享路径映射时发送 `image_base64`，适合远端服务读不到本机截图路径的常见场景。
- 如果 KV-Ground 已可用，一般不需要配置 `visionSense.visualGrounderModel`。

等价环境变量：

```bash
export SCIFORGE_VISION_PLANNER_BASE_URL="http://your-openai-compatible-endpoint/v1"
export SCIFORGE_VISION_PLANNER_API_KEY="your-api-key"
export SCIFORGE_VISION_PLANNER_MODEL="qwen3.6-plus"

export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
```

## 图片传输策略

KV-Ground 运行在服务端；如果只传 `image_path`，它必须是服务端可读路径。可选方案：

1. **JSON 内联上传，默认策略**

   SciForge 读取本地截图并随 `/predict/` 请求发送 `image_base64`，KV-Ground 在服务端写入临时文件后推理，请求结束后自动清理。

   ```json
   {
     "visionSense": {
       "grounderBaseUrl": "http://127.0.0.1:18081"
     }
   }
   ```

   也可以显式指定，和默认行为等价：

   ```bash
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="inline"
   ```

2. **共享挂载目录，适合已有共享盘**

   SciForge 截图写入本地共享目录，KV-Ground 服务端通过同一挂载读取。

   ```json
   {
     "visionSense": {
       "grounderLocalPathPrefix": "/Applications/workspace/ailab/research/app/SciForge/workspace/.sciforge/vision-runs/",
       "grounderRemotePathPrefix": "/remote/shared/sciforge/vision-runs/"
     }
   }
   ```

3. **服务端本地路径，同机部署时使用**

   如果 KV-Ground 与 SciForge 在同一机器，且服务确实能读本地路径，可以显式允许：

   ```bash
   export SCIFORGE_VISION_KV_GROUND_ALLOW_SERVICE_LOCAL_PATHS=1
   ```

4. **SCP 上传截图，兼容旧部署**

   如果不能使用内联上传，也可以让 Grounder adapter 先 `scp` 截图，再把服务端路径传给 `/predict/`。

   ```bash
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY="scp"
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_HOST="<host>"
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_PORT="<ssh-port>"
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_USER="<user>"
   export SCIFORGE_VISION_KV_GROUND_UPLOAD_REMOTE_DIR="/remote/writable/dir"
   ```

## 常见排错

本地 `curl http://127.0.0.1:18081/health` 失败：

```bash
lsof -nP -iTCP:18081 -sTCP:LISTEN
```

如果没有 SSH 进程监听，重新建立隧道：

```bash
ssh -N -p 32361 -L 18081:127.0.0.1:18080 root@101.126.157.149
```

远端服务未运行：

```bash
ssh -p 32361 root@101.126.157.149
SUP=/nix/store/5mc40v8qa34jyilh5jgsfi1sc42f77hv-python3.8-supervisor-4.2.2/bin/supervisorctl
$SUP -c /mlplatform/supervisord/supervisord.conf status kv-ground
$SUP -c /mlplatform/supervisord/supervisord.conf restart kv-ground
```

返回 `image_path not found`：

- 确认请求中的 `image_path` 是服务器路径，不是本地路径。
- 如果图片只在本机，改用 `image_base64`，或让 SciForge 默认发送 `image_base64`。
- 如果使用路径映射，检查 `grounderLocalPathPrefix` 和 `grounderRemotePathPrefix` 是否能正确替换。

坐标明显偏移：

- 确认 KV-Ground 返回的是原始输入截图尺寸下的像素坐标。
- 确认窗口模式下使用的是目标窗口截图坐标，不是全屏坐标。
- 检查 Retina / devicePixelRatio 映射；SciForge trace 会记录 `executorCoordinateScale`。

VisionPlanner 无法理解截图：

- 检查 `visionSense.plannerModel` 或 `SCIFORGE_VISION_PLANNER_MODEL` 是否是 VLM。
- 不要把 `deepseek-v4`、`deepseek-v4-flash` 等文本模型配置到 VisionPlanner。
- 推荐先使用 `qwen3.6-plus` 统一 VLM 行为。
