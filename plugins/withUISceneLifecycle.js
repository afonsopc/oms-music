const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// iOS 27 traps at launch any app that does not adopt the UIScene lifecycle:
// EXC_BREAKPOINT inside _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption.
// The app opens and closes with no useful console output, and it reproduces only
// on iOS 27 or newer, so an iOS 26 simulator will happily run the same binary.
//
// Expo SDK 57 still generates a window-based AppDelegate (ExpoAppDelegate.swift
// carries a literal "TODO: - Configuring and Discarding Scenes"), and there is no
// upstream fix yet: expo/expo#46663 and #46664 are open with no workaround posted.
//
// So this plugin adopts the lifecycle minimally: it declares a single scene
// configuration and appends a SceneDelegate that takes the window the app
// delegate already created for React Native, attaches it to the scene, and shows
// it. Nothing else about the startup path changes.
//
// A manifest with an EMPTY UISceneConfigurations is NOT enough: UIKit still
// counts that as non-adoption and traps. The delegate class must be named.
//
// Delete this plugin once expo generates a scene-based template, and verify on a
// real iOS 27 device rather than a simulator.

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    if let appDelegate = UIApplication.shared.delegate as? AppDelegate,
       let existing = appDelegate.window {
      existing.windowScene = windowScene
      window = existing
      existing.makeKeyAndVisible()
      return
    }
    let created = UIWindow(windowScene: windowScene)
    window = created
    created.makeKeyAndVisible()
  }
}
`;

const MARKER = "class SceneDelegate:";

const withSceneDelegateClass = (config) =>
  withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") {
      throw new Error(
        `withUISceneLifecycle expects a Swift AppDelegate, got ${cfg.modResults.language}`
      );
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = `${cfg.modResults.contents}\n${SCENE_DELEGATE}`;
    }
    return cfg;
  });

const withSceneManifest = (config) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });

module.exports = (config) => withSceneManifest(withSceneDelegateClass(config));
