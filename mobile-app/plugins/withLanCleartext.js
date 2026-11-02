/**
 * The food court edge server is reached over the local Wi-Fi as plain HTTP (http://<LAN-IP>:8000/api).
 * Android release builds block cleartext HTTP by default (targetSdk >= 28), which would make every
 * API call fail on a real device. This plugin opts the app into cleartext traffic.
 *
 * Remove it once the edge server is served over HTTPS with a certificate the devices trust.
 */
// Resolve through the direct `expo` dependency: pnpm does not hoist @expo/config-plugins
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withLanCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:usesCleartextTraffic'] = 'true';
    }
    return cfg;
  });
};
