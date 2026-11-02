/* doc_cipher.c - see doc_cipher.h. Reads the cipher constants from the ELF's own
 * instructions; no constant of the cipher is kept here, only where to find it. */
#include "doc_cipher.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ERR(...) do{ if(err&&errlen) snprintf(err,errlen,__VA_ARGS__); return -1; }while(0)

static uint32_t le32(const uint8_t *p){
    return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24); }
static uint16_t le16(const uint8_t *p){ return (uint16_t)(p[0]|(p[1]<<8)); }

int doc_elf_read(const char *elf_path, uint32_t va, void *out, size_t n,
                 char *err, size_t errlen){
    if(!elf_path||!*elf_path) ERR("no ELF given (--elf <SLES_541.85>)");
    FILE *f=fopen(elf_path,"rb");
    if(!f) ERR("cannot open ELF '%s'",elf_path);
    uint8_t eh[0x34];
    if(fread(eh,1,sizeof eh,f)!=sizeof eh||memcmp(eh,"\x7f" "ELF",4)){ fclose(f); ERR("'%s' is not an ELF",elf_path); }
    uint32_t phoff=le32(eh+0x1c); uint16_t phsz=le16(eh+0x2a), phn=le16(eh+0x2c);
    for(unsigned i=0;i<phn;i++){
        uint8_t ph[0x20];
        if(phsz<0x20||fseek(f,(long)phoff+(long)i*phsz,SEEK_SET)||fread(ph,1,0x20,f)!=0x20) break;
        uint32_t type=le32(ph), off=le32(ph+4), vaddr=le32(ph+8), fsz=le32(ph+0x10);
        if(type==1&&vaddr<=va&&(uint64_t)va+n<=(uint64_t)vaddr+fsz){
            int ok=!fseek(f,(long)(off+(va-vaddr)),SEEK_SET)&&fread(out,1,n,f)==n;
            fclose(f);
            if(!ok) ERR("short read of the ELF at %#x",va);
            return 0;
        }
    }
    fclose(f);
    ERR("address %#x not in the ELF",va);
}

/* One instruction that carries a constant: opcode, rs (-1 = unchecked), rt,
 * funct for SPECIAL (-1 = none), and which field holds the value. */
typedef struct { uint32_t addr; int op, rs, rt, funct; int sa; } insn_t;

static int insn_field(const char *elf, const insn_t *s, uint32_t *val,
                      const char *what, char *err, size_t errlen){
    uint8_t b[4];
    if(doc_elf_read(elf,s->addr,b,4,err,errlen)) return -1;
    uint32_t w=le32(b);
    if((int)(w>>26)!=s->op||(s->rs>=0&&(int)((w>>21)&31)!=s->rs)||(int)((w>>16)&31)!=s->rt
       ||(s->funct>=0&&(int)(w&63)!=s->funct))
        ERR("%s: unexpected instruction %#010x at %#x (not SLES_541.85?)",what,w,s->addr);
    *val=s->sa?((w>>6)&31):(w&0xffff);
    return 0;
}

#define ADDIU(a,rs,rt) {a,0x09,rs,rt,-1,0}
#define ORI(a,rs,rt)   {a,0x0d,rs,rt,-1,0}
#define XORI(a,rs,rt)  {a,0x0e,rs,rt,-1,0}
#define LUI(a,rt)      {a,0x0f,0,rt,-1,0}
#define SLL(a,rt)      {a,0x00,0,rt,0x00,1}
#define DSLL(a,rt)     {a,0x00,0,rt,0x38,1}

int doc_cipher_load(const char *elf_path, doc_cipher *c, char *err, size_t errlen){
    /* Same instructions as kel_class.py CIPHER_INSNS. */
    static const insn_t I[] = {
        ADDIU(0x41BB84,2,2),   /* 0 FUN_0041bb38: addiu v0, v0, imm  (key byte 0)   */
        ADDIU(0x41BB94,2,2),   /* 1               addiu v0, v0, imm  (byte i)       */
        SLL  (0x41BB9C,3),     /* 2               sll   v1, v1, sa   (byte i-1)     */
        XORI (0x41BBA4,2,2),   /* 3               xori  v0, v0, imm                 */
        DSLL (0x41BBD4,2),     /* 4               dsll  v1, v0, sa   (word x 2^sa+1)*/
        ORI  (0x41BF0C,0,8),   /* 5 FUN_0041bf08: ori   t0, zero, imm (mix, high)   */
        DSLL (0x41BF10,8),     /* 6               dsll  t0, t0, sa                  */
        ORI  (0x41BF14,8,8),   /* 7               ori   t0, t0, imm  (mix, low)     */
        DSLL (0x41BF28,9),     /* 8               dsll  counter << sa               */
        DSLL (0x41BF30,9),     /* 9                                                 */
        DSLL (0x41BF38,9),     /* 10                                                */
        LUI  (0x41BF7C,3),     /* 11 FUN_0041bf78: lui  v1, imm      (table, high)  */
        ADDIU(0x41BF84,3,12),  /* 12              addiu t4, v1, imm  (signed low)   */
        XORI (0x41BF90,2,2),   /* 13              xori  v0, v0, imm  (counter>>3 ^) */
    };
    uint32_t v[sizeof I/sizeof I[0]];
    for(size_t i=0;i<sizeof I/sizeof I[0];i++)
        if(insn_field(elf_path,&I[i],&v[i],"block cipher",err,errlen)) return -1;
    c->k_add0=(uint8_t)v[0]; c->k_add=(uint8_t)v[1]; c->k_shl=(uint8_t)v[2];
    c->k_xor=(uint8_t)v[3]; c->k_mul=(uint8_t)v[4];
    c->mix=(v[5]<<v[6])|v[7];
    c->m_s1=(uint8_t)v[8]; c->m_s2=(uint8_t)v[9]; c->m_s3=(uint8_t)v[10];
    c->b_xor=(uint8_t)v[13];
    uint32_t tva=(v[11]<<16)+(uint32_t)(int32_t)(int16_t)v[12];
    return doc_elf_read(elf_path,tva,c->table,256,err,errlen);
}

int doc_fez_key(const char *elf_path, uint64_t *key, char *err, size_t errlen){
    static const insn_t I = ADDIU(0x23C3F0,0,3);   /* FUN_0023c3f0: addiu v1, zero, imm; sd v1 */
    uint32_t v;
    if(insn_field(elf_path,&I,&v,"FUN_0023c3f0",err,errlen)) return -1;
    *key=(uint64_t)(int64_t)(int16_t)v;
    return 0;
}

int doc_textbin_key(const char *elf_path, uint64_t *key, char *err, size_t errlen){
    /* FUN_003a6520: a0 = ori; then three (dsll a0, a0, sa; ori a0, a0, imm). */
    static const insn_t I[] = {
        ORI(0x3A6524,0,4), DSLL(0x3A6528,4), ORI(0x3A652C,4,4), DSLL(0x3A6530,4),
        ORI(0x3A6534,4,4), DSLL(0x3A6538,4), ORI(0x3A653C,4,4),
    };
    uint32_t v; uint64_t k=0;
    for(size_t i=0;i<sizeof I/sizeof I[0];i++){
        if(insn_field(elf_path,&I[i],&v,"FUN_003a6520",err,errlen)) return -1;
        if(I[i].sa) k<<=v; else k|=v;
    }
    *key=k;
    return 0;
}
