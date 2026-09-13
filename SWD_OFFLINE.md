# SWD 离线环境迁移（Windows）

在联网电脑安装 Serial Lab，执行 `Serial Lab: Install / Repair SWD Environment`，确认 SWD 环境可用。也可以将 `serialLab.swd.pythonPath` 指向已有环境的 `python.exe`；环境必须包含 pyOCD 0.45.1 和 pyelftools 0.33。

执行 `Serial Lab: 导出 SWD 离线环境`，保存 `.slrt` 文件。它包含实际 Python 基础安装、标准库、DLL、当前环境的 site-packages 和 CMSIS Pack Manager 缓存，不依赖源电脑的虚拟环境路径。包可能比较大，并包含环境中其他已安装的 Python 包，请在分享前确认这些内容适合分发。

将扩展 VSIX 和 `.slrt` 复制到离线电脑，安装 VSIX，打开受信任的工作区，执行 `Serial Lab: 导入 SWD 离线环境`。只导入可信来源的包：校验哈希只能发现损坏，不能认证来源，验证阶段会运行包内 Python。导入成功后清空 `serialLab.swd.pythonPath`，重新连接 SWD。自动环境会优先使用已导入包，不会下载依赖；显式 Python 路径仍优先。

目前仅支持 Windows，并要求导出和导入电脑的 VS Code 平台与 CPU 架构一致；操作系统版本也必须能运行所导出的 Python 及原生依赖。系统 USB 驱动不在包内，需要单独安装。此包不是跨操作系统安装包。

## 芯片支持包

若芯片不是 pyOCD 内置支持的型号，请先在联网电脑执行 `Serial Lab: Install SWD Target Pack`，再导出。导出包含完整 CMSIS Pack Manager 缓存（索引、PDSC 和已下载 .pack），离线电脑无需重新下载这些支持包。未安装的芯片支持包不会凭空包含在归档中，需要回联网电脑安装后重新导出。

为保证缓存可迁移，导出仅修改**包内副本**的 `cmsis_pack_manager/__init__.py` 默认缓存路径为 `sys.prefix/pack-cache`，不会修改源电脑依赖。导入后的 pyOCD 自动使用包内缓存。可以用所用 Python 执行以下只读命令检查缓存目录：

```powershell
& '完整路径\python.exe' -c 'import cmsis_pack_manager; print(cmsis_pack_manager.Cache(True, True).data_path)'
```

`serialLab.swd.target` 必须手动填写准确型号，ELF 不会用于猜测芯片。导出过程中不要同时安装或修改 Python 包、芯片支持包。

## 校验与恢复

归档记录平台、架构、依赖版本、每个文件长度和 SHA-256；导入拒绝路径穿越、Windows 特殊路径、重复路径、文件/目录冲突及异常归档长度。格式仅容纳普通文件，不接受符号链接或硬链接。导入在独立新目录完成全部校验，并测试 Python 依赖后才原子切换活动记录；失败时原有环境保持有效。

活动记录位于 VS Code 扩展全局存储的 `swd/offline-v1/active.json`。已激活环境损坏时会报错，不会静默联网。重新导入可修复。需要恢复自动联网环境时，关闭相关 VS Code 窗口并移走该活动记录，再执行安装/修复命令；旧环境目录不会在导入时自动清理，避免影响现有会话。

导入、导出和验证都不会连接探针、烧录、复位或读写目标芯片。
