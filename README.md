# Serial Lab

**0.2.22：保留 Native 串口调参，新增 SWD / DAPLink 运行态 RAM 调参。** STM32 无需上位机通信代码；从 ELF 选择参数，支持上下限和写后读回。使用说明见工程及扩展安装目录中的 `SWD.md`。

VSCode 串口调试工作台：连接本机串口，解析 JustFloat / FireWater / RawData 与自定义协议，实时波形、文本/HEX 终端、指令发送、采样与原始日志导出。

面向 STM32 / 嵌入式日常调试，可在编辑器内与代码并排使用，减少切到独立上位机的成本。

## 功能

- 选择本机串口，默认 **115200 8N1**
- 内置协议：
  - **JustFloat**：小端 `float32` 序列 + 尾标 `00 00 80 7F`
  - **FireWater**：文本浮点行（逗号或空白分隔，`\n` 结束）
  - **RawData**：不解码，仅终端显示
- **自定义协议**（workspace 配置 `serialLab.protocols`）
- 多通道 uPlot 波形、暂停、通道显隐
- 终端 **文本 / HEX** 显示切换；发送 **文本 / HEX** + 行尾（none/LF/CR/CRLF）
- 导出采样 CSV 与原始 RX/TX 日志

## 快速开始

### 开发运行

```powershell
npm install
npm run compile
npm test
```

在 VSCode 中打开本目录，按 **F5** 启动 Extension Development Host。

### 日常使用

1. 打开左侧 Activity Bar 的 **Serial Lab** 侧栏  
2. **刷新** 端口，选择设备（如 `COM3`）  
3. 确认波特率（默认 115200），点击 **连接**  
4. 选择协议：JustFloat / FireWater / RawData / Custom  
5. 命令面板执行 **Serial Lab: Open Workbench** 打开波形与终端  
6. 需要时 **Serial Lab: Export Samples CSV** 或 **Export Raw Log**

> 同一串口同一时间只能被一个程序占用。若 VOFA+ 或串口助手已打开 COM 口，请先断开。

## 自定义协议

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

## 架构（简述）

- **扩展宿主**：`serialport` 读写、协议解码、有界缓冲、导出  
- **Webview**：uPlot 波形 + 终端 + 发送条，约 50 ms 批量刷新  
- 协议解码与串口 I/O 不在 Webview 内，避免界面卡顿阻塞接收  

主要目录：

```text
src/
  extension.ts          激活与命令
  appController.ts      服务编排与 UI 刷新
  serial/               串口服务
  protocol/             JustFloat / FireWater / Raw / Custom / Router
  store/                RawBuffer / SeriesStore / ChannelRegistry
  state/                workspace 配置读写
  export/               CSV / 日志导出
  webview/              主面板与侧栏
```

## 开发脚本

| 命令 | 作用 |
|------|------|
| `npm run compile` | `tsc` 编译到 `out/` |
| `npm test` | vitest 单元测试 |
| `npm run watch` | 监听编译 |
| `npm run package` | `vsce package` 打 VSIX（需自行安装 `@vscode/vsce`） |

## 排障

| 现象 | 处理 |
|------|------|
| 端口列表为空 | 点侧栏刷新；确认驱动（如 CH340）已安装 |
| 连接失败 / Access denied | 关闭 VOFA+、SSCOM 等占用程序 |
| 有 RX 但无波形 | 检查协议是否匹配；RawData 不出通道 |
| HEX 发送报错 | 必须偶数个十六进制字符，可用空格分隔 |

## 许可

原创代码 **MPL-2.0**，见 [LICENSE](LICENSE)。

第三方：

- [serialport](https://github.com/serialport/node-serialport) — MIT  
- [uPlot](https://github.com/leeoniya/uPlot) — MIT（已 vendored 于 `src/webview/media/`）  
- VSCode Extension API — 按 Microsoft / VS Code 条款使用  
