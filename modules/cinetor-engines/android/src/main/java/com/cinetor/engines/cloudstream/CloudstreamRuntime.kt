// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines.cloudstream

import android.content.Context
import android.content.res.AssetManager
import android.content.res.Resources
import com.cinetor.engines.*
import com.lagradost.api.setContext
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.LoadResponse.Companion.getImdbId
import com.lagradost.cloudstream3.LoadResponse.Companion.getTMDbId
import com.lagradost.cloudstream3.plugins.BasePlugin
import com.lagradost.cloudstream3.plugins.Plugin
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.extractorApis
import dalvik.system.PathClassLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

/** Same-UID reviewed DEX loader. This is deliberately NOT described as a sandbox. */
internal class CloudstreamRuntime(private val context: Context, private val store: PluginStore, private val http: HttpBroker) {
    private data class Loaded(val entry: ReviewedPlugin, val instance: BasePlugin, val loader: PathClassLoader,
                              val assets: AssetManager?, val providers: List<MainAPI>)
    private data class Provider(val loaded: Loaded, val api: MainAPI)
    private val loaded = ConcurrentHashMap<String, Loaded>()
    private val providers = ConcurrentHashMap<String, Provider>()
    private val mutex = Mutex()
    private val issuedData = LinkedHashMap<String, String>()
    private val issuedUrls = LinkedHashMap<String, String>()
    @Volatile private var activeSession: HttpBroker.Session? = null
    private val hostClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            try {
                val session = activeSession ?: throw EngineFailure("UNSUPPORTED_HTTP", "Cloudstream network access requires an active reviewed request")
                session.cloudstreamInterceptor().intercept(chain)
            } catch (error: EngineFailure) {
                // A non-IO exception on OkHttp's async dispatcher can escape its failure callback.
                throw java.io.IOException("Cloudstream broker policy rejected the request", error)
            }
        }.build()

    init {
        setContext(WeakReference<Any>(context.applicationContext))
        app.baseClient = hostClient
        app.defaultTimeOut = 30L
        LoadResponse.simklIdPrefix = "cinetor_simkl"
        LoadResponse.malIdPrefix = "cinetor_mal"
        LoadResponse.aniListIdPrefix = "cinetor_anilist"
        LoadResponse.kitsuIdPrefix = "cinetor_kitsu"
    }

    private suspend fun <T> scoped(entry: ReviewedPlugin, control: RequestControl, block: suspend () -> T): T = mutex.withLock {
        control.check()
        val session = http.session(entry.networkOrigins)
        val hook = control.onCancel { session.close() }
        activeSession = session
        try { block().also { control.check() } } finally { activeSession = null; hook.close(); session.close() }
    }

    suspend fun install(entry: ReviewedPlugin, control: RequestControl): Map<String, Any?> = scoped(entry, control) {
        val file = store.install(entry)
        ensureLoaded(entry, file)
        mapOf("status" to "ok", "plugin" to entry.inventory(true), "providers" to providerInventory().filter { it["pluginId"] == entry.id })
    }

    @Suppress("DEPRECATION")
    private fun ensureLoaded(entry: ReviewedPlugin, file: File = store.file(entry)): Loaded {
        loaded[entry.id]?.let { return it }
        store.verifiedBytes(entry)
        store.validateArchive(file, entry)
        val loader = PathClassLoader(file.absolutePath, context.classLoader)
        var instance: BasePlugin? = null
        var assets: AssetManager? = null
        try {
            val clazz = loader.loadClass(entry.pluginClass ?: throw EngineFailure("UNSUPPORTED_ABI", "Reviewed class name is missing"))
            requireEngine(clazz.classLoader === loader && BasePlugin::class.java.isAssignableFrom(clazz),
                "UNSUPPORTED_ABI", "Plugin must be loaded from its DEX, not from the host or an incompatible base class")
            instance = clazz.getDeclaredConstructor().newInstance() as BasePlugin
            instance.filename = file.absolutePath
            if (entry.requiresResources) {
                val androidPlugin = instance as? Plugin
                    ?: throw EngineFailure("UNSUPPORTED_RESOURCES", "Resources require the Android Plugin ABI")
                assets = AssetManager::class.java.getDeclaredConstructor().newInstance()
                val cookie = AssetManager::class.java.getMethod("addAssetPath", String::class.java).invoke(assets, file.absolutePath) as Int
                requireEngine(cookie != 0, "UNSUPPORTED_RESOURCES", "Android rejected the compiled plugin resources")
                androidPlugin.resources = Resources(assets, context.resources.displayMetrics, context.resources.configuration)
            }
            if (instance is Plugin) instance.load(context) else instance.load()
            val registered = APIHolder.allProviders.filter { it.sourcePlugin == file.absolutePath }
            requireEngine(registered.isNotEmpty() && registered.size <= 32 && registered.none { it.usesWebView },
                "UNSUPPORTED_API", "Plugin must register a bounded list of non-WebView providers")
            requireEngine(registered.map { it.javaClass.name }.distinct().size == registered.size,
                "UNSUPPORTED_ABI", "Duplicate provider classes cannot be assigned stable identities")
            val result = Loaded(entry, instance, loader, assets, registered)
            registered.forEach { api -> api.init(); providers["${entry.id}:${api.javaClass.name}"] = Provider(result, api) }
            loaded[entry.id] = result
            return result
        } catch (error: Throwable) {
            try { instance?.beforeUnload() } catch (_: Throwable) { }
            removeRegistrations(file.absolutePath)
            assets?.close()
            val cause = (error as? java.lang.reflect.InvocationTargetException)?.targetException ?: error
            if (cause is EngineFailure || cause is kotlinx.coroutines.CancellationException || cause is VirtualMachineError || cause is ThreadDeath) throw cause
            throw EngineFailure("UNSUPPORTED_ABI", "Reviewed plugin failed native class, resource, or registration compatibility")
        }
    }

    private fun removeRegistrations(filename: String) {
        APIHolder.allProviders.filter { it.sourcePlugin == filename }.forEach {
            APIHolder.removePluginMapping(it)
            APIHolder.allProviders.remove(it)
        }
        extractorApis.filter { it.sourcePlugin == filename }.forEach { extractorApis.remove(it) }
        providers.entries.removeIf { it.value.loaded.instance.filename == filename }
    }

    private fun entryFor(input: Map<String, Any?>): ReviewedPlugin {
        val providerId = input.text("providerId", 512)
        val pluginId = providerId.substringBefore(':')
        (input["pluginId"] as? String)?.let { requireEngine(it == pluginId, "INVALID_REQUEST", "Provider does not belong to the selected plugin") }
        return store.entry(pluginId, "cloudstream")
    }
    private fun provider(input: Map<String, Any?>, entry: ReviewedPlugin): Provider {
        ensureLoaded(entry)
        return providers[input.text("providerId", 512)] ?: throw EngineFailure("UNSUPPORTED_API", "Provider is not registered by the reviewed plugin")
    }
    private fun bounded(value: String, size: Int = 65536): String {
        requireEngine(value.toByteArray().size <= size, "LIMIT", "Provider output exceeds the byte budget")
        return value
    }
    private fun issue(map: LinkedHashMap<String, String>, provider: String, value: String): String {
        bounded(value)
        val key = "$provider:${sha256(value.toByteArray())}"
        map.remove(key)
        var characters = map.values.sumOf { it.length }
        while (map.isNotEmpty() && (map.size >= 4096 || characters + value.length > 2 * Limits.JSON)) {
            val removed = map.remove(map.keys.first())
            characters -= removed?.length ?: 0
        }
        map[key] = value
        return value
    }
    private fun requireIssued(map: LinkedHashMap<String, String>, provider: String, value: String) {
        requireEngine(map["$provider:${sha256(value.toByteArray())}"] == value, "INVALID_REQUEST", "Use the exact opaque provider output from the preceding search or load request")
    }

    suspend fun search(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        val entry = entryFor(input)
        return scoped(entry, control) {
            val target = provider(input, entry)
            val providerId = input.text("providerId", 512)
            val page = input.optionalInt("page") ?: 1
            requireEngine(page in 1..100, "INVALID_REQUEST", "Invalid search page")
            val found = target.api.search(input.text("query", 256), page)
            requireEngine(found == null || found.items.size <= Limits.MAX_ITEMS, "LIMIT", "Provider search exceeds the item budget")
            val items = found?.items?.map { item ->
                mapOf("name" to bounded(item.name, 1024), "url" to issue(issuedUrls, providerId, item.url),
                    "providerId" to providerId, "mediaType" to type(item.type), "posterUrl" to item.posterUrl?.take(8192))
            } ?: emptyList()
            requireEngine(Json.encode(items).toByteArray().size <= Limits.JSON, "LIMIT", "Provider search output exceeds the byte budget")
            result(input, "items", items, items.isEmpty()) + ("hasNext" to (found?.hasNext ?: false))
        }
    }

    suspend fun load(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        val entry = entryFor(input)
        return scoped(entry, control) {
            val target = provider(input, entry)
            val providerId = input.text("providerId", 512)
            val url = input.text("url", 65536)
            requireIssued(issuedUrls, providerId, url)
            val item = target.api.load(url) ?: return@scoped result(input, "item", null, true)
            fun episode(episode: Episode, dubStatus: String? = null): Map<String, Any?> = mapOf(
                "name" to episode.name?.take(1024), "season" to episode.season, "episode" to episode.episode,
                "data" to issue(issuedData, providerId, episode.data), "dubStatus" to dubStatus)
            val episodes = when (item) {
                is TvSeriesLoadResponse -> {
                    requireEngine(item.episodes.size <= Limits.MAX_EPISODES, "LIMIT", "Episode list exceeds the budget")
                    item.episodes.map { episode(it) }
                }
                is AnimeLoadResponse -> {
                    requireEngine(item.episodes.values.sumOf { it.size } <= Limits.MAX_EPISODES, "LIMIT", "Episode list exceeds the budget")
                    item.episodes.flatMap { (dub, list) -> list.map { episode(it, dub.name) } }
                }
                else -> emptyList()
            }
            val data = when (item) {
                is MovieLoadResponse -> issue(issuedData, providerId, item.dataUrl)
                is LiveStreamLoadResponse -> issue(issuedData, providerId, item.dataUrl)
                is TvSeriesLoadResponse, is AnimeLoadResponse -> null
                else -> throw EngineFailure("UNSUPPORTED_MEDIA", "Unsupported Cloudstream load response type")
            }
            val tmdb = item.getTMDbId()?.takeIf { it.matches(Regex("[1-9][0-9]{0,18}")) }
            val normalized = mapOf("name" to bounded(item.name, 1024), "url" to bounded(item.url),
                "providerId" to providerId, "mediaType" to type(item.type), "year" to item.year,
                "posterUrl" to item.posterUrl?.take(8192), "tmdbId" to tmdb, "imdbId" to item.getImdbId(),
                "mappingEvidence" to if (tmdb != null) "provider-sync-data" else null,
                "data" to data, "dataUrl" to data, "episodes" to episodes)
            requireEngine(Json.encode(normalized).toByteArray().size <= Limits.JSON, "LIMIT", "Provider load output exceeds the budget")
            result(input, "item", normalized)
        }
    }

    suspend fun resolve(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        val entry = entryFor(input)
        return scoped(entry, control) {
            val target = provider(input, entry)
            val providerId = input.text("providerId", 512)
            val data = if (input["opaqueData"] != null) input.text("opaqueData", 65536) else input.text("data", 65536)
            input.text("contentKey", 512)
            requireIssued(issuedData, providerId, data)
            val lock = Any()
            val links = mutableListOf<ExtractorLink>()
            val subtitles = mutableListOf<SubtitleFile>()
            val succeeded = target.api.loadLinks(data, false,
                { subtitle -> synchronized(lock) { control.check(); requireEngine(subtitles.size < 30, "LIMIT", "Subtitle callback budget exceeded"); subtitles.add(subtitle) } },
                { link -> synchronized(lock) { control.check(); requireEngine(links.size < Limits.MAX_SOURCES, "LIMIT", "Stream callback budget exceeded"); links.add(link) } })
            control.check()
            requireEngine(succeeded || links.isEmpty(), "MALFORMED", "Provider reported failure after returning stream callbacks")
            val sources = synchronized(lock) { links.map { link ->
                requireEngine(target.api.getVideoInterceptor(link) == null, "UNSUPPORTED_INTERCEPTOR", "This source requires a native player interceptor not exposed by the current host")
                StreamNormalizer.cloudstream(link, subtitles.toList(), entry, providerId, target.api.hasDownloadSupport)
            }.distinctBy { it["sourceId"] } }
            result(input, "sources", sources, sources.isEmpty())
        }
    }

    suspend fun openSettings(id: String, activity: Context, control: RequestControl): Map<String, Any?> {
        val entry = store.entry(id, "cloudstream")
        return scoped(entry, control) {
            val instance = ensureLoaded(entry).instance as? Plugin
            val settings = instance?.openSettings ?: throw EngineFailure("UNSUPPORTED_SETTINGS", "This plugin has no native settings screen")
            withContext(Dispatchers.Main) { settings(activity) }
            mapOf("status" to "ok", "settingsScope" to "plugin-global")
        }
    }

    suspend fun restoreInstalled(control: RequestControl) {
        store.entries.filter { it.engine == "cloudstream" && store.installed(it) }.forEach { entry ->
            scoped(entry, control) { ensureLoaded(entry) }
        }
    }

    fun providerInventory(): List<Map<String, Any?>> = providers.entries.sortedBy { it.key }.map { (id, provider) ->
        mapOf("providerId" to id, "pluginId" to provider.loaded.entry.id, "name" to provider.api.name,
            "version" to provider.loaded.entry.version, "hash" to provider.loaded.entry.hash,
            "nativeSettings" to ((provider.loaded.instance as? Plugin)?.openSettings != null), "settingsScope" to "plugin-global")
    }

    fun close() {
        activeSession?.close()
        // beforeUnload and registry removal run only after in-flight calls leave the mutex.
        // The module owns this coroutine scope and cancels its requests before disposal.
    }

    suspend fun unloadAll() = mutex.withLock {
        loaded.values.forEach { item ->
            try { item.instance.beforeUnload() } finally { removeRegistrations(item.instance.filename ?: ""); item.assets?.close() }
        }
        loaded.clear(); issuedData.clear(); issuedUrls.clear()
    }

    private fun type(type: TvType?): String? = when (type) {
        TvType.Movie, TvType.AnimeMovie -> "movie"
        TvType.TvSeries, TvType.Anime, TvType.OVA, TvType.Cartoon -> "tv"
        TvType.Live -> "live"
        else -> null
    }
}
