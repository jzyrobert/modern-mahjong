package expo.modules.lanserver

import android.content.Context
import android.content.res.AssetManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocket
import fi.iki.elonen.NanoWSD.WebSocketFrame
import java.io.IOException
import java.io.InputStream
import java.net.NetworkInterface
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

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

  // mDNS state — at most one advertisement and one active discovery
  // session per process.
  private var nsdManager: NsdManager? = null
  private var registrationListener: NsdManager.RegistrationListener? = null
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  // Resolves are async-callback-based; we serialise them so the
  // upstream `NsdManager` doesn't reject overlapping
  // `resolveService` calls (it tolerates one in-flight at a time on
  // older API levels).
  private val resolveQueue = ConcurrentHashMap<String, NsdServiceInfo>()
  private var resolveInFlight = false

  override fun definition() = ModuleDefinition {
    Name("LanServer")

    Events("connection", "message", "close", "hostFound", "hostLost")

    AsyncFunction("start") { opts: Map<String, Any?> ->
      val port = (opts["port"] as? Number)?.toInt() ?: 0
      val wsPath = (opts["wsPath"] as? String) ?: "/ws"
      stopServer()
      val ctx = appContext.reactContext as Context
      val srv = WSDServer(port, wsPath, this@LanServerModule, ctx.assets)
      srv.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
      server = srv
      val bound = srv.listeningPort
      val addresses = lanAddresses(ctx, bound)
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

    AsyncFunction("advertise") { opts: Map<String, Any?> ->
      val serviceName = opts["serviceName"] as? String
        ?: throw IllegalArgumentException("advertise: missing serviceName")
      val port = (opts["port"] as? Number)?.toInt()
        ?: throw IllegalArgumentException("advertise: missing port")
      registerService(serviceName, port)
    }

    AsyncFunction("unadvertise") {
      unregisterService()
    }

    AsyncFunction("startDiscovery") {
      startNsdDiscovery()
    }

    AsyncFunction("stopDiscovery") {
      stopNsdDiscovery()
    }

    OnDestroy {
      stopServer()
      unregisterService()
      stopNsdDiscovery()
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

  private fun ensureNsd(): NsdManager {
    val cached = nsdManager
    if (cached != null) return cached
    val ctx = appContext.reactContext as Context
    val mgr = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    nsdManager = mgr
    return mgr
  }

  /**
   * Register `_modernmahjong._tcp.` for `serviceName` on `port`.
   * Replaces any existing registration on this module instance.
   */
  private fun registerService(serviceName: String, port: Int) {
    val mgr = ensureNsd()
    unregisterService()

    val info = NsdServiceInfo().apply {
      this.serviceName = serviceName
      this.serviceType = SERVICE_TYPE
      this.port = port
    }
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {}
      override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
      override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
      override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
    }
    registrationListener = listener
    mgr.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
  }

  private fun unregisterService() {
    val mgr = nsdManager ?: return
    val listener = registrationListener ?: return
    try {
      mgr.unregisterService(listener)
    } catch (_: IllegalArgumentException) {
      // Already unregistered.
    }
    registrationListener = null
  }

  private fun startNsdDiscovery() {
    val mgr = ensureNsd()
    stopNsdDiscovery()

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) {}
      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        // Resolve to get the actual host + port. NsdManager only
        // tolerates one in-flight resolve at a time on older API
        // levels, so we queue up.
        resolveQueue[serviceInfo.serviceName] = serviceInfo
        drainResolveQueue()
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        sendEvent("hostLost", mapOf("name" to serviceInfo.serviceName))
        resolveQueue.remove(serviceInfo.serviceName)
      }
    }
    discoveryListener = listener
    mgr.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
  }

  private fun stopNsdDiscovery() {
    val mgr = nsdManager ?: return
    val listener = discoveryListener ?: return
    try {
      mgr.stopServiceDiscovery(listener)
    } catch (_: IllegalArgumentException) {
      // Already stopped.
    }
    discoveryListener = null
    resolveQueue.clear()
    resolveInFlight = false
  }

  @Synchronized
  private fun drainResolveQueue() {
    if (resolveInFlight) return
    val (key, info) = resolveQueue.entries.firstOrNull() ?: return
    resolveQueue.remove(key)
    resolveInFlight = true
    val mgr = nsdManager ?: return

    val resolveListener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
        resolveInFlight = false
        drainResolveQueue()
      }

      override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
        val host = serviceInfo.host?.hostAddress
        if (host != null) {
          sendEvent(
            "hostFound",
            mapOf(
              "name" to serviceInfo.serviceName,
              "host" to host,
              "port" to serviceInfo.port,
            ),
          )
        }
        resolveInFlight = false
        drainResolveQueue()
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // The newer overload accepts an Executor; we just hand it to
      // the main thread via a no-op `Runnable::run` since the
      // resolve callback is already async.
      mgr.resolveService(info, Runnable::run, resolveListener)
    } else {
      @Suppress("DEPRECATION")
      mgr.resolveService(info, resolveListener)
    }
  }

  companion object {
    private const val SERVICE_TYPE = "_modernmahjong._tcp."
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
 * `wsPath` and serves the bundled Expo Web export for any other HTTP
 * request. The export ships as Android assets under `assets/lan-bundle/`
 * (staged by the `stageLanBundleAssets` Gradle task during APK build).
 * If the staging directory was empty at build time (web export wasn't
 * run), `assets/lan-bundle/` is missing and `serveHttp` returns a
 * friendly 404 instead — i.e. the LAN web-host capability lights up
 * iff `pnpm --filter @mahjong/client export-web` ran before
 * `eas build`.
 */
private class WSDServer(
  port: Int,
  private val wsPath: String,
  private val module: LanServerModule,
  private val assets: AssetManager,
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

      override fun onException(exception: IOException) {
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
    return serveBundleAsset(session.uri)
  }

  /**
   * Look the request up under `assets/lan-bundle/`. Returns the file
   * with a guessed MIME type if it exists; on miss, falls back to
   * `index.html` (so deep-linked Expo Router routes resolve to the
   * SPA shell), and finally to a plain-text 404 if no bundle was
   * staged into the APK at all.
   */
  private fun serveBundleAsset(rawUri: String): Response {
    val cleaned = sanitizeRequestPath(rawUri)
    val candidate = if (cleaned.isEmpty() || cleaned.endsWith("/")) {
      "${BUNDLE_ROOT}/${cleaned.trimEnd('/')}/index.html".replace("//", "/")
    } else {
      "$BUNDLE_ROOT/$cleaned"
    }

    val direct = openAsset(candidate)
    if (direct != null) return assetResponse(candidate, direct)

    // Static export ships HTML files alongside the path, not under it
    // (Expo Router writes `/match.html` for the `/match` route, etc.).
    if (!cleaned.contains('.')) {
      val htmlForRoute = "$BUNDLE_ROOT/${cleaned.ifEmpty { "index" }}.html"
      val routed = openAsset(htmlForRoute)
      if (routed != null) return assetResponse(htmlForRoute, routed)

      // SPA fallback: serve the root index.html so client-side routing
      // can take over.
      val fallback = openAsset("$BUNDLE_ROOT/index.html")
      if (fallback != null) return assetResponse("$BUNDLE_ROOT/index.html", fallback)
    }

    return newFixedLengthResponse(
      Response.Status.NOT_FOUND,
      "text/plain",
      "Not found. LAN bundle missing — run `pnpm --filter @mahjong/client export-web` " +
        "before `eas build` so the host can serve the web client to browser guests.",
    )
  }

  private fun openAsset(path: String): InputStream? = try {
    assets.open(path)
  } catch (_: IOException) {
    null
  }

  /**
   * Defend the asset lookup against `..` traversal and stray query
   * strings. Anything unsafe collapses to an empty path, which
   * resolves to `index.html`.
   */
  private fun sanitizeRequestPath(raw: String): String {
    val noQuery = raw.substringBefore('?').substringBefore('#')
    val trimmed = noQuery.trimStart('/')
    if (trimmed.contains("..")) return ""
    return trimmed
  }

  private fun assetResponse(assetPath: String, stream: InputStream): Response {
    val mime = mimeFor(assetPath)
    val response = newChunkedResponse(Response.Status.OK, mime, stream)
    // Long-cache the hashed `_expo/static/...` files Expo emits;
    // everything else (HTML / sitemap / not-found) stays fresh.
    if (assetPath.contains("/_expo/static/") || assetPath.contains("/assets/")) {
      response.addHeader("Cache-Control", "public, max-age=31536000, immutable")
    } else {
      response.addHeader("Cache-Control", "no-cache")
    }
    return response
  }

  private fun mimeFor(path: String): String {
    val lower = path.lowercase()
    return when {
      lower.endsWith(".html") -> "text/html; charset=utf-8"
      lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript; charset=utf-8"
      lower.endsWith(".css") -> "text/css; charset=utf-8"
      lower.endsWith(".json") -> "application/json; charset=utf-8"
      lower.endsWith(".svg") -> "image/svg+xml"
      lower.endsWith(".png") -> "image/png"
      lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
      lower.endsWith(".gif") -> "image/gif"
      lower.endsWith(".webp") -> "image/webp"
      lower.endsWith(".ico") -> "image/x-icon"
      lower.endsWith(".woff") -> "font/woff"
      lower.endsWith(".woff2") -> "font/woff2"
      lower.endsWith(".ttf") -> "font/ttf"
      lower.endsWith(".otf") -> "font/otf"
      lower.endsWith(".txt") -> "text/plain; charset=utf-8"
      else -> "application/octet-stream"
    }
  }

  companion object {
    private const val BUNDLE_ROOT = "lan-bundle"
  }
}
