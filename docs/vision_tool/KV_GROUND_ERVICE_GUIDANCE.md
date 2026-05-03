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

## 本地访问方式

如果本地 `18080` 已经被占用，使用 `18081` 建立 SSH 隧道：

```bash
ssh -N -p 32361 -L 18081:127.0.0.1:18080 root@101.126.157.149
```

保持这个命令运行。之后在本地访问：

```bash
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
  "gpu_count": 1
}
```

## 预测接口

接口：

```text
POST /predict/
```

请求字段：

- `image_path`：服务器上的图片路径，或服务器可访问的 HTTP/HTTPS 图片 URL。
- `text_prompt`：定位指令，例如 `Click the Submit button`。

调用示例：

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

因为 API 运行在服务器上，`image_path` 必须是服务器能读取的路径。本地图片需要先上传。

上传本地图片：

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

- 确认图片已经上传到服务器。
- 确认请求中的 `image_path` 是服务器路径，不是本地路径。

查看 GPU：

```bash
ssh -p 32361 root@101.126.157.149 'nvidia-smi'
```

查看服务端口：

```bash
ssh -p 32361 root@101.126.157.149 'ss -ltnp | grep 18080'
```