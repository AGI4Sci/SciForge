# 科学单位换算（`@sciforge/plugin-unit-conversion`）

常用科研单位的确定性换算。纯本地计算，不联网、不读写文件、不需要账号。

## 能力

| 工具（注册名） | 能力 id | 效果 | 说明 |
| --- | --- | --- | --- |
| `unit_conversion_convert` | `unit-conversion.convert` | compute | 同维度内换算一个数值 |
| `unit_conversion_list` | `unit-conversion.list-units` | read | 列出全部支持单位与示例 |

## 用法

```jsonc
// unit_conversion_convert
{ "value": 100, "from": "C", "to": "F" }
// → { "ok": true, "result": { "value": 212, "from": "C", "to": "F", "dimension": "temperature",
//                             "k": 1.8, "b": 32, "formatted": "212" } }

// unit_conversion_list
{}
// → { "ok": true, "result": { "dimensions": [...], "examples": [...] } }
```

失败时返回 `{ "ok": false, "error": { "code", "message" } }`，`code` 取值：

- `unknown_unit` — 单位不认识（错误信息里会列出全部支持单位）。
- `incompatible_dimensions` — 跨维度换算，例如 `m → kg`。
- `invalid_request` — `value` 不是有限数、`from`/`to` 缺失或为空。

## 支持的维度与单位

| 维度 | 基准 | 单位 |
| --- | --- | --- |
| length | m | `m` `km` `cm` `mm` `um` `nm` `in` `ft` `yd` `mi` |
| mass | kg | `kg` `g` `mg` `ug` `t` `lb` `oz` |
| time | s | `s` `ms` `us` `min` `h` `d` |
| volume | L | `L` `mL` `uL` `m3` `gal_us` `fl_oz_us` |
| energy | J | `J` `kJ` `cal` `kcal` `Wh` `kWh` `eV` |
| pressure | Pa | `Pa` `kPa` `MPa` `bar` `mbar` `atm` `mmHg` |
| temperature | K | `K` `C` `F` `R`（仿射换算） |

拼写大小写不敏感（`mL` = `ml`），并接受常见全称（`meter`、`kilogram`、`celsius`、
`fahrenheit`、`torr` 等，见 `src/core/units.ts` 的别名表）。别名表是显式枚举的：
不收录含义可能冲突的写法，避免同一个输入在不同语境下换到不同单位。

## 数值精度（明确写清楚，不夸大）

- 线性单位（长度/质量/时间/体积/能量/压力）：因子在加载时**十进制有理化**，
  换算按"先乘后除一次"计算，能精确表示的小数因子得到精确结果
  （`3 ft → 36 in`、`1 kcal → 4.184 kJ`、`1 atm → 101325 Pa`）。
- 温度：以有理数 (分子, 分母) 表示仿射变换并单次除法，常见换算精确
  （`100 °C → 212 °F`、`37 °C → 98.6 °F`、`491.67 °R → 32 °F`、`0 °C → 273.15 K`）。
- 没有短精确十进制形式的因子（如 `eV`）走 IEEE-754 双精度：`1 eV → J` 为
  `1.6021766340000001e-19`，相对误差约 1e-16。结果里同时给出 `formatted`
  （12 位有效数字）供显示。
- 返回的 `k`、`b` 就是实际使用的变换（`to = from × k + b`），可由调用方复算。

## 限制

- 只做**同维度**换算；不解析表达式、不做量纲推导、不换算汇率或货币。
- 不收录 `M`（mol/L）等与长度 `m` 易混的单位；摩尔浓度不在范围内。
- 不换算英制液量以外的历史单位（如 UK gallon、桶）。
- `gal_us` / `fl_oz_us` 明确是美制。

## 构建与测试

```bash
npm run build   # esbuild → dist/main.js（@deepseek-ai/* 由宿主提供）
npm test        # 11 个用例：换算正确性、仿射温度、别名、拒绝路径、声明一致性、配置 fail-closed
```

## 依赖与平台

- 宿主依赖：`@deepseek-ai/dsh-tools`（宿主提供，制品不携带）。
- 无第三方运行时依赖，无原生模块；macOS / Linux / Windows 通用。
- 许可证：本插件随 SciForge 仓库（Apache-2.0）；单位因子取自国际单位制定义与
  NIST 常用换算常数（`lb = 0.45359237 kg`、`in = 0.0254 m`、`cal = 4.184 J`、
  `atm = 101325 Pa`、`eV = 1.602176634e-19 J`）。

## 验收

`scripts/dsh-plugin-verify.mjs` 对这个插件真实跑完：构建 → 签名打包 → 安装激活 →
带不同输入的两次真实调用 → 参数越界由宿主拒、跨维度由插件拒 → 重启后仍可调用 →
禁用撤下能力 → 重新启用 → 卸载无残留 → 再重启不加载。