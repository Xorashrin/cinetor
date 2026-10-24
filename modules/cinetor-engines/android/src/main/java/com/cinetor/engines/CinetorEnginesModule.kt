// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import android.content.Context
import com.cinetor.engines.cloudstream.CloudstreamRuntime
import com.cinetor.engines.nuvio.NuvioRuntime
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.UUID

class CinetorEnginesModule : Module() {
    private var host: EngineHost? = null
    private fun engine(): EngineHost = synchronized(this) {
        host ?: EngineHost(appContext.reactContext?.applicationContext
            ?: throw IllegalStateException("Android context is unavailable")).also { host = it }
    }

    override fun definition() = ModuleDefinition {
        Name("CinetorEngines")
        AsyncFunction("capabilities") { capabilities() }
        AsyncFunction("inventory") Coroutine { -> engine().inventory() }
        AsyncFunction("installNuvio") Coroutine { input: Map<String, Any?> -> engine().install(input, "nuvio") }
        AsyncFunction("installCloudstream") Coroutine { input: Map<String, Any?> -> engine().install(input, "cloudstream") }
        AsyncFunction("resolveNuvio") Coroutine { input: Map<String, Any?> -> engine().run(input) { engine().nuvio.resolve(input, it) } }
        AsyncFunction("nuvioSettings") Coroutine { input: Map<String, Any?> -> engine().run(input) { engine().nuvio.settingsLayout(input, it) } }
        AsyncFunction("searchCloudstream") Coroutine { input: Map<String, Any?> -> engine().run(input) { engine().cloudstream.search(input, it) } }
        AsyncFunction("loadCloudstream") Coroutine { input: Map<String, Any?> -> engine().run(input) { engine().cloudstream.load(input, it) } }
        AsyncFunction("resolveCloudstream") Coroutine { input: Map<String, Any?> -> engine().run(input) { engine().cloudstream.resolve(input, it) } }
        AsyncFunction("cancel") { input: Map<String, Any?> ->
            val requestId = input.text("requestId", 128)
            mapOf("requestId" to requestId, "cancelled" to engine().requests.cancel(requestId))
        }
        AsyncFunction("inspectRepository") Coroutine { input: Map<String, Any?> -> engine().inspectRepository(input) }
        AsyncFunction("probeMedia") Coroutine { input: Map<String, Any?> -> engine().probe(input) }
        AsyncFunction("readSettings") Coroutine { input: Map<String, Any?> -> engine().readSettings(input) }
        AsyncFunction("writeSettings") Coroutine { input: Map<String, Any?> -> engine().writeSettings(input) }
        AsyncFunction("openCloudstreamSettings") Coroutine { input: Map<String, Any?> ->
            val request = input + ("requestId" to (input["requestId"] ?: UUID.randomUUID().toString()))
            engine().run(request) { control ->
                val activity = appContext.currentActivity ?: throw EngineFailure("UNSUPPORTED_SETTINGS", "Open settings from a foreground Android screen")
                engine().cloudstream.openSettings(request.text("pluginId", 128), activity, control)
            }
        }
        OnDestroy { synchronized(this@CinetorEnginesModule) { host?.close(); host = null } }
    }

    private fun capabilities(): Map<String, Any?> = mapOf(
        "platform" to "android", "bridgeVersion" to 1, "native" to true,
        "nuvio" to mapOf("available" to true, "runtime" to "quickjs-kt-android:1.0.15", "profile" to "nuvio-mobile-quickjs-1.0.15",
            "nativeInterrupt" to true, "deadlineMs" to Limits.TIMEOUT, "heapBytes" to 33554432, "stackBytes" to 524288,
            "settingsScope" to "plugin-profile", "webView" to false, "hostJsExecution" to false),
        "cloudstream" to mapOf("available" to true, "library" to "4.8.0", "profile" to "cloudstream-4.8.0-androidJvm",
            "compiledDex" to true, "resources" to true, "nativeSettings" to true,
            "settingsScope" to "plugin-global", "sandboxed" to false, "cancellation" to "cooperative-plus-broker-call-cancel",
            "compatibility" to "reviewed-4.8.0-extensions-only"),
        "admission" to "bundled-source-reviewed-sha256-only", "historicalInventoryBundled" to false,
        "unsupported" to listOf("Cloudstream-4.7-or-older-ABI", "WebView", "WASM", "P2P", "DRM", "video-click-actions",
            "native-plugin-libraries", "unreviewed-extensions", "player-interceptors", "Cloudstream-plugin-POST")
    )
}

internal class EngineHost(context: Context) : AutoCloseable {
    val store = PluginStore(context)
    val settings = SettingsStore(context)
    val requests = Requests()
    private val http = HttpBroker()
    val nuvio = NuvioRuntime(store, settings, http)
    val cloudstream = CloudstreamRuntime(context, store, http)

    suspend fun run(input: Map<String, Any?>, block: suspend (RequestControl) -> Map<String, Any?>): Map<String, Any?> = requests.run(input, block)

    suspend fun install(input: Map<String, Any?>, engine: String): Map<String, Any?> {
        val request = input + ("requestId" to (input["requestId"] ?: UUID.randomUUID().toString()))
        return run(request) { control ->
            val entry = store.entry(input.text("pluginId", 128), engine)
            if (engine == "cloudstream") cloudstream.install(entry, control)
            else { store.install(entry); control.check(); mapOf("status" to "ok", "plugin" to entry.inventory(true)) }
        }
    }

    suspend fun inspectRepository(input: Map<String, Any?>): Map<String, Any?> = run(input) { control ->
        result(input, "document", http.inspectRepository(input, control))
    }

    suspend fun probe(input: Map<String, Any?>): Map<String, Any?> = run(input) { control ->
        val origins = store.entries.filter { store.installed(it) }.flatMap { it.mediaOrigins }.toSet()
        val session = http.session(origins)
        val hook = control.onCancel { session.close() }
        try { result(input, "probe", session.probe(input)) } finally { hook.close(); session.close() }
    }

    suspend fun inventory(): Map<String, Any?> {
        val restore = run(mapOf("requestId" to "inventory-${UUID.randomUUID()}")) { control ->
            cloudstream.restoreInstalled(control)
            mapOf("status" to "ok")
        }
        val restoreFailed = restore["status"] != "ok"
        val items = store.entries.map {
            val installed = store.installed(it)
            val enabled = installed && !(it.engine == "cloudstream" && restoreFailed)
            it.inventory(enabled, when {
                it.engine == "cloudstream" && restoreFailed -> "Installed plugin failed native compatibility; see engine status"
                !installed -> "Install this reviewed bundled plugin to enable it"
                else -> null
            }, installed)
        }.toMutableList()
        if (store.entries.none { it.id == "cinetor-bbb-cloudstream" }) items.add(mapOf(
            "id" to "cinetor-bbb-cloudstream", "pluginId" to "cinetor-bbb-cloudstream", "engine" to "cloudstream",
            "name" to "Blender Open Movie (Cloudstream)", "version" to "1", "enabled" to false, "reviewed" to true,
            "status" to "unsupported", "disabledReason" to "CI-built compiled fixture asset is missing or invalid"))
        return mapOf("plugins" to items, "providers" to cloudstream.providerInventory(),
            "historicalInventoryBundled" to false, "inventoryNotice" to "Only two original reviewed Blender fixtures are included; historical repository listings are not working-source evidence")
    }

    fun readSettings(input: Map<String, Any?>): Map<String, Any?> = try {
        val entry = store.entry(input.text("pluginId", 128))
        val profile = (input["profileId"] as? String) ?: "default"
        mapOf("status" to "ok", "pluginId" to entry.id, "profileId" to profile, "settings" to settings.read(entry.id, profile),
            "settingsScope" to "plugin-profile", "nativeSettingsScope" to if (entry.engine == "cloudstream") "plugin-global" else null)
    } catch (error: Exception) { errorResult(error, input) }

    fun writeSettings(input: Map<String, Any?>): Map<String, Any?> = try {
        val entry = store.entry(input.text("pluginId", 128))
        val profile = (input["profileId"] as? String) ?: "default"
        val parsed = Json.parse(Json.encode(input["settings"]), 32768)
        requireEngine(parsed.isObject, "INVALID_REQUEST", "Settings must be a JSON object")
        settings.write(entry.id, profile, Json.map(parsed))
        mapOf("status" to "ok", "pluginId" to entry.id, "profileId" to profile)
    } catch (error: Exception) { errorResult(error, input) }

    override fun close() {
        requests.close()
        cloudstream.close()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { cloudstream.unloadAll() }
    }
}
