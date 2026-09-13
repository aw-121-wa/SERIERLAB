# SWD / DAPLink 运行态调参

Serial Lab 0.2.32 保留 Native 串口调参，另增 SWD 参数来源。两条连接独立：可以继续用串口采样，同时通过 DAPLink 修改 RAM 参数。STM32 无需 Serial Lab SDK、串口协议或调参任务。

首次使用推荐点击 **连接向导**：选择 SWD 探针、手动搜索选择芯片、准备支持包，然后选择 ELF 和参数。芯片不会从 ELF 自动识别。缺少 target/ELF 的连接请求会打开向导。工作台可查看实际连接配置并复制诊断报告；离线安装见 [SWD_OFFLINE.md](SWD_OFFLINE.md)。

## 安装与连接

0.2.33 起，VS Code 启动后自动后台检查已有 SWD 环境，结果在“输出 → Serial Lab”中查看。插件直接调用环境的 Python，不需要运行 activate。没有环境时使用连接向导下载安装，或导入离线包；启动预检不自动连接探针。

1. 默认无需安装 Python。保持 `serialLab.swd.pythonPath` 为空，首次选择 ELF 或连接 SWD 时点击“安装”。插件会下载独立 Python 3.11、pyOCD 0.45.1 和 pyelftools 0.33，以后直接复用。已有自定义 Python 配置会优先使用；若要自动管理，请手动清空此设置。离线或需要自行管理时，给自己的 Python 安装依赖并填写解释器路径：

   ```powershell
   python -m pip install "pyocd==0.45.1" "pyelftools==0.33"
   python -m pyocd list --probes
   python -m pyocd list --targets
   ```

   源码工程也可使用 `python -m pip install -r scripts/requirements-swd.txt`。如果报 `No USB backend found`，检查该 Python 的 USB 依赖是否兼容；不要混用其他解释器安装的二进制包。`serialLab.swd.pythonPath` 填写解释器完整路径，不是 `py -3.11` 这样的命令。

2. 接好 DAPLink 的 SWDIO、SWCLK、GND 和按探针要求连接的目标电压参考。STM32 已运行固件，调试接口可用。关闭占用同一探针的 Keil、OpenOCD、其他 pyOCD 等。不能靠选 DAPLink 的 COM 口实现 SWD。
3. 打开 Serial Lab 工作台，在 Parameters 的“参数来源”选择 **SWD / DAPLink**。
4. 点击“SWD 设置”，填写实际 STM32 对应的 `serialLab.swd.target`。必须使用 pyOCD 支持的具体 target ID；缺少型号支持时先安装对应 CMSIS Device Family Pack。不要用泛型 Cortex-M 代替具体芯片的内存映射。
5. 点击“选择 ELF”，选择与板上固件对应、带 DWARF 调试信息的 `.elf` / `.axf`，随后勾选需要调节的变量。也可单独点击“选择参数”。最多 64 个，重名符号不能自动选择。
6. 点击“连接 SWD”。连接时读取并核对 ELF 中位于目标 Flash 的加载段，包含代码和 `.data` 初值；不匹配就拒绝连接。该检查不能证明被人为替换的 DWARF 信息正确，仍须使用烧录时生成的原始 ELF。
7. 修改参数输入框后按 Enter 或离开输入框；布尔值通过复选框修改。写入后读取实际值校验。切回 **Native 串口** 可继续使用原有 SDK 的设备发现和 ACK/NACK 调参。

选择 ELF 及参数会保存到当前工作区的 VS Code 设置。已连接会话使用连接时的配置快照，修改设置后请断开重连。多根工作区的相对 ELF 路径以第一个目录为基准。

## 设置示例

### 自动环境维护

- 命令面板执行 **Serial Lab: Install / Repair SWD Environment** 可重新安装托管环境。自定义 Python 模式下只检查环境，不改动它。
- 缺少芯片型号时，先配置 `serialLab.swd.target`，再执行 **Serial Lab: Install SWD Target Pack**，完成后重新连接。此操作不连接或烧录芯片。芯片包使用 pyOCD 自己的用户缓存。
- 自动安装支持 Windows x64、macOS x64/arm64、Linux glibc x64/arm64，需要系统 `tar`。其他平台使用自定义 Python。USB 驱动和 Linux 设备访问权限仍需按 pyOCD 文档配置。
- 首次安装需要访问 GitHub、Python 下载源和 PyPI；支持 VS Code `http.proxy` 或 `HTTPS_PROXY`。离线电脑可预先准备自定义 Python 环境。安装失败查看 **Serial Lab SWD Setup** 输出并重试。
- Python、环境和 uv 缓存保存在扩展 `globalStorageUri/swd/runtime-v1`，不写入固件工程、不修改系统 PATH。安装使用独立目录，验证成功后切换；旧环境保留，清理时先关闭所有 VS Code 窗口。崩溃遗留的 `install.lock` 也只应在关闭所有窗口后删除。
- uv 固定为 0.8.22，下载后校验 SHA-256；Python 固定为 3.11 系列，pyOCD/pyelftools 固定顶层版本，间接依赖由安装器解析。uv 使用 MIT/Apache-2.0，pyOCD 使用 Apache-2.0，pyelftools 使用公共领域许可；Python 及芯片包分别遵循其上游许可。插件按需下载这些组件，不将整个 Python 环境打入 VSIX。

官方说明：[uv Python 管理](https://docs.astral.sh/uv/guides/install-python/)、[pyOCD 芯片包](https://pyocd.io/docs/open_cmsis_pack_support.html)。

以下芯片 ID 仅作示例，必须换成实际芯片对应的 ID：

```json
{
  "serialLab.swd.pythonPath": "",
  "serialLab.swd.elf": "build/firmware.elf",
  "serialLab.swd.target": "stm32f407vg",
  "serialLab.swd.probeId": "",
  "serialLab.swd.frequency": 1000000,
  "serialLab.swd.pollHz": 5,
  "serialLab.swd.watch": [
    { "path": "yaw_kp", "min": 0, "max": 20 },
    { "path": "pid.inner.limit", "min": 0, "max": 2000 },
    { "path": "gains[0]", "min": 0, "max": 100 }
  ]
}
```

- `probeId` 为空时要求只连接一个探针；有多个时填完整唯一 ID。
- `frequency` 是 SWD 时钟，默认 1 MHz；`pollHz` 是参数读取频率，默认 5 Hz、上限 20 Hz，设为 0 仅手动刷新。慢请求不会排队补读。
- 只读取 watch 列表，不扫描 RAM、不自动写入、不保存到 Flash。Flash 核对只在连接时进行，会有一次性读取开销。
- 断开 SWD 才停止其轮询；切换参数面板来源不会断开连接。要停止后台读取可断开 SWD 或设置 0 Hz 后重连。
- 连接要求受信任的 VS Code 工作区。扩展不会自动安装 Python 包，也不会加载项目中的 pyOCD 用户脚本。

## STM32 端最小准备

```c
volatile float yaw_kp = 3.5f;

// 控制周期中实际读取 yaw_kp。
// 不需要 sl_init / sl_process / UART 通信。
```

保留正常优化等级并生成调试信息，例如 GCC `-g`。调参对象需要稳定 RAM 地址，算法应持续读取该对象。`volatile` 避免编译器复用旧值，但不会解决 D-Cache 或多参数一致性。

当前支持固定地址全局/静态变量的 `float32`、`int32`、`uint32`、1 字节 `bool`，嵌套结构体成员，以及最多 256 个元素的一维固定数组。实际 watch 最多 64 个值。指针解引用、位域、union、64 位值、动态位置、寄存器变量、多维数组、常量及编译期宏不支持。已被优化掉的变量不能恢复。

每次访问同时检查 ELF 可写存储范围与 pyOCD 的目标可写 RAM 范围。32 位值必须 4 字节对齐。连接不调用 halt/reset/flash，禁止自动解锁；断开不主动改变内核运行状态。目标不在运行态时拒绝读写。

**F7/H7 等启用 D-Cache 的芯片：**请将调参区放入调试口可访问的不可缓存 RAM，或自行实现正确缓存维护；不能仅加 `volatile`，也不要为了调参关闭整个 D-Cache。具体 RAM 区域和 MPU 配置取决于型号。

多个参数的写入不是事务，不保证同一控制周期同时生效。若必须成组生效，可用影子参数和控制周期边界切换；这需要少量固件配合，但不需要通信协议。单参数写后读回只说明内存值匹配，不代表控制算法已应用。固件若同时改写该变量，可能出现读回不一致。

RAM 改值复位即丢失；调好后把值写回固件默认配置。SWD 会使用总线资源，不保证零时序干扰或硬实时延迟。首先从低频轮询开始，实际板子的控制周期抖动、缓存及低功耗访问行为需要实测。本次自动化测试不替代硬件验证。

## 开发验证

```powershell
npm.cmd test
npm.cmd run compile
python -m unittest discover -s scripts -p test_swd_backend.py
```

Python 测试覆盖值编码、范围、RAM 限制、Flash 核对、附加选项、写后读回；安装 ARM GCC 时还会编译测试固件验证真实 ELF/DWARF 解析。缺少 ARM GCC 时该项显示 skipped。TypeScript 测试覆盖 RPC、连接竞态、断开、来源隔离和 Native 选择。

参考：[pyOCD API](https://pyocd.io/docs/python_api.html)、[pyOCD 选项](https://pyocd.io/docs/options.html)、[ST F7/H7 缓存说明](https://www.st.com/resource/en/application_note/an4839-level-1-cache-on-stm32f7-series-and-stm32h7-series-stmicroelectronics.pdf)。
