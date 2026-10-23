"""Require the signed release to render its Home screen before publication."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', type=Path)
    parser.add_argument('--serial')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    command = ['adb'] + (['-s', args.serial] if args.serial else [])
    package = 'com.cinator.app'

    def adb(*items):
        return subprocess.check_output(command + list(items), timeout=30)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    adb('install', '-r', str(args.apk))
    adb('shell', 'am', 'force-stop', package)
    adb('logcat', '-c')
    adb('shell', 'input', 'keyevent', '82')
    adb('shell', 'am', 'start', '-n', package + '/.MainActivity')
    started = time.monotonic()
    passed = False
    xml = b''
    logs = b''
    while time.monotonic() - started < 65:
        time.sleep(3)
        logs = adb('logcat', '-d', '-s', 'AndroidRuntime:E', 'ReactNativeJS:E')
        if b'FATAL EXCEPTION' in logs and package.encode() in logs:
            break
        adb('shell', 'uiautomator', 'dump', '/sdcard/cinetor-smoke.xml')
        xml = adb('exec-out', 'cat', '/sdcard/cinetor-smoke.xml')
        nodes = list(ET.fromstring(xml).iter('node'))
        app_nodes = [node for node in nodes if node.get('package') == package]
        values = [node.get('text', '') + ' ' + node.get('content-desc', '') for node in app_nodes]
        if any('Home' in value for value in values) and any('Anime' in value for value in values):
            if adb('shell', 'pidof', package).strip():
                passed = True
                break
    (args.output.parent / 'startup-logcat.txt').write_bytes(logs)
    (args.output.parent / 'startup-ui.xml').write_bytes(xml)
    (args.output.parent / 'startup-screen.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    evidence = {
        'apkSha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
        'package': package,
        'api': adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip(),
        'architecture': adb('shell', 'getprop', 'ro.product.cpu.abi').decode().strip(),
        'startup': 'pass' if passed else 'fail',
        'homeAndAnimeNavigationRendered': passed,
        'elapsedSeconds': round(time.monotonic() - started, 1),
        'playback': 'not tested by this startup validator',
    }
    args.output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))
    if not passed:
        print(logs.decode(errors='replace')[-5000:])
        raise SystemExit('VERDICT: FAIL -- release did not render the Home screen')
    print('VERDICT: PASS')


if __name__ == '__main__':
    main()
