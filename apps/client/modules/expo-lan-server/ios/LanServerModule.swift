import ExpoModulesCore

/**
 * iOS skeleton for the LanServer Expo module. The Android Kotlin
 * counterpart uses NanoHTTPD-WebSockets for the embedded HTTP+WS
 * server; iOS has a few options (Telegraph, Swifter, GCDWebServer +
 * a WebSocket layer) but none are wired up here yet — `start()`
 * throws so the JS bridge falls through to the `NotImplemented`
 * branch on iOS.
 *
 * To complete iOS:
 *   1. Add a Swift Package or CocoaPods dependency for an
 *      HTTP+WebSocket server (Telegraph is the cleanest API).
 *   2. Replace the `start` body with the Telegraph server boot,
 *      tag connections with UUIDs, and forward connection /
 *      message / close events via `sendEvent(...)`.
 *   3. Implement `lanAddresses()` using `getifaddrs` to enumerate
 *      AF_INET interfaces, skipping `lo0`.
 *
 * The JS side already calls `requireOptionalNativeModule` so an
 * unimplemented iOS leaves the lobby in the "needs dev client"
 * state — acceptable while iOS support is deferred.
 */
public class LanServerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LanServer")

    Events("connection", "message", "close", "hostFound", "hostLost")

    AsyncFunction("start") { (opts: [String: Any]) -> [String: Any] in
      throw NSError(
        domain: "expo.modules.lanserver",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "iOS LanServer module not implemented yet — see modules/expo-lan-server/ios/LanServerModule.swift for the TODO.",
        ]
      )
    }

    AsyncFunction("stop") { () -> Void in
      // No-op: nothing started.
    }

    AsyncFunction("send") { (opts: [String: Any]) -> Void in
      throw NSError(
        domain: "expo.modules.lanserver",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "iOS LanServer module not implemented yet.",
        ]
      )
    }

    AsyncFunction("advertise") { (opts: [String: Any]) -> Void in
      // mDNS advertisement on iOS would use NetService /
      // NWBrowser; pair with the HTTP+WS server's advertised port
      // once `start` actually boots. Stub for now.
      throw NSError(
        domain: "expo.modules.lanserver",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "iOS LanServer.advertise not implemented yet.",
        ]
      )
    }

    AsyncFunction("unadvertise") { () -> Void in
      // No-op: nothing advertised.
    }

    AsyncFunction("startDiscovery") { () -> Void in
      throw NSError(
        domain: "expo.modules.lanserver",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "iOS LanServer.startDiscovery not implemented yet.",
        ]
      )
    }

    AsyncFunction("stopDiscovery") { () -> Void in
      // No-op: nothing started.
    }
  }
}
