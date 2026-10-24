// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cinetor.engines.nuvio.NuvioRuntime
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.QuickJsInterruptedException
import com.dokar.quickjs.binding.function
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/** Device-only tests. No tests execute provider code in Node, the RN realm, or a JVM mock. */
@RunWith(AndroidJUnit4::class)
class NativeEnginesInstrumentedTest {
    private lateinit var host: EngineHost
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun request(vararg values: Pair<String, Any?>): Map<String, Any?> =
        mapOf("requestId" to UUID.randomUUID().toString(), "deadlineMs" to 5000) + mapOf(*values)

    @Before fun start() { host = EngineHost(context) }
    @After fun stop() = runBlocking { host.requests.close(); host.cloudstream.unloadAll(); host.cloudstream.close() }

    private suspend fun evaluate(code: String, budget: Int = 5000, layout: Boolean = false): Map<String, Any?> {
        val input = request("deadlineMs" to budget)
        val runtime = NuvioRuntime(host.store, host.settings, HttpBroker())
        return host.run(input) { control ->
            result(input, "value", runtime.evaluate(code, "owned-test", "{}",
                "{\"tmdbId\":\"810\",\"mediaType\":\"movie\"}", emptySet(), control, layout))
        }
    }

    @Test fun realQuickJsSyncPromiseEmptyAndThrow() = runBlocking {
        assertEquals("[]", evaluate("module.exports.getStreams = () => [];")["value"])
        val promised = evaluate("module.exports.getStreams = async () => { await new Promise(r => setTimeout(r,1)); return [{url:'https://media.w3.org/2010/05/bunny/movie.mp4'}]; };")
        assertEquals("ok", promised["status"])
        assertTrue((promised["value"] as String).contains("movie.mp4"))
        assertEquals("error", evaluate("module.exports.getStreams = () => { throw new Error('owned failure'); };")["status"])
        assertEquals("error", evaluate("module.exports.getStreams = () => ({url:'bad'});")["status"])
        assertEquals("unsupported", evaluate("module.exports = {};")["status"])
        assertEquals("unsupported", evaluate("module.exports.getStreams = async () => { await WebAssembly.instantiate([]); return []; };")["status"])
        assertEquals("error", evaluate("module.exports.getStreams = () => Promise.reject(new Error('owned rejection'));")["status"])
    }

    @Test fun settingsCallsAwaitSyncAndAsyncResults() = runBlocking {
        assertEquals("[]", evaluate("module.exports = {};", layout = true)["value"])
        assertEquals("[]", evaluate("module.exports.onSettings = () => [];", layout = true)["value"])
        val promised = evaluate("module.exports.onSettings = async () => { await new Promise(r => setTimeout(r,1)); return [{id:'enabled',type:'boolean'}]; };", layout = true)
        assertEquals("ok", promised["status"])
        assertEquals("enabled", Json.parse(promised["value"] as String).single()["id"].asText())
        assertEquals("error", evaluate("module.exports.onSettings = () => Promise.reject(new Error('owned rejection'));", layout = true)["status"])
        assertEquals("error", evaluate("module.exports.onSettings = () => ({});", layout = true)["status"])
        assertEquals("timeout", evaluate("module.exports.onSettings = () => new Promise(() => {});", 150, layout = true)["status"])
    }

    @Test fun nativeInterruptStopsBusyJavaScript() = runBlocking {
        val result = evaluate("module.exports.getStreams = () => { while (true) {} };", 150)
        assertEquals("timeout", result["status"])
    }

    @Test fun officialInterruptIsCallableAcrossThreads() = runBlocking {
        val runtime = QuickJs.create(Dispatchers.IO)
        val entered = CompletableDeferred<Unit>()
        try {
            runtime.memoryLimit = 8L * 1024 * 1024
            runtime.maxStackSize = 256L * 1024
            runtime.evaluationTimeoutMillis = 10000
            runtime.function("started") { entered.complete(Unit) }
            val worker = async(Dispatchers.IO) {
                runCatching { runtime.evaluate<Any?>("started(); while(true){}") }.exceptionOrNull()
            }
            try {
                withTimeout(3000) {
                    entered.await()
                    runtime.interruptEvaluation()
                    assertTrue(worker.await() is QuickJsInterruptedException)
                }
                assertEquals(2, runtime.evaluate<Int>("1 + 1"))
            } finally {
                runtime.interruptEvaluation()
                withContext(NonCancellable) { worker.join() }
            }
        } finally { runtime.close() }
    }

    @Test fun cancelAndPromiseTimeoutRemainDistinct() = runBlocking {
        assertEquals("timeout", evaluate("module.exports.getStreams = () => new Promise(() => {});", 150)["status"])
        val input = request("deadlineMs" to 5000)
        val runtime = NuvioRuntime(host.store, host.settings, HttpBroker())
        val task = async(Dispatchers.IO) {
            host.run(input) { control -> result(input, "value", runtime.evaluate(
                "module.exports.getStreams = async () => { await new Promise(r => setTimeout(r,10000)); return []; };",
                "owned-cancel", "{}", "{}", emptySet(), control)) }
        }
        delay(50)
        host.requests.cancel(input["requestId"] as String)
        assertEquals("cancelled", withTimeout(2000) { task.await() }["status"])
    }

    @Test fun ownedNuvioCanonicalInputsAndProfileSettings() = runBlocking {
        assertEquals("ok", host.install(mapOf("pluginId" to "cinetor-bbb-nuvio"), "nuvio")["status"])
        val input = request("pluginId" to "cinetor-bbb-nuvio", "tmdbId" to "810", "mediaType" to "movie", "contentKey" to "tmdb:movie:810", "profileId" to "engine-test")
        host.settings.write("cinetor-bbb-nuvio", "engine-test", mapOf("enabled" to true))
        val success = host.run(input) { host.nuvio.resolve(input, it) }
        assertEquals("ok", success["status"])
        assertEquals("tmdb:movie:810", success["contentKey"])
        assertEquals(1, (success["sources"] as List<*>).size)
        val layout = host.run(input) { host.nuvio.settingsLayout(input, it) }
        assertEquals("ok", layout["status"])
        assertEquals("enabled", ((layout["layout"] as List<*>).single() as Map<*, *>)["id"])
        val wrong = input + mapOf("requestId" to UUID.randomUUID().toString(), "tmdbId" to "811")
        assertEquals("empty", host.run(wrong) { host.nuvio.resolve(wrong, it) }["status"])
        val tv = input + mapOf("requestId" to UUID.randomUUID().toString(), "mediaType" to "tv", "season" to 0, "episode" to 1)
        assertEquals("empty", host.run(tv) { host.nuvio.resolve(tv, it) }["status"])
        host.settings.write("cinetor-bbb-nuvio", "engine-test", mapOf("enabled" to false))
        assertEquals("empty", host.run(input) { host.nuvio.resolve(input, it) }["status"])
        assertEquals(emptyMap<String, Any?>(), host.settings.read("cinetor-bbb-nuvio", "another-profile"))
    }

    @Test fun downloadCandidatesMatchNativePackagingFormats() {
        val entry = host.store.entry("cinetor-bbb-nuvio")
        for ((extension, expected) in mapOf("mp4" to true, "m3u8" to true, "mpd" to true, "mkv" to false, "webm" to false)) {
            val node = Json.parse("""{"url":"https://media.w3.org/owned-fixture.$extension","downloadable":true}""")
            assertEquals(extension, expected, StreamNormalizer.nuvio(node, entry)["downloadable"])
        }
        val disabled = Json.parse("""{"url":"https://media.w3.org/owned-fixture.mp4","downloadable":false}""")
        assertEquals(false, StreamNormalizer.nuvio(disabled, entry)["downloadable"])
    }

    @Test fun urlDomCryptoHostRoundTripsAndIsolation() = runBlocking {
        val code = """
            module.exports.getStreams = async () => {
                const u = new URL('../b?a=1&a=2', 'https://example.org/a/c');
                if (u.pathname !== '/b' || u.searchParams.getAll('a').length !== 2) throw new Error('URL');
                u.searchParams.append('q','two words');
                if (!u.href.includes('q=two+words')) throw new Error('URL mutation');
                const dom = new DOMParser().parseFromString('<div><i>A</i></div>', 'text/html');
                if (dom.querySelector('i').textContent !== 'A') throw new Error('DOM');
                if (CryptoJS.SHA256('abc').toString() !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('digest');
                if (typeof globalThis.previousRequest !== 'undefined') throw new Error('isolation');
                globalThis.previousRequest = true;
                return [];
            };
        """.trimIndent()
        assertEquals("ok", evaluate(code)["status"])
        assertEquals("ok", evaluate(code)["status"])
        assertEquals("error", evaluate("module.exports.getStreams=()=>Array.from({length:31},()=>({url:'x'}));")["status"])
    }

    @Test fun realDexResourcesSearchLoadOpaqueLinks() = runBlocking {
        val entry = host.store.entry("cinetor-bbb-cloudstream", "cloudstream")
        assertEquals("ok", host.install(mapOf("pluginId" to entry.id), "cloudstream")["status"])
        val provider = "cinetor-bbb-cloudstream:com.cinetor.fixture.BlenderProvider"
        assertTrue(host.cloudstream.providerInventory().any { it["providerId"] == provider && it["nativeSettings"] == true })
        val searchInput = request("providerId" to provider, "query" to "Big Buck Bunny", "page" to 1)
        val search = host.run(searchInput) { host.cloudstream.search(searchInput, it) }
        assertEquals("ok", search["status"])
        val row = (search["items"] as List<*>).single() as Map<*, *>
        val loadInput = request("providerId" to provider, "url" to row["url"])
        val loaded = host.run(loadInput) { host.cloudstream.load(loadInput, it) }
        val item = loaded["item"] as Map<*, *>
        assertEquals("810", item["tmdbId"])
        assertEquals("movie", item["mediaType"])
        assertEquals("provider-sync-data", item["mappingEvidence"])
        assertFalse((item["data"] as String).startsWith("http"))
        val resolveInput = request("providerId" to provider, "opaqueData" to item["data"], "contentKey" to "tmdb:movie:810")
        val links = host.run(resolveInput) { host.cloudstream.resolve(resolveInput, it) }
        assertEquals("ok", links["status"])
        assertEquals(1, (links["sources"] as List<*>).size)
        val wrong = resolveInput + mapOf("opaqueData" to "810", "requestId" to UUID.randomUUID().toString())
        assertEquals("error", host.run(wrong) { host.cloudstream.resolve(wrong, it) }["status"])
        val wait = request("providerId" to provider, "query" to "__cinetor_cancel_fixture__", "deadlineMs" to 100)
        assertEquals("timeout", host.run(wait) { host.cloudstream.search(wait, it) }["status"])
    }

    @Test fun archiveResourceAndAbiFailuresAreRejected() {
        val entry = host.store.entry("cinetor-bbb-cloudstream")
        val original = context.assets.open(entry.asset).use { it.readBounded(Limits.ARCHIVE) }
        val dir = File(context.cacheDir, "engine-archive-${UUID.randomUUID()}").apply { mkdirs() }
        val good = File(dir, "good.cs3").apply { writeBytes(original) }
        try {
            host.store.validateArchive(good, entry)
            for ((mode, expectedCode) in mapOf("resources" to "UNSUPPORTED_RESOURCES", "abi" to "UNSUPPORTED_ABI",
                "traversal" to "ARCHIVE", "absolute" to "ARCHIVE")) {
                val broken = File(dir, "$mode.cs3")
                ZipFile(good).use { source -> ZipOutputStream(broken.outputStream()).use { target ->
                    source.entries().asSequence().forEach { item ->
                        if (mode == "resources" && item.name == "resources.arsc") return@forEach
                        target.putNextEntry(ZipEntry(item.name))
                        var data = source.getInputStream(item).use { it.readBytes() }
                        if (mode == "abi" && item.name == "manifest.json") data = data.toString(Charsets.UTF_8).replace("com.cinetor.fixture.BlenderPlugin", "unsupported.OlderPlugin").toByteArray()
                        target.write(data); target.closeEntry()
                    }
                    if (mode == "traversal" || mode == "absolute") {
                        target.putNextEntry(ZipEntry(if (mode == "traversal") "../escape" else "/escape"))
                        target.write(byteArrayOf(1)); target.closeEntry()
                    }
                } }
                val failure = runCatching { host.store.validateArchive(broken, entry) }.exceptionOrNull()
                assertTrue("$mode must fail with EngineFailure, got ${failure?.javaClass?.name}", failure is EngineFailure)
                assertEquals(mode, expectedCode, (failure as EngineFailure).code)
            }
            val malformed = File(dir, "malformed.cs3").apply { writeText("This is not a ZIP archive.") }
            val failure = runCatching { host.store.validateArchive(malformed, entry) }.exceptionOrNull()
            assertTrue("Malformed ZIP must fail with EngineFailure, got ${failure?.javaClass?.name}", failure is EngineFailure)
            assertEquals("ARCHIVE", (failure as EngineFailure).code)
        } finally { dir.deleteRecursively() }
    }

    @Test fun redirectReuseAndAbortCompleteWithoutDuplicateCalls() = runBlocking {
        val transport = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            val first = chain.request().url.encodedPath == "/first"
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(if (first) 302 else 200).message("Owned fixture")
                .apply { if (first) header("Location", "/second") }
                .body("owned".toResponseBody("text/plain".toMediaType())).build()
        }.build()
        val broker = HttpBroker(transport)
        repeat(30) { index ->
            broker.session(setOf("https://example.org")).use { session ->
                val response = Json.parse(session.fetch("same-id-$index", "https://example.org/first", "GET", emptyMap(), null, "follow"))
                assertEquals(200, response["status"].asInt())
                assertEquals("https://example.org/second", response["url"].asText())
                session.abort("aborted")
                assertEquals("CANCELLED", (runCatching {
                    session.fetch("aborted", "https://example.org/first", "GET", emptyMap(), null, "follow")
                }.exceptionOrNull() as EngineFailure).code)
            }
        }
    }

    @Test fun repositoryMetadataIsSeparateAndCannotExecutePackages() = runBlocking {
        val payload = "{\"pluginLists\":[\"https://example.net/index.json\"]}"
        val transport = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            assertNull(chain.request().header("Authorization"))
            assertNull(chain.request().header("Cookie"))
            val body = if (chain.request().url.encodedPath.endsWith(".cs3")) "dex\\nnot-json" else payload
            okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("Owned metadata fixture")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val broker = HttpBroker(transport)
        val input = request("url" to "https://example.org/repo.json")
        val metadata = host.run(input) { result(input, "document", broker.inspectRepository(input, it)) }
        assertEquals("ok", metadata["status"])
        val document = metadata["document"] as Map<*, *>
        assertEquals(payload, document["bodyText"])
        assertEquals(sha256(payload.toByteArray()), document["sha256"])
        val binary = request("url" to "https://example.org/plugin.cs3")
        assertEquals("error", host.run(binary) { result(binary, "document", broker.inspectRepository(binary, it)) }["status"])
        assertEquals("unsupported", host.install(mapOf("pluginId" to "remote-discovered-plugin"), "cloudstream")["status"])
    }

    @Test fun nativeNetworkAdmissionFailsBeforeUnapprovedRequest() = runBlocking {
        val broker = HttpBroker()
        broker.session(emptySet()).use { session ->
            val failure = runCatching { session.fetch("test", "https://example.org/", "GET", emptyMap(), null, "follow") }.exceptionOrNull()
            assertTrue(failure is EngineFailure)
            assertEquals("UNSUPPORTED_ORIGIN", (failure as EngineFailure).code)
        }
        assertTrue(runCatching { safeHeaders(mapOf("Authorization" to "a", "authorization" to "b")) }.isFailure)
        assertTrue(runCatching { Json.parse("{\"a\":1,\"a\":2}") }.isFailure)
        assertTrue(runCatching { Json.parse("{}{}") }.isFailure)
    }
}
