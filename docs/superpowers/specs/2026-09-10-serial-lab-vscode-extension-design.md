# Serial Lab — VSCode 串口调试插件首版设计

## 状态

已与用户对齐（2026-09-10）：产品形态为 VSCode 插件；首版为轻量单面板工作台；必须内置 FireWater / JustFloat / RawData，并支持用户自定义协议；仓库内容将清空后重写。

## 目标

在 VSCode 内完成 STM32/嵌入式日常数据观察与指令收发，替代「切出去开 VOFA+」的工作流：

1. 选择并连接本机串口（默认 115200 8N1）。
2. 用内置或自定义协议解析多通道数值。
3. 在 Webview 中实时查看波形与原始收发内容（文本 / HEX）。
4. 以文本或 HEX 发送指令（可选行尾）。
5. 导出解码采样 CSV 与原始 RX/TX 日志。

首版明确不做：节点编辑器、CAN、FFT/滤波、AI、完整 Dock 布局、多串口并发、脚本沙箱中的复杂运行时。

## 产品标识

- 扩展 ID（publisher.name）：`local.serial-lab`（发布前可改 publisher）
- 显示名：**Serial Lab**
- Activity Bar 标题：Serial Lab

## 技术栈

| 层 | 选择 | 理由 |
|----|------|------|
| 扩展宿主 | TypeScript + VSCode Extension API | 原生侧栏/状态栏/工作区配置 |
| 串口 | `serialport` npm 包 | Windows COM 枚举与读写 |
| 波形 | uPlot（打进 Webview 资源） | 轻量、高性能时序图 |
| Webview 通信 | `postMessage` / `onDidReceiveMessage` | 批量帧推送与 UI 事件 |
| 打包调试 | `npm` + `vsce`，F5 Extension Development Host | 快速本地迭代 |

不使用 Tauri、React、Qt。旧 `debug-workbench` Qt 分支保留在 git 历史中，不再作为主产品。

## 界面布局

```text
┌ ActivityBar ┬ SideBar（TreeView/WebviewView） ┬ 主 WebviewPanel ──────────┐
│ Serial Lab  │ 连接                              │ [Tab] 波形 | 终端        │
│             │  端口下拉 / 刷新 / 波特率          │                          │
│             │  连接 / 断开                       │  uPlot 多通道时序        │
│             │ 协议                              │  暂停 / 自动缩放 / 时间窗 │
│             │  FireWater | JustFloat | RawData  │                          │
│             │  | Custom…                        │  终端：文本 | HEX        │
│             │  自定义协议管理…                   │  时间戳 / 方向 / 清空    │
│             │ 通道                              │                          │
│             │  勾选可见 / 颜色 / 别名            │  发送：文本|HEX + 行尾   │
└─────────────┴──────────────────────────────────┴──────────────────────────┘
状态栏：● COM3 · 115200 · JustFloat · RX 12.3 kB · TX 64 B · err 0
```

- 侧栏负责配置；主面板负责观察与发送。
- 可用命令 `Serial Lab: Open Workbench` 打开或聚焦主面板。
- 布局保持单面板，避免首版陷入 VSCode 多视图限制。

## 架构与模块

```text
Extension Host
├── SerialService          端口枚举、open/close/write、错误与计数
├── RawBuffer              有界原始 RX 环（默认 2 MiB，满则丢最旧）
├── ProtocolRouter         当前协议选择 → 对应 Decoder
│   ├── JustFloatDecoder
│   ├── FireWaterDecoder
│   ├── RawDataDecoder     不产出数值通道，仅驱动终端显示
│   └── CustomProtocolDecoder
├── ChannelRegistry        稳定通道 id、别名、颜色、可见性
├── SeriesStore            有界时间序列（默认 60 s）
├── ExportService          采样 CSV / 原始日志导出
├── WorkspaceState         端口/协议/通道/自定义协议持久化
└── WebviewBridge          批量推送 samples / raw / status

Webview
├── WaveformView (uPlot)
├── TerminalView (text | hex)
├── SendBar (text | hex + EOL)
└── StatusBarMirror（主面板内可选；权威状态在 VSCode StatusBar）
```

所有权约定：

- 串口与解析只在 Extension Host，不在 Webview。
- 禁止每样本一次 `postMessage`；按帧批量、定时刷 UI（约 30–60 FPS）。
- GUI/Webview 卡顿只影响显示，不阻塞串口读取。

## 数据流

```text
serialport 'data' (Buffer)
  → RawBuffer.push
  → ProtocolRouter.decode → SampleBatch { t, channels: number[] }
  → ChannelRegistry 映射别名/可见性
  → SeriesStore.append（有界）
  → Bridge.emitSamples（批量）
  → Webview uPlot / 终端渲染

TX 输入 → SerialService.write → RawBuffer/TX log + 计数
导出请求 → ExportService 读 SeriesStore 或原始日志 → 文件对话框
```

时间戳：扩展宿主单调时钟（`performance.now` 或 `process.hrtime`），相对会话起点；导出时附带 ISO 时间作展示列。

## 协议

### 内置

| 协议 | 帧规则 | 通道 |
|------|--------|------|
| JustFloat | 小端 `float32` 重复，尾标 `00 00 80 7F` | 首帧确立通道数；后续长度不一致记错误并丢弃 |
| FireWater | 一行文本：`v0,v1,...` 或空白分隔的有限浮点，以 `\n` 结束 | 每行列数可变化；坏行计错误、不产出部分通道 |
| RawData | 不解码 | 无波形通道；终端显示原始字节 |

分片/粘包：Decoder 必须保存 pending 缓冲；pending 有上限（如 64 KiB），超限丢弃并计错误。

### 自定义协议（首版必须支持）

自定义协议是用户可命名、可多份、可切换的配置，存入 VSCode **workspace** 设置（`serialLab.protocols`），避免与机器全局配置混淆。

**两种模式，用户在 UI 里二选一：**

#### A. 配置型（无代码，默认）

字段：

- `name`：显示名  
- `lineEnding`: `lf` | `crlf` | `cr`  
- `delimiter`: `comma` | `space` | `tab` | `semicolon` | 任意单字符/字符串  
- `trim`: boolean  
- `skipPrefix`: 可选前缀（如 `DATA,`）  
- `channels`: 有序列表  
  - `index`：字段下标（0-based）  
  - `name`：通道名（默认 `ch{index}`）  
  - `color`：可选  
- `allowChannelCountChange`: boolean（默认 false；true 时按行最大字段数扩展通道）

行为：按行切分 → 分隔符切字段 → 可选去前缀 → 按 `index` 取有限数值（十进制或科学计数）→ 产出 `SampleBatch`。任一映射字段非有限数则整行错误计数，不部分写入。

#### B. 脚本型（可选，进阶）

- `mode`: `script`  
- `script`：用户编写的 **单函数体**，签名约定：

```js
// 输入：一行完整文本（不含行尾）
// 输出：number[] 或 null（null = 本行忽略）
return line.split(';').slice(1).map(Number).filter(n => Number.isFinite(n));
```

- 在 Extension Host 中用受限方式执行（`new Function('line', script)`），**不**暴露 `require`/`process`/`fs`。  
- 每次调用测执行耗时；超过软上限（默认 50 ms）则计 `script_timeout`，本行结果丢弃。首版不强杀同步脚本，文档要求脚本保持纯函数、禁止死循环。  
- 脚本仅处理**文本行**；二进制自定义协议首版不做，统一走 JustFloat 或后续扩展。

UI：侧栏「协议」→「自定义…」打开简单管理页（WebviewView 或 QuickPick + InputBox 流程）：新建/编辑/删除/导入 JSON/导出 JSON。脚本型用 `vscode.window.showInputBox` 多行不便时，可先用「打开 JSON 编辑」让用户在编辑器里改配置文件。

内置三协议不可被删除；自定义协议可随时切换，切换时重置 Decoder pending，不重置串口连接，不强制清空终端原始缓冲（可提供「清空显示」）。  
切换后通道集合以新协议输出为准；通道稳定 id 为 `协议id.通道名`。旧通道历史留在 SeriesStore 中直至超时淘汰，图例可一键「清空波形」。

## 接收 / 发送格式

- 终端显示编码：`text`（UTF-8，非法字节替换）| `hex`（空格分隔大写）。  
- 同一原始缓冲两种视图，切换不丢数据。  
- 发送：`text` 或 `hex`（允许空白分隔字节对）；行尾 `none` | `lf` | `cr` | `crlf`。  
- HEX 非法输入：不发送，状态栏/消息提示。  
- 发送内容写入 TX 计数与原始日志（方向 `TX`）。

## 波形与终端

- uPlot：多曲线、时间轴滚动、Y 自动/手动、暂停推进视图（不停止解码与记录）、通道图例点击显隐。  
- SeriesStore 约 60 s 或点数上限；隐藏通道可不查询/不绘制以省开销。  
- 终端：有界行数/字节（默认 2000 行或 1 MiB 显示量），可暂停滚动、清空、显示方向与相对时间。

## 导出

1. **采样 CSV**  
   列：`t_ms,iso_time,ch0,ch1,...`（使用当前别名）。仅导出可见或全部通道（对话框选项）。  
2. **原始日志**  
   文本日志：`iso_time,dir,hex_or_text` 或逐字节二进制 `.bin` + `.idx`（首版优先 **文本日志**：`timestamp,dir,encoding,payload`）。  

导出经 VSCode `showSaveDialog`；大数据集分批写文件，避免一次内存暴涨。

## 持久化（workspace state / settings）

| 项 | 位置 |
|----|------|
| 端口名、波特率、数据位/校验/停止位（若暴露） | `serialLab.connection` |
| 当前协议 id | `serialLab.protocol` |
| 通道别名、颜色、可见性 | `serialLab.channels` |
| 自定义协议列表 | `serialLab.protocols` |
| 终端编码、发送编码与行尾 | `serialLab.terminal` |

连接状态本身不持久化为「已连接」；重载窗口后需手动连接。

## 错误处理

| 场景 | 行为 |
|------|------|
| 无可用串口 | 侧栏空状态提示，非崩溃 |
| 端口占用 / 拒绝访问 | 显示完整错误；保持 UI 可操作 |
| 设备拔出 | 停止波形推进与读取，状态改为 Error/Disconnected，可手动重连 |
| 协议错误 / 缓冲溢出 | 计数器 + 状态栏；继续解析后续帧 |
| 自定义脚本异常/超时 | 计错误，本行忽略，不拖垮串口循环 |
| 导出失败 | 通知错误；已写部分内容尽量保留并说明 |

## 测试策略

- **单元**（不依赖 VSCode UI）：JustFloat 分片/粘包/坏尾标；FireWater 分隔/坏行/科学计数；自定义配置型映射；脚本型成功/抛错/超时；HEX 编解码；环形缓冲淘汰。  
- **集成**：用假 Transport 注入字节流，断言 SeriesStore 与导出内容。  
- **手工**：F5 调试 + 模拟器或 STM32 COM 口；与 VOFA+ 对照 JustFloat/FireWater；自定义协议用常见日志格式验收。  

## 仓库与目录（清空重写）

```text
serial-lab/   （D:\myvofa 工作区）
├── package.json              扩展清单、命令、配置 schema
├── tsconfig.json
├── src/
│   ├── extension.ts          激活、命令、侧栏注册
│   ├── serial/serialService.ts
│   ├── protocol/
│   │   ├── types.ts
│   │   ├── justfloat.ts
│   │   ├── firewater.ts
│   │   ├── raw.ts
│   │   ├── custom.ts
│   │   └── router.ts
│   ├── store/{rawBuffer,seriesStore,channels}.ts
│   ├── export/exportService.ts
│   ├── state/workspaceState.ts
│   └── webview/
│       ├── panel.ts          WebviewPanel 生命周期与 bridge
│       ├── sidebar.ts        连接/协议/通道
│       └── media/            main.js, main.css, uplot
├── src/test/                 单元与集成测试
├── docs/superpowers/specs/   本设计
└── README.md
```

重写策略：

- 在新分支（建议 `feat/serial-lab-v0`）上建立上述结构。  
- 删除旧工作区中的 Qt/文档产物文件，**保留 git 历史**以便回溯；不强制 `git init` 抹史。  
- 合并/推送由用户明确要求后再做。

## 里程碑

1. **M0 骨架**：扩展可 F5 启动，侧栏空壳，状态栏出现。  
2. **M1 串口**：枚举、连接、RX 计数、断开。  
3. **M2 内置协议 + 终端**：三协议 + 文本/HEX 显示 + 发送。  
4. **M3 波形**：uPlot + 通道显隐 + 暂停。  
5. **M4 自定义协议**：配置型 + 脚本型 + 管理 UI。  
6. **M5 导出与打磨**：CSV/日志导出、错误态、README。  

## 验收标准（首版）

- [ ] 能选择本机串口并以 115200 8N1 连接；状态栏实时显示连接与 RX/TX。  
- [ ] JustFloat / FireWater 能出多通道波形；RawData 仅终端。  
- [ ] 终端可在文本与 HEX 间切换且不丢已有缓冲。  
- [ ] 可发送文本或 HEX（含行尾选项）。  
- [ ] 可新建至少一种配置型自定义协议并用于波形。  
- [ ] 可导出采样 CSV 与原始收发日志。  
- [ ] 断开、拔出、协议错误均有可见反馈，应用不假死。  

## 许可与第三方

- 原创代码建议 MPL-2.0（与旧仓一致）；若后续再 fork Lissio 需单独评估 GPL-2.0。  
- `serialport`、uPlot、VSCode API 遵循其各自许可证；README 列出依赖。  
