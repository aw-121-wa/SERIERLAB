# Backlog

## Architecture debt

- **Unify DisplayRing**: `src/store/displayRing.ts` (TS, tested) and `src/webview/media/main.js` (hand-rolled JS) can drift. Prefer one shared source or a bundler step; keep `webviewDisplayRing.api.test.ts` until then.
- **COM port in workspace settings**: saveConnection no longer writes path (S9), but legacy `serialLab.connection.path` may remain in user settings files.
- **S11.1 RX SPSC visibility**: document/verify ISR producer vs `sl_process` consumer index ownership; consider `_Atomic`/barriers before Cortex-M bring-up.
- **S11.1 setter contract**: setter returning true MUST have written final value to `param->address` before return (ACK read-back).
- **Embedded Memory Pass**: `SL_TX_QUEUE_DEPTH` 2/4/8; report RAM for small/default/high-throughput.

## Roadmap (updated)

- S8–S11 done (identity, project config, native host, C SDK)
- S12 Parameter Inspector UI ← current
- S13 Command / Event
- S14 Session Recorder
- S15 Replay
- S16 SWD / ELF (optional later)
