#include <stdint.h>
#include <stdbool.h>
volatile float yaw_kp = 3.5f;
volatile int32_t negative = -12;
volatile uint32_t count = 42;
volatile bool enabled = true;
volatile struct { float kp; struct { int32_t limit; } inner; } pid = { 2.5f, { 800 } };
volatile float gains[3] = {1, 2, 3};
const float fixed = 99.0f;
volatile float *pointer = &yaw_kp;
struct { unsigned int bit:1; } bits;
void _start(void) { for (;;) { count++; } }
