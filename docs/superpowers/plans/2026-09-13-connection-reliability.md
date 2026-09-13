# Connection reliability implementation plan

User approved scope: four audit fixes, connection wizard, effective configuration, diagnostics, offline runtime packages. Never infer target from ELF. Preserve Native and pyOCD backend.

- [x] Add regression tests then fix serial cancellation, backend ELF identity, watch reconnect, whitespace numeric input.
- [x] Add explicit transport/probe/target wizard; query installed targets, install missing support, select ELF and connect. Target selected by user only.
- [x] Expose immutable active serial/SWD configuration, separate next-connect settings, connection diagnostics and copy report command.
- [x] Add same-platform offline runtime export/import with manifest validation, relocatable interpreter and installed packages, atomic activation; document limitations.
- [x] Run focused and full tests, compile, review, package updated VSIX and document usage.

Architecture: retain existing controller and backend. New wizard orchestrates existing commands; new diagnostics module classifies observable state without claiming hardware root cause. Offline packaging isolated from connection code. Test without probes; do not flash/reset hardware.

Validation: 54 TypeScript suites / 296 tests; Python backend 10 tests; compile/package passed. Windows x64 offline relocation retained exact 212 installed targets including STM32F750. No hardware writes or flash/reset performed. Offline package Windows only; target remains explicit user selection.
