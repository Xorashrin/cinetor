package expo.modules.cinetormedia

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.ByteArrayInputStream

/** Finite, clear presentations only. Media3 still parses and selects actual supported tracks. */
internal object ManifestValidation {
  fun validate(bytes: ByteArray, container: String) {
    val text = bytes.toString(Charsets.UTF_8).removePrefix("﻿").trimStart()
    if (text.contains("<!DOCTYPE", true) || text.contains("<!ENTITY", true)) throw MediaFailure("invalid_manifest", "External manifest entities are not allowed")
    if (text.startsWith("#EXTM3U")) {
      val lines = text.lineSequence().map { it.trim() }.toList()
      val master = lines.any { it.startsWith("#EXT-X-STREAM-INF:") }
      if (!master && lines.none { it == "#EXT-X-ENDLIST" }) {
        throw MediaFailure("live_unsupported", "Live media cannot be saved for offline playback")
      }
      if (lines.any { it.startsWith("#EXT-X-PART:") || it.startsWith("#EXT-X-PRELOAD-HINT:") || it.startsWith("#EXT-X-CONTENT-STEERING:") }) {
        throw MediaFailure("live_unsupported", "Low-latency and steered media are not supported offline")
      }
      for (line in lines.filter { it.startsWith("#EXT-X-KEY:") || it.startsWith("#EXT-X-SESSION-KEY:") }) {
        val method = Regex("(?:^|[:,])METHOD=([^,]+)").find(line)?.groupValues?.get(1)
        val format = Regex("(?:^|,)KEYFORMAT=\"([^\"]+)\"").find(line)?.groupValues?.get(1)
        if (method !in setOf("NONE", "AES-128") || format != null && format != "identity") {
          throw MediaFailure("drm_unsupported", "DRM-protected media is not supported offline")
        }
      }
      return
    }
    if (container != "dash") throw MediaFailure("invalid_manifest", "The server returned an invalid media manifest")
    try {
      val factory = XmlPullParserFactory.newInstance()
      factory.isNamespaceAware = true
      val parser = factory.newPullParser()
      parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
      parser.setInput(ByteArrayInputStream(bytes), "UTF-8")
      var root = false
      var event = parser.eventType
      while (event != XmlPullParser.END_DOCUMENT) {
        if (event == XmlPullParser.DOCDECL) throw MediaFailure("invalid_manifest", "External manifest entities are not allowed")
        if (event == XmlPullParser.START_TAG) {
          if (!root) {
            if (parser.name != "MPD") throw MediaFailure("invalid_manifest", "Invalid DASH presentation")
            root = true
            if (parser.getAttributeValue(null, "type") == "dynamic") throw MediaFailure("live_unsupported", "Live media cannot be saved for offline playback")
          }
          if (parser.name == "ContentProtection") throw MediaFailure("drm_unsupported", "DRM-protected media is not supported offline")
          if (parser.name == "ContentSteering" || parser.name == "Location") throw MediaFailure("unsupported_manifest", "Redirected DASH presentations are not supported offline")
        }
        event = parser.nextToken()
      }
      if (!root) throw MediaFailure("invalid_manifest", "The media manifest is empty")
    } catch (error: MediaFailure) { throw error }
    catch (_: Exception) { throw MediaFailure("invalid_manifest", "The server returned an invalid DASH manifest") }
  }
}
