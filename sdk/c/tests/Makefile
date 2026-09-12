# Desktop C tests for Serial Lab native SDK (no ARM toolchain required)
CC ?= gcc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -I../include -O1
SRC = ../src/sl.c ../src/sl_cobs.c ../src/sl_crc16.c
BIN = seriallab-native-c-tests

.PHONY: all test clean

all: $(BIN)

$(BIN): test_main.c $(SRC)
	$(CC) $(CFLAGS) -o $@ test_main.c $(SRC) -lm

test: $(BIN)
	./$(BIN)

clean:
	rm -f $(BIN)
