#!/usr/bin/env python3
"""Compare matching mock n8n suites without hiding unchanged failures."""
import argparse
import json
from pathlib import Path


def compare(before, after):
    if before.get('variant', 'baseline') != 'baseline' or after.get('variant') != 'milestone2':
        raise ValueError('Expected baseline and milestone2 report variants, in that order')
    if before['sourceSha256'] == after['sourceSha256']:
        raise ValueError('Cannot compare a workflow against itself')
    def checks(report):
        return {(s['scenario'], c['name']): c['status'] for s in report['scenarios'] for c in s['checks']}
    old, new = checks(before), checks(after)
    if old.keys() != new.keys():
        raise ValueError('Suites have different assertions; compare matching extended runs')
    improved = [k for k in old if old[k] == 'FAIL' and new[k] == 'PASS']
    regressed = [k for k in old if old[k] == 'PASS' and new[k] == 'FAIL']
    remaining = [k for k in new if new[k] == 'FAIL']
    lines = ['# Milestone 2 comparison', '', 'Mock-backed n8n execution; no live integration verification.', '',
             '| Scenario | Baseline | Milestone 2 |', '|---|---|---|']
    previous = {s['scenario']: s['status'] for s in before['scenarios']}
    lines += [f"| {s['scenario']} | {previous[s['scenario']]} | {s['status']} |" for s in after['scenarios']]
    for title, items in [('Fixed assertions', improved), ('Regressions', regressed), ('Remaining failures', remaining)]:
        lines += ['', '## ' + title, ''] + ([f'- {s}: {c}' for s, c in items] or ['None.'])
    return '\n'.join(lines) + '\n', regressed


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline', type=Path)
    p.add_argument('updated', type=Path)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    text, regressions = compare(json.loads(args.baseline.read_text()), json.loads(args.updated.read_text()))
    with args.output.open('x') as f:
        f.write(text)
    print(text)
    raise SystemExit(1 if regressions else 0)
