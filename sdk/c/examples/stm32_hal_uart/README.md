# STM32 HAL UART example (illustrative — not built in CI)

Core SDK has **no HAL dependency**. Wire like this:

```c
#include "seriallab/sl.h"

static float yaw_kp = 3.5f;
static int32_t max_pwm = 800;
static bool heading_hold = true;

static sl_param_t params[] = {
    SL_PARAM_FLOAT_RW(1, "yaw.kp", &yaw_kp, 0.0f, 20.0f, 0.1f),
    SL_PARAM_INT32_RW(2, "motor.max_pwm", &max_pwm, 0, 2000),
    SL_PARAM_BOOL_RW(3, "debug.heading_hold", &heading_hold),
};

static sl_context_t sl;

/* TX adapter MUST copy `data` before returning true.
   Never hand the SDK buffer pointer to DMA and return true immediately. */
static bool uart_tx_accept(const uint8_t *data, size_t len, void *user) {
  (void)user;
  if (huart1.gState != HAL_UART_STATE_READY) {
    return false; /* busy — SDK retries in sl_process() */
  }
  /* Copy into a persistent app buffer owned by this adapter, then DMA. */
  static uint8_t tx_copy[SL_MAX_ENCODED_PENDING];
  if (len > sizeof(tx_copy)) {
    return false;
  }
  memcpy(tx_copy, data, len);
  return HAL_UART_Transmit_DMA(&huart1, tx_copy, (uint16_t)len) == HAL_OK;
}

/* UART RX callback / ReceiveToIdle — ISR context: only push bytes */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
  if (huart == &huart1) {
    sl_rx_push(&sl, rx_buf, rx_len);
    /* restart RX DMA / idle receive */
  }
}

int main(void) {
  sl_device_info_t dev = { "MyBoard", "1.0.0" };
  sl_init(&sl, params, 3, &dev, uart_tx_accept, NULL);
  for (;;) {
    sl_process(&sl); /* main loop only — never in ISR */
    /* application control loop continues */
  }
}
```

## Rules

1. `sl_rx_push` from UART ISR/callback only.  
2. `sl_process` from main loop or low-priority RTOS task.  
3. TX callback `true` means **bytes were copied**.  
4. Parameter values live in RAM only (reset restores firmware defaults).
