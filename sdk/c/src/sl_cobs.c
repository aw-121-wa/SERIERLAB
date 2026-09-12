#include "seriallab/sl.h"

#include <string.h>

size_t sl_cobs_encode(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap) {
  size_t read_index = 0;
  size_t write_index = 1;
  size_t code_index = 0;
  uint8_t code = 1;

  if (out_cap < 1) {
    return 0;
  }
  if (in_len == 0) {
    out[0] = 0x01;
    return 1;
  }

  while (read_index < in_len) {
    if (in[read_index] == 0) {
      out[code_index] = code;
      code_index = write_index++;
      code = 1;
      read_index++;
      if (write_index > out_cap) {
        return 0;
      }
    } else {
      if (write_index >= out_cap) {
        return 0;
      }
      out[write_index++] = in[read_index++];
      code++;
      if (code == 0xFF) {
        out[code_index] = code;
        code_index = write_index++;
        code = 1;
        if (write_index > out_cap) {
          return 0;
        }
      }
    }
  }
  out[code_index] = code;
  return write_index;
}

size_t sl_cobs_decode(const uint8_t *in, size_t in_len, uint8_t *out, size_t out_cap) {
  size_t read_index = 0;
  size_t write_index = 0;

  if (in_len == 0) {
    return (size_t)-1;
  }

  while (read_index < in_len) {
    uint8_t code = in[read_index];
    size_t i;
    if (code == 0) {
      return (size_t)-1;
    }
    read_index++;
    if (read_index + (size_t)(code - 1) > in_len) {
      return (size_t)-1;
    }
    for (i = 1; i < code; i++) {
      if (in[read_index] == 0) {
        return (size_t)-1;
      }
      if (write_index >= out_cap) {
        return (size_t)-1;
      }
      out[write_index++] = in[read_index++];
    }
    if (code != 0xFF && read_index < in_len) {
      if (write_index >= out_cap) {
        return (size_t)-1;
      }
      out[write_index++] = 0;
    }
  }
  return write_index;
}
