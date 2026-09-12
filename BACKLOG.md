# Backlog

## Architecture debt

- **Unify DisplayRing**: TS vs main.js can drift — keep api test until bundler merge.
- **S11.1 RX SPSC visibility**: verify producer/consumer index ownership on Cortex-M.
- **S11.1 setter contract**: setter true ⇒ final value already at `param->address`.
- **Embedded Memory Pass**: `SL_TX_QUEUE_DEPTH` 2/4/8 + RAM report.

## Frozen roadmap (do not implement out of order)

### S13 Unified Runtime Sources ← current

SWD variable → Channel → SeriesStore → Plot. Same plot as UART telemetry.
Central poll scheduler (not per-var timers). SessionClock timestamps.
Stable id: ELF identity + symbol, never bare RAM address.
Stop and wait for review after S13.

### S14 Code-Aware Runtime Debug

Source hover/edit/watch/plot via ELF/DWARF. Fixed-address objects only in v1.
Depends on S13 channel identity.

### S15 Experiment Session

Record firmware hash + telemetry + SWD + parameter edits. Replay without writes.

### After S13–S15

README / GIF / Release / Marketplace / resume — do not pile CAN/FFT/3D.
