#include "seriallab/sl.h"

#include <math.h>
#include <string.h>

_Static_assert(sizeof(float) == 4, "SERIERLAB requires IEEE754 float32");

static uint16_t read_u16_le(const uint8_t *p) { return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8)); }

static uint32_t read_u32_le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void write_u16_le(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
}

static void write_u32_le(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v & 0xFF);
  p[1] = (uint8_t)((v >> 8) & 0xFF);
  p[2] = (uint8_t)((v >> 16) & 0xFF);
  p[3] = (uint8_t)((v >> 24) & 0xFF);
}

static void write_f32_le(uint8_t *p, float f) {
  uint32_t u;
  memcpy(&u, &f, 4);
  write_u32_le(p, u);
}

static float read_f32_le(const uint8_t *p) {
  uint32_t u = read_u32_le(p);
  float f;
  memcpy(&f, &u, 4);
  return f;
}

static size_t param_wire_size(sl_param_type_t t) { return t == SL_PARAM_BOOL ? 1u : 4u; }

static void write_value(uint8_t *p, sl_param_type_t t, sl_param_value_t v) {
  switch (t) {
  case SL_PARAM_FLOAT32:
    write_f32_le(p, v.f32);
    break;
  case SL_PARAM_INT32:
    write_u32_le(p, (uint32_t)v.i32);
    break;
  case SL_PARAM_UINT32:
    write_u32_le(p, v.u32);
    break;
  case SL_PARAM_BOOL:
    p[0] = v.b ? 1u : 0u;
    break;
  }
}

static bool read_value(const uint8_t *p, sl_param_type_t t, sl_param_value_t *out) {
  switch (t) {
  case SL_PARAM_FLOAT32:
    out->f32 = read_f32_le(p);
    return out->f32 == out->f32 && out->f32 != INFINITY && out->f32 != -INFINITY;
  case SL_PARAM_INT32:
    out->i32 = (int32_t)read_u32_le(p);
    return true;
  case SL_PARAM_UINT32:
    out->u32 = read_u32_le(p);
    return true;
  case SL_PARAM_BOOL:
    if (p[0] > 1) {
      return false;
    }
    out->b = p[0] != 0;
    return true;
  default:
    return false;
  }
}

static void read_param_storage(const sl_param_t *p, sl_param_value_t *out) {
  switch (p->type) {
  case SL_PARAM_FLOAT32:
    memcpy(&out->f32, p->address, 4);
    break;
  case SL_PARAM_INT32:
    memcpy(&out->i32, p->address, 4);
    break;
  case SL_PARAM_UINT32:
    memcpy(&out->u32, p->address, 4);
    break;
  case SL_PARAM_BOOL:
    out->b = *(bool *)p->address;
    break;
  }
}

static bool write_param_storage(sl_param_t *p, sl_param_value_t v) {
  switch (p->type) {
  case SL_PARAM_FLOAT32:
    memcpy(p->address, &v.f32, 4);
    break;
  case SL_PARAM_INT32:
    memcpy(p->address, &v.i32, 4);
    break;
  case SL_PARAM_UINT32:
    memcpy(p->address, &v.u32, 4);
    break;
  case SL_PARAM_BOOL:
    *(bool *)p->address = v.b;
    break;
  default:
    return false;
  }
  return true;
}

static bool value_in_range(const sl_param_t *p, sl_param_value_t v) {
  if (p->type == SL_PARAM_FLOAT32) {
    if (p->has_min && v.f32 < p->min.f32) {
      return false;
    }
    if (p->has_max && v.f32 > p->max.f32) {
      return false;
    }
    return true;
  }
  if (p->type == SL_PARAM_INT32) {
    if (p->has_min && v.i32 < p->min.i32) {
      return false;
    }
    if (p->has_max && v.i32 > p->max.i32) {
      return false;
    }
    return true;
  }
  if (p->type == SL_PARAM_UINT32) {
    if (p->has_min && v.u32 < p->min.u32) {
      return false;
    }
    if (p->has_max && v.u32 > p->max.u32) {
      return false;
    }
    return true;
  }
  return true;
}

static size_t cstr_len(const char *s) {
  size_t n = 0;
  if (!s) {
    return 0;
  }
  while (s[n]) {
    n++;
  }
  return n;
}

static bool valid_param_type(uint8_t t) {
  return t == SL_PARAM_FLOAT32 || t == SL_PARAM_INT32 || t == SL_PARAM_UINT32 || t == SL_PARAM_BOOL;
}

static sl_param_t *find_param(sl_context_t *ctx, uint16_t id) {
  size_t i;
  for (i = 0; i < ctx->param_count; i++) {
    if (ctx->params[i].id == id) {
      return &ctx->params[i];
    }
  }
  return NULL;
}

size_t sl_encode_frame(uint8_t msg_type, uint8_t flags, uint16_t request_id, const uint8_t *payload,
                       size_t payload_len, uint8_t *out, size_t out_cap) {
  uint8_t raw[SL_MAX_DECODED_FRAME];
  uint16_t crc;
  size_t raw_len;
  size_t enc_len;

  if (payload_len > 1014u) {
    return 0;
  }
  raw_len = SL_HEADER_SIZE + payload_len + SL_CRC_SIZE;
  raw[0] = 1;
  raw[1] = msg_type;
  raw[2] = flags;
  raw[3] = 0;
  write_u16_le(&raw[4], request_id);
  write_u16_le(&raw[6], (uint16_t)payload_len);
  if (payload_len && payload) {
    memcpy(&raw[8], payload, payload_len);
  }
  crc = sl_crc16(raw, SL_HEADER_SIZE + payload_len);
  write_u16_le(&raw[SL_HEADER_SIZE + payload_len], crc);
  enc_len = sl_cobs_encode(raw, raw_len, out, out_cap > 0 ? out_cap - 1 : 0);
  if (enc_len == 0 || enc_len + 1 > out_cap) {
    return 0;
  }
  out[enc_len] = 0;
  return enc_len + 1;
}

static bool tx_enqueue(sl_context_t *ctx, uint8_t type, uint8_t flags, uint16_t rid,
                       const uint8_t *payload, size_t plen) {
  uint8_t wire[SL_MAX_ENCODED_PENDING];
  size_t n;
  size_t slot;

  if (ctx->tx_count >= SL_TX_PENDING_MAX) {
    ctx->metrics.tx_overflows++;
    return false;
  }
  n = sl_encode_frame(type, flags, rid, payload, plen, wire, sizeof(wire));
  if (n == 0) {
    ctx->metrics.decode_errors++;
    return false;
  }
  slot = (ctx->tx_head + ctx->tx_count) % SL_TX_PENDING_MAX;
  memcpy(ctx->tx_q[slot].encoded, wire, n);
  ctx->tx_q[slot].len = n;
  ctx->tx_count++;
  return true;
}

static void tx_pump(sl_context_t *ctx) {
  while (ctx->tx_count > 0) {
    sl_tx_msg_t *m = &ctx->tx_q[ctx->tx_head];
    if (!ctx->tx_accept) {
      break;
    }
    if (!ctx->tx_accept(m->encoded, m->len, ctx->tx_user)) {
      break;
    }
    ctx->metrics.tx_bytes += (uint32_t)m->len;
    ctx->tx_head = (ctx->tx_head + 1u) % SL_TX_PENDING_MAX;
    ctx->tx_count--;
  }
}

static void queue_nack(sl_context_t *ctx, uint16_t rid, uint16_t param_id, uint8_t code,
                       const char *detail) {
  uint8_t p[132];
  size_t dlen = detail ? cstr_len(detail) : 0;
  if (dlen > 127) {
    dlen = 127;
  }
  write_u16_le(&p[0], param_id);
  p[2] = code;
  p[3] = (uint8_t)dlen;
  if (dlen) {
    memcpy(&p[4], detail, dlen);
  }
  tx_enqueue(ctx, SL_MSG_PARAM_NACK, SL_FLAG_RESPONSE, rid, p, 4 + dlen);
  ctx->metrics.nack_count++;
}

static void queue_value(sl_context_t *ctx, uint8_t flags, uint16_t rid, const sl_param_t *param) {
  uint8_t p[8];
  sl_param_value_t v;
  size_t vsz = param_wire_size(param->type);
  read_param_storage(param, &v);
  write_u16_le(&p[0], param->id);
  p[2] = (uint8_t)param->type;
  write_value(&p[3], param->type, v);
  tx_enqueue(ctx, SL_MSG_PARAM_VALUE, flags, rid, p, 3 + vsz);
}

static void queue_desc(sl_context_t *ctx, const sl_param_t *param) {
  uint8_t p[256];
  size_t path_len = cstr_len(param->path);
  size_t unit_len = cstr_len(param->unit);
  size_t o;
  uint8_t access = param->writable ? 1u : 0u;
  uint8_t opt = 0;
  if (path_len > SL_MAX_PATH_LENGTH || unit_len > SL_MAX_UNIT_LENGTH) {
    return;
  }
  if (param->has_min) {
    opt |= 1u;
  }
  if (param->has_max) {
    opt |= 2u;
  }
  if (param->has_step) {
    opt |= 4u;
  }
  write_u16_le(&p[0], param->id);
  p[2] = (uint8_t)param->type;
  p[3] = access;
  p[4] = opt;
  p[5] = (uint8_t)path_len;
  p[6] = (uint8_t)unit_len;
  o = 7;
  if (path_len) {
    memcpy(&p[o], param->path, path_len);
    o += path_len;
  }
  if (unit_len) {
    memcpy(&p[o], param->unit, unit_len);
    o += unit_len;
  }
  if (param->has_min) {
    write_value(&p[o], param->type, param->min);
    o += param_wire_size(param->type);
  }
  if (param->has_max) {
    write_value(&p[o], param->type, param->max);
    o += param_wire_size(param->type);
  }
  if (param->has_step) {
    write_value(&p[o], param->type, param->step);
    o += param_wire_size(param->type);
  }
  tx_enqueue(ctx, SL_MSG_PARAM_DESC, SL_FLAG_UNSOLICITED, 0, p, o);
}

static void handle_hello(sl_context_t *ctx, uint16_t rid, const uint8_t *pl, size_t plen) {
  uint8_t minv, maxv;
  uint8_t p[80];
  size_t nlen, flen, o;
  size_t i;

  if (plen < 6) {
    return;
  }
  minv = pl[0];
  maxv = pl[1];
  ctx->metrics.hello_count++;
  if (!(minv <= 1 && 1 <= maxv)) {
    /* No dedicated incompatible message in v1 — drop. */
    return;
  }
  nlen = cstr_len(ctx->device.device_name);
  flen = cstr_len(ctx->device.firmware_version);
  if (nlen > SL_MAX_DEVICE_NAME_LENGTH) {
    nlen = SL_MAX_DEVICE_NAME_LENGTH;
  }
  if (flen > SL_MAX_FW_VERSION_LENGTH) {
    flen = SL_MAX_FW_VERSION_LENGTH;
  }
  p[0] = 1;
  write_u32_le(&p[1], 0);
  write_u16_le(&p[5], (uint16_t)ctx->param_count);
  p[7] = (uint8_t)nlen;
  p[8] = (uint8_t)flen;
  o = 9;
  if (nlen) {
    memcpy(&p[o], ctx->device.device_name, nlen);
    o += nlen;
  }
  if (flen) {
    memcpy(&p[o], ctx->device.firmware_version, flen);
    o += flen;
  }
  tx_enqueue(ctx, SL_MSG_HELLO, SL_FLAG_RESPONSE, rid, p, o);

  ctx->hello_seen = true;
  ctx->hello_request_id = rid;
  ctx->desc_sent = 0;
  ctx->state = SL_STATE_READY;
  for (i = 0; i < ctx->param_count; i++) {
    queue_desc(ctx, &ctx->params[i]);
  }
}

static void handle_get(sl_context_t *ctx, uint16_t rid, const uint8_t *pl, size_t plen) {
  uint16_t id;
  sl_param_t *param;
  if (plen < 2) {
    return;
  }
  id = read_u16_le(pl);
  ctx->metrics.get_count++;
  param = find_param(ctx, id);
  if (!param) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_UNKNOWN, "unknown");
    return;
  }
  queue_value(ctx, SL_FLAG_RESPONSE, rid, param);
}

static void handle_set(sl_context_t *ctx, uint16_t rid, const uint8_t *pl, size_t plen) {
  uint16_t id;
  sl_param_t *param;
  sl_param_value_t req;
  size_t vsz;
  uint8_t ptype;

  if (plen < 3) {
    return;
  }
  id = read_u16_le(pl);
  ptype = pl[2];
  ctx->metrics.set_count++;
  param = find_param(ctx, id);
  if (!param) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_UNKNOWN, "unknown");
    return;
  }
  if (!param->writable) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_READONLY, "ro");
    return;
  }
  if (ptype != (uint8_t)param->type) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_TYPE, "type");
    return;
  }
  vsz = param_wire_size(param->type);
  if (plen < 3 + vsz) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_INVALID, "trunc");
    return;
  }
  if (!read_value(&pl[3], param->type, &req)) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_INVALID, "value");
    return;
  }
  if (!value_in_range(param, req)) {
    queue_nack(ctx, rid, id, SL_PARAM_ERR_RANGE, "range");
    return;
  }
  if (param->setter) {
    if (!param->setter(param, req, param->setter_user)) {
      queue_nack(ctx, rid, id, SL_PARAM_ERR_INVALID, "setter");
      return;
    }
  } else {
    if (!write_param_storage(param, req)) {
      queue_nack(ctx, rid, id, SL_PARAM_ERR_INTERNAL, "write");
      return;
    }
  }
  /* ACK with read-back actual applied value */
  {
    uint8_t p[8];
    sl_param_value_t applied;
    size_t asz = param_wire_size(param->type);
    read_param_storage(param, &applied);
    write_u16_le(&p[0], param->id);
    p[2] = (uint8_t)param->type;
    write_value(&p[3], param->type, applied);
    tx_enqueue(ctx, SL_MSG_PARAM_ACK, SL_FLAG_RESPONSE, rid, p, 3 + asz);
  }
}

static void handle_raw_frame(sl_context_t *ctx, const uint8_t *raw, size_t raw_len) {
  uint16_t crc_rx, crc_calc;
  uint16_t rid;
  uint16_t plen;
  uint8_t type, flags;
  const uint8_t *payload;

  if (raw_len < SL_HEADER_SIZE + SL_CRC_SIZE) {
    ctx->metrics.decode_errors++;
    return;
  }
  if (raw[0] != 1) {
    ctx->metrics.decode_errors++;
    return;
  }
  type = raw[1];
  flags = raw[2];
  rid = read_u16_le(&raw[4]);
  plen = read_u16_le(&raw[6]);
  if ((size_t)SL_HEADER_SIZE + plen + SL_CRC_SIZE != raw_len) {
    ctx->metrics.decode_errors++;
    return;
  }
  crc_rx = read_u16_le(&raw[SL_HEADER_SIZE + plen]);
  crc_calc = sl_crc16(raw, SL_HEADER_SIZE + plen);
  if (crc_rx != crc_calc) {
    ctx->metrics.crc_errors++;
    return;
  }
  ctx->metrics.frames_ok++;
  payload = &raw[8];

  if (type == SL_MSG_HELLO && (flags & SL_FLAG_RESPONSE) == 0) {
    handle_hello(ctx, rid, payload, plen);
    return;
  }
  if (type == SL_MSG_PARAM_GET) {
    handle_get(ctx, rid, payload, plen);
    return;
  }
  if (type == SL_MSG_PARAM_SET) {
    handle_set(ctx, rid, payload, plen);
    return;
  }
}

static void decoder_feed_byte(sl_context_t *ctx, uint8_t b) {
  sl_rx_decoder_t *d = &ctx->decoder;
  uint8_t decoded[SL_MAX_DECODED_FRAME];
  size_t n;

  if (b == 0) {
    if (d->len == 0) {
      return;
    }
    n = sl_cobs_decode(d->pending, d->len, decoded, sizeof(decoded));
    d->len = 0;
    d->waiting_delim = false;
    if (n == (size_t)-1) {
      ctx->metrics.cobs_errors++;
      return;
    }
    handle_raw_frame(ctx, decoded, n);
    return;
  }
  if (d->len >= SL_MAX_ENCODED_PENDING) {
    d->waiting_delim = true;
    ctx->metrics.decode_errors++;
    return;
  }
  if (d->waiting_delim) {
    return;
  }
  d->pending[d->len++] = b;
}

sl_result_t sl_init(sl_context_t *ctx, sl_param_t *params, size_t param_count,
                    const sl_device_info_t *device, sl_tx_accept_fn tx_accept, void *tx_user) {
  size_t i, j;
  if (!ctx || !params || param_count == 0 || param_count > SL_MAX_PARAMS) {
    return SL_ERR_ARGUMENT;
  }
  memset(ctx, 0, sizeof(*ctx));
  ctx->params = params;
  ctx->param_count = param_count;
  if (device) {
    ctx->device = *device;
  }
  ctx->tx_accept = tx_accept;
  ctx->tx_user = tx_user;

  for (i = 0; i < param_count; i++) {
    sl_param_t *p = &params[i];
    size_t path_len;
    size_t unit_len;
    if (!p->address || p->id == 0 || !valid_param_type((uint8_t)p->type) || !p->path) {
      return SL_ERR_CONFIG;
    }
    path_len = cstr_len(p->path);
    unit_len = cstr_len(p->unit);
    if (path_len == 0 || path_len > SL_MAX_PATH_LENGTH || unit_len > SL_MAX_UNIT_LENGTH) {
      return SL_ERR_CONFIG;
    }
    if (p->type == SL_PARAM_BOOL && (p->has_min || p->has_max || p->has_step)) {
      return SL_ERR_CONFIG;
    }
    if (p->has_min && p->has_max) {
      if (p->type == SL_PARAM_FLOAT32 && p->min.f32 > p->max.f32) {
        return SL_ERR_CONFIG;
      }
      if (p->type == SL_PARAM_INT32 && p->min.i32 > p->max.i32) {
        return SL_ERR_CONFIG;
      }
      if (p->type == SL_PARAM_UINT32 && p->min.u32 > p->max.u32) {
        return SL_ERR_CONFIG;
      }
    }
    if (p->has_step) {
      if (p->type == SL_PARAM_FLOAT32 && !(p->step.f32 > 0.0f)) {
        return SL_ERR_CONFIG;
      }
      if (p->type == SL_PARAM_INT32 && !(p->step.i32 > 0)) {
        return SL_ERR_CONFIG;
      }
      if (p->type == SL_PARAM_UINT32 && !(p->step.u32 > 0)) {
        return SL_ERR_CONFIG;
      }
    }
    for (j = 0; j < i; j++) {
      if (params[j].id == p->id) {
        return SL_ERR_CONFIG;
      }
      if (strcmp(params[j].path, p->path) == 0) {
        return SL_ERR_CONFIG;
      }
    }
  }
  ctx->state = SL_STATE_IDLE;
  return SL_OK;
}

size_t sl_rx_push(sl_context_t *ctx, const uint8_t *data, size_t len) {
  size_t accepted = 0;
  size_t i;
  if (!ctx || !data) {
    return 0;
  }
  for (i = 0; i < len; i++) {
    uint16_t next = (uint16_t)((ctx->rx_fifo.head + 1u) % SL_RX_FIFO_SIZE);
    if (next == ctx->rx_fifo.tail) {
      ctx->rx_fifo.overflows++;
      ctx->metrics.rx_overflows++;
      break;
    }
    ctx->rx_fifo.buf[ctx->rx_fifo.head] = data[i];
    ctx->rx_fifo.head = next;
    ctx->metrics.rx_bytes++;
    accepted++;
  }
  return accepted;
}

void sl_process(sl_context_t *ctx) {
  if (!ctx) {
    return;
  }
  while (ctx->rx_fifo.tail != ctx->rx_fifo.head) {
    uint8_t b = ctx->rx_fifo.buf[ctx->rx_fifo.tail];
    ctx->rx_fifo.tail = (uint16_t)((ctx->rx_fifo.tail + 1u) % SL_RX_FIFO_SIZE);
    decoder_feed_byte(ctx, b);
  }
  tx_pump(ctx);
}

const sl_metrics_t *sl_metrics(const sl_context_t *ctx) { return ctx ? &ctx->metrics : NULL; }
sl_state_t sl_get_state(const sl_context_t *ctx) { return ctx ? ctx->state : SL_STATE_IDLE; }
