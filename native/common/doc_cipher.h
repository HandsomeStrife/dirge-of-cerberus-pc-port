/* doc_cipher.h - the game's 8-byte block cipher constants, read from the user's ELF.
 *
 * The cipher (key schedule FUN_0041bb38, block decrypt FUN_0041c010 = byte stage
 * FUN_0041bf78 + word stage FUN_0041bf08) is shared by the event classes
 * (FUN_003a8320), the text-bins (FUN_003a6520) and the .fez effect files
 * (FUN_0023c418). Its constants (instruction immediates, shift amounts, the
 * byte table's address and bytes) and the fixed keys are not kept in the repo:
 * they are read here from the user's PAL SLES_541.85 at run time, each
 * instruction's opcode and registers checked first (the same table as
 * native/assets/models/kel_class.py CIPHER_INSNS).
 */
#ifndef DOC_CIPHER_H
#define DOC_CIPHER_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint8_t  k_add0;     /* FUN_0041bb38: key byte 0 += k_add0                       */
    uint8_t  k_add;      /*   byte i = (byte i-1 + byte i + k_add)                    */
    uint8_t  k_shl;      /*            ^ (byte i-1 << k_shl)                          */
    uint8_t  k_xor;      /*            ^ k_xor                                        */
    uint8_t  k_mul;      /*   word k = word k-1 * ((1 << k_mul) + 1)                  */
    uint8_t  m_s1, m_s2, m_s3; /* FUN_0041bf08: counter | counter << m_s1 | ...       */
    uint32_t mix;        /*   ... + mix                                               */
    uint8_t  b_xor;      /* FUN_0041bf78: first chain byte = (counter >> 3) ^ b_xor   */
    uint8_t  table[256]; /*   the byte table (its address from the lui / addiu pair)  */
} doc_cipher;

/* n bytes at virtual address va of the ELF (its PT_LOAD segments). 0 on success. */
int doc_elf_read(const char *elf_path, uint32_t va, void *out, size_t n,
                 char *err, size_t errlen);

/* Fill *c from the ELF. 0 on success; on error writes a message into err. */
int doc_cipher_load(const char *elf_path, doc_cipher *c, char *err, size_t errlen);

/* FUN_0023c3f0: the .fez key (the addiu that loads it). */
int doc_fez_key(const char *elf_path, uint64_t *key, char *err, size_t errlen);

/* FUN_003a6520: the text-bin header key (its ori / dsll chain). */
int doc_textbin_key(const char *elf_path, uint64_t *key, char *err, size_t errlen);

#endif /* DOC_CIPHER_H */
