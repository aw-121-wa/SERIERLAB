#ifndef SERIALLAB_SL_H
#define SERIALLAB_SL_H

#include "sl_types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint8_t buf[SL_RX_FIFO_SIZE];
  volatile uint16_t head;
  volatile uint16_t tail;
  uint32_t overflows;
} sl_rx_fifo_t;

typedef struct {
  uint8_t encoded[SL_MAX_ENCODED_PENDING];
  size_t len;
} sl_tx_msg_t;

typedef struct {
  uint8_t pending[SL_MAX_ENCODED_PENDING];
  size_t len;
  bool waiting_delim;
} sl_rx_decoder_t;

typedef struct {
  sl_param_t *params;
  size_t param_count;
  sl_device_info_t device;

  sl_rx_fifo_t rx_fifo;
  sl_rx_decoder_t decoder;

  sl_tx_msg_t tx_q[SL_TX_PENDING_MAX];
  size_t tx_head;
  size_t tx_count;

  sl_tx_accept_fn tx_accept;
  void *tx_user;

  sl_state_t state;
  bool hello_seen;
  uint16_t desc_sent;
  uint16_t hello_request_id;

  sl_metrics_t metrics;
} sl_context_t;

sl_result_t sl_init(sl_context_t *ctx, sl_param_t *params, size_t param_count,
                    const sl_device_info_t *device, sl_tx_accept_fn tx_accept, void *tx_user);

/** ISR-safe: push raw UART bytes into bounded FIFO. Returns bytes accepted. */
size_t sl_rx_push(sl_context_t *ctx, const uint8_t *data, size_t len);

/** Main-loop: parse frames, handle messages, retry TX. Never call from ISR. */
void sl_process(sl_context_t *ctx);

const sl_metrics_t *sl_metrics(const sl_context_t *ctx);
sl_state_t sl_get_state(const sl_context_t *ctx);

/* Test / host helpers (also useful for fixtures) */
uint16_t sl_crc16(const uint8_t *data, size_t len);
size_t sl_cobs_encode(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap);
size_t sl_cobs_decode(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap);
size_t sl_encode_frame(uint8_t msg_type, uint8_t flags, uint16_t request_id, const uint8_t *payload,
                       size_t payload_len, uint8_t *out, size_t out_cap);

#ifdef __cplusplus
}
#endif

#endif /* SERIALLAB_SL_H */
