# SWD parameters alongside Native

User approved adding the previously proposed SWD/ELF/RAM workflow while retaining Native.

Keep serial telemetry and Native protocol independent of the new SWD session. The parameter panel selects Native or SWD; messages carry their source so stale UI actions cannot write through another backend. Native remains the default.

Use a persistent Python helper with pyOCD and pyelftools, exchanging JSON lines over stdio with the extension. Compared with an OpenOCD Tcl backend this provides target memory maps and a direct typed API; implementing USB CMSIS-DAP ourselves would duplicate probe support. Python dependencies are explicit, never silently installed by the extension.

Parse ARM little-endian ELF with DWARF: fixed-address global/static scalar variables, nested structure members and bounded arrays; reject pointers, unions, bitfields and dynamic locations. Resolve configured symbol paths uniquely. Only ELF writable allocated storage intersecting target RAM is accessible. Support float32, int32, uint32 and one-byte bool. Keep limits in host configuration.

Attach without halt/reset/flash/unlock, leave run state unchanged on disconnect, disable host memory caches. Require a target ID and an unambiguous probe. Verify immutable ELF flash sections against the connected target at attach before enabling writes. Stop on mismatch. Poll configured watch list only, default 5 Hz, at most 64 values; serialize operations, no catch-up queue. Refresh manually with polling disabled. Writes validate bounds and alignment and read back their result. A readback is not a device ACK or a multi-value transaction.

Expose source selector and SWD connect/disconnect/refresh controls in Parameters, plus settings for Python, ELF, target, probe, clock, watch list and frequency. Serial and SWD can coexist, but other programs must release the same probe. Document volatile, cache coherency, reset volatility and unavailable optimized symbols.

Validate helper with synthetic ARM ELF/DWARF and fake target memory; validate RPC lifecycle and source routing in TypeScript tests; run complete existing tests, compile, syntax checks and VSIX packaging. Hardware timing/cache behavior remains an explicit physical-board verification step.
