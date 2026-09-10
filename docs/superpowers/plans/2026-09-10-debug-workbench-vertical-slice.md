# Debug Workbench First Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first Qt 6 desktop application that receives simulated or COM5/115200 JustFloat data, displays bounded raw terminal data and real-time plots, and records raw traffic without GUI or disk stalls blocking acquisition.

**Architecture:** Three ownership domains isolate the GUI, I/O plus decoding, and SQLite recording. Raw `RxChunk` data fans out to a bounded terminal buffer, a non-blocking recorder queue, and the JustFloat decoder; decoded batches enter a bounded telemetry store that plots query at a fixed refresh rate.

**Tech Stack:** C++20, CMake 4.x, Ninja, Qt 6.11.x Widgets/Core/SerialPort/Sql/Test, MinGW-w64 13.1 matching the Qt package, SQLite through QtSql, GitHub Actions Windows CI.

## Global Constraints

- License all original repository code under MPL-2.0.
- Support and test Windows 10 and Windows 11 first; keep non-UI core interfaces portable.
- Use Qt 6 Widgets through the LGPLv3 dynamic-linking path and include required notices before binary distribution.
- Do not link Qt Graphs, Qwt, QCustomPlot, or another plotting library in this slice.
- Use a repository-owned `QPainter` plot backend behind `IPlotBackend`.
- Use three ownership domains only: GUI, I/O plus decode, and recorder.
- Never block the I/O path on GUI rendering or disk writes.
- Never emit one Qt signal per decoded sample; transfer batches.
- Use monotonic nanoseconds relative to Session start for ordering.
- Use stable channel paths `justfloat.ch0` through `justfloat.chn`; aliases are presentation metadata.
- Default telemetry history is 60 seconds, terminal presentation storage is 4 MiB, and recorder queue capacity is 16 MiB.
- Warn at 70 percent recorder queue use and enter explicit `Degraded` state at overflow.
- Use SQLite rows for metadata and batched BLOB rows for raw traffic.
- Use COM5 at 115200 baud for the local hardware acceptance test.
- Exclude Native Debug Protocol, STM32 SDK, replay, control-plane features, plugins, scripts, advanced analysis, and additional transports.

---

## File Structure

```text
CMakeLists.txt                         Root configuration, Qt discovery, CTest
cmake/Warnings.cmake                  Compiler warning policy
LICENSE                               Unmodified MPL-2.0 license text
README.md                             Configure, build, run, and hardware-check commands
.github/workflows/windows.yml         Windows build and automated tests
core/model/types.h                    Time, raw chunk, sample, and channel value types
core/metrics/runtime_metrics.*        Thread-safe counters and snapshots
core/buffers/bounded_raw_buffer.*     Terminal presentation storage
core/buffers/raw_record_queue.*       Non-blocking recorder handoff
core/telemetry/telemetry_store.*      Bounded channel history and queries
core/telemetry/minmax_downsampler.*   Spike-preserving point reduction
transports/api/transport.*            Transport config, status, and interface
transports/synthetic/synthetic_transport.*  Deterministic JustFloat source
transports/serial/serial_transport.*  QSerialPort implementation
protocols/justfloat/justfloat_decoder.*     Chunked frame parser
storage/recorder/session_schema.*     SQL schema and row codecs
storage/recorder/raw_session_recorder.*    Recorder-thread SQLite writer
plotting/api/plot_backend.h           Renderer boundary
plotting/qpaint/qpaint_plot_backend.* QPainter implementation
apps/desktop/app_controller.*         Threads and data-flow wiring
apps/desktop/main_window.*            Dock layout and top-level actions
apps/desktop/widgets/terminal_widget.*     Bounded raw terminal view
apps/desktop/widgets/channel_browser.*    Channel list, aliases, and bindings
apps/desktop/widgets/plot_widget.*         Fixed-rate plot query and interaction
apps/desktop/widgets/metrics_widget.*      Runtime and recorder health
apps/desktop/workspace/workspace_document.* JSON persistence
apps/desktop/main.cpp                 Application entry point
tests/unit/                            Focused Qt Test executables
tests/integration/                     Pipeline and failure-injection tests
tests/performance/                     Soak runner and metrics output
docs/adr/                              Architecture decisions
docs/acceptance/com5-115200.md         Hardware procedure and evidence template
```

---

### Task 1: Build Baseline and Core Types

**Files:**
- Create: `CMakeLists.txt`
- Create: `cmake/Warnings.cmake`
- Create: `LICENSE`
- Create: `README.md`
- Create: `core/CMakeLists.txt`
- Create: `core/model/types.h`
- Create: `core/metrics/runtime_metrics.h`
- Create: `core/metrics/runtime_metrics.cpp`
- Create: `tests/CMakeLists.txt`
- Create: `tests/unit/test_runtime_metrics.cpp`
- Create: `docs/adr/001-product-scope-and-license.md`
- Create: `docs/adr/002-thread-ownership-and-backpressure.md`

**Interfaces:**
- Produces: `TimestampNs`, `RxChunk`, `ChannelPath`, `Sample`, `SampleBatch`, `RuntimeMetrics::snapshot()`.
- Consumes: Qt Core only.

- [ ] **Step 1: Install and verify the matching Qt toolchain**

Use `aqtinstall` 3.3.0 to query the exact archive and MinGW tool names before installation:

```powershell
py -m pip install aqtinstall==3.3.0
py -m aqt list-qt windows desktop --arch 6.11.2
py -m aqt list-tool windows desktop tools_mingw1310
```

Install `6.11.2 win64_mingw` and the single `qt.tools.win64_mingw1310` tool into `C:\Qt`:

```powershell
py -m aqt install-qt --outputdir C:\Qt windows desktop 6.11.2 win64_mingw
py -m aqt install-tool --outputdir C:\Qt windows desktop tools_mingw1310 qt.tools.win64_mingw1310
```

Verify `C:\Qt\6.11.2\mingw_64\bin\qmake.exe` and `C:\Qt\Tools\mingw1310_64\bin\g++.exe` exist.

- [ ] **Step 2: Write the failing metrics test**

```cpp
// tests/unit/test_runtime_metrics.cpp
#include <QtTest>
#include "core/metrics/runtime_metrics.h"

class RuntimeMetricsTest final : public QObject {
    Q_OBJECT
private slots:
    void snapshotContainsAccumulatedCounters() {
        RuntimeMetrics metrics;
        metrics.addRxBytes(12);
        metrics.addSamples(3);
        metrics.addDecoderError();
        const auto value = metrics.snapshot();
        QCOMPARE(value.rxBytes, quint64{12});
        QCOMPARE(value.samples, quint64{3});
        QCOMPARE(value.decoderErrors, quint64{1});
    }
};
QTEST_APPLESS_MAIN(RuntimeMetricsTest)
#include "test_runtime_metrics.moc"
```

- [ ] **Step 3: Create the root build and verify the test fails**

The root `CMakeLists.txt` must enable C++20, `AUTOMOC`, CTest, and find `Qt6 6.11 COMPONENTS Core Widgets SerialPort Sql Test`. Add `core` before `tests`.

```powershell
$env:Path = 'C:\Qt\Tools\mingw1310_64\bin;' + $env:Path
cmake -S . -B build -G Ninja -DCMAKE_PREFIX_PATH=C:\Qt\6.11.2\mingw_64 -DBUILD_TESTING=ON
cmake --build build
```

Expected: compilation fails because `RuntimeMetrics` is not defined.

- [ ] **Step 4: Implement the core types and atomic metrics**

```cpp
// core/model/types.h
#pragma once
#include <QByteArray>
#include <QString>
#include <QVector>
#include <cstdint>

using TimestampNs = std::uint64_t;
using ChannelPath = QString;

enum class Direction { Rx, Tx };

struct RxChunk {
    TimestampNs hostTimeNs{};
    std::uint64_t sequence{};
    QByteArray bytes;
};

struct Sample {
    TimestampNs timeNs{};
    ChannelPath path;
    double value{};
};

struct SampleBatch {
    QVector<Sample> samples;
};
```

`RuntimeMetrics` stores atomic counters and returns this plain value:

```cpp
struct RuntimeMetricsSnapshot {
    quint64 rxBytes{};
    quint64 txBytes{};
    quint64 samples{};
    quint64 frames{};
    quint64 decoderErrors{};
    quint64 terminalDroppedBytes{};
    quint64 recorderDroppedBytes{};
    quint64 transportSequence{};
    quint64 recorderQueueBytes{};
    quint64 recorderQueueHighWaterBytes{};
    double recorderQueuePercent{};
    double uiFps{};
};

class RuntimeMetrics final {
public:
    void addRxBytes(quint64 value);
    void addTxBytes(quint64 value);
    void addSamples(quint64 value);
    void addFrame();
    void addDecoderError();
    void addTerminalDroppedBytes(quint64 value);
    void addRecorderDroppedBytes(quint64 value);
    void setTransportSequence(quint64 value);
    void observeRecorderQueue(quint64 bytes, quint64 capacityBytes);
    void setUiFps(double value);
    RuntimeMetricsSnapshot snapshot() const;
};
```

All integer counters are atomic. Queue percent and UI FPS are written by their owning threads and copied into `snapshot()`.

- [ ] **Step 5: Add project metadata and run the baseline tests**

Add the unmodified MPL-2.0 text from `https://www.mozilla.org/MPL/2.0/` to `LICENSE`. Document local configure and test commands in `README.md`. Record the confirmed license/scope and thread rules in ADR-001 and ADR-002.

```powershell
cmake --build build
ctest --test-dir build --output-on-failure
```

Expected: `RuntimeMetricsTest` passes.

- [ ] **Step 6: Commit**

```powershell
git add CMakeLists.txt cmake LICENSE README.md core tests docs/adr
git commit -m "build: establish Qt workbench baseline"
```

---

### Task 2: Transport Interface and Deterministic Simulator

**Files:**
- Create: `transports/CMakeLists.txt`
- Create: `transports/api/transport.h`
- Create: `transports/synthetic/synthetic_transport.h`
- Create: `transports/synthetic/synthetic_transport.cpp`
- Create: `tests/unit/test_synthetic_transport.cpp`
- Modify: `CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `RxChunk`, `RuntimeMetrics`.
- Produces: `TransportConfig`, `TransportStatus`, `ITransport`, `SyntheticConfig`, `SyntheticTransport::makeFrame()` and batched `chunkReceived(RxChunk)` notifications.

```cpp
enum class SyntheticPattern { Sine, Step, Ramp, Noise, Spike };

struct SyntheticConfig {
    int channelCount{4};
    int framesPerSecond{100};
    int chunksPerFrame{1};
    quint32 seed{12345};
    SyntheticPattern pattern{SyntheticPattern::Sine};
};
```

- [ ] **Step 1: Write a failing deterministic-frame test**

```cpp
void SyntheticTransportTest::frameIsLittleEndianJustFloat() {
    const auto frame = SyntheticTransport::makeFrame({1.0F, -2.5F});
    QCOMPARE(frame.size(), 12);
    QCOMPARE(frame.right(4), QByteArray::fromHex("0000807f"));
    QCOMPARE(frame.left(8), QByteArray::fromHex("0000803f000020c0"));
}
```

- [ ] **Step 2: Define the interface and verify the test fails**

```cpp
enum class TransportStatus { Closed, Opening, Open, Error };

struct TransportConfig {
    QString endpoint;
    qint32 baudRate{115200};
};

class ITransport : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    ~ITransport() override = default;
public slots:
    virtual void open(const TransportConfig& config) = 0;
    virtual void close() = 0;
    virtual void write(QByteArray bytes) = 0;
signals:
    void chunkReceived(RxChunk chunk);
    void statusChanged(TransportStatus status, QString detail);
    void writeCompleted(TimestampNs timeNs, QByteArray bytes);
};

Q_DECLARE_METATYPE(RxChunk)
Q_DECLARE_METATYPE(TransportStatus)
```

Run `cmake --build build`. Expected: failure because the simulator implementation is absent.

- [ ] **Step 3: Implement deterministic patterns and timer-driven emission**

`SyntheticConfig` contains channel count, frames per second, chunks per frame, and a fixed seed. Generate sine, step, ramp, noise, and one periodic spike. `makeFrame()` uses `qToLittleEndian` or `memcpy` plus an explicit terminator; it must not reinterpret unaligned memory.

```cpp
class SyntheticTransport final : public ITransport {
    Q_OBJECT
public:
    explicit SyntheticTransport(SyntheticConfig config, QObject* parent = nullptr);
    static QByteArray makeFrame(const QVector<float>& values);
public slots:
    void open(const TransportConfig& config) override;
    void close() override;
    void write(QByteArray bytes) override;
};
```

The simulator assigns one monotonic timestamp and sequence per emitted `RxChunk`. Fragmentation must be deterministic for the same seed.

- [ ] **Step 4: Test chunking and run unit tests**

Add a test that configures two chunks per frame, gathers emitted chunks with `QSignalSpy`, concatenates them, and compares them with `makeFrame()`.

```powershell
cmake --build build
ctest --test-dir build -R SyntheticTransportTest --output-on-failure
```

- [ ] **Step 5: Commit**

```powershell
git add CMakeLists.txt transports tests
git commit -m "feat: add deterministic synthetic transport"
```

---

### Task 3: Serial Transport on Its Owning Thread

**Files:**
- Create: `transports/serial/serial_transport.h`
- Create: `transports/serial/serial_transport.cpp`
- Create: `tests/unit/test_serial_transport.cpp`
- Modify: `transports/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `ITransport`, `TransportConfig`, `RxChunk`, `RuntimeMetrics`.
- Produces: `SerialTransport`, which is moved to the I/O thread before `open()`.

- [ ] **Step 1: Write failing state-transition tests**

```cpp
void SerialTransportTest::invalidPortReportsErrorWithoutThrowing() {
    SerialTransport transport;
    QSignalSpy states(&transport, &ITransport::statusChanged);
    transport.open({QStringLiteral("__missing_port__"), 115200});
    QVERIFY(states.count() >= 1);
    QCOMPARE(states.last().at(0).value<TransportStatus>(), TransportStatus::Error);
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
cmake --build build
ctest --test-dir build -R SerialTransportTest --output-on-failure
```

Expected: compilation fails because `SerialTransport` does not exist.

- [ ] **Step 3: Implement QSerialPort ownership and reads**

Create `QSerialPort` as a child of `SerialTransport`, assert that open/close/write execute on `thread()`, and connect `readyRead` to one slot that drains `readAll()` into a single `RxChunk`. Use `QElapsedTimer` for Session-relative nanoseconds and monotonically increasing sequence values.

```cpp
class SerialTransport final : public ITransport {
    Q_OBJECT
public:
    explicit SerialTransport(QObject* parent = nullptr);
public slots:
    void open(const TransportConfig& config) override;
    void close() override;
    void write(QByteArray bytes) override;
private slots:
    void drainReadyRead();
    void handleError(QSerialPort::SerialPortError error);
};
```

Map `QSerialPort::SerialPortError` to `TransportStatus::Error`, except `NoError`. Never retry automatically. A later explicit `open()` is the manual reconnect path.

- [ ] **Step 4: Add ownership and close-idempotence tests**

Move the object to a `QThread`, invoke `close()` with a queued connection twice, and assert the last state is `Closed` with no warning or crash.

```powershell
cmake --build build
ctest --test-dir build -R SerialTransportTest --output-on-failure
```

- [ ] **Step 5: Commit**

```powershell
git add transports/serial transports/CMakeLists.txt tests
git commit -m "feat: add serial transport"
```

---

### Task 4: Bounded Raw Buffer and Terminal Widget

**Files:**
- Create: `core/buffers/bounded_raw_buffer.h`
- Create: `core/buffers/bounded_raw_buffer.cpp`
- Create: `apps/desktop/CMakeLists.txt`
- Create: `apps/desktop/widgets/terminal_widget.h`
- Create: `apps/desktop/widgets/terminal_widget.cpp`
- Create: `tests/unit/test_bounded_raw_buffer.cpp`
- Create: `tests/unit/test_terminal_widget.cpp`
- Modify: `CMakeLists.txt`
- Modify: `core/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `RxChunk`, `Direction`, `RuntimeMetrics`.
- Produces: `RawEntry`, `BoundedRawBuffer::append()`, `BoundedRawBuffer::snapshot()`, `TerminalWidget::appendEntries(QVector<RawEntry>)`.

```cpp
struct RawEntry {
    TimestampNs hostTimeNs{};
    quint64 sequence{};
    Direction direction{Direction::Rx};
    QByteArray bytes;
};

class BoundedRawBuffer final {
public:
    explicit BoundedRawBuffer(qsizetype limitBytes = 4 * 1024 * 1024);
    void append(RxChunk chunk, Direction direction);
    QVector<RawEntry> snapshot() const;
    qsizetype byteSize() const;
    quint64 droppedBytes() const;
};
```

- [ ] **Step 1: Write the failing eviction test**

```cpp
void BoundedRawBufferTest::evictsOldestBytesAndCountsThem() {
    BoundedRawBuffer buffer(8);
    buffer.append({1, 1, QByteArray("123456")}, Direction::Rx);
    buffer.append({2, 2, QByteArray("abcdef")}, Direction::Rx);
    QCOMPARE(buffer.byteSize(), qsizetype{8});
    QCOMPARE(buffer.droppedBytes(), quint64{4});
    QCOMPARE(buffer.snapshot().last().bytes, QByteArray("abcdef"));
}
```

- [ ] **Step 2: Verify the test fails**

Run `ctest --test-dir build -R BoundedRawBufferTest --output-on-failure`. Expected: build failure because the buffer is absent.

- [ ] **Step 3: Implement byte-bounded entries**

Use a `std::deque<RawEntry>` where `RawEntry` contains timestamp, sequence, direction, and bytes. Split or remove the oldest entry until the configured byte limit is respected. A single input larger than the limit keeps only its newest bytes and counts the removed prefix.

- [ ] **Step 4: Build the terminal presentation**

Use `QPlainTextEdit` in read-only mode, a Text/Hex mode selector, pause control, search field, EOL selector, command input, and an in-memory command history. A 30 Hz timer drains pending chunks from the widget's presentation queue in batches. Pausing stops rendering only.

```cpp
void TerminalWidgetTest::pauseDoesNotRejectIncomingChunks() {
    TerminalWidget widget(1024);
    widget.setPaused(true);
    widget.appendEntries({RawEntry{1, 1, Direction::Rx, QByteArray("abc")}});
    QCOMPARE(widget.bufferedByteCount(), qsizetype{3});
    QVERIFY(widget.toPlainTextForTest().isEmpty());
}
```

- [ ] **Step 5: Run tests and commit**

```powershell
cmake --build build
ctest --test-dir build -R "BoundedRawBufferTest|TerminalWidgetTest" --output-on-failure
git add CMakeLists.txt core apps tests
git commit -m "feat: add bounded raw terminal"
```

---

### Task 5: Non-Blocking Queue and Raw SQLite Recorder

**Files:**
- Create: `core/buffers/raw_record_queue.h`
- Create: `core/buffers/raw_record_queue.cpp`
- Create: `storage/CMakeLists.txt`
- Create: `storage/recorder/session_schema.h`
- Create: `storage/recorder/session_schema.cpp`
- Create: `storage/recorder/raw_session_recorder.h`
- Create: `storage/recorder/raw_session_recorder.cpp`
- Create: `tests/unit/test_raw_record_queue.cpp`
- Create: `tests/integration/test_raw_session_recorder.cpp`
- Modify: `CMakeLists.txt`
- Modify: `core/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: timestamped RX/TX raw records.
- Produces: `RawRecordQueue::tryPush()`, `RawSessionRecorder::start()`, `stop()`, `drainOnce()`, and `RecorderMetrics`.

```cpp
struct RawRecord {
    TimestampNs hostTimeNs{};
    Direction direction{Direction::Rx};
    quint64 sequence{};
    QByteArray bytes;
};

enum class RecorderQueueState { Healthy, Warning, Degraded };

struct RecorderOptions {
    qsizetype capacityBytes{16 * 1024 * 1024};
    int artificialDelayMs{};
};

struct RecorderMetrics {
    RecorderQueueState state{RecorderQueueState::Healthy};
    quint64 queueBytes{};
    quint64 highWaterBytes{};
    quint64 writtenBytes{};
    quint64 droppedBytes{};
    qint64 lastCommitAgeMs{};
};

class RawRecordQueue final {
public:
    explicit RawRecordQueue(qsizetype capacityBytes);
    bool tryPush(RawRecord record);
    QVector<RawRecord> tryPopBatch(qsizetype maxRecords, qsizetype maxBytes);
    RecorderQueueState state() const;
    quint64 droppedBytes() const;
};

class RawSessionRecorder final : public QObject {
    Q_OBJECT
public:
    RawSessionRecorder(RawRecordQueue* queue, RecorderOptions options);
public slots:
    void start(QString sessionPath);
    void drainOnce();
    void stop();
signals:
    void metricsChanged(RecorderMetrics metrics);
    void failed(QString detail);
};
```

- [ ] **Step 1: Write failing non-blocking capacity tests**

```cpp
void RawRecordQueueTest::overflowIsExplicit() {
    RawRecordQueue queue(8);
    QVERIFY(queue.tryPush({1, Direction::Rx, 1, QByteArray("1234")}));
    QVERIFY(queue.tryPush({2, Direction::Rx, 2, QByteArray("5678")}));
    QVERIFY(!queue.tryPush({3, Direction::Rx, 3, QByteArray("x")}));
    QCOMPARE(queue.droppedBytes(), quint64{1});
    QCOMPARE(queue.state(), RecorderQueueState::Degraded);
}
```

- [ ] **Step 2: Implement `tryPush` without waiting**

Protect the byte-counted queue with `QMutex::tryLock()`. If the lock is unavailable or capacity would be exceeded, return `false` and atomically increment dropped bytes. Report `Healthy`, `Warning`, or `Degraded` from 0–69, 70–99, or 100 percent/overflow.

- [ ] **Step 3: Define the database schema and failing persistence test**

```sql
CREATE TABLE session_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE raw_chunks(
  id INTEGER PRIMARY KEY,
  host_time_ns INTEGER NOT NULL,
  direction INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  bytes BLOB NOT NULL
);
CREATE INDEX raw_chunks_time ON raw_chunks(host_time_ns);
```

The test records three chunks, stops the writer, opens a separate read-only test connection, and verifies row count, ordered sequence values, and exact BLOB concatenation.

- [ ] **Step 4: Implement recorder-thread database ownership**

Create the named `QSqlDatabase` connection inside `RawSessionRecorder::start()` after the object has moved to the recorder thread. Drain up to 256 records or 1 MiB per transaction, whichever comes first. Commit at least once per second when data is pending. On SQL error, roll back, stop recording, preserve prior commits, and emit `failed(QString)`.

- [ ] **Step 5: Run recorder tests including injected delay**

Expose a test-only drain delay through constructor dependency `RecorderOptions::artificialDelayMs`. Verify that a 200 ms writer delay raises queue use while producer calls still return promptly.

```powershell
cmake --build build
ctest --test-dir build -R "RawRecordQueueTest|RawSessionRecorderTest" --output-on-failure
```

- [ ] **Step 6: Commit**

```powershell
git add CMakeLists.txt core/buffers storage tests
git commit -m "feat: record raw sessions asynchronously"
```

---

### Task 6: Incremental JustFloat Decoder

**Files:**
- Create: `protocols/CMakeLists.txt`
- Create: `protocols/justfloat/justfloat_decoder.h`
- Create: `protocols/justfloat/justfloat_decoder.cpp`
- Create: `tests/unit/test_justfloat_decoder.cpp`
- Modify: `CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: arbitrary `RxChunk` boundaries.
- Produces: `DecodeResult JustFloatDecoder::feed(const RxChunk&)`, channel paths, decoded `SampleBatch` values, and counted errors.

- [ ] **Step 1: Write table-driven failing parser tests**

```cpp
void JustFloatDecoderTest::handlesEverySplitPosition() {
    const QByteArray frame = QByteArray::fromHex("0000803f000020c00000807f");
    for (qsizetype split = 0; split <= frame.size(); ++split) {
        JustFloatDecoder decoder;
        auto first = decoder.feed({10, 1, frame.left(split)});
        auto second = decoder.feed({20, 2, frame.mid(split)});
        QCOMPARE(first.batches.size() + second.batches.size(), 1);
        const auto& batch = second.batches.isEmpty() ? first.batches.front() : second.batches.front();
        QCOMPARE(batch.samples.at(0).path, QStringLiteral("justfloat.ch0"));
        QCOMPARE(batch.samples.at(0).value, 1.0);
        QCOMPARE(batch.samples.at(1).value, -2.5);
    }
}
```

Add cases for two frames per chunk, empty payload, payload not divisible by four, channel-count changes, and pending input larger than 1 MiB without a terminator.

- [ ] **Step 2: Verify tests fail**

```powershell
cmake --build build
ctest --test-dir build -R JustFloatDecoderTest --output-on-failure
```

- [ ] **Step 3: Implement bounded delimiter parsing**

```cpp
struct DecodeResult {
    QVector<SampleBatch> batches;
    quint64 errors{};
};

class JustFloatDecoder final {
public:
    explicit JustFloatDecoder(qsizetype maxPendingBytes = 1024 * 1024);
    DecodeResult feed(const RxChunk& chunk);
    void reset();
    int channelCount() const;
private:
    QByteArray pending_;
    int channelCount_{-1};
    qsizetype maxPendingBytes_;
};
```

Find `QByteArray::fromHex("0000807f")`, remove one complete frame at a time, and decode each four-byte scalar using `qFromLittleEndian<quint32>` followed by `std::bit_cast<float>`. Assign the timestamp of the chunk that completes the frame.

- [ ] **Step 4: Run parser tests and commit**

```powershell
cmake --build build
ctest --test-dir build -R JustFloatDecoderTest --output-on-failure
git add CMakeLists.txt protocols tests
git commit -m "feat: decode incremental JustFloat streams"
```

---

### Task 7: Bounded Telemetry Store and Min Max Downsampling

**Files:**
- Create: `core/telemetry/minmax_downsampler.h`
- Create: `core/telemetry/minmax_downsampler.cpp`
- Create: `core/telemetry/telemetry_store.h`
- Create: `core/telemetry/telemetry_store.cpp`
- Create: `tests/unit/test_minmax_downsampler.cpp`
- Create: `tests/unit/test_telemetry_store.cpp`
- Modify: `core/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: `SampleBatch` keyed by stable `ChannelPath`.
- Produces: `TelemetryStore::append()`, `query()`, `paths()`, `historyRange()`, and `PlotData`.

```cpp
struct PlotPoint {
    TimestampNs timeNs{};
    double value{};
};

struct PlotData {
    ChannelPath path;
    QVector<PlotPoint> points;
};

QVector<PlotPoint> minMaxEnvelope(const QVector<PlotPoint>& input,
                                  qsizetype maxPoints);

class ITelemetryQuery {
public:
    virtual ~ITelemetryQuery() = default;
    virtual PlotData query(const ChannelPath& path,
                           TimestampNs beginNs,
                           TimestampNs endNs,
                           qsizetype maxPoints) const = 0;
};

class TelemetryStore final : public ITelemetryQuery {
public:
    explicit TelemetryStore(std::chrono::nanoseconds historyDuration);
    void append(SampleBatch batch);
    PlotData query(const ChannelPath& path,
                   TimestampNs beginNs,
                   TimestampNs endNs,
                   qsizetype maxPoints) const override;
    QStringList paths() const;
    QPair<TimestampNs, TimestampNs> historyRange(const ChannelPath& path) const;
};
```

- [ ] **Step 1: Write the failing spike-preservation test**

```cpp
void MinMaxDownsamplerTest::keepsNarrowSpike() {
    QVector<PlotPoint> input;
    for (int i = 0; i < 1000; ++i)
        input.push_back({TimestampNs(i), i == 501 ? 100.0 : 0.0});
    const auto output = minMaxEnvelope(input, 40);
    QVERIFY(output.size() <= 40);
    QVERIFY(std::any_of(output.cbegin(), output.cend(), [](const auto& p) {
        return p.value == 100.0;
    }));
}
```

- [ ] **Step 2: Implement deterministic bucket envelopes**

For each non-empty time bucket, emit minimum and maximum points in timestamp order. Preserve the first and last visible points. Return the original input when it already fits the point budget.

- [ ] **Step 3: Write the failing 60-second eviction test**

```cpp
void TelemetryStoreTest::historyIsBoundedByTime() {
    TelemetryStore store(std::chrono::seconds(60));
    store.append(makeSingleChannelBatch("justfloat.ch0", 0, 0.0));
    store.append(makeSingleChannelBatch("justfloat.ch0", 61'000'000'000ULL, 1.0));
    const auto data = store.query("justfloat.ch0", 0, 70'000'000'000ULL, 100);
    QCOMPARE(data.points.size(), 1);
    QCOMPARE(data.points.front().value, 1.0);
}
```

Define the test helper in the same file:

```cpp
SampleBatch makeSingleChannelBatch(const ChannelPath& path,
                                   TimestampNs timeNs,
                                   double value) {
    return SampleBatch{{Sample{timeNs, path, value}}};
}
```

- [ ] **Step 4: Implement block-based channel storage**

Use fixed-capacity blocks of 4096 timestamps and values per channel. Guard store mutation and snapshot queries with `QReadWriteLock`; hold the read lock only while copying the requested range, then downsample outside the lock. Evict complete old blocks and trim the first surviving block when its leading points are outside the history window.

- [ ] **Step 5: Run tests and commit**

```powershell
cmake --build build
ctest --test-dir build -R "MinMaxDownsamplerTest|TelemetryStoreTest" --output-on-failure
git add core/telemetry core/CMakeLists.txt tests
git commit -m "feat: add bounded telemetry store"
```

---

### Task 8: QPainter Plot Backend and Fixed Rate Plot Widget

**Files:**
- Create: `plotting/CMakeLists.txt`
- Create: `plotting/api/plot_backend.h`
- Create: `plotting/qpaint/qpaint_plot_backend.h`
- Create: `plotting/qpaint/qpaint_plot_backend.cpp`
- Create: `apps/desktop/widgets/plot_widget.h`
- Create: `apps/desktop/widgets/plot_widget.cpp`
- Create: `tests/unit/test_plot_widget.cpp`
- Modify: `CMakeLists.txt`
- Modify: `apps/desktop/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: bounded `PlotData` queries from `TelemetryStore`.
- Produces: `IPlotBackend::paint()`, `QPainterPlotBackend`, and Plot zoom/pan/pause/cursor behavior.

- [ ] **Step 1: Write a failing fixed-refresh test**

Inject an `ITelemetryQuery` test double that counts queries:

```cpp
class FakeTelemetryQuery final : public ITelemetryQuery {
public:
    PlotData query(const ChannelPath& path, TimestampNs, TimestampNs,
                   qsizetype maxPoints) const override {
        ++queries_;
        lastMaxPoints_ = maxPoints;
        return {path, {}};
    }
    void simulateStoreAppend(int sampleCount) { simulatedSamples_ += sampleCount; }
    int queryCount() const { return queries_; }
private:
    mutable int queries_{};
    mutable qsizetype lastMaxPoints_{};
    int simulatedSamples_{};
};

class FakePlotBackend final : public IPlotBackend {
public:
    void paint(QPainter&, const QRectF&, const PlotFrame&) override { ++paintCount; }
    int paintCount{};
};

void PlotWidgetTest::samplesDoNotTriggerPaintOrQuery() {
    FakeTelemetryQuery query;
    PlotWidget widget(&query, std::make_unique<FakePlotBackend>());
    widget.bindChannel(QStringLiteral("justfloat.ch0"));
    query.simulateStoreAppend(1000);
    QCOMPARE(query.queryCount(), 0);
    QTest::qWait(40);
    QVERIFY(query.queryCount() >= 1);
    QVERIFY(query.queryCount() <= 3);
}
```

- [ ] **Step 2: Define the rendering boundary**

```cpp
struct PlotSeriesFrame {
    ChannelPath path;
    QString displayName;
    QColor color;
    QVector<PlotPoint> points;
};

struct PlotFrame {
    TimestampNs beginNs{};
    TimestampNs endNs{};
    QVector<PlotSeriesFrame> series;
    std::optional<TimestampNs> cursorNs;
};

class IPlotBackend {
public:
    virtual ~IPlotBackend() = default;
    virtual void paint(QPainter& painter, const QRectF& area, const PlotFrame& frame) = 0;
};

class QPainterPlotBackend final : public IPlotBackend {
public:
    void paint(QPainter& painter, const QRectF& area,
               const PlotFrame& frame) override;
};

class PlotWidget final : public QWidget {
    Q_OBJECT
public:
    PlotWidget(ITelemetryQuery* query,
               std::unique_ptr<IPlotBackend> backend,
               QWidget* parent = nullptr);
    void bindChannel(ChannelPath path);
    void setChannelVisible(const ChannelPath& path, bool visible);
    void setPaused(bool paused);
};
```

- [ ] **Step 3: Implement PlotWidget state and bounded queries**

Use one `QTimer` with an initial 16 ms interval. Each tick queries only visible channels with `maxPoints = max(2 * plotPixelWidth, 256)`. Pause freezes `endNs`; it does not unsubscribe or change the store. Wheel zoom and drag pan only modify the visible time range.

- [ ] **Step 4: Implement QPainter rendering and interaction tests**

Draw axes, grid, paths, current/min/max labels, and cursor values. Clip all data paths to the plot rectangle. Test that hidden channels are not queried, pause keeps the same range, and resizing changes `maxPoints`.

```powershell
cmake --build build
ctest --test-dir build -R PlotWidgetTest --output-on-failure
```

- [ ] **Step 5: Commit**

```powershell
git add CMakeLists.txt plotting apps/desktop/widgets tests
git commit -m "feat: add bounded real-time plotting"
```

---

### Task 9: Workspace, Main Window, Metrics, and Thread Wiring

**Files:**
- Create: `apps/desktop/workspace/workspace_document.h`
- Create: `apps/desktop/workspace/workspace_document.cpp`
- Create: `apps/desktop/widgets/channel_browser.h`
- Create: `apps/desktop/widgets/channel_browser.cpp`
- Create: `apps/desktop/widgets/metrics_widget.h`
- Create: `apps/desktop/widgets/metrics_widget.cpp`
- Create: `apps/desktop/app_controller.h`
- Create: `apps/desktop/app_controller.cpp`
- Create: `apps/desktop/main_window.h`
- Create: `apps/desktop/main_window.cpp`
- Create: `apps/desktop/main.cpp`
- Create: `tests/unit/test_workspace_document.cpp`
- Create: `tests/integration/test_app_controller.cpp`
- Modify: `apps/desktop/CMakeLists.txt`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: all transport, decoder, store, recorder, terminal, plotting, and metrics interfaces.
- Produces: runnable `debug-workbench.exe`, workspace JSON, and enforced thread topology.

```cpp
struct PlotBinding {
    QString plotId;
    QStringList channelPaths;
    bool operator==(const PlotBinding&) const = default;
};

struct WorkspaceState {
    TransportConfig connection{QStringLiteral("COM5"), 115200};
    QHash<ChannelPath, QString> aliases;
    QHash<ChannelPath, QString> units;
    QVector<PlotBinding> plotBindings;
    int historySeconds{60};
    qsizetype terminalLimitBytes{4 * 1024 * 1024};
    qsizetype recorderCapacityBytes{16 * 1024 * 1024};
    QByteArray dockState;
    bool operator==(const WorkspaceState&) const = default;
};

class WorkspaceDocument final {
public:
    static QByteArray encode(const WorkspaceState& state);
    static WorkspaceState decode(const QByteArray& json);
    static WorkspaceState load(const QString& path);
    static void save(const QString& path, const WorkspaceState& state);
};

class AppController final : public QObject {
    Q_OBJECT
public:
    explicit AppController(QObject* parent = nullptr);
    void startSynthetic(const SyntheticConfig& config);
    void startSerial(const TransportConfig& config);
    void startRecording(const QString& sessionPath);
    void stopRecording();
    bool shutdown(std::chrono::seconds deadline = std::chrono::seconds(5));
    TelemetryStore* telemetryStore();
signals:
    void terminalEntriesReady(QVector<RawEntry> entries);
    void transportStatusChanged(TransportStatus status, QString detail);
    void metricsChanged(RuntimeMetricsSnapshot metrics);
};
```

- [ ] **Step 1: Write the failing workspace round-trip test**

```cpp
void WorkspaceDocumentTest::roundTripsStablePathsAndComProfile() {
    WorkspaceState input;
    input.connection = {QStringLiteral("COM5"), 115200};
    input.aliases.insert(QStringLiteral("justfloat.ch0"), QStringLiteral("target"));
    input.units.insert(QStringLiteral("justfloat.ch0"), QStringLiteral("rpm"));
    input.plotBindings = {{QStringLiteral("plot-1"), {QStringLiteral("justfloat.ch0")}}};
    const QByteArray json = WorkspaceDocument::encode(input);
    const auto output = WorkspaceDocument::decode(json);
    QCOMPARE(output, input);
}
```

- [ ] **Step 2: Implement versioned JSON and atomic file saves**

Use schema version `1`, reject a missing or unsupported version with a descriptive error, and save through `QSaveFile`. Encode the Qt dock state as Base64. Defaults are COM5, 115200 baud, 60-second history, 4 MiB terminal limit, and 16 MiB recorder queue.

- [ ] **Step 3: Write the failing thread-isolation integration test**

Start `AppController` with a synthetic transport and injected recorder delay. Capture thread IDs for transport callbacks, recorder drains, and GUI batch delivery. Assert the three owners differ and that 500 ms of blocked GUI event processing does not stop the transport sequence counter.

- [ ] **Step 4: Implement AppController wiring**

Create one I/O `QThread` and one recorder `QThread`. Move the chosen transport and decoder worker to I/O; move the recorder to recorder. Fan each `RxChunk` to:

1. `RawRecordQueue::tryPush()` immediately.
2. A GUI `RawEntry` delivery batch accumulated for at most 33 ms.
3. `JustFloatDecoder::feed()`, followed by one store append per decoded batch.

When `writeCompleted()` reports accepted TX bytes, create a `Direction::Tx` raw record for both the recorder queue and the terminal batch. RX and TX sequence counters are independent and monotonic.

Shutdown order is: stop transport, flush/stop recorder with a five-second deadline, quit recorder thread, quit I/O thread, then destroy widgets. A recorder timeout produces a visible failure and does not hang application exit.

- [ ] **Step 5: Build the confirmed main-window layout**

Implement the connection/record toolbar, left channel dock, central plot area, lower terminal dock, and metrics status area. Dragging or assigning a channel stores its stable path. Connect/Disconnect and Start/Stop Recording actions are disabled when their state transition is invalid.

- [ ] **Step 6: Run focused and full tests**

```powershell
cmake --build build
ctest --test-dir build -R "WorkspaceDocumentTest|AppControllerTest" --output-on-failure
ctest --test-dir build --output-on-failure
```

- [ ] **Step 7: Commit**

```powershell
git add apps tests
git commit -m "feat: assemble debug workbench desktop slice"
```

---

### Task 10: Soak Harness, Windows CI, Deployment Notes, and COM5 Acceptance

**Files:**
- Create: `tests/performance/soak_main.cpp`
- Create: `tests/integration/test_pipeline_faults.cpp`
- Create: `.github/workflows/windows.yml`
- Create: `docs/acceptance/com5-115200.md`
- Create: `docs/licenses/qt-lgpl-compliance.md`
- Modify: `README.md`
- Modify: `tests/CMakeLists.txt`

**Interfaces:**
- Consumes: complete application pipeline.
- Produces: reproducible 30-minute simulator soak command, Windows CI, license checklist, and hardware evidence procedure.

- [ ] **Step 1: Write failing fault-injection assertions**

Configure deterministic fragmentation, one invalid-length frame every 100 valid frames, 200 ms recorder delays, and a 500 ms GUI stall. Assert:

```cpp
struct SoakSummary {
    quint64 expectedChunks{};
    quint64 transportSequence{};
    quint64 decoderErrors{};
    quint64 recorderQueueHighWaterBytes{};
    quint64 acceptedBytes{};
    quint64 recordedBytes{};
    quint64 explicitDroppedBytes{};
};

QCOMPARE(summary.transportSequence, summary.expectedChunks);
QCOMPARE(summary.decoderErrors, expectedInvalidFrames);
QVERIFY(summary.recorderQueueHighWaterBytes > 0);
QVERIFY(summary.recorderQueueHighWaterBytes <= options.recorderCapacityBytes);
QCOMPARE(summary.acceptedBytes,
         summary.recordedBytes + summary.explicitDroppedBytes);
```

The harness reports unreported loss as accepted input minus committed raw bytes minus explicit recorder dropped bytes; that value must be zero.

- [ ] **Step 2: Implement the parameterized soak executable**

Support:

```text
debug-workbench-soak --duration 00:30:00 --channels 8 --frames-per-second 400 \
  --fragment-seed 12345 --history-seconds 60 --session soak.session
```

Emit one JSON summary containing duration, accepted bytes, recorded bytes, explicit dropped bytes, frames, samples, decoder errors, maximum queue depth, maximum RSS, and pass/fail reasons. Exit nonzero for unreported loss, unbounded growth, SQL errors, or a stuck pipeline.

- [ ] **Step 3: Run a short local fault test, then the 30-minute soak**

```powershell
cmake --build build
ctest --test-dir build -R PipelineFaultsTest --output-on-failure
build\tests\performance\debug-workbench-soak.exe --duration 00:30:00 --channels 8 --frames-per-second 400 --fragment-seed 12345 --history-seconds 60 --session build\soak.session
```

Expected: exit code 0 and `acceptedBytes == recordedBytes + explicitDroppedBytes`.

- [ ] **Step 4: Add Windows CI with pinned tool versions**

The workflow uses `windows-latest`, Python, `aqtinstall==3.3.0`, Qt `6.11.2 win64_mingw`, and `tools_mingw1310/qt.tools.win64_mingw1310`, followed by CMake configure, build, and CTest. Cache only the downloaded Qt archive directory, not build outputs or Session databases. Run the short fault test in CI; keep the 30-minute soak as a manual workflow dispatch and local release gate.

- [ ] **Step 5: Document and perform COM5/115200 acceptance**

`docs/acceptance/com5-115200.md` contains this exact procedure:

1. Connect the STM32 device as COM5 at 115200, 8-N-1, no flow control.
2. Select JustFloat and leave channel count in auto-detect mode.
3. Start a new Session and run for ten minutes.
4. During minute three, zoom and pan continuously for 30 seconds.
5. During minute five, pause the Plot for 30 seconds while observing RX and recorder counters.
6. Stop recording and record RX bytes, recorded bytes, explicit dropped bytes, decoder errors, maximum recorder queue, minimum UI FPS, and Session path.
7. Pass only when Terminal, Plot, and Recorder remain responsive, RX continues during Plot interaction, and all loss is zero or explicitly reported.

- [ ] **Step 6: Verify LGPL deployment obligations are documented**

Document dynamic Qt linking, required Qt LGPLv3 text and copyright notices, corresponding Qt source offer/location, relinking rights, and third-party notices. Run `windeployqt` into a disposable staging directory and verify that no Qt Graphs library is present.

- [ ] **Step 7: Run the final verification and commit**

```powershell
cmake --build build
ctest --test-dir build --output-on-failure
git diff --check
git status --short
git add .github README.md tests docs
git commit -m "test: add soak ci and hardware acceptance"
```

Expected: automated tests pass; the only allowed uncommitted files are ignored local build, Session, and visualization artifacts.
