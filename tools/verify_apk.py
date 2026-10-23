"""Inspect a real release APK with Android SDK tools; emit commit-bound evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def inspect(apk: Path, commit: str, output: Path):
    sdk = Path(os.environ.get('ANDROID_HOME', os.environ.get('ANDROID_SDK_ROOT', '')))
    candidates = [p for p in (sdk / 'build-tools').glob('*') if (p / 'aapt').exists()]
    if not candidates:
        raise SystemExit('Android build-tools/aapt unavailable')
    tools = sorted(candidates, key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.name)))[-1]
    badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
    match = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    if not match:
        raise SystemExit('APK package metadata missing')
    package, code, version = match.groups()
    if package != 'com.cinator.app' or version != '1.1.0' or code != '5':
        raise SystemExit(f'Unexpected APK identity: {match.group(0)}')
    signatures = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if 'assets/index.android.bundle' not in names:
            raise SystemExit('Embedded release JavaScript bundle missing')
        arch = [a for a in ('armeabi-v7a', 'arm64-v8a', 'x86_64') if any(n.startswith(f'lib/{a}/') for n in names)]
        if len(arch) != 3:
            raise SystemExit(f'Incomplete universal architectures: {arch}')
        debuggable = subprocess.check_output([str(tools / 'aapt'), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
        if re.search(r'android:debuggable[^\n]*0xffffffff', debuggable):
            raise SystemExit('Deliverable manifest is debuggable')
    digest = hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest()
    certificate = re.search(r'Signer #1 certificate SHA-256 digest: (\w+)', signatures)
    evidence = dict(commit=commit, artifact='cinetor-android-release', file=apk.name, package=package,
                    version=version, versionCode=int(code), sizeBytes=apk.stat().st_size, sha256=digest,
                    architectures=arch, releaseVariant=True, debuggable=False,
                    signing='Android debug certificate; NOT private distribution signing',
                    certificateSha256=certificate.group(1) if certificate else None,
                    signatureVerification=signatures.strip())
    output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', type=Path)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--output', type=Path, default=Path('release-evidence.json'))
    args = parser.parse_args()
    inspect(args.apk, args.commit, args.output)
