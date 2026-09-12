# Change Log

## 0.2.30

- S14.3 源码右键：Watch / Add to Plot / Edit / Reveal Runtime Variable
- RuntimeVariableEditor：prepare → commit 时重新 resolve，固件或地址变更则中止写入
- SWD write+read-back 串行化；RuntimeEvent（SessionClock）
- TOCTOU 回归：ELF 切换 / 地址变化 → 0 次 backend write

## 0.2.29

- S14.2.2：CU scope 使用 **完整路径**（`DW_AT_comp_dir`+`DW_AT_name`），不再 basename
- `App/motor.c` 与 `Drivers/motor.c` 同名 static 可区分；scopeHash 基于全路径
- `scopePathsMatch` 支持绝对/相对 CU 路径匹配

## 0.2.28

- S14.2.1 RuntimeSymbol identity：`sha256::scope::expression`（global / file-static CU）
- SWD Channel ID：`swd.<elfPrefix>.global.*` 或 `swd.<elfPrefix>.<scopeHash8>.*`
- 同 ELF 下 motor.c / imu.c 同名 static 不再串 Hover 缓存与 Plot 通道
- Python inspect 输出 `sourceFile` / `kind`（无 DW_AT_external → file-static）

## 0.2.27

- S14.1.1：拒绝把 `ptr->x` / `foo()` / `motors[i]` 切成伪全局符号
- S14.2 Runtime Hover：C/C++ 悬停显示类型、缓存 Live 值、地址、ELF id
- Hover 只读 SWD watch 缓存，不阻塞、不自动轮询、不写变量；stale firmware 不展示旧值

## 0.2.26

- S14.1 RuntimeSymbolService：光标表达式提取 + 复用 SWD inspect 符号表解析固定地址
- 支持 global / struct / nested / array[i]；拒绝 ptr、call、变量下标
- RuntimeSymbol 绑定完整 ELF 内容 SHA256；`isCurrent` 检测 stale firmware
- 无第二套 DWARF parser；不访问硬件

## 0.2.25

- S13.1：SWD Channel ID 使用 **ELF 文件内容 SHA-256**（16 hex），不是路径哈希
- 同路径重编译 → firmware identity 变化 → 不复用旧 watch/channel id
- disconnect 清空 elfSha256，禁止 stale RAM watch
- `pollRateHz` 明确为全局实际轮询率（v1 非 per-variable）

## 0.2.24

- S13 Unified Runtime Sources：SWD 变量进入统一 Channel → SeriesStore → Plot（可与 UART 同图）
- 侧栏通道徽章 UART / NATIVE / SWD；稳定 id = ELF key + symbol
- 集中 poll timer；SessionClock 时间戳；variable-write 事件类型预留

## 0.2.22

- 保留 Native 调参，新增独立的 SWD / DAPLink 参数来源：pyOCD 运行态附加、ELF/DWARF 变量选择、低频轮询、RAM 校验及写后读回。
- 连接时核对 ELF 的 Flash 加载段，不自动解锁、不暂停、复位或烧录。
- 修复 Native 选择回落到 JustFloat；隔离不同来源和会话的参数写入。
- 新增 SWD.md 使用说明与 STM32 端要求。

## 0.2.21

- 侧栏协议下拉增加 **Native (在线调参)**；settings enum 同步

## 0.2.20

- S12.1 审计修复：`parameters.update` 真正单行增量更新；每参数 ↻ Refresh（`parameter.refresh`）
- Hardware Gate 发布包（含 S1–S12）

## 0.2.19

- S12 Parameter Inspector：Workbench 右侧参数面板（path 分组、搜索、float/int/uint/bool、readonly）
- SET → pending → ACK(appliedValue) / NACK / timeout；Host ParameterStore 为唯一真值
- Bridge：`parameters.snapshot` + `parameters.update`（事件驱动，非 50ms 全量）

## 0.2.18

- S10 语义收紧：Host 先拒超范围 SET；unsolicited PARAM_VALUE 要求有效 parameterId；discovery 2s 超时
- S11 STM32 C SDK v1（pure C、无堆、无 HAL）：COBS/CRC/frame/RX FIFO/TX pending/HELLO+PARAM_*
- 显式 parameter table + 可选 setter hook；ACK 为 read-back appliedValue
- 桌面 gcc 测试与 S10 golden vectors 交叉验证

## 0.2.17

- S10 Native Runtime Control Protocol v1（PC 端）：COBS+0x00 帧、CRC-16/CCITT-FALSE、HELLO/PARAM_* 消息
- ParameterStore / RequestManager / NativeSession；golden wire vectors
- `protocol.kind = native`；连接后自动 HELLO + parameter discovery
- 不改动 JustFloat/FireWater/Raw/Custom wire format

## 0.2.16

- S9 `.seriallab.json` v1：versioned 项目配置（serial framing / protocol / channel 展示）
- 优先级：`.seriallab.json` > workspace settings > user settings > defaults
- JSON Schema + `jsonValidation`；坏文件保持 last-known-good
- 串口 **port** 改存 `workspaceState`，不再自动写入 `.vscode/settings.json`
- 命令：`Serial Lab: Edit Project Configuration`
- **修复**：dataBits / parity / stopBits / flowControl 真正传入 SerialPort open（此前仅 baudRate）

## 0.2.15

- S8 Channel Identity：`id` / `path` / `displayName` / `unit` 分离
- Builtin id 冻结为 `justfloat.ch0` 等；Custom 稳定为 `custom.<protocolId>.idxN`
- 热路径不再每 batch `list().find` + `setMeta`；仅 discovery/变更时写 metadata
- Legacy custom prefs（`custom.<name>`）迁移到新 id；兼容旧 `name` 字段

## 0.2.14

- 修复 X 轴不推进 / 无法缩放：`setScale` 后不再调用默认 `redraw()`（会用旧 scale 覆盖 pending）
- 改用 `uplot.batch()` 同步 commit，`applyingFollow` 在 hook 触发时仍为 true
- follow 关时 `setData` 后 `redraw(false)` 只刷数据
- `new uPlot()` 后重置 userX/userYZoom 标记
- S7.1：Plot follow 回归测试 + 软件 Integration Gate（合成源全链路，105 tests）

## 0.2.13

- Y 自动量程改用稳健分位数，避免单点尖峰把整段波形压成一条线
- 始终包含 0，不再强行对称到 ±max（单侧信号不再浪费半幅画面）
- 时间窗读数与 uPlot 实际 scale 同步

## 0.2.12

- 修复实时波形不滚动：Webview DisplayRing 补齐 `count` / `xAt` / `yAt`（`latestSampleTime` 此前恒为 null）
- 修复「重置缩放」因 `xAt is not a function` 失效
- 新增 API 漂移回归测试，锁定 main.js 与 TS DisplayRing 接口一致

## 0.2.11

- 侧栏每个通道显示实时数值（约 200ms 刷新）
- 通道列表改为原地更新，避免整表重建闪烁

## 0.2.10

- 状态条 RX/TX/err/t 每 50ms 刷新（原先收数时几乎不更新）
- setData 后强制重设 X 窗口并 redraw，修复时间轴不推进
- 重置缩放走同一强制路径

## 0.2.9

- 修复跟随完全不推进：去掉误判“正在看历史”的提前返回
- 数据尚未填满时间窗时，右缘随最新采样增长（不再钉死在固定 xmax）
- 跟随开启时滚轮缩放只改窗口宽度，仍贴住实时边缘滚动

## 0.2.8

- 重置缩放：真正恢复全时间范围并重新跟随
- 坐标轴刻度/标签改为近白色，更易读
- 缩放与 VOFA 一致：跟随开/关都可自由缩放到任意区间；跟随仅在新数据到达右缘时向前滚

## 0.2.7

- 去掉无意义的自绘白色零线，只保留网格与底部 t_ms
- 跟随窗口最小 500ms，避免缩放过窄导致时间轴几乎不动
- 状态栏显示当前时间窗 `t a–b ms`，便于确认是否在推进

## 0.2.6

- 实时跟随：时间轴与波形持续向最新数据滑动（strip chart）
- 缩放只改变可见时间窗宽度，跟随开启时仍不断前进
- 工具栏「跟随:开/关」；关闭后可自由查看历史，重置缩放会重新打开跟随

## 0.2.5

- 修复通道勾选无响应（不再每 50ms 重建图例）
- 缩放后保持视图；X 缩放时 Y 仅拟合当前窗口（仍含 0 居中）
- 图中加粗绘制 y=0 / x=0 零轴；底部保留 t_ms 时间轴

## 0.2.4

- 滚轮 / 触控板：缩放 X；Ctrl（或捏合）缩放 Y
- 显示坐标网格；Y 自动量程以 0 为中心（零线居中）
- 工具栏提示更新

## 0.2.3

- 修复：通道隐藏后无法重新勾选显示
- Snapshot 始终带上隐藏通道（visible=false），Webview 用 setSeries 切换显示，不再整图销毁

## 0.2.2

- 波形支持拖拽框选放大（X/Y）
- 实时 delta 更新不再重置缩放；双击图区或点「重置缩放」恢复自适应

## 0.2.1

- 波形 X 轴改为会话 `t_ms`（不再显示 1970 日历时间）
- 关闭 uPlot 内置 legend，修复与终端叠字
- 侧栏增加「打开波形面板」；连接成功后自动打开
- 侧栏视图改名为「连接」，避免与波形面板混淆

## 0.2.0

- Foundation：UI 暂停不再无界堆积；Resume 发送新快照而非回放 backlog
- SessionClock：CSV / Raw 日志使用真实 wall-clock ISO，不再出现 1970 时间戳
- SeriesStore 改为 RingBuffer；getWindow 使用 Min/Max envelope，窄尖峰不被 stride 吃掉
- Workbench 波形改为 Snapshot + Delta，降低 Extension Host → Webview 重复传输
- 按 View / Command 懒激活；Workspace 不受信任时禁用 Experimental Script 协议
- 配置项：`serialLab.uiPendingMaxBytes` / `serialLab.uiPendingMaxEntries`

## 0.1.0

- 首次发布：串口连接、JustFloat / FireWater / RawData、自定义协议
- 侧栏端口与协议配置，主面板波形 / 终端 / 发送
- 文本与 HEX 收发，采样 CSV 与原始日志导出
