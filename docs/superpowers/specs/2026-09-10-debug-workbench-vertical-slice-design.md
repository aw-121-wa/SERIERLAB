# Embedded Debug Workbench First Vertical Slice Design

## 1 Purpose

This specification defines the first runnable vertical slice of an open-source embedded debugging workbench for STM32 and robotics development. The slice validates the product's most important architectural boundary: serial acquisition, terminal display, telemetry decoding, recording, storage, and plotting must work together without the GUI or disk blocking data reception.

The working product name is **Debug Workbench**. The repository is licensed under **MPL-2.0**. The first supported and tested platform is **Windows 10 and Windows 11**, while the core interfaces avoid Windows-specific dependencies so Linux and macOS can be added later.

This design implements the first slice recommended by `embedded_debug_workbench_project_plan_v0.1.docx`. It is not the complete V0.1 described by that source plan.

## 2 Confirmed Technology Decisions

- Language and build: C++20, CMake, and Ninja.
- Desktop framework: Qt 6 Widgets using the open-source LGPLv3 distribution and dynamic linking.
- Project license: MPL-2.0.
- Compiler on Windows: the compiler bundled for the selected official Qt package; the first installation should use Qt's matching MinGW-w64 toolchain to avoid ABI mismatches with the unrelated Scoop GCC already installed.
- Plotting: a minimal in-repository `QPainter` implementation behind `IPlotBackend`.
- Tests: CTest and Qt Test.
- Session storage: SQLite metadata and batched binary BLOB chunks.
- Initial real-device profile: COM5 at 115200 baud.
- Initial closed-loop test source: an in-process synthetic device simulator.

Qt Widgets is available under Qt's LGPLv3 open-source licensing path. Qt Graphs is not selected because Qt lists it among modules available under GPLv3 rather than LGPLv3 for open-source use. The implementation must ship the notices and relinking materials required by the selected Qt distribution before a public binary release.

## 3 Scope

### 3.1 Included in the first slice

- Select and connect either a synthetic source or a serial port.
- Configure a serial port and persist the COM5 at 115200 profile.
- Display raw RX data in a bounded Terminal view.
- Decode VOFA+ JustFloat frames containing little-endian `float32` values followed by `00 00 80 7F`.
- Generate `CH0` through `CHn` after the first valid frame and allow aliases and units to be saved.
- Store recent telemetry in bounded memory.
- Plot multiple channels with zoom, pan, autoscale, pause, cursor, current value, minimum, and maximum.
- Refresh plots at a fixed GUI rate and query at most the number of points needed for the visible width.
- Record raw RX and TX chunks to a Session database on a dedicated recorder thread.
- Display receive rate, sample rate, decoder errors, recorder queue depth, dropped display bytes, and UI FPS.
- Save and restore the connection profile, channel presentation metadata, plot bindings, and Qt dock layout.

### 3.2 Explicitly excluded

- Native Debug Protocol and device self-description.
- Parameter, command, event, and time-synchronization control planes.
- STM32 SDK and reference firmware.
- Session replay and raw re-decoding.
- CAN, Modbus, BLE, HID, TCP, UDP, and WebSocket transports.
- Public plugins, scripting, FFT, filters, expressions, 3D views, and robot-specific widgets.
- Automatic infinite serial reconnection.

These exclusions are subsequent gates. They must not be introduced while implementing this slice.

## 4 Architecture

The application uses three thread ownership domains:

1. **GUI thread** owns widgets, workspace state, fixed-rate plot refresh, and presentation-only buffers.
2. **I/O and decode thread** owns the active transport, timestamps incoming raw chunks, parses JustFloat frames, and appends decoded batches to the telemetry store.
3. **Recorder thread** owns SQLite and consumes raw record batches from a bounded queue.

The normal data path is:

```text
SyntheticTransport or SerialTransport
  -> RxChunk(host_time_ns, sequence, bytes)
     -> bounded raw-record queue -> RawSessionRecorder
     -> bounded Terminal RawBuffer -> TerminalWidget
     -> JustFloatDecoder -> SampleBatch -> TelemetryStore
                                      <- PlotWidget query at 30 to 60 Hz
```

The GUI never owns or directly calls `QSerialPort`. SQLite is never used from the GUI or transport hot path. Individual samples never produce individual Qt signals.

## 5 Components and Interfaces

### 5.1 Core model

The core model defines `TimestampNs`, `RxChunk`, `ChannelPath`, `Sample`, `SampleBatch`, and `RuntimeMetrics`. Host receive timestamps use a monotonic clock relative to the Session start. Wall-clock time is presentation metadata only.

`ChannelPath` is the stable workspace identity. JustFloat initially creates paths `justfloat.ch0` through `justfloat.chn`; aliases such as `target` affect presentation but do not replace the stable path.

### 5.2 Transport

`ITransport` exposes asynchronous open, close, write, received-chunk, status, and error operations without protocol knowledge.

`SyntheticTransport` generates deterministic sine, step, ramp, noise, and spike patterns. It supports configurable channel count, frame rate, chunk fragmentation, and error injection so automated tests can reproduce failures.

`SerialTransport` wraps `QSerialPort` entirely within the I/O thread. It supports explicit open and close, error reporting, byte counters, and writes. The first slice reports disconnection and allows a manual reconnect; it does not run an unbounded retry loop.

### 5.3 JustFloat decoder

The decoder consumes arbitrary byte chunks and searches for the four-byte terminator `00 00 80 7F`. A valid payload is non-empty and divisible by four. Values are decoded as little-endian IEEE 754 `float32`.

The first valid frame establishes the channel count. A later frame with a different payload length is rejected, increments `decoder_errors`, and does not enter the telemetry store. Re-selecting or resetting the protocol clears the established channel count.

The parser preserves incomplete frames between chunks, handles multiple frames in one chunk, and bounds its pending buffer so an absent terminator cannot grow memory without limit.

### 5.4 Telemetry store and downsampling

Each channel stores time and double-precision values in bounded blocks. The default live-history window is 60 seconds and is configurable in the workspace.

Plot queries specify a channel path, time range, and `max_points`. When the source data exceeds the point budget, the store returns a min/max envelope per time bucket so narrow spikes remain visible. Hidden curves are not queried.

### 5.5 Raw terminal buffer

The terminal buffer holds a bounded quantity of raw bytes and derived text lines. The default presentation limit is 4 MiB. When full, it removes the oldest display data and increments `terminal_dropped_bytes`; recording is unaffected.

The first slice provides Text and Hex display modes, RX and TX direction, monotonic timestamps, pause, search, EOL selection, and command history.

### 5.6 Session recorder

SQLite stores ordinary rows for Session metadata and batched BLOB rows for raw chunks. Each raw record contains timestamp, direction, sequence, and bytes. Transactions are committed in batches rather than once per chunk.

The record queue is bounded by bytes. Its default capacity is 16 MiB, with warning and degraded thresholds at 70 percent and 100 percent. The recorder exposes queue depth, write rate, last commit age, written bytes, and dropped bytes.

### 5.7 Plot backend

`IPlotBackend` separates plot data and interaction from rendering. The first implementation uses `QPainter` and draws only data returned by bounded `TelemetryStore` queries.

The plot supports multiple curves, zoom, pan, autoscale, pause, cursor inspection, current value, visible minimum, and visible maximum. A timer drives refresh at a configurable 30 to 60 Hz. Pause stops view advancement but does not stop decoding or recording.

### 5.8 Workspace and desktop shell

The main window uses `QMainWindow` and `QDockWidget`:

- A top connection toolbar selects Simulator or COM port, baud rate, connect or disconnect, and recording state.
- A left dock lists JustFloat channels, aliases, units, and plot assignments.
- The central area contains one or more plots.
- A lower dock contains the Terminal.
- A status area shows runtime and recorder metrics.

Workspace files save the connection profile, selected protocol, channel aliases and units, plot bindings, live-history duration, terminal limit, and Qt window state. They do not save live telemetry history or redefine device-side schema.

## 6 Backpressure and Error Handling

- The I/O thread never waits for the GUI or disk.
- Terminal presentation overflow drops the oldest display data and increments a visible counter.
- At 70 percent recorder queue use, the UI shows a warning. At overflow, the recorder enters an explicit `Degraded` state and increments dropped-byte counters.
- A recorder write error stops recording, preserves already committed transactions, and reports the failure. Acquisition and live plotting continue.
- A partial JustFloat frame remains buffered. Invalid or inconsistent frames are discarded, counted, and parsing resumes at a later terminator.
- The decoder's pending byte buffer, terminal buffer, recorder queue, and telemetry history all have explicit bounds.
- Serial open, read, write, and disconnect failures update `TransportStatus`, append an error entry, and keep the application responsive.
- GUI stalls may reduce displayed frame rate but do not stop acquisition or recording.

## 7 Testing Strategy

### 7.1 Unit tests

CTest runs Qt Test executables covering:

- JustFloat frames split at every byte boundary.
- Multiple frames in one chunk.
- Invalid payload lengths and channel-count changes.
- Decoder pending-buffer bounds.
- Terminal buffer eviction and counters.
- Telemetry history eviction.
- Min/max envelope preservation of spikes.
- Recorder batch encoding and transaction recovery.
- Workspace round trips for stable channel paths and layout metadata.

### 7.2 Integration and fault injection

An integration harness runs:

```text
SyntheticTransport -> RxChunk -> Recorder and Decoder -> TelemetryStore -> plot query
```

It injects 200 ms recorder delays, a 500 ms GUI-thread pause, arbitrary raw-chunk fragmentation, invalid frames, and transport disconnects. Tests verify that each bounded queue reports its state and that acquisition does not block on slower consumers.

### 7.3 Acceptance checks

1. Run the deterministic simulator continuously for 30 minutes. No unreported acquisition or decoder loss is allowed; bounded buffers and telemetry history must remain within configured limits.
2. With recording enabled, the raw bytes committed to the Session plus explicitly reported dropped bytes must equal bytes accepted from the simulator.
3. Display eight visible curves and record FPS, CPU, and memory baselines. Interaction must remain responsive; this slice records the baseline rather than claiming a hardware-independent FPS guarantee.
4. During injected recorder and GUI stalls, the I/O path continues and all pressure or loss is visible in runtime metrics.
5. Connect COM5 at 115200 baud for ten minutes. Terminal, Plot, and Recorder must operate simultaneously, and zooming, panning, or pausing the Plot must not stop receive or record activity.
6. Windows CI configures the project, builds it, and runs all automated tests without attached hardware. The COM5 check remains an explicit local hardware acceptance step.

## 8 Delivery Sequence

The slice is delivered in independently testable increments:

1. Repository, MPL-2.0 license, Qt/CMake build, CI, and architecture records.
2. Core types, metrics, and deterministic simulator.
3. Transport interface and serial implementation.
4. Raw terminal buffer and Terminal UI.
5. Raw Session schema and asynchronous recorder.
6. JustFloat decoder and channel discovery.
7. Bounded telemetry store and min/max downsampling.
8. `QPainter` plot backend and central Plot UI.
9. Workspace persistence and runtime metrics UI.
10. Full simulator soak test and COM5 hardware acceptance.

The implementation plan must use test-driven steps and keep commits aligned with these increments.

## 9 Source and License References

- User-supplied product plan: `C:/Users/lovec/Downloads/embedded_debug_workbench_project_plan_v0.1.docx`.
- Qt licensing: <https://doc.qt.io/qt-6/licensing.html>.
- Qt supported Windows configurations: <https://doc.qt.io/qt-6/supported-platforms.html>.
- MPL-2.0 license text: <https://www.mozilla.org/MPL/2.0/>.

