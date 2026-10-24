// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Profile-specific plugin settings, encrypted at rest and excluded from Android backup. */
internal class SettingsStore(context: Context) {
    private val root = File(context.noBackupFilesDir, "cinetor-engines/settings").apply { mkdirs() }
    private fun path(pluginId: String, profileId: String): File {
        requireEngine(pluginId.length <= 128 && profileId.length <= 128 && profileId.isNotBlank(), "INVALID_REQUEST", "Invalid settings scope")
        return File(root, sha256("$pluginId\u0000$profileId".toByteArray()) + ".bin")
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("cinetor-engine-settings-v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("cinetor-engine-settings-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(pluginId: String, profileId: String): Map<String, Any?> {
        val file = AtomicFile(path(pluginId, profileId))
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return emptyMap()
        try {
            val data = file.openRead().use { it.readBounded(65536) }
            requireEngine(data.size > 29 && data[0].toInt() == 1, "STORAGE", "Unsupported settings format")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(1, 13)))
            cipher.updateAAD("$pluginId\u0000$profileId".toByteArray())
            val node = Json.parse(cipher.doFinal(data.copyOfRange(13, data.size)).toString(Charsets.UTF_8), 32768)
            requireEngine(node.isObject, "STORAGE", "Invalid stored settings")
            return Json.map(node)
        } catch (error: EngineFailure) { throw error } catch (_: Exception) {
            throw EngineFailure("STORAGE", "Unable to decrypt plugin settings; reset is required")
        }
    }
    @Synchronized fun write(pluginId: String, profileId: String, settings: Map<String, Any?>) {
        requireEngine(settings.size <= 64 && settings.keys.all { it.matches(Regex("[A-Za-z0-9_.-]{1,128}")) },
            "INVALID_REQUEST", "Invalid settings keys")
        val encoded = Json.encode(settings)
        val node = Json.parse(encoded, 32768)
        requireEngine(node.isObject, "INVALID_REQUEST", "Settings must be a JSON object")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD("$pluginId\u0000$profileId".toByteArray())
        val encrypted = byteArrayOf(1) + cipher.iv + cipher.doFinal(encoded.toByteArray(Charsets.UTF_8))
        val target = AtomicFile(path(pluginId, profileId))
        requireEngine(target.baseFile.exists() || (root.listFiles()?.size ?: 0) < 256,
            "LIMIT", "Stored settings scope budget exceeded")
        val stream = target.startWrite()
        try { stream.write(encrypted); target.finishWrite(stream) } catch (error: Exception) { target.failWrite(stream); throw error }
    }
}
