# 自定义串口协议



侧栏协议选 **Custom…** → **编辑自定义协议**，在打开的 JSON 中维护数组。改完后把 `serialLab.protocol` 设为 `custom`，并用 `serialLab.activeCustomProtocolId` 指定当前项（侧栏切换协议时也会写入）。

### 配置型（无代码）

```json
[
  {
    "id": "stm32-csv",
    "name": "STM32 CSV",
    "mode": "config",
    "delimiter": "comma",
    "skipPrefix": "DATA,",
    "channels": [
      { "index": 0, "name": "ax" },
      { "index": 1, "name": "ay" },
      { "index": 2, "name": "az" }
    ]
  }
]
```

字段说明：

| 字段 | 含义 |
|------|------|
| `delimiter` | `comma` / `space` / `tab` / `semicolon` 或任意分隔字符串 |
| `skipPrefix` | 可选行前缀（不匹配则忽略该行） |
| `channels[].index` | 字段下标（0-based） |
| `channels[].name` | 通道显示名 |

### 脚本型

对「一行文本」返回 `number[]` 或 `null`：

```json
[
  {
    "id": "tagged",
    "name": "Tagged",
    "mode": "script",
    "script": "return line.split(';').slice(1).map(Number).filter(Number.isFinite);"
  }
]
```

脚本在扩展宿主中受限执行，异常或超过软上限（约 50 ms）会记错误并丢弃该行。请保持纯函数、避免死循环。

## 发送示例

- 文本：`hello` + 行尾 LF  
- HEX：`01 0A FF`（允许空白分隔）

