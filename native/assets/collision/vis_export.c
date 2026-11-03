/* vis_export.c - the room visibility probe's data for the browser (worker 0225). C99.
 *
 *   cidvis <out.json> <0680cc11.bin>...
 *
 * FUN_00264ee0 (every frame) casts FUN_0026a320(eye, eye + (0, 100, 0), 0x10f) through the
 * +0x58 sub-tree of each loaded chunk's cid. FUN_0026f8a0 tests a tag-2 packet only when its
 * mask (pkt+0x08) has a bit outside 0x10f | 0x100 (DAT_004e8898), and on the nearest hit copies
 * entry header[3] of that cid's surface table (+0x24, count +0x20) to DAT_004e8880, which
 * FUN_00269400 stores as DAT_004e86f0 (the 128-bit visibility mask). This writes, per input
 * file: its chunk (FileCode byte 2, 0680cc11), its surface table, and the triangles of the
 * +0x58 tag-2 packets that pass that mask test, with the packet's mask and header[3].
 * The tables are game data: the output belongs in native/web/data (not tracked).
 */
#include "cid.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PROBE_CLASS 0x10fu   /* FUN_00264ee0's third argument; FUN_00271408 ors in 0x100 */

static int chunk_of(const char *path) {
    const char *b = strrchr(path, '/'); b = b ? b + 1 : path;
    unsigned fc;
    if (strlen(b) < 8 || sscanf(b, "%8x", &fc) != 1 || (fc >> 16) != 0x0680 || (fc & 0xff) != 0x11)
        return -1;
    return (int)((fc >> 8) & 0xff);
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <out.json> <0680cc11.bin>...\n", argv[0]); return 2; }
    FILE *o = fopen(argv[1], "w");
    if (!o) { fprintf(stderr, "error: cannot write %s\n", argv[1]); return 1; }
    fprintf(o, "{\"version\": 1, \"probe\": {\"class\": %u, \"dy\": 100.0}, \"chunks\": [", PROBE_CLASS);
    int ntot = 0;
    for (int f = 2; f < argc; f++) {
        int chunk = chunk_of(argv[f]);
        if (chunk < 0) { fprintf(stderr, "error: %s: not a z128 cid file name (0680cc11)\n", argv[f]); return 1; }
        cid_mesh m; char err[256];
        int r = cid_load_file(argv[f], &m, err, sizeof err);
        if (r != CID_OK) { fprintf(stderr, "error: %s: %s\n", argv[f], cid_strerror(r)); return 1; }
        fprintf(o, "%s\n {\"chunk\": %d, \"table\": [", f > 2 ? "," : "", chunk);
        for (int i = 0; m.surf_table && i < m.surf_table_count; i++)
            fprintf(o, "%s[%u, %u, %u, %u]", i ? ", " : "", m.surf_table[i * 4], m.surf_table[i * 4 + 1],
                    m.surf_table[i * 4 + 2], m.surf_table[i * 4 + 3]);
        fprintf(o, "],\n  \"tris\": [");
        int n = 0;
        for (int t = 0; t < m.ntris; t++) {
            const cid_tri *tr = &m.tris[t];
            /* FUN_002714d0 walks +0x58 (sub-tree 1); FUN_0026f8a0: mask & ~DAT_004e8898 */
            if (tr->subtree != 1 || tr->source != CID_SRC_VU_PACKED) continue;
            if ((tr->mask & ~(PROBE_CLASS | 0x100u)) == 0) continue;
            fprintf(o, "%s[%u, %d", n ? ",\n   " : "", tr->mask, tr->vis_index);
            for (int a = 0; a < 3; a++) {
                const cid_vec3 *v = &m.verts[tr->v[a]];
                fprintf(o, ", %.9g, %.9g, %.9g", v->x, v->y, v->z);
            }
            fprintf(o, "]");
            n++;
        }
        fprintf(o, "]}");
        fprintf(stderr, "%s: chunk %02x, table %d, probe tris %d\n", argv[f], chunk, m.surf_table_count, n);
        ntot += n;
        cid_free(&m);
    }
    fprintf(o, "]}\n");
    if (fclose(o) != 0) { fprintf(stderr, "write failed: %s\n", argv[1]); return 1; }
    printf("wrote %s: %d probe triangles\n", argv[1], ntot);
    return 0;
}
