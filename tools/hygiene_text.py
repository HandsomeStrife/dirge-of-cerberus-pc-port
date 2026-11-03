#!/usr/bin/env python3
"""hygiene_text.py -- check that no game text sits in tracked files (the repo is public).

    python3 -I tools/hygiene_text.py [--data native/web/data] [--allow tools/hygiene_allow.txt] [-v]

Loads every exported message string from the gitignored web data (any "messages" map, at any depth, in
native/web/data/**/*.json; values are hex-encoded bytes or plain text), cuts each into its text runs (at control
bytes, two-byte codes >= 0x80 and the text's '$' codes), and looks for every run of 6+ characters (with 3+ letters)
in the files `git ls-files` lists. A hit prints file:line and the run's first 3 characters and length only (never
the run itself) and makes the exit status 1. Exit 0 when clean, 2 when there is no data to check against.

Generic words: a run is skipped when it is in the allowlist file (one entry per line, '#' comments, case and runs of
spaces ignored; for ordinary English words, or a name the manager has cleared). The tool itself holds no game strings.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MIN_LEN, MIN_LETTERS = 6, 3
CODE = re.compile(rb'\$(?:i[\x21-\x7e]{2}|[A-Za-z&][0-9]*)\$?')     # '$' text codes (FUN_003d1d98; $i + 2 characters: an image)
CUT = re.compile(rb'[\x00-\x1f\x80-\xff]+')                       # control bytes, two-byte codes


def decode(v):
    if not isinstance(v, str):
        return None
    if len(v) % 2 == 0 and re.fullmatch(r'[0-9a-fA-F]*', v):
        try:
            return bytes.fromhex(v)
        except ValueError:
            pass
    return v.encode('latin-1', 'replace')


def runs(b):
    for part in CUT.split(CODE.sub(b'\x00', b)):
        t = part.decode('latin-1').strip()
        t = re.sub(r'\s+', ' ', t)
        if len(t) >= MIN_LEN and sum(c.isalpha() for c in t) >= MIN_LETTERS:
            yield t


def collect(data_dir):
    found = set()

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'messages' and isinstance(v, dict):
                    for x in v.values():
                        b = decode(x)
                        if b:
                            found.update(runs(b))
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    for dp, _, fs in os.walk(data_dir):
        for f in fs:
            if not f.endswith('.json'):
                continue
            p = os.path.join(dp, f)
            if os.path.getsize(p) > 64 << 20:
                continue
            try:
                walk(json.load(open(p, 'rb')))
            except (ValueError, OSError):
                continue
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.path.join(ROOT, 'native/web/data'))
    ap.add_argument('--allow', default=os.path.join(HERE, 'hygiene_allow.txt'))
    ap.add_argument('-v', action='store_true', help='also print how many runs were checked')
    a = ap.parse_args()
    allow = set()
    if os.path.exists(a.allow):
        for line in open(a.allow, encoding='utf-8'):
            w = line.split('#', 1)[0].strip().lower()
            if w:
                allow.add(w)
    texts = {t for t in collect(a.data) if re.sub(r'\s+', ' ', t.lower()) not in allow}
    if not texts:
        print('hygiene_text: no exported messages under %s (build the web data first)' % a.data)
        return 2
    pats = [(t, re.compile(r'(?<![A-Za-z0-9])' + re.escape(t) + r'(?![A-Za-z0-9])', re.I)) for t in sorted(texts, key=len, reverse=True)]
    files = subprocess.run(['git', '-C', ROOT, 'ls-files', '-z'], capture_output=True, check=True).stdout.split(b'\0')
    hits = 0
    for rel in files:
        if not rel:
            continue
        p = os.path.join(ROOT, rel.decode('utf-8', 'replace'))
        try:
            if os.path.getsize(p) > 8 << 20:
                continue
            raw = open(p, 'rb').read()
        except OSError:
            continue
        if b'\0' in raw[:4096]:
            continue                                                   # binary
        body = raw.decode('utf-8', 'replace')
        low = body.lower()
        for t, rx in pats:
            if t.lower() not in low:
                continue
            for m in rx.finditer(body):
                line = body.count('\n', 0, m.start()) + 1
                print('%s:%d: %s... (%d chars)' % (rel.decode('utf-8', 'replace'), line, t[:3], len(t)))
                hits += 1
    if a.v:
        print('hygiene_text: %d message runs checked against %d tracked files' % (len(pats), len(files) - 1))
    print('hygiene_text: %d hit(s)' % hits if hits else 'hygiene_text: clean')
    return 1 if hits else 0


if __name__ == '__main__':
    sys.exit(main())
