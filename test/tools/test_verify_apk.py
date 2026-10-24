"""Cloud-only regressions for APK signer parsing and update compatibility."""
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    'verify_apk', Path(__file__).resolve().parents[2] / 'tools' / 'verify_apk.py')
verify_apk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_apk)


class SigningEvidenceTest(unittest.TestCase):
    certificate = 'a' * 64

    def output(self, signer='Signer #1', certificate=None, signers=1):
        return (f'Verifies\nNumber of signers: {signers}\n'
                f'{signer} certificate SHA-256 digest: {certificate or self.certificate}\n')

    def test_legacy_and_versioned_signer_formats(self):
        for signer in ('Signer #1', 'V2 Signer:', 'V3.0 Signer:'):
            with self.subTest(signer=signer):
                self.assertEqual(verify_apk.verify_certificate(self.output(signer), self.certificate), self.certificate)

    def test_same_certificate_across_signature_schemes(self):
        output = self.output('V2 Signer:') + f'V3.0 Signer: certificate SHA-256 digest: {self.certificate.upper()}\n'
        self.assertEqual(verify_apk.verify_certificate(output, self.certificate), self.certificate)

    def test_missing_ambiguous_or_changed_certificates_fail(self):
        outputs = [
            'Verifies\nNumber of signers: 1\n',
            self.output(certificate='b' * 64),
            self.output(signers=2),
            self.output(certificate='a' * 63),
            self.output() + f'V3.0 Signer: certificate SHA-256 digest: {"b" * 64}\n',
        ]
        for output in outputs:
            with self.subTest(output=output):
                with self.assertRaises(SystemExit):
                    verify_apk.verify_certificate(output, self.certificate)

    def test_invalid_expected_pin_fails(self):
        with self.assertRaises(SystemExit):
            verify_apk.verify_certificate(self.output(), '')


class NativeArchitectureTest(unittest.TestCase):
    architectures = {'armeabi-v7a': (1, 40), 'arm64-v8a': (2, 183), 'x86_64': (2, 62)}

    def fixture(self, omit=None, corrupt=None):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            for abi, (elf_class, machine) in self.architectures.items():
                header = bytearray(20)
                header[:7] = b'\x7fELF' + bytes((elf_class, 1, 1))
                header[16:18] = (3).to_bytes(2, 'little')
                header[18:20] = machine.to_bytes(2, 'little')
                for library in ('libreactnative.so', 'libquickjs.so'):
                    name = f'lib/{abi}/{library}'
                    if name != omit:
                        archive.writestr(name, b'not an ELF library' if name == corrupt else header)
        return zipfile.ZipFile(data)

    def test_complete_arm_and_emulator_library_sets(self):
        with self.fixture() as archive:
            libraries = verify_apk.verify_native_libraries(archive)
        self.assertEqual(set(libraries), set(self.architectures))
        for names in libraries.values():
            self.assertEqual(names, ['libquickjs.so', 'libreactnative.so'])

    def test_one_library_in_each_directory_is_not_enough(self):
        with self.fixture(omit='lib/armeabi-v7a/libquickjs.so') as archive:
            with self.assertRaisesRegex(SystemExit, 'Incomplete native libraries for armeabi-v7a'):
                verify_apk.verify_native_libraries(archive)

    def test_invalid_elf_is_rejected(self):
        with self.fixture(corrupt='lib/arm64-v8a/libquickjs.so') as archive:
            with self.assertRaisesRegex(SystemExit, 'ELF architecture'):
                verify_apk.verify_native_libraries(archive)

    def test_empty_native_payload_is_rejected(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w'):
            pass
        with zipfile.ZipFile(data) as archive:
            with self.assertRaises(SystemExit):
                verify_apk.verify_native_libraries(archive)


if __name__ == '__main__':
    unittest.main()
