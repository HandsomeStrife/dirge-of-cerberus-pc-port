# FED/FEZ effect-definition parser — native port (purist, no emulation).
CC      ?= cc
CFLAGS  ?= -std=c11 -O2 -Wall -Wextra -Wpedantic
LDLIBS  ?= -lz
BIN      = fed
OBJ      = fed.o fez.o fed_dump.o main.o doc_cipher.o

.PHONY: all clean check

all: $(BIN)

$(BIN): $(OBJ)
	$(CC) $(CFLAGS) -o $@ $(OBJ) $(LDLIBS)

%.o: %.c fed.h fez.h
	$(CC) $(CFLAGS) -c -o $@ $<

# the cipher constants are read from the user's ELF (native/common/doc_cipher.c)
doc_cipher.o: ../../common/doc_cipher.c ../../common/doc_cipher.h
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(BIN) $(OBJ)

# Smoke test: parse a real sample if the extract tree is present.
DIRGE_EXTRACT ?= ../../../extract
DIRGE_ELF ?= ../../../elf/SLES_541.85
KEL ?= $(DIRGE_EXTRACT)/_KEL
ELF ?= $(DIRGE_ELF)
check: $(BIN)
	@f="$(KEL)/data/effect/resident/r0000/r0001/fer/r0001.fed"; \
	if [ -f "$$f" ]; then ./$(BIN) "$$f" | head -20; \
	else echo "sample not found ($$f) — skipping check"; fi
	@f="$(KEL)/data/effect/resident/r0000/r0002/fer/r0002.fez"; \
	if [ -f "$$f" ] && [ -f "$(ELF)" ]; then ./$(BIN) "$$f" --elf "$(ELF)" | head -5; \
	else echo "fez sample or ELF not found — skipping fez check"; fi
