// Test builds without push notifications, for signing with a free Apple ID.
//
// Free ("Personal Team") accounts can't sign the Push Notifications capability,
// so Xcode refuses any build whose entitlements contain `aps-environment`, which
// expo-notifications always adds. With OCM_NO_PUSH=1 this plugin removes it
// again and tells the app (extra.pushDisabled) not to try registering.
//
//   OCM_NO_PUSH=1 npx expo run:ios --device
//
// Without the variable it does nothing, so normal and EAS builds keep push.
const fs = require('fs');
const { IOSConfig, withFinalizedMod } = require('@expo/config-plugins');
const plist = require('@expo/plist').default;

module.exports = function withNoPush(config) {
  if (process.env.OCM_NO_PUSH !== '1') return config;

  config.extra = { ...config.extra, pushDisabled: true };

  // Finalized mods run after every other mod has written its files, so
  // expo-notifications can't add the entitlement back afterwards.
  return withFinalizedMod(config, [
    'ios',
    async (cfg) => {
      const file = IOSConfig.Entitlements.getEntitlementsPath(cfg.modRequest.projectRoot);
      if (file && fs.existsSync(file)) {
        const entitlements = plist.parse(fs.readFileSync(file, 'utf8'));
        delete entitlements['aps-environment'];
        fs.writeFileSync(file, plist.build(entitlements));
      }
      return cfg;
    },
  ]);
};
