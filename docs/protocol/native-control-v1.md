# SERIERLAB Native Runtime Control Protocol v1

Normative wire protocol for PC ↔ MCU control plane.  
TypeScript (this repo) and future STM32 C SDK (S11) MUST match this document and the golden vectors in `src/test/nativeGoldenVectors.test.ts`.

## 1. Framing

```
Raw frame (after header+CRC)
    → COBS encode
    → append 0x00 delimiter
```

Receiver: accumulate bytes until `0x00`, COBS-decode the slice (excluding delimiter), verify frame.

Pending encoded frame max: **1400 bytes**. On overflow without delimiter: discard until next `0x00`, count decode error.

Decoded frame max: **1024 bytes**. Oversize → reject + error.

Malformed COBS / CRC / length / version: increment error, discard that frame, continue at next delimiter.

## 2. COBS

Consistent Overhead Byte Stuffing. No zero bytes in encoded body; `0x00` is end-of-frame only.

## 3. CRC

CRC-16/CCITT-FALSE:

| field | value |
|-------|--------|
| poly | 0x1021 |
| init | 0xFFFF |
| refin | false |
| refout | false |
| xorout | 0x0000 |

CRC covers `version` through last payload byte (not CRC itself, not COBS delimiter).

Standard vector: ASCII `"123456789"` → **0x29B1**.

## 4. Raw frame layout (after COBS decode)

All multi-byte integers **little-endian**.

| Offset | Size | Field |
|--------|------|--------|
| 0 | 1 | version (= 1) |
| 1 | 1 | messageType |
| 2 | 1 | flags |
| 3 | 1 | reserved (MUST 0; receiver ignores) |
| 4 | 2 | requestId |
| 6 | 2 | payloadLength |
| 8 | N | payload |
| 8+N | 2 | crc16 |

Header = 8 bytes; CRC = 2 bytes.

## 5. Flags

| bit | name |
|-----|------|
| 0 | RESPONSE |
| 1 | UNSOLICITED |
| 2–7 | reserved (0) |

`requestId`: Host requests use **1..65535** (wrap 65535→1, never reuse pending).  
`requestId = 0`: unsolicited device messages only.

## 6. Message types (v1)

| ID | Name |
|----|------|
| 0x01 | Hello |
| 0x10 | ParamDesc |
| 0x11 | ParamGet |
| 0x12 | ParamValue |
| 0x13 | ParamSet |
| 0x14 | ParamAck |
| 0x15 | ParamNack |

Reserved ranges (not implemented in S10): telemetry 0x20–0x2F, event 0x30–0x3F, command 0x40–0x4F.

## 7. Parameter types

| ID | Type | Wire |
|----|------|------|
| 1 | float32 | IEEE754 LE 4 bytes |
| 2 | int32 | signed LE 4 bytes |
| 3 | uint32 | unsigned LE 4 bytes |
| 4 | bool | 1 byte, **0 or 1** only |

No float64 / string / array / struct / blob in v1.

## 8. Parameter identity

- `id`: uint16, **1..65535** (0 invalid)
- `path`: UTF-8, max **127** bytes (e.g. `chassis.yaw.kp`)
- `unit`: UTF-8, max **31** bytes

## 9. HELLO

**Host → device** (requestId ≠ 0):

```
uint8  minVersion = 1
uint8  maxVersion = 1
uint32 hostCapabilities = 0
```

**Device → host** (RESPONSE, same requestId):

```
uint8  selectedVersion
uint32 deviceCapabilities
uint16 parameterCount
uint8  deviceNameLength        // ≤ 63
uint8  firmwareVersionLength   // ≤ 31
bytes  deviceName UTF-8
bytes  firmwareVersion UTF-8
```

If `selectedVersion` not supported → session incompatible; no discovery.

## 10. Discovery

After HELLO success, device sends `PARAM_DESC` per parameter:

- flags.UNSOLICITED, requestId = 0  
- count must match `HELLO.parameterCount`

Host applies a **2000 ms discovery timeout** from HELLO success. Incomplete discovery → `discovery_failed` (never treat a partial table as ready).

Disconnect clears host parameter registry; next connect re-runs HELLO + discovery.

Unsolicited `PARAM_VALUE`: `frame.requestId = 0` and `frame.flags.UNSOLICITED`; **payload.parameterId must be 1..65535**. `parameterId = 0` is invalid → host decode error.

## 11. PARAM_DESC payload

```
uint16 parameterId
uint8  paramType
uint8  accessFlags     // bit0 writable
uint8  optionFlags     // bit0 hasMin, bit1 hasMax, bit2 hasStep
uint8  pathLength
uint8  unitLength
bytes  path
bytes  unit
[min]  if hasMin, typed
[max]  if hasMax, typed
[step] if hasStep, typed
```

Bool MUST NOT set hasMin/hasMax/hasStep.  
Numeric: `min <= max`, `step > 0`. Float min/max/step MUST be finite.

## 12. PARAM_GET / PARAM_VALUE

**GET** (request): payload `uint16 parameterId`  
**VALUE** (RESPONSE or UNSOLICITED): `uint16 parameterId, uint8 paramType, value`

Host: type MUST match descriptor or protocol error.

## 13. PARAM_SET / ACK / NACK

**SET**: `uint16 parameterId, uint8 paramType, value`  
Host MUST reject values outside descriptor min/max **before sending PARAM_SET**. Device MUST re-validate independently.  
`ACK.appliedValue` MAY differ from requested (quantization / normalization / device dynamic constraint) and is the confirmed value — it is not a license to ignore public min/max.

**ACK** (RESPONSE): `uint16 parameterId, uint8 paramType, appliedValue`  
Host treats ACK value as confirmed.

**NACK** (RESPONSE): `uint16 parameterId, uint8 errorCode, uint8 detailLength, bytes UTF-8`  
`detailLength ≤ 127`

Error codes: UnknownParameter=1, ReadOnly=2, TypeMismatch=3, OutOfRange=4, InvalidValue=5, Busy=6, InternalError=7.

## 14. Session rules

- Host does not mark SET confirmed until ACK  
- NACK → keep old confirmed, surface error  
- Max 32 pending host requests; default timeout 1000 ms  
- Disconnect rejects all pending and clears registry  

## 15. Coexistence

Native is a **separate protocol mode** (`protocol.kind = "native"`).  
JustFloat / FireWater / Raw / Custom wire formats are unchanged.  
Native control frames are NOT encoded as telemetry SampleBatch.
