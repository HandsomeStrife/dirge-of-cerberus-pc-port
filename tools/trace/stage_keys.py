"""stage_keys.py (worker 0219): the flag tables' XOR keys from a save state -> out/<name>.json (gitignored), for
test_stage_controller.mjs to read the stage traces (TRACE_FIELDSET=stage logs the stored, XORed bytes).

  python3 -I tools/trace/stage_keys.py [STATE.p2s] [-o tools/trace/out/w219_keys.json]

The global flags DAT_0050db20 are stored XOR DAT_0046f608 (FUN_0037cea0 / FUN_0037ce60), the stage flags (zone object
+0x38) XOR DAT_0047dbf0 (FUN_003ff738 / FUN_003ff658). Both keys are runtime RAM (not in the ELF image); every trace
that loads the same state shares them.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from p2s import read_p2s  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('state', nargs='?', default='/srv/shared/dirge-port/save-states/sea-of-flames.p2s')
ap.add_argument('-o', '--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'w219_keys.json'))
a = ap.parse_args()
ee = read_p2s(a.state)['eeMemory.bin']
json.dump(dict(state=os.path.basename(a.state), global_key=ee[0x46F608:0x46F648].hex(), zone_key=ee[0x47DBF0:0x47DC30].hex()),
          open(a.out, 'w'))
print('wrote', a.out)
