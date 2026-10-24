const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withGradleProperties } = require('expo/config-plugins');

const NETWORK_SECURITY = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors><certificates src="system" /></trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

/** The loopback exception serves only native-registered BDIX media capabilities. */
module.exports = function withCinetorAndroid(config) {
  config = withGradleProperties(config, value => {
    // Match Expo's AGP 9 compatibility mode and compile all native engines with Kotlin 2.4.10.
    const properties = { 'android.builtInKotlin': 'false', 'android.newDsl': 'false', 'android.kotlinVersion': '2.4.10' };
    value.modResults = value.modResults.filter(row => row.type !== 'property' || !(row.key in properties));
    for (const [key, property] of Object.entries(properties)) value.modResults.push({ type: 'property', key, value: property });
    return value;
  });
  config = withAndroidManifest(config, value => {
    const application = value.modResults.manifest.application?.[0];
    if (!application) throw new Error('Cinetor requires an Android application manifest.');
    application.$['android:usesCleartextTraffic'] = 'false';
    application.$['android:networkSecurityConfig'] = '@xml/cinetor_network_security';
    return value;
  });
  return withDangerousMod(config, ['android', async value => {
    const directory = path.join(value.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(path.join(directory, 'cinetor_network_security.xml'), NETWORK_SECURITY);
    return value;
  }]);
};
