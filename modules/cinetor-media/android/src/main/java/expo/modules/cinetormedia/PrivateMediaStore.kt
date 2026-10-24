package expo.modules.cinetormedia

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class MediaRecord(
  val key: String,
  val id: String = UUID.randomUUID().toString(),
  val url: String,
  val headers: Map<String, String>,
  val container: String,
  val headerOrigin: String? = null,
  var status: String = "queued",
  var bytes: Long = 0,
  var total: Long = -1,
  var progress: Double? = null,
  var progressKind: String = "indeterminate",
  var localUri: String? = null,
  var error: String? = null,
  var errorCode: String? = null,
  var updatedAt: Long = System.currentTimeMillis(),
  var streamKeys: List<Triple<Int, Int, Int>> = emptyList(),
) {
  fun publicMap(removed: Boolean = false): Map<String, Any?> = mapOf(
    "key" to key, "id" to id, "status" to status, "container" to container,
    "bytesDownloaded" to bytes, "totalBytes" to total.takeIf { it >= 0 }, "progress" to progress,
    "progressKind" to progressKind, "localUri" to localUri,
    "sizeMB" to if (status == "downloaded") bytes / 1e6 else null,
    "error" to error, "errorCode" to errorCode, "updatedAt" to updatedAt,
    "restartRequired" to (status == "paused" || status == "failed"), "removed" to removed,
  )

  fun json(): JSONObject = JSONObject().apply {
    put("key", key); put("id", id); put("url", url); put("headers", JSONObject(headers)); put("container", container)
    put("headerOrigin", headerOrigin ?: JSONObject.NULL)
    put("status", status); put("bytes", bytes); put("total", total); put("progress", progress ?: JSONObject.NULL)
    put("progressKind", progressKind); put("localUri", localUri ?: JSONObject.NULL)
    put("error", error ?: JSONObject.NULL); put("errorCode", errorCode ?: JSONObject.NULL); put("updatedAt", updatedAt)
    put("streamKeys", JSONArray().apply { streamKeys.forEach { put(JSONArray(listOf(it.first, it.second, it.third))) } })
  }

  companion object {
    fun fromJson(json: JSONObject): MediaRecord {
      val headerJson = json.getJSONObject("headers")
      val keys = json.optJSONArray("streamKeys") ?: JSONArray()
      return MediaRecord(
        key = json.getString("key"), id = json.getString("id"), url = json.getString("url"),
        headers = headerJson.keys().asSequence().associateWith { headerJson.getString(it) }, container = json.getString("container"),
        headerOrigin = if (json.isNull("headerOrigin")) null else json.getString("headerOrigin"),
        status = json.getString("status"), bytes = json.optLong("bytes", 0), total = json.optLong("total", -1),
        progress = if (json.isNull("progress")) null else json.getDouble("progress"),
        progressKind = json.optString("progressKind", "indeterminate"),
        localUri = if (json.isNull("localUri")) null else json.getString("localUri"),
        error = if (json.isNull("error")) null else json.getString("error"),
        errorCode = if (json.isNull("errorCode")) null else json.getString("errorCode"),
        updatedAt = json.optLong("updatedAt", 0),
        streamKeys = (0 until keys.length()).map { index -> keys.getJSONArray(index).let { Triple(it.getInt(0), it.getInt(1), it.getInt(2)) } },
      )
    }
  }
}

/** URLs and all request headers are AES-GCM sealed with an Android Keystore key, excluded from backup. */
internal class PrivateMediaStore(context: Context) {
  val root = File(context.noBackupFilesDir, "cinetor-media").apply { mkdirs() }
  private val file = AtomicFile(File(root, "records.sealed"))
  private val alias = "cinetor.media.records.v1"
  val records = linkedMapOf<String, MediaRecord>()
  var wifiOnly = true

  private fun secret(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }

  init {
    if (file.baseFile.exists()) {
      try {
        val bytes = file.readFully()
        if (bytes.size < 29 || bytes[0].toInt() != 1) throw IllegalStateException()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        val json = JSONObject(cipher.doFinal(bytes.copyOfRange(13, bytes.size)).toString(Charsets.UTF_8))
        wifiOnly = json.optBoolean("wifiOnly", true)
        val entries = json.getJSONArray("records")
        for (index in 0 until entries.length()) {
          val record = MediaRecord.fromJson(entries.getJSONObject(index))
          if (!Regex("[a-f0-9-]{36}").matches(record.id)) throw IllegalStateException()
          records[record.key] = record
        }
      } catch (_: Exception) {
        // Never reset or overwrite a store that could still contain the user's offline media.
        throw MediaFailure("private_store_locked", "Private media storage could not be unlocked")
      }
    }
  }

  @Synchronized fun save() {
    val json = JSONObject().put("wifiOnly", wifiOnly).put("records", JSONArray().apply { records.values.forEach { put(it.json()) } })
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secret())
    val ciphertext = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
    val output = file.startWrite()
    try {
      output.write(byteArrayOf(1)); output.write(cipher.iv); output.write(ciphertext)
      file.finishWrite(output)
    } catch (error: Exception) { file.failWrite(output); throw error }
  }

  fun exportFile(id: String) = File(File(root, "exports").apply { mkdirs() }, "$id.mp4")
  fun temporaryFile(id: String) = File(File(root, "exports").apply { mkdirs() }, "$id.part")
}
