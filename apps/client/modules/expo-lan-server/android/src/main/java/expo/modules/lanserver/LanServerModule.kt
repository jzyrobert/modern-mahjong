package expo.modules.lanserver

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocket
import fi.iki.elonen.NanoWSD.WebSocketFrame
import java.net.NetworkInterface
import java.util.UUID

/**
 * `LanServer` Expo native module — embeds a NanoHTTPD WebSocket
 * server inside the app process so the host can accept guest
 * connections over LAN. Mirrors the JS bridge in
 * `apps/client/modules/expo-lan-server/src/LanServer.ts`.
 *
 * The module **only loads inside an Expo Dev Client build** — Expo Go
 * doesn't ship third-party native modules. To enable LAN hosting the
 * user must run:
 *
 *   eas build --profile development --platform android --local
 *
 * Connections are tagged with a UUID `id`; events fire as
 *   - `connection` { id, query }
 *   - `message`    { id, data }
 *   - `close`      { id }
 *
 * The companion `MatchSession` (running in the host's app process)
 * handles each `connection` like a `partyserver` connection: parse
 * the query string for `playerId` + `name` + `matchCode`, route the
 * subsequent `message` events through the same dispatch logic the
 * Cloudflare Worker uses, and emit replies via `send(id, data)`.
 *
 * **Implementation status:** start/stop/send wired; advertising via
 * mDNS deferred (the host pastes their own URL for now via
 * `HostLanModal`). Inbound origin / matchCode validation is delegated
 * to `MatchSession.applyClientMessage`, same as the Worker.
 */
class LanServerModule : Module() {
  private var server: WSDServer? = null
  // Map<connectionId, WebSocket> so JS-side `send({ id, data })` can
  // route to the right open socket.
  private val sockets = mutableMapOf<String, WebSocket>()

  override fun definition() = ModuleDefinition {
    Name("LanServer")

    Events("connection", "message", "close")

    AsyncFunction("start") { opts: Map<String, Any?> ->
      val port = (opts["port"] as? Number)?.toInt() ?: 0
      val wsPath = (opts["wsPath"] as? String) ?: "/ws"
      stopServer()
      val srv = WSDServer(port, wsPath, this@LanServerModule)
      srv.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
      server = srv
      val bound = srv.listeningPort
      val addresses = lanAddresses(appContext.reactContext as Context, bound)
      mapOf("port" to bound, "addresses" to addresses)
    }

    AsyncFunction("stop") {
      stopServer()
    }

    AsyncFunction("send") { opts: Map<String, Any?> ->
      val id = opts["id"] as? String
        ?: throw IllegalArgumentException("send: missing connection id")
      val data = opts["data"] as? String
        ?: throw IllegalArgumentException("send: missing data")
      val sock = sockets[id]
        ?: throw IllegalStateException("send: connection $id not open")
      sock.send(data)
    }

    OnDestroy {
      stopServer()
    }
  }

  internal fun emitConnection(id: String, query: String, sock: WebSocket) {
    sockets[id] = sock
    sendEvent("connection", mapOf("id" to id, "query" to query))
  }

  internal fun emitMessage(id: String, data: String) {
    sendEvent("message", mapOf("id" to id, "data" to data))
  }

  internal fun emitClose(id: String) {
    sockets.remove(id)
    sendEvent("close", mapOf("id" to id))
  }

  private fun stopServer() {
    server?.stop()
    server = null
    sockets.clear()
  }

  /**
   * Discover all routable IPv4 addresses for LAN hosting. We skip
   * loopback / link-local and surface real interface IPs (typically
   * a single Wi-Fi address).
   */
  private fun lanAddresses(context: Context, port: Int): List<String> {
    val out = mutableListOf<String>()
    try {
      // Prefer the Wi-Fi assigned IP if it's available — that's the
      // address guests will reach the host on.
      val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      val wifiIpInt = wm?.connectionInfo?.ipAddress ?: 0
      if (wifiIpInt != 0) {
        @Suppress("DEPRECATION")
        val wifiIp = "%d.%d.%d.%d".format(
          wifiIpInt and 0xff,
          wifiIpInt shr 8 and 0xff,
          wifiIpInt shr 16 and 0xff,
          wifiIpInt shr 24 and 0xff,
        )
        out.add("http://$wifiIp:$port")
      }
      val ifaces = NetworkInterface.getNetworkInterfaces() ?: return out
      for (iface in ifaces) {
        if (iface.isLoopback || !iface.isUp) continue
        for (addr in iface.inetAddresses) {
          if (addr.isLoopbackAddress || addr.isLinkLocalAddress) continue
          val host = addr.hostAddress ?: continue
          if (host.contains(':')) continue // skip IPv6 for now
          val candidate = "http://$host:$port"
          if (!out.contains(candidate)) out.add(candidate)
        }
      }
    } catch (_: Exception) { }
    return out
  }
}

/**
 * NanoWSD subclass — accepts WebSocket upgrades on the configured
 * `wsPath` and routes all other HTTP requests to a "not found"
 * response. (The legacy plan also wanted the server to host the
 * web bundle for guests visiting the URL in a browser; that's
 * deferred — for now the host's URL is only useful from another
 * copy of the app on the same LAN.)
 */
private class WSDServer(
  port: Int,
  private val wsPath: String,
  private val module: LanServerModule,
) : NanoWSD(port) {
  override fun openWebSocket(handshake: IHTTPSession): WebSocket {
    val id = UUID.randomUUID().toString()
    val query = handshake.queryParameterString ?: ""
    return object : WebSocket(handshake) {
      override fun onOpen() {
        module.emitConnection(id, query, this)
      }

      override fun onMessage(message: WebSocketFrame) {
        module.emitMessage(id, message.textPayload)
      }

      override fun onClose(code: WebSocketFrame.CloseCode, reason: String, initiatedByRemote: Boolean) {
        module.emitClose(id)
      }

      override fun onPong(pong: WebSocketFrame) { /* keepalive */ }

      override fun onException(exception: java.io.IOException) {
        module.emitClose(id)
      }
    }
  }

  override fun serveHttp(session: IHTTPSession): Response {
    if (session.uri == wsPath) {
      // NanoWSD handles the upgrade; fall back to the parent which
      // either upgrades or rejects with 400.
      return super.serveHttp(session)
    }
    return newFixedLengthResponse(
      Response.Status.NOT_FOUND,
      "text/plain",
      "Not found — LAN guest bundle hosting is deferred (see modules/expo-lan-server/README.md).",
    )
  }
}
