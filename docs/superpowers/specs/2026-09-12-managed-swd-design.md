# Managed SWD backend

Approved direction: make SWD usable without a preinstalled Python/pyOCD, retain Native and custom interpreters. Do not change the previously deferred Chinese-path RPC behavior.

Default empty `serialLab.swd.pythonPath` selects a versioned environment under ExtensionContext.globalStorageUri. Use pinned uv release archives with committed SHA-256 digests; uv obtains CPython 3.11 and installs pinned pyOCD/pyelftools into a private venv. Support Windows x64, macOS x64/arm64 and glibc Linux x64/arm64; unsupported platforms can use a custom interpreter. No PATH or global Python modifications.

Before downloads, present install destination and explicit install choice. Progress and output log expose stages; errors offer retry and custom Python guidance. In-process coalescing and a filesystem lease serialize installations across windows. Build new venvs in unique final locations (venvs cannot be renamed) and publish an atomic active manifest only after import/version checks. Failed attempts clean only their owned temporary files. Keep the prior active environment intact during repair.

Custom Python is checked but never silently altered. A missing target support pack receives an actionable message plus a user-triggered install action. Native startup must not inspect or install Python. Network download respects VS Code HTTP proxy or HTTPS_PROXY; uv inherits proxy env. Exact top-level package versions are pinned; transitive dependencies follow their upstream constraints.

Test isolated environment lifecycle, cancellation/decline, custom paths, retries, locking, deadlines, archive checksum/platform mapping, stale controller connect, package declarations, and a real installation in a temporary workspace-owned storage directory. Package docs and licenses; no firmware changes or target access in setup.
