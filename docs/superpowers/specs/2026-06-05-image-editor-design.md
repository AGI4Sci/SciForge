# Image Preview and Editor Design

最后更新：2026-06-05

## 状态

本设计已按用户确认的技术路线整理：使用 SVG/DOM overlay 负责编辑交互，使用 Offscreen Canvas 负责最终 PNG 导出。当前文档用于后续实现计划，不代表代码已经完成。

## 背景

SciForge 右侧 Image 栏已经承担图片 evidence 和 artifact 的预览职责。用户希望所有图片都使用一个通用图片预览、展示组件，并在原图弹出的查看器里加入轻量图片编辑能力。已经确认的产品方向是：

- 预览组件要自动适配可视区域，图片不能超出显示范围。
- 点击对话里的图片引用后，右侧 Image 栏展示该图片。
- Image / Evidence 标签改为 Image。
- 原图查看器默认是只读预览，点击 Edit 后进入编辑模式。
- 编辑范围选择“裁剪 + 审阅标注”。
- 标注工具包含鼠标画线、箭头/形状、文字、编号 pin、高亮、模糊/遮挡。
- 保存结果时不覆盖原图，而是生成新的图片 artifact。
- 保存格式是 PNG 加 annotation JSON。
- 新 artifact 只在右侧 Image 栏展示，不自动添加到对话引用或 composer。
- 导出使用源图片像素坐标，不按屏幕预览尺寸降采样。

## 目标

- 提供一个通用的图片预览组件，供 Image 栏、原图弹窗和图片 artifact 结果复用。
- 提供一个轻量图片编辑模式，覆盖研究审阅场景需要的裁剪、圈注、指示、遮挡和说明。
- 保持原图不可变，所有编辑保存为新的 artifact，并保留可再次编辑的 annotation JSON。
- 保证预览和导出一致：用户在 overlay 中看到的标注，在导出的 PNG 中以相同源图像坐标落位。
- 支持用户直接打开原图预览；Desktop/native 可用时优先弹出系统图片预览窗口，Web dev 或 native 不可用时回退到 raw URL 新窗口。在只读模式下点击图片本身也可以打开原图，编辑模式下点击图片用于编辑交互。

## 非目标

- 不做完整图像处理软件能力，例如图层混合、滤镜库、复杂颜色校正、路径布尔运算或多人协作。
- 不覆盖或删除原始图片 artifact。
- 不自动把编辑后的图片塞回对话引用、composer 或下一轮模型上下文。
- 不把模糊/遮挡声明为安全删除。它只会烘焙到导出 PNG 中，原图 artifact 仍然存在。
- 首版不引入 Fabric、Konva 或类似大型画布编辑库，除非后续需求超过轻量审阅工具范围。

## 技术路线

最终路线是“SVG/DOM 编辑层 + Offscreen Canvas 导出层”：

- 预览层使用真实 `img` 元素展示图片，并用 CSS `object-fit: contain`、稳定 stage 尺寸和 pan/zoom transform 控制显示。
- 编辑层使用覆盖在图片上的 SVG/DOM overlay。标注对象以源图片像素坐标保存，UI 只负责把屏幕坐标映射到图片坐标。
- 导出层使用 Offscreen Canvas 或隐藏 canvas。保存时重新加载源图片，按 annotation JSON 的确定顺序绘制，输出 PNG artifact。
- artifact 层保存两个结果：导出的 PNG artifact，以及可编辑的 annotation JSON artifact。PNG 是默认展示对象，JSON 用于后续 reopen edit。

这条路线比纯 Canvas 编辑更容易实现对象选中、拖拽、文本和编号 pin；也比 Fabric/Konva 更轻，能保持现有 artifact/ref 模型清晰。

## 组件边界

### Image Preview Surface

通用预览组件负责：

- 加载图片 ref/raw URL。
- 展示 loading、load error、preview unavailable 和 metadata 状态。
- 自动 fit 到容器，避免图片溢出。
- 提供 read-only controls：zoom in、zoom out、fit、actual size、pan、copy ref、open original、download。
- 在只读模式下，点击图片打开原图预览；双击也执行同一行为，避免用户误以为只能点工具栏。Open original 优先调用 Desktop/native 图片预览能力，不能调用时打开 raw preview URL。

### Image Editor Overlay

编辑 overlay 负责：

- 维护当前工具、选中对象、hover/drag 状态和 undo/redo 历史。
- 将 pointer 坐标转换为源图片像素坐标。
- 支持裁剪框、自由画线、直线/箭头、矩形、文字、编号 pin、高亮区域、模糊/遮挡区域。
- 用 SVG/DOM 即时显示标注对象。文本输入使用轻量 inline editor，提交后写回 annotation JSON。
- 在编辑模式下禁用“点击图片打开原图”，避免和绘制、选择、拖拽冲突；工具栏仍保留 Open original。

### Image Export Rasterizer

导出 rasterizer 负责：

- 读取源图片自然尺寸和 annotation JSON。
- 如果没有裁剪，输出尺寸等于源图片自然像素尺寸。
- 如果存在裁剪，输出尺寸等于裁剪区域在源图片中的像素尺寸；这表示保留源图像素密度，而不是保留屏幕预览尺寸。
- 按固定顺序绘制：源图片裁剪区域、模糊/遮挡、高亮、自由画线、形状、箭头、编号 pin、文字。
- 生成 PNG blob，并交给 artifact 保存适配层。

### Artifact Save Adapter

保存适配层负责：

- 创建新的 PNG artifact ref。
- 创建 annotation JSON artifact ref。
- 记录 source image ref、source natural size、crop rect、annotation list、export size、createdAt 和 schema version。
- 保存成功后，右侧 Image 栏聚焦到新的 PNG artifact。
- 不把新 artifact 自动追加到聊天消息、composer 或下一轮 refs。

## Annotation JSON

Annotation document 使用版本化结构：

```json
{
  "schema": "sciforge.image-annotation.v1",
  "sourceRef": "artifact-or-upload-ref",
  "sourceNaturalSize": { "width": 3024, "height": 1964 },
  "crop": { "x": 120, "y": 80, "width": 1600, "height": 1000 },
  "annotations": [
    {
      "id": "ann_...",
      "type": "freehand",
      "points": [{ "x": 140, "y": 110 }],
      "stroke": "#ffcc00",
      "strokeWidth": 6
    }
  ],
  "export": {
    "format": "png",
    "width": 1600,
    "height": 1000
  }
}
```

所有几何坐标都使用源图片像素坐标。没有裁剪时 `crop` 可以省略；没有标注时 `annotations` 可以为空数组。

## 用户体验

- Image 栏标签显示为 `Image`。
- 工具栏使用图标按钮、tooltip、active 状态和 disabled 状态；避免一长排灰色文字按钮。
- 预览默认 fit；actual size 会进入可平移视图。
- 鼠标滚轮或触控板缩放应围绕指针位置，避免用户缩放后丢失关注区域。
- Esc 取消当前绘制或文本编辑，Delete 删除选中标注，Cmd/Ctrl+Z 和 Cmd/Ctrl+Shift+Z 支持 undo/redo。
- Save as artifact 在没有任何编辑时禁用，或者提示“没有需要保存的更改”。
- 保存中显示进度状态；保存失败不丢失当前编辑状态。

## 错误处理

- 图片加载失败时，保留 ref 信息和 Open original / Copy ref 操作。
- 如果源图片因为跨域或权限导致 Canvas 无法导出，保存动作 fail closed，并提示用户仍可打开原图或下载原图。
- 大尺寸图片预览时只缩放显示层，不改变源图像素；导出时若图片尺寸超过浏览器安全阈值，提示用户缩小裁剪范围或稍后重试。
- 模糊/遮挡只作用于导出 PNG；原始 sourceRef 不会被修改。
- annotation JSON 解析失败时，仍然展示 PNG artifact，并提示该图片不能继续编辑，只能重新从 PNG 创建新编辑。

## 验收计划

- Unit tests：屏幕坐标和源图像坐标转换、crop 输出尺寸、annotation JSON 版本化和默认值。
- Rasterizer tests：使用固定小图片 fixture，验证线条、矩形、文字、遮挡和裁剪导出尺寸稳定。
- Component tests：Image 标签文案、图片 ref 点击后聚焦 Image 栏、只读模式点击图片打开原图、Edit 进入编辑模式、Save 生成新 artifact。
- Playwright smoke：上传图片、点击图片引用、右侧自动展示、fit 不溢出、打开原图、进入编辑、画线和编号 pin、裁剪保存、保存后 Image 栏展示新 PNG。
- Visual QA：桌面和窄屏宽度下工具栏不重叠，图片不超出 stage，active tool 和 disabled save 状态清晰可见。
