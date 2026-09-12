# Backlog

## Architecture debt

- **Unify DisplayRing**: `src/store/displayRing.ts` (TS, tested) and `src/webview/media/main.js` (hand-rolled JS) can drift. Prefer one shared source or a bundler step; keep `webviewDisplayRing.api.test.ts` until then.
- **COM port in workspace settings**: `saveConnection` writes `serialLab.connection` into `.vscode/settings.json` and dirties git. Move machine-local path/baud to `workspaceState` / globalState; project file (`.seriallab.json`) should not pin COMx.

## Next (post S7 freeze)

- S8 Channel Identity (stable id/path vs displayName)
- S9 `.seriallab.json` + JSON Schema (priority: file > workspace > user > defaults)
- S10 Session Recorder (disk, non-blocking)
- S11 Replay
