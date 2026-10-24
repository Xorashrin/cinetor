"""Cloud-only regressions for APK signer parsing and update compatibility."""
import importlib.util
from pathlib import Path
import unittest


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


if __name__ == '__main__':
    unittest.main()
