// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import com.fasterxml.jackson.databind.JsonNode
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.utils.DrmExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkPlayList
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import java.util.Locale

internal object StreamNormalizer {
    private fun headers(node: JsonNode?): Map<String, String> {
        if (node == null || node.isNull) return emptyMap()
        requireEngine(node.isObject && node.all { it.isTextual }, "MALFORMED", "Stream headers must be a string map")
        return safeHeaders(node.fields().asSequence().associate { it.key to it.value.asText() })
    }
    private fun subtitle(url: String, name: String?, language: String?, headers: Map<String, String>, entry: ReviewedPlugin): Map<String, Any?> {
        val target = safeUrl(url, entry.mediaOrigins)
        return mapOf("url" to target.toString(), "label" to name?.take(160), "language" to language?.take(64),
            "headers" to safeHeaders(headers), "headerOrigin" to origin(target)).filterValues { it != null }
    }
    private fun stream(url: String, label: String?, quality: String?, headers: Map<String, String>, container: String?,
                       downloadable: Boolean, subtitles: List<Map<String, Any?>>, entry: ReviewedPlugin, providerId: String): Map<String, Any?> {
        val target = safeUrl(url, entry.mediaOrigins)
        val format = container ?: when (target.encodedPath.substringAfterLast('.').lowercase(Locale.US)) {
            "mp4", "m4v" -> "mp4"
            "webm" -> "webm"
            "mkv" -> "mkv"
            "m3u8" -> "hls"
            "mpd" -> "dash"
            else -> "unknown"
        }
        requireEngine(format !in setOf("torrent", "magnet", "drm"), "UNSUPPORTED_MEDIA", "Only unprotected HTTPS media is supported")
        val normalizedHeaders = safeHeaders(headers)
        return mapOf("url" to target.toString(), "headers" to normalizedHeaders, "headerOrigin" to origin(target),
            "label" to (label?.take(160) ?: entry.name), "quality" to quality?.take(64), "container" to format,
            "downloadable" to (downloadable && format in setOf("mp4", "hls", "dash")),
            "subtitleTracks" to subtitles, "sourceId" to "$providerId:${sha256((url + Json.encode(normalizedHeaders)).toByteArray()).take(24)}",
            "providerId" to providerId, "providerVersion" to entry.version, "providerHash" to entry.hash,
            "engine" to entry.engine, "verified" to false).filterValues { it != null }
    }

    fun nuvio(node: JsonNode, entry: ReviewedPlugin): Map<String, Any?> {
        if (node.isTextual) return stream(node.asText(), null, null, emptyMap(), null, true, emptyList(), entry, entry.id)
        requireEngine(node.isObject, "MALFORMED", "Stream result must be a URL or object")
        requireEngine(node["infoHash"] == null && node.string("type")?.lowercase(Locale.US) !in setOf("torrent", "magnet", "drm"),
            "UNSUPPORTED_MEDIA", "P2P and DRM streams are not admitted")
        val nested = node["url"]
        val url = if (nested?.isTextual == true) nested.asText() else nested?.string("url")
        requireEngine(!url.isNullOrBlank(), "MALFORMED", "Stream result is missing its HTTP URL")
        val tracks = node["subtitles"] ?: node["subtitleTracks"]
        requireEngine(tracks == null || tracks.isArray && tracks.size() <= 30, "LIMIT", "Invalid subtitle list")
        val subtitles = tracks?.map { track ->
            subtitle(track.string("url") ?: throw EngineFailure("MALFORMED", "Subtitle is missing its URL"),
                track.string("name") ?: track.string("label"), track.string("language"), headers(track["headers"]), entry)
        } ?: emptyList()
        return stream(url!!, node.string("title") ?: node.string("name"), node["quality"]?.asText(),
            headers(node["headers"] ?: nested?.takeIf { it.isObject }?.get("headers")), null,
            node["downloadable"]?.asBoolean(true) != false, subtitles, entry, entry.id)
    }

    fun cloudstream(link: ExtractorLink, tracks: List<SubtitleFile>, entry: ReviewedPlugin, providerId: String,
                    canDownload: Boolean): Map<String, Any?> {
        requireEngine(link !is DrmExtractorLink && link !is ExtractorLinkPlayList && link.audioTracks.isEmpty(),
            "UNSUPPORTED_MEDIA", "DRM, playlist, and separate-audio outputs require a player capability not included here")
        val container = when (link.type) {
            ExtractorLinkType.M3U8 -> "hls"
            ExtractorLinkType.DASH -> "dash"
            ExtractorLinkType.VIDEO -> null
            else -> throw EngineFailure("UNSUPPORTED_MEDIA", "Cloudstream output is not HTTPS video")
        }
        val headers = link.headers.toMutableMap()
        if (link.referer.isNotBlank() && headers.keys.none { it.equals("referer", true) }) headers["referer"] = link.referer
        val subtitles = tracks.map { subtitle(it.url, it.lang, it.langTag ?: it.lang, it.headers ?: emptyMap(), entry) }
        return stream(link.url, link.name, link.quality.takeIf { it > 0 }?.toString(), headers,
            container, canDownload, subtitles, entry, providerId)
    }
}
