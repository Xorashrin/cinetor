"""Reject missing, skipped, or failed native tests instead of treating NO-SOURCE as verification."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--require-class', action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    reports = sorted(args.root.rglob('*.xml'))
    if not reports:
        raise SystemExit(f'No native test XML reports found: {args.root}')
    passed = {}
    failed = []
    total = 0
    for report in reports:
        tree = ET.parse(report)
        for case in tree.iter('testcase'):
            total += 1
            classname = case.get('classname', '')
            if case.find('failure') is not None or case.find('error') is not None or case.find('skipped') is not None:
                failed.append(f'{classname}.{case.get("name", "")}')
            else:
                passed[classname] = passed.get(classname, 0) + 1
    missing = [name for name in args.require_class if not any(key == name or key.endswith('.' + name) for key in passed)]
    evidence = {'totalTestCases': total, 'passedByClass': passed, 'failedOrSkipped': failed, 'missingRequiredClasses': missing,
                'reports': [str(path) for path in reports], 'verdict': 'PASS' if total and not failed and not missing else 'FAIL',
                'scope': 'Native automated tests only; not broad provider playback or physical-device acceptance.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))
    if evidence['verdict'] != 'PASS':
        raise SystemExit('Native verification is incomplete or failed.')


if __name__ == '__main__':
    main()
