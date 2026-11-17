// iOS 27 SDK compatibility for the generated ios/ project.
//
// 1. UIScene lifecycle. Apps built with the iOS 27 SDK must adopt scenes, or
//    UIKit traps at launch (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
//    Expo 54's AppDelegate template still creates the window itself, so this adds
//    a scene manifest to Info.plist and a SceneDelegate that owns the window,
//    starts React Native in it, and forwards deep links / universal links to the
//    AppDelegate (UIKit delivers those to the scene once scenes are adopted).
//
// 2. User script sandboxing off. CocoaPods' "[CP] Copy Pods Resources" and
//    "[CP] Embed Pods Frameworks" phases fail with "Unexpected failure" when
//    ENABLE_USER_SCRIPT_SANDBOXING is on, which Xcode's recommended settings enable.
const { withAppDelegate, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

const WINDOW_SETUP = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

const WINDOW_SETUP_REPLACEMENT = `
    // The window and React Native root view are created in SceneDelegate,
    // since the iOS 27 SDK requires apps to adopt the UIScene lifecycle.
`;

const SCENE_DELEGATE = `class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)

    // URLs / user activities that launched the app are delivered here instead of to the app delegate.
    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    if let userActivity = connectionOptions.userActivities.first {
      self.scene(scene, continue: userActivity)
    }
  }

  // Linking API
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate else { return }
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  // Universal Links
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}

`;

function withSceneDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate.');
    }
    let src = cfg.modResults.contents;
    if (src.includes('class SceneDelegate')) return cfg;

    // Fail loudly if a future Expo template changes shape, rather than ship an app that traps at launch.
    if (!WINDOW_SETUP.test(src) || !src.includes('class ReactNativeDelegate')) {
      throw new Error(
        'with-ios-scene-lifecycle: AppDelegate.swift no longer matches the Expo 54 template; update this plugin.',
      );
    }
    src = src.replace(WINDOW_SETUP, WINDOW_SETUP_REPLACEMENT);
    src = src.replace('class ReactNativeDelegate', `${SCENE_DELEGATE}class ReactNativeDelegate`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function withoutScriptSandboxing(config) {
  return withXcodeProject(config, (cfg) => {
    const configurations = cfg.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      // The section also holds "<id>_comment" string entries; only touch real configurations.
      if (entry && typeof entry === 'object' && entry.buildSettings) {
        entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }
    return cfg;
  });
}

module.exports = function withIosSceneLifecycle(config) {
  return withoutScriptSandboxing(withSceneManifest(withSceneDelegate(config)));
};
