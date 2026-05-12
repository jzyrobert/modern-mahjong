import ExpoModulesCore

/**
 * iOS skeleton for the LanServer Expo module. **No iOS build is
 * currently planned** — the project ships web + Android only, and
 * adding macOS / signing infrastructure to CI is out of scope. This
 * file exists so `expo prebuild` produces a syntactically-valid
 * `ios/` project tree (and so anyone forking the repo for an iOS
 * shell has a place to start), not because a Swift implementation is
 * actively being worked on.
 *
 * Every async function except `stop` / `unadvertise` /
 * `stopDiscovery` throws — the JS bridge calls
 * `requireOptionalNativeModule` and the lobby's "Host LAN match"
 * button hides itself when `isLanServerAvailable()` returns false,
 * the same path web + Expo Go take.
 *
 * If someone does pick this up later, the Android Kotlin module is
 * the reference: drop in Telegraph (or Swifter / GCDWebServer + a
 * WebSocket layer) for the HTTP+WS server, `NetService` /
 * `NWBrowser` for mDNS, and `getifaddrs` for `lanAddresses()`.
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
        "iOS LanServer.\(method) is not implemented — no iOS build is currently planned. See modules/expo-lan-server/ios/LanServerModule.swift for the reference.",
    ]
  )
}
