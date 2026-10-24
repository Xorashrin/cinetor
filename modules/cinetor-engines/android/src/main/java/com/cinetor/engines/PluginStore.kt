// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import android.content.Context
import android.system.Os
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.zip.ZipException
import java.util.zip.ZipFile

internal data class ReviewedPlugin(
    val id: String,
    val engine: String,
    val name: String,
    val version: String,
    val hash: String,
    val asset: String,
    val license: String,
    val profile: String,
    val networkOrigins: Set<String>,
    val mediaOrigins: Set<String>,
    val maxBytes: Int,
    val pluginClass: String? = null,
    val requiresResources: Boolean = false,
) {
    fun inventory(enabled: Boolean, reason: String? = null, installed: Boolean = enabled) = mapOf(
        "id" to id, "pluginId" to id, "engine" to engine, "name" to name,
        "version" to version, "hash" to hash, "enabled" to enabled, "installed" to installed, "reviewed" to true,
        "settingsAvailable" to true,
        "license" to license, "profile" to profile, "disabledReason" to reason,
        "status" to when { enabled -> "installed"; installed -> "unsupported"; else -> "reviewed" },
        "capabilities" to if (engine == "nuvio") listOf("movie", "settings") else listOf("search", "load", "movie", "resources", "settings"),
    )
}

internal class PluginStore(private val context: Context) {
    private val root = File(context.noBackupFilesDir, "cinetor-engines/plugins").apply { mkdirs() }
    private val fixturePin by lazy {
        try {
            val node = context.assets.open("cinetor/owned-fixture.json").use { Json.parse(it.readBounded(8192).toString(Charsets.UTF_8)) }
            requireEngine(node.string("pluginId") == "cinetor-bbb-cloudstream" &&
                node.string("profile") == "cloudstream-4.8.0-androidJvm" &&
                node.string("sourceLicense") == "GPL-3.0-or-later", "NOT_REVIEWED", "Unrecognized fixture provenance")
            node.string("sha256")?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
        } catch (_: Exception) { null }
    }

    val entries: List<ReviewedPlugin> get() = listOfNotNull(
        ReviewedPlugin("cinetor-bbb-nuvio", "nuvio", "Blender Open Movie (Nuvio)", "1.0.0",
            "881ba17ce256f51f95095ca61b65e935a0be4b7cb7815882c47db18e39c66295", "cinetor/plugins/bbb.js", "GPL-3.0-or-later", "nuvio-mobile-quickjs-1.0.15",
            emptySet(), setOf("https://media.w3.org"), Limits.CODE),
        fixturePin?.let { hash -> ReviewedPlugin("cinetor-bbb-cloudstream", "cloudstream",
            "Blender Open Movie (Cloudstream)", "1", hash, "cinetor/plugins/bbb.cs3", "GPL-3.0-or-later",
            "cloudstream-4.8.0-androidJvm", emptySet(), setOf("https://media.w3.org"), Limits.ARCHIVE,
            "com.cinetor.fixture.BlenderPlugin", true) }
    )

    fun entry(id: String, engine: String? = null): ReviewedPlugin {
        val entry = entries.singleOrNull { it.id == id && (engine == null || it.engine == engine) }
        return entry ?: throw EngineFailure("NOT_REVIEWED", "Only source-reviewed bundled plugins are admitted by this release")
    }

    fun file(entry: ReviewedPlugin): File = File(root, "${entry.id}-${entry.hash}.${if (entry.engine == "nuvio") "js" else "cs3"}")

    fun installed(entry: ReviewedPlugin): Boolean = file(entry).let { it.isFile && it.length() in 1..entry.maxBytes.toLong() }

    @Synchronized
    fun install(entry: ReviewedPlugin): File {
        val destination = file(entry)
        if (destination.exists()) {
            verifiedBytes(entry)
            return destination
        }
        val bytes = context.assets.open(entry.asset).use { it.readBounded(entry.maxBytes) }
        requireEngine(sha256(bytes) == entry.hash, "INTEGRITY", "Bundled plugin hash does not match the reviewed pin")
        val temporary = File(root, ".${UUID.randomUUID()}.part")
        try {
            FileOutputStream(temporary).use { stream ->
                // Android 14+ dynamic-code loading: mark the opened inode read-only before writing.
                Os.chmod(temporary.absolutePath, 256)
                stream.write(bytes)
                stream.fd.sync()
            }
            if (entry.engine == "cloudstream") validateArchive(temporary, entry)
            requireEngine(temporary.renameTo(destination), "STORAGE", "Unable to atomically install the plugin")
            return destination
        } finally { temporary.delete() }
    }

    fun verifiedBytes(entry: ReviewedPlugin): ByteArray {
        val source = file(entry)
        requireEngine(source.isFile && source.canonicalFile.parentFile == root.canonicalFile,
            "NOT_INSTALLED", "Install the reviewed plugin before using it")
        requireEngine((android.system.Os.stat(source.path).st_mode and 146) == 0,
            "INTEGRITY", "Executable plugin storage must be read-only")
        val bytes = source.inputStream().use { it.readBounded(entry.maxBytes) }
        requireEngine(sha256(bytes) == entry.hash, "INTEGRITY", "Installed plugin integrity check failed")
        return bytes
    }

    fun validateArchive(file: File, entry: ReviewedPlugin) {
        var total = 0L
        var manifest: String? = null
        var dex = false
        var resources = false
        val names = HashSet<String>()
        try {
            ZipFile(file).use { zip ->
                val iterator = zip.entries()
                while (iterator.hasMoreElements()) {
                    val item = iterator.nextElement()
                    val name = item.name
                    requireEngine(names.size < 512 && name.length <= 256 && !name.startsWith("/") &&
                        !name.contains('\\') && name.split('/').none { it == ".." || it == "." } &&
                        names.add(name), "ARCHIVE", "Unsafe or duplicate archive entry")
                    requireEngine(!name.endsWith(".so") && !name.startsWith("lib/"),
                        "UNSUPPORTED_NATIVE_PLUGIN", "Native-library plugins are not admitted")
                    if (item.isDirectory) continue
                    val bytes = zip.getInputStream(item).use { it.readBounded(Limits.UNPACKED) }
                    total += bytes.size
                    requireEngine(total <= Limits.UNPACKED && item.size == bytes.size.toLong(),
                        "ARCHIVE", "Archive size limit or entry length mismatch")
                    if (name == "manifest.json") {
                        requireEngine(bytes.size <= 8192, "ARCHIVE", "Plugin manifest is too large")
                        manifest = bytes.toString(Charsets.UTF_8)
                    }
                    if (name == "classes.dex") dex = bytes.size > 8 && bytes.copyOfRange(0, 4).contentEquals(byteArrayOf(100, 101, 120, 10))
                    if (name == "resources.arsc") resources = bytes.isNotEmpty()
                }
            }
        } catch (error: ZipException) {
            // Android 14+ can reject unsafe entry paths before the explicit checks above run.
            throw EngineFailure("ARCHIVE", "Invalid or unsafe plugin archive").apply { initCause(error) }
        }
        val parsed = Json.parse(manifest ?: throw EngineFailure("ARCHIVE", "Embedded manifest.json is required"), 8192)
        requireEngine(parsed.isObject && dex && parsed.string("pluginClassName") == entry.pluginClass &&
            parsed.string("name") == "CinetorBlenderFixture" && parsed["version"]?.isIntegralNumber == true &&
            parsed["version"].asInt() == entry.version.toInt() &&
            parsed["requiresResources"]?.isBoolean == true && parsed["requiresResources"].asBoolean() == entry.requiresResources,
            "UNSUPPORTED_ABI", "Plugin manifest does not match its reviewed Android ABI profile")
        requireEngine(!entry.requiresResources || resources, "UNSUPPORTED_RESOURCES", "Plugin requires compiled Android resources")
    }
}
