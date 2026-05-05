import ExpoModulesCore

/**
 * iOS skeleton for the LanServer Expo module. The Android Kotlin
 * counterpart uses NanoHTTPD-WebSockets for the embedded HTTP+WS
 * server; iOS has a few options (Telegraph, Swifter, GCDWebServer +
 * a WebSocket layer) but none are wired up here yet — `start()`,
 * `send()`, `advertise()`, and `startDiscovery()` throw so the JS
 * bridge falls through to the `NotImplemented` branch on iOS.
 *
 * To complete iOS:
 *   1. Add a Swift Package or CocoaPods dependency for an
 *      HTTP+WebSocket server (Telegraph is the cleanest API).
 *   2. Replace the `start` body with the Telegraph server boot,
 *      tag connections with UUIDs, and forward connection /
 *      message / close events via `sendEvent(...)`.
 *   3. Implement `lanAddresses()` using `getifaddrs` to enumerate
 *      AF_INET interfaces, skipping `lo0`.
 *   4. mDNS via `NetService` / `NWBrowser` (advertise + discover).
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
      throw notImplemented("start")
    }

    AsyncFunction("stop") { () -> Void in
      // No-op: nothing started.
    }

    AsyncFunction("send") { (opts: [String: Any]) -> Void in
      throw notImplemented("send")
    }

    AsyncFunction("advertise") { (opts: [String: Any]) -> Void in
      // mDNS advertisement on iOS would use NetService /
      // NWBrowser; pair with the HTTP+WS server's advertised port
      // once `start` actually boots.
      throw notImplemented("advertise")
    }

    AsyncFunction("unadvertise") { () -> Void in
      // No-op: nothing advertised.
    }

    AsyncFunction("startDiscovery") { () -> Void in
      throw notImplemented("startDiscovery")
    }

    AsyncFunction("stopDiscovery") { () -> Void in
      // No-op: nothing started.
    }
  }
}

private func notImplemented(_ method: String) -> NSError {
  return NSError(
    domain: "expo.modules.lanserver",
    code: 1,
    userInfo: [
      NSLocalizedDescriptionKey:
        "iOS LanServer.\(method) not implemented yet — see modules/expo-lan-server/ios/LanServerModule.swift for the TODO.",
    ]
  )
}
