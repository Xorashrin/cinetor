"""Inspect a real release APK with Android SDK tools; emit commit-bound evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def verify_certificate(signatures: str, expected: str) -> str:
    signers = re.search(r'^Number of signers:\s*(\d+)\s*$', signatures, re.MULTILINE)
    certificates = {value.lower() for value in re.findall(
        r'^(?:Signer #\d+|V\d+(?:\.\d+)? Signer):? certificate SHA-256 digest: ([0-9a-fA-F]{64})\s*$',
        signatures, re.MULTILINE)}
    if not signers or signers.group(1) != '1' or len(certificates) != 1:
        raise SystemExit('APK must report exactly one signer and one certificate SHA-256 digest')
    certificate = next(iter(certificates))
    if not re.fullmatch(r'[0-9a-f]{64}', expected) or certificate != expected:
        raise SystemExit('APK signing certificate differs from the recorded v1.1.1 update certificate')
    return certificate


def verify_native_libraries(archive: zipfile.ZipFile) -> dict[str, list[str]]:
    expected = {'armeabi-v7a': (1, 40), 'arm64-v8a': (2, 183), 'x86_64': (2, 62)}
    libraries = {abi: set() for abi in expected}
    for name in archive.namelist():
        parts = name.split('/')
        if len(parts) != 3 or parts[0] != 'lib' or not parts[2].endswith('.so'):
            continue
        _, abi, library = parts
        if abi not in expected:
            raise SystemExit(f'Unexpected native architecture: {abi}')
        if library in libraries[abi]:
            raise SystemExit(f'Duplicate native library: {name}')
        with archive.open(name) as source:
            header = source.read(20)
        elf_class, machine = expected[abi]
        if (len(header) != 20 or header[:4] != b'\x7fELF' or header[4] != elf_class or
                header[5:7] != b'\x01\x01' or int.from_bytes(header[16:18], 'little') != 3 or
                int.from_bytes(header[18:20], 'little') != machine):
            raise SystemExit(f'Native library ELF architecture does not match its APK directory: {name}')
        libraries[abi].add(library)
    required = set().union(*libraries.values())
    for abi, names in libraries.items():
        if not names or names != required:
            raise SystemExit(f'Incomplete native libraries for {abi}: missing {sorted(required - names)}')
    return {abi: sorted(names) for abi, names in libraries.items()}


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
    root = Path(__file__).resolve().parents[1]
    config = json.loads((root / 'app.json').read_text())['expo']
    signing = json.loads((root / 'config/android-signing.json').read_text())
    if package != config['android']['package'] or package != signing['package'] or version != config['version'] or code != str(config['android']['versionCode']):
        raise SystemExit(f'Unexpected APK identity: {match.group(0)}')
    sdk_versions = re.search(r"sdkVersion:'(\d+)'", badging), re.search(r"targetSdkVersion:'(\d+)'", badging)
    if not all(sdk_versions):
        raise SystemExit('APK Android SDK requirements missing')
    min_sdk, target_sdk = (int(match.group(1)) for match in sdk_versions)
    build_properties = next(plugin[1]['android'] for plugin in config['plugins']
                            if isinstance(plugin, list) and plugin[0] == 'expo-build-properties')
    if min_sdk != build_properties['minSdkVersion'] or target_sdk != build_properties['targetSdkVersion']:
        raise SystemExit(f'Unexpected APK Android SDK requirements: min {min_sdk}, target {target_sdk}')
    signatures = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    certificate = verify_certificate(signatures, signing['expectedCertificateSha256'])
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if 'assets/index.android.bundle' not in names:
            raise SystemExit('Embedded release JavaScript bundle missing')
        native_libraries = verify_native_libraries(archive)
        arch = list(native_libraries)
        debuggable = subprocess.check_output([str(tools / 'aapt'), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
        if re.search(r'android:debuggable[^\n]*0xffffffff', debuggable):
            raise SystemExit('Deliverable manifest is debuggable')
    with apk.open('rb') as archive:
        digest = hashlib.file_digest(archive, 'sha256').hexdigest()
    evidence = dict(commit=commit, artifact='cinetor-android-release', file=apk.name, package=package,
                    version=version, versionCode=int(code), sizeBytes=apk.stat().st_size, sha256=digest,
                    architectures=arch, nativeLibraries=native_libraries, minSdkVersion=min_sdk,
                    targetSdkVersion=target_sdk, releaseVariant=True, debuggable=False,
                    signing=signing['signing'],
                    certificateSha256=certificate, matchesRecordedUpdateCertificate=True,
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
