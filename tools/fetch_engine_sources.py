#!/usr/bin/env python3
"""Pinned native-engine intake and original fixture packaging. Run builds only in CI.

This script never imports or executes downloaded code. Each download is placed in
its own new empty directory. Run with python3 -I from the repository root.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import urllib.request
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "modules/cinetor-engines"
LOCK = ROOT / "config/engine-lock.json"
MAX_AAR = 16 * 1024 * 1024
MAX_ARCHIVE = 128 * 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit(message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_lock():
    return json.loads(LOCK.read_text(), object_pairs_hook=no_duplicates)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fresh_download(url: str, limit: int, expected: str | None = None, size: int | None = None) -> Path:
    allowed_hosts = {"codeload.github.com", "repo.maven.apache.org", "jitpack.io", "raw.githubusercontent.com"}
    def validate(url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in allowed_hosts or parsed.username or parsed.password or parsed.port not in (None, 443):
            fail("Source intake requires an approved HTTPS origin without credentials")
    class PinnedRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, response, code, message, headers, new_url):
            validate(new_url)
            return super().redirect_request(request, response, code, message, headers, new_url)
    validate(url)
    directory = Path(tempfile.mkdtemp(prefix="cinetor-pinned-download-"))
    destination = directory / "artifact"
    request = urllib.request.Request(url, headers={"User-Agent": "Cinetor-pinned-source-intake/1"})
    opener = urllib.request.build_opener(PinnedRedirect())
    with opener.open(request, timeout=60) as response:
        validate(response.geturl())
        data = response.read(limit + 1)
    if len(data) > limit:
        fail("Downloaded artifact exceeds intake limit")
    if size is not None and len(data) != size:
        fail("Pinned artifact size mismatch")
    if expected is not None and digest(data) != expected:
        fail("Pinned artifact SHA-256 mismatch")
    destination.write_bytes(data)
    return destination


def core_aar(lock) -> Path:
    item = lock["engines"]["cloudstream"]
    return fresh_download(item["artifactUrl"], MAX_AAR, item["sha256"], item["size"])


def zip_members(archive: zipfile.ZipFile, limit=MAX_ARCHIVE):
    names = set()
    total = 0
    for member in archive.infolist():
        name = member.filename
        path = PurePosixPath(name)
        if name in names or name.startswith("/") or "\\" in name or any(p in ("..", ".") for p in path.parts):
            fail("Unsafe or duplicate archive member")
        names.add(name)
        total += member.file_size
        if len(names) > 8192 or total > limit or ((member.external_attr >> 16) & 0o170000) == 0o120000:
            fail("Archive exceeds intake policy")
        yield member


def jar_from_aar(aar: Path, destination: Path):
    if not aar.is_file() or aar.stat().st_size > MAX_ARCHIVE:
        fail("Missing or oversized AAR")
    with zipfile.ZipFile(aar) as archive:
        list(zip_members(archive))
        data = archive.read("classes.jar")
    destination.write_bytes(data)


def verify_fixture_sources(lock):
    entry = next(p for p in lock["plugins"] if p["id"] == "cinetor-bbb-cloudstream")
    for relative, pin in entry["sourceFiles"].items():
        path = (ROOT / relative).resolve()
        if not path.is_relative_to(MODULE.resolve()) or digest(path.read_bytes()) != pin:
            fail(f"Owned fixture source pin mismatch: {relative}")
    return entry


def prepare_fixture(args, lock):
    verify_fixture_sources(lock)
    destination = MODULE / "fixtures/cloudstream/sdk"
    if destination.exists():
        fail("Fixture SDK directory must be new and empty; use a fresh CI checkout")
    destination.mkdir(parents=True)
    core = core_aar(lock)
    host = Path(args.host_aar).resolve()
    if not host.is_relative_to(MODULE.resolve()):
        fail("Bootstrap host AAR must come from this module's CI build")
    jar_from_aar(core, destination / "cloudstream-classes.jar")
    jar_from_aar(host, destination / "host-classes.jar")
    print("Prepared exact native API compile-only JARs; no third-party code executed")


def package_fixture(args, lock):
    entry = verify_fixture_sources(lock)
    apk = Path(args.fixture_apk).resolve()
    if not apk.is_relative_to((MODULE / "fixtures/cloudstream/build").resolve()):
        fail("Fixture APK must come from the original fixture CI project")
    if apk.stat().st_size > MAX_AAR:
        fail("Fixture APK is oversized")
    selected = {}
    with zipfile.ZipFile(apk) as archive:
        for item in zip_members(archive, 32 * 1024 * 1024):
            name = item.filename
            if item.is_dir():
                continue
            if name in ("classes.dex", "resources.arsc", "AndroidManifest.xml") or name.startswith("res/"):
                selected[name] = archive.read(item)
            elif name.startswith("classes") and name.endswith(".dex"):
                fail("Owned fixture unexpectedly contains multidex output")
    if not all(name in selected for name in ("classes.dex", "resources.arsc", "AndroidManifest.xml")):
        fail("Fixture must contain actual DEX and compiled Android resources")
    dex = selected["classes.dex"]
    if not dex.startswith(b"dex\n") or b"Lcom/cinetor/fixture/BlenderPlugin;" not in dex:
        fail("Original fixture plugin was not compiled into DEX")
    # Compile-only dependencies must not appear as DEX definitions. The references
    # may appear in strings; only class_def descriptors are inspected here.
    import struct
    string_count, string_offset = struct.unpack_from("<II", dex, 56)
    type_count, type_offset = struct.unpack_from("<II", dex, 64)
    class_count, class_offset = struct.unpack_from("<II", dex, 96)
    if class_count > 512 or string_count > 100000 or type_count > 100000:
        fail("Unexpected fixture DEX size")
    def dex_string(index):
        offset = struct.unpack_from("<I", dex, string_offset + index * 4)[0]
        for _ in range(5):
            byte = dex[offset]; offset += 1
            if byte < 128:
                break
        end = dex.index(0, offset)
        return dex[offset:end].decode("utf-8")
    for index in range(class_count):
        type_index = struct.unpack_from("<I", dex, class_offset + index * 32)[0]
        string_index = struct.unpack_from("<I", dex, type_offset + type_index * 4)[0]
        descriptor = dex_string(string_index)
        if not descriptor.startswith("Lcom/cinetor/fixture/"):
            fail(f"Host or runtime class packaged inside fixture DEX: {descriptor}")
    selected["manifest.json"] = json.dumps({"name": "CinetorBlenderFixture", "version": 1,
        "pluginClassName": "com.cinetor.fixture.BlenderPlugin", "requiresResources": True}, sort_keys=True).encode()
    destination = MODULE / "android/generated-assets/cinetor"
    (destination / "plugins").mkdir(parents=True, exist_ok=True)
    asset = destination / "plugins/bbb.cs3"
    with zipfile.ZipFile(asset, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(selected.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100444 << 16
            archive.writestr(info, data)
    pin = {"pluginId": entry["id"], "profile": entry["profile"], "sha256": digest(asset.read_bytes()),
        "size": asset.stat().st_size, "sourceLicense": entry["license"], "sourceFiles": entry["sourceFiles"],
        "buildEvidence": "compiled-in-ci-not-runtime-tested"}
    (destination / "owned-fixture.json").write_text(json.dumps(pin, indent=2) + "\n")
    print(json.dumps(pin, indent=2))


def copy_notices():
    destination = MODULE / "android/generated-assets/cinetor/licenses"
    destination.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / "licenses/engines").glob("*"):
        if source.is_file():
            shutil.copyfile(source, destination / source.name)


def source_bundle(args, lock):
    destination = Path(args.output).resolve()
    if destination.exists():
        fail("Corresponding-source output must be a new directory")
    destination.mkdir(parents=True)
    records = []
    for entry in lock["correspondingSources"]:
        # Revision is immutable; record downloaded source-archive hashes for the
        # release receipt. Do not confuse GitHub-generated archive hashes with
        # the separately verified published AAR hashes.
        source = fresh_download(entry["url"], MAX_ARCHIVE, entry.get("sha256"))
        target = destination / (entry["id"] + ".tar.gz")
        shutil.copyfile(source, target)
        records.append({**entry, "archiveSha256": digest(target.read_bytes()), "size": target.stat().st_size})
    (destination / "SOURCE_RECEIPTS.json").write_text(json.dumps(records, indent=2) + "\n")
    shutil.copytree(ROOT / "licenses/engines", destination / "licenses")
    shutil.copyfile(LOCK, destination / "engine-lock.json")
    print("Downloaded immutable-revision source archives without extracting or executing them")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare-fixture", action="store_true")
    action.add_argument("--package-fixture", action="store_true")
    action.add_argument("--verify-artifacts", action="store_true")
    action.add_argument("--source-bundle", action="store_true")
    parser.add_argument("--host-aar")
    parser.add_argument("--fixture-apk")
    parser.add_argument("--output")
    args = parser.parse_args()
    lock = load_lock()
    if args.prepare_fixture:
        if not args.host_aar:
            parser.error("--host-aar is required")
        prepare_fixture(args, lock)
    elif args.package_fixture:
        if not args.fixture_apk:
            parser.error("--fixture-apk is required")
        package_fixture(args, lock)
        copy_notices()
    elif args.verify_artifacts:
        for engine in lock["engines"].values():
            if "artifactUrl" in engine:
                fresh_download(engine["artifactUrl"], MAX_AAR, engine["sha256"], engine["size"])
        print("Pinned published artifact hashes verified; runtime and ABI tests NOT RUN")
    else:
        if not args.output:
            parser.error("--output is required")
        source_bundle(args, lock)


if __name__ == "__main__":
    main()
