# SWD Parameters Implementation Plan

**Goal:** Add running RAM parameter control through DAPLink without removing Native.
**Architecture:** Independent SWD controller, serialized stdio RPC, Python ELF/pyOCD backend, shared parameter presentation with explicit source.
**Tech Stack:** TypeScript, Python 3, pyOCD, pyelftools, vitest, unittest.

## Tasks
- [x] Write failing helper tests for types, bounds, ELF symbols, target RAM restrictions and write verification. Implement `scripts/swd_backend.py` and `scripts/requirements-swd.txt`.
- [x] Write failing RPC tests for response framing, errors, exit and timeout. Implement `src/swd/client.ts` using spawn without a shell and finite request deadlines.
- [x] Implement `src/swd/controller.ts`: config snapshot, connect, watch state, serialized polling, errors and cleanup. Add source-aware parameter messages and controls. Repair Native protocol selection and connection cleanup.
- [x] Document setup and configuration, limits and firmware requirements. Run Python tests, all vitest tests, TypeScript compilation, JS syntax checks and VSIX packaging. Inspect package contents and changes.

Validation: 220 vitest tests, 9 Python unittest tests (including compiled ARM ELF), TypeScript compilation, JS syntax, diff check and VSIX contents passed. Independent review found a connection race; regression tests reproduced it and the fix was re-reviewed. `serial-lab-0.2.22.vsix` packaged successfully. Python 3.11.7 imports pyOCD 0.45.1; default Python 3.14 needs compatible USB dependencies. Physical board behavior is not yet verified.

## Invariants
Never halt/reset/program/unlock; never infer scalar type from symbol size alone. ELF and target RAM checks precede memory writes. No writes on connect or refresh. Invalid/missing dependencies produce actionable errors. Requests use session/source identity; disconnect invalidates stale operations. No overlapping polling, default 5 Hz and bounded watch list. Preserve Native SDK and wire protocol.
