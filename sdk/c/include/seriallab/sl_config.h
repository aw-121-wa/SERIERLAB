#ifndef SERIALLAB_SL_CONFIG_H
#define SERIALLAB_SL_CONFIG_H

/* Compile-time limits — must match docs/protocol/native-control-v1.md */

#ifndef SL_MAX_DECODED_FRAME
#define SL_MAX_DECODED_FRAME 1024u
#endif

#ifndef SL_MAX_ENCODED_PENDING
#define SL_MAX_ENCODED_PENDING 1400u
#endif

#ifndef SL_MAX_PATH_LENGTH
#define SL_MAX_PATH_LENGTH 127u
#endif

#ifndef SL_MAX_UNIT_LENGTH
#define SL_MAX_UNIT_LENGTH 31u
#endif

#ifndef SL_MAX_DEVICE_NAME_LENGTH
#define SL_MAX_DEVICE_NAME_LENGTH 63u
#endif

#ifndef SL_MAX_FW_VERSION_LENGTH
#define SL_MAX_FW_VERSION_LENGTH 31u
#endif

#ifndef SL_RX_FIFO_SIZE
#define SL_RX_FIFO_SIZE 2048u
#endif

#ifndef SL_TX_PENDING_MAX
#define SL_TX_PENDING_MAX 8u
#endif

#ifndef SL_MAX_PARAMS
#define SL_MAX_PARAMS 64u
#endif

#endif /* SERIALLAB_SL_CONFIG_H */
