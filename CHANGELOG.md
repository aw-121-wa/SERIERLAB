# Change Log

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
