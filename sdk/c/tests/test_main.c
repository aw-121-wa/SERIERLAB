#include "seriallab/sl.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, msg)                                                                           \
  do {                                                                                             \
    if (!(cond)) {                                                                                 \
      fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, msg);                                 \
      failures++;                                                                                  \
    }                                                                                              \
  } while (0)

static bool tx_ok(const uint8_t *data, size_t len, void *user) {
  (void)user;
  (void)data;
  (void)len;
  return true;
}

/* Capturing transport for response inspection */
static uint8_t last_tx[2048];
static size_t last_tx_len;
static bool tx_capture(const uint8_t *data, size_t len, void *user) {
  (void)user;
  if (len <= sizeof(last_tx)) {
    memcpy(last_tx, data, len);
    last_tx_len = len;
  }
  return true;
}

static void test_crc(void) {
  CHECK(sl_crc16((const uint8_t *)"123456789", 9) == 0x29B1, "crc 123456789");
}

static void test_cobs_roundtrip(void) {
  uint8_t enc[64];
  uint8_t dec[64];
  uint8_t src[] = {0x00, 0x01, 0x02, 0x00, 0x00, 0xFF};
  size_t n = sl_cobs_encode(src, sizeof(src), enc, sizeof(enc));
  size_t m;
  CHECK(n > 0, "cobs encode");
  m = sl_cobs_decode(enc, n, dec, sizeof(dec));
  CHECK(m == sizeof(src), "cobs decode len");
  CHECK(memcmp(src, dec, sizeof(src)) == 0, "cobs roundtrip");
}

/* Golden vectors from TS nativeGoldenVectors.test.ts */
static void test_golden_decode_get(void) {
  /* GET1 wire */
  static const uint8_t wire[] = {0x03, 0x01, 0x11, 0x01, 0x02, 0x01, 0x02,
                                 0x02, 0x02, 0x01, 0x03, 0x58, 0xad, 0x00};
  sl_param_t params[1];
  sl_context_t ctx;
  float kp = 1.0f;
  sl_device_info_t dev = {"FakeMCU", "0.0.1"};
  uint8_t dec[64];
  size_t n;

  memset(&params[0], 0, sizeof(params[0]));
  params[0].id = 1;
  params[0].path = "kp";
  params[0].type = SL_PARAM_FLOAT32;
  params[0].writable = true;
  params[0].address = &kp;

  CHECK(sl_init(&ctx, params, 1, &dev, tx_capture, NULL) == SL_OK, "init");
  CHECK(sl_rx_push(&ctx, wire, sizeof(wire)) == sizeof(wire), "push get");
  sl_process(&ctx);
  /* Should emit PARAM_VALUE response; decode last_tx */
  CHECK(last_tx_len > 0, "tx after get");
  n = sl_cobs_decode(last_tx, last_tx_len - 1, dec, sizeof(dec));
  CHECK(n > 0, "decode value frame");
  CHECK(dec[1] == SL_MSG_PARAM_VALUE, "msg type value");
  CHECK(dec[2] == SL_FLAG_RESPONSE, "response flag");
  CHECK(dec[4] == 1 && dec[5] == 0, "rid=1");
}

static void test_golden_set_float_ack(void) {
  static const uint8_t wire[] = {
      0x03, 0x01, 0x13, 0x01, 0x02, 0x02, 0x02, 0x07, 0x02, 0x11, 0x08,
      0x01, 0x66, 0x66, 0x86, 0x40, 0x42, 0x31, 0x00,
  };
  sl_param_t params[1];
  sl_context_t ctx;
  float kp = 0.0f;
  sl_device_info_t dev = {"FakeMCU", "0.0.1"};
  uint8_t dec[64];
  size_t n;

  memset(&params[0], 0, sizeof(params[0]));
  params[0].id = 17;
  params[0].path = "yaw.kp";
  params[0].type = SL_PARAM_FLOAT32;
  params[0].writable = true;
  params[0].address = &kp;
  params[0].has_min = true;
  params[0].has_max = true;
  params[0].min.f32 = 0.0f;
  params[0].max.f32 = 20.0f;

  CHECK(sl_init(&ctx, params, 1, &dev, tx_capture, NULL) == SL_OK, "init set");
  CHECK(sl_rx_push(&ctx, wire, sizeof(wire)) == sizeof(wire), "push set");
  sl_process(&ctx);
  CHECK(kp > 4.19f && kp < 4.21f, "applied 4.2");
  n = sl_cobs_decode(last_tx, last_tx_len - 1, dec, sizeof(dec));
  CHECK(n > 0, "decode ack");
  CHECK(dec[1] == SL_MSG_PARAM_ACK, "ack type");
  CHECK((dec[2] & SL_FLAG_RESPONSE) != 0, "ack response");
  /* applied float at payload+3 */
  {
    uint32_t u = (uint32_t)dec[11] | ((uint32_t)dec[12] << 8) | ((uint32_t)dec[13] << 16) |
                 ((uint32_t)dec[14] << 24);
    float f;
    memcpy(&f, &u, 4);
    CHECK(f > 4.19f && f < 4.21f, "ack applied float");
  }
}

static void test_init_validation(void) {
  sl_param_t p[2];
  sl_context_t ctx;
  float a = 0, b = 0;
  memset(p, 0, sizeof(p));
  p[0].id = 1;
  p[0].path = "x";
  p[0].type = SL_PARAM_FLOAT32;
  p[0].address = &a;
  p[1].id = 1;
  p[1].path = "y";
  p[1].type = SL_PARAM_FLOAT32;
  p[1].address = &b;
  CHECK(sl_init(&ctx, p, 2, NULL, tx_ok, NULL) == SL_ERR_CONFIG, "dup id");
  p[1].id = 2;
  p[1].path = "x";
  CHECK(sl_init(&ctx, p, 2, NULL, tx_ok, NULL) == SL_ERR_CONFIG, "dup path");
  p[1].path = "y";
  p[0].id = 0;
  CHECK(sl_init(&ctx, p, 2, NULL, tx_ok, NULL) == SL_ERR_CONFIG, "id 0");
  p[0].id = 1;
  CHECK(sl_init(&ctx, p, 2, NULL, tx_ok, NULL) == SL_OK, "ok");
}

static void test_readonly_nack(void) {
  sl_param_t p[1];
  sl_context_t ctx;
  int32_t v = 5;
  sl_device_info_t dev = {"t", "1"};
  uint8_t dec[64];
  memset(p, 0, sizeof(p));
  p[0].id = 1;
  p[0].path = "ro";
  p[0].type = SL_PARAM_INT32;
  p[0].writable = false;
  p[0].address = &v;
  CHECK(sl_init(&ctx, p, 1, &dev, tx_capture, NULL) == SL_OK, "init ro");
  /* SET int32 2 rid=1 */
  {
    uint8_t payload[7];
    uint8_t wire[32];
    size_t n;
    memset(payload, 0, sizeof(payload));
    payload[0] = 1;
    payload[1] = 0;
    payload[2] = SL_PARAM_INT32;
    payload[3] = 2;
    n = sl_encode_frame(SL_MSG_PARAM_SET, 0, 1, payload, 7, wire, sizeof(wire));
    CHECK(n > 0, "encode set ro");
    sl_rx_push(&ctx, wire, n);
    sl_process(&ctx);
    n = sl_cobs_decode(last_tx, last_tx_len - 1, dec, sizeof(dec));
    CHECK(n > 0 && dec[1] == SL_MSG_PARAM_NACK, "nack readonly");
    CHECK(v == 5, "value unchanged");
  }
}

static void test_fifo_overflow(void) {
  sl_param_t p[1];
  sl_context_t ctx;
  float v = 0;
  uint8_t junk[SL_RX_FIFO_SIZE + 16];
  size_t accepted;
  memset(p, 0, sizeof(p));
  p[0].id = 1;
  p[0].path = "a";
  p[0].type = SL_PARAM_FLOAT32;
  p[0].address = &v;
  CHECK(sl_init(&ctx, p, 1, NULL, tx_ok, NULL) == SL_OK, "init fifo");
  memset(junk, 0x41, sizeof(junk));
  accepted = sl_rx_push(&ctx, junk, sizeof(junk));
  CHECK(accepted < sizeof(junk), "fifo rejects overflow");
  CHECK(sl_metrics(&ctx)->rx_overflows > 0, "overflow counted");
}

int main(void) {
  printf("sizeof(sl_context_t)=%zu\n", sizeof(sl_context_t));
  test_crc();
  test_cobs_roundtrip();
  test_golden_decode_get();
  test_golden_set_float_ack();
  test_init_validation();
  test_readonly_nack();
  test_fifo_overflow();
  if (failures) {
    fprintf(stderr, "%d C test(s) failed\n", failures);
    return 1;
  }
  printf("seriallab-native-c-tests: all passed\n");
  return 0;
}
