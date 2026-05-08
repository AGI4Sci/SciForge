# KV-Ground 服务接入指南

本文说明 SciForge `vision-sense` 如何接入你自己部署的 KV-Ground。KV-Ground 只负责 grounding：输入截图路径和文本目标，输出图像坐标。需要 VLM 的环节统一走 VisionPlanner 模型，例如 `qwen3.6-plus`。

## 职责划分

```text
VisionPlanner: VLM，读取文本 + 截图，输出通用 GUI action
KV-Ground: grounding 模型，读取 image_path + text_prompt，输出坐标
GuiExecutor: 根据坐标执行 click/scroll/type/press_key
Verifier: 重新截图，检查窗口一致性和视觉变化
```

推荐配置：

- VLM：`qwen3.6-plus`
- Grounder：自部署 KV-Ground
- 普通文本模型：可以继续给 AgentServer 或其他文本任务使用，不要混用到 VisionPlanner。

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
- 默认会把本地截图以 JSON base64 传给 KV-Ground，适合远端服务读不到本机路径的常见场景。
- 如果 KV-Ground 已可用，一般不需要配置 `visionSense.visualGrounderModel`。

等价环境变量：

```bash
export SCIFORGE_VISION_PLANNER_BASE_URL="http://your-openai-compatible-endpoint/v1"
export SCIFORGE_VISION_PLANNER_API_KEY="your-api-key"
export SCIFORGE_VISION_PLANNER_MODEL="qwen3.6-plus"

export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
```

## KV-Ground API

健康检查：

```bash
curl http://127.0.0.1:18081/health
```

正常返回示例：

```json
{
  "ok": true,
  "model_dir": "/path/to/KV-Ground-8B-BaseGuiOwl1.5-0315",
  "cuda_available": true,
  "gpu_count": 1
}
```

预测接口：

```text
POST /predict/
```

请求字段：

- `image_path`：可选。KV-Ground 服务端可读取的图片路径、服务端可访问的 HTTP/HTTPS 图片 URL，或 `data:image/...;base64,...`。
- `image_base64`：可选。本地图像 bytes 的 base64 字符串；可以带 `data:image/png;base64,` 前缀。远端服务读不到本机路径时推荐使用。
- `image_data`：可选，`image_base64` 的别名。
- `image_mime_type`：可选，内联图片 MIME 类型，例如 `image/png`。
- `text_prompt`：定位指令，例如 `Click the Submit button`。
- `coordinate_space`：可选，SciForge 会传入 `window` / `window-local` / `screen`。
- `window_target`：可选，目标窗口元数据，便于服务端记录或调试。

调用示例：

```bash
curl -X POST http://127.0.0.1:18081/predict/ \
  -H "Content-Type: application/json" \
  -d '{
    "image_path": "/remote/shared/path/restart_check.png",
    "text_prompt": "Click the Submit button",
    "coordinate_space": "window"
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

SciForge 会优先读取：

- `coordinates: [x, y]`
- 或 KV-Ground 输出中的 bbox / point 文本

坐标必须对应输入截图原始像素尺寸。窗口模式下，坐标应是目标窗口截图坐标，不是全屏坐标。

## 路径策略

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

   手动调用示例：

   ```bash
   IMG_B64=$(base64 < /local/path/screenshot.png | tr -d '\n')
   curl -X POST http://127.0.0.1:18081/predict/ \
     -H "Content-Type: application/json" \
     -d "{
       \"image_base64\": \"$IMG_B64\",
       \"image_mime_type\": \"image/png\",
       \"text_prompt\": \"Click the Submit button\"
     }"
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

## SSH 隧道示例

如果 KV-Ground 在远端，且远端监听 `127.0.0.1:18080`，本地可映射为 `18081`：

```bash
ssh -N -p <ssh-port> -L 18081:127.0.0.1:18080 <user>@<host>
```

后台运行：

```bash
ssh -f -N -p <ssh-port> -L 18081:127.0.0.1:18080 <user>@<host>
```

然后配置：

```bash
export SCIFORGE_VISION_KV_GROUND_URL="http://127.0.0.1:18081"
```

## 服务管理示例

如果使用 supervisor 管理 KV-Ground：

```bash
SUP=/path/to/supervisorctl
$SUP -c /path/to/supervisord.conf status kv-ground
$SUP -c /path/to/supervisord.conf restart kv-ground
```

查看日志：

```bash
tail -f /path/to/kv-ground.err.log
tail -f /path/to/kv-ground.out.log
```

查看 GPU：

```bash
nvidia-smi
```

查看端口：

```bash
ss -ltnp | grep 18080
```

## 常见排错

`/health` 失败：

- 确认 SSH 隧道仍在运行。
- 确认 KV-Ground 服务进程仍在。
- 确认 `SCIFORGE_VISION_KV_GROUND_URL` 指向本机可访问地址。

`image_path not found`：

- 请求里的 `image_path` 必须是 KV-Ground 服务端路径，不是 SciForge 本地路径。
- 检查 `grounderLocalPathPrefix` 和 `grounderRemotePathPrefix` 是否能正确替换。
- 远端服务读不到本机路径时，不要把本机路径当 `image_path` 传；让 SciForge 默认发送 `image_base64`，或显式设置 `SCIFORGE_VISION_KV_GROUND_UPLOAD_STRATEGY=inline`。

坐标明显偏移：

- 确认 KV-Ground 返回的是原始输入截图尺寸下的像素坐标。
- 确认窗口模式下使用的是目标窗口截图坐标，不是全屏坐标。
- 检查 Retina / devicePixelRatio 映射；SciForge trace 会记录 `executorCoordinateScale`。

VisionPlanner 无法理解截图：

- 检查 `visionSense.plannerModel` 或 `SCIFORGE_VISION_PLANNER_MODEL` 是否是 VLM。
- 不要把 `deepseek-v4`、`deepseek-v4-flash` 等文本模型配置到 VisionPlanner。
- 推荐先使用 `qwen3.6-plus` 统一 VLM 行为。
