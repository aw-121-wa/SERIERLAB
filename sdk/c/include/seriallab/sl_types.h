#ifndef SERIALLAB_SL_TYPES_H
#define SERIALLAB_SL_TYPES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "sl_config.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  SL_OK = 0,
  SL_ERR_ARGUMENT = -1,
  SL_ERR_CONFIG = -2,
  SL_ERR_OVERFLOW = -3,
  SL_ERR_BUSY = -4,
  SL_ERR_PROTOCOL = -5
} sl_result_t;

typedef enum {
  SL_PARAM_FLOAT32 = 1,
  SL_PARAM_INT32 = 2,
  SL_PARAM_UINT32 = 3,
  SL_PARAM_BOOL = 4
} sl_param_type_t;

typedef enum {
  SL_MSG_HELLO = 0x01,
  SL_MSG_PARAM_DESC = 0x10,
  SL_MSG_PARAM_GET = 0x11,
  SL_MSG_PARAM_VALUE = 0x12,
  SL_MSG_PARAM_SET = 0x13,
  SL_MSG_PARAM_ACK = 0x14,
  SL_MSG_PARAM_NACK = 0x15
} sl_msg_type_t;

typedef enum {
  SL_FLAG_RESPONSE = 1 << 0,
  SL_FLAG_UNSOLICITED = 1 << 1
} sl_frame_flags_t;

typedef enum {
  SL_PARAM_ERR_UNKNOWN = 1,
  SL_PARAM_ERR_READONLY = 2,
  SL_PARAM_ERR_TYPE = 3,
  SL_PARAM_ERR_RANGE = 4,
  SL_PARAM_ERR_INVALID = 5,
  SL_PARAM_ERR_BUSY = 6,
  SL_PARAM_ERR_INTERNAL = 7
} sl_param_err_t;

typedef union {
  float f32;
  int32_t i32;
  uint32_t u32;
  bool b;
} sl_param_value_t;

struct sl_param;

/** Optional write hook. Return false → PARAM_NACK InvalidValue. */
typedef bool (*sl_param_setter_fn)(const struct sl_param *param, sl_param_value_t requested, void *user);

typedef struct sl_param {
  uint16_t id;
  const char *path;
  const char *unit;
  sl_param_type_t type;
  bool writable;
  void *address;
  bool has_min;
  bool has_max;
  bool has_step;
  sl_param_value_t min;
  sl_param_value_t max;
  sl_param_value_t step;
  sl_param_setter_fn setter;
  void *setter_user;
} sl_param_t;

/** true = data copied/taken by transport; false = busy (SDK retries). */
typedef bool (*sl_tx_accept_fn)(const uint8_t *data, size_t len, void *user);

typedef struct {
  const char *device_name;
  const char *firmware_version;
} sl_device_info_t;

typedef struct {
  uint32_t rx_bytes;
  uint32_t tx_bytes;
  uint32_t frames_ok;
  uint32_t cobs_errors;
  uint32_t crc_errors;
  uint32_t decode_errors;
  uint32_t rx_overflows;
  uint32_t tx_overflows;
  uint32_t hello_count;
  uint32_t get_count;
  uint32_t set_count;
  uint32_t nack_count;
} sl_metrics_t;

typedef enum {
  SL_STATE_IDLE = 0,
  SL_STATE_READY = 1
} sl_state_t;

#define SL_HEADER_SIZE 8u
#define SL_CRC_SIZE 2u

#define SL_PARAM_FLOAT_RW(id_, path_, addr_, min_, max_, step_)                                    \
  {                                                                                                \
    (id_), (path_), NULL, SL_PARAM_FLOAT32, true, (addr_), true, true, true,                        \
        {.f32 = (min_)}, {.f32 = (max_)}, {.f32 = (step_)}, NULL, NULL                              \
  }

#define SL_PARAM_FLOAT_RO(id_, path_, addr_)                                                       \
  {                                                                                                \
    (id_), (path_), NULL, SL_PARAM_FLOAT32, false, (addr_), false, false, false, {0}, {0}, {0},     \
        NULL, NULL                                                                                 \
  }

#define SL_PARAM_INT32_RW(id_, path_, addr_, min_, max_)                                           \
  {                                                                                                \
    (id_), (path_), NULL, SL_PARAM_INT32, true, (addr_), true, true, false, {.i32 = (min_)},        \
        {.i32 = (max_)}, {0}, NULL, NULL                                                           \
  }

#define SL_PARAM_UINT32_RW(id_, path_, addr_, min_, max_)                                          \
  {                                                                                                \
    (id_), (path_), NULL, SL_PARAM_UINT32, true, (addr_), true, true, false, {.u32 = (min_)},       \
        {.u32 = (max_)}, {0}, NULL, NULL                                                           \
  }

#define SL_PARAM_BOOL_RW(id_, path_, addr_)                                                        \
  {                                                                                                \
    (id_), (path_), NULL, SL_PARAM_BOOL, true, (addr_), false, false, false, {0}, {0}, {0}, NULL,   \
        NULL                                                                                       \
  }

#ifdef __cplusplus
}
#endif

#endif /* SERIALLAB_SL_TYPES_H */
