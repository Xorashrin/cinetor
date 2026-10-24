// SPDX-License-Identifier: GPL-3.0-or-later
// Original Cinetor fixture. Media: Big Buck Bunny, Blender Foundation, CC BY 3.0.
package com.cinetor.fixture

import android.app.AlertDialog
import android.content.Context
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.LoadResponse.Companion.addTMDbId
import com.lagradost.cloudstream3.plugins.Plugin
import com.lagradost.cloudstream3.utils.DataStore.getKey
import com.lagradost.cloudstream3.utils.DataStore.setKey
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.newExtractorLink
import kotlinx.coroutines.delay

class BlenderPlugin : Plugin() {
    override fun load(context: Context) {
        check(javaClass.classLoader !== context.classLoader) { "Fixture must be loaded from external DEX" }
        val res = resources ?: error("Compiled resources are required")
        check(res.getString(R.string.fixture_resource_proof) == "cinetor-cloudstream-resource-v1")
        registerMainAPI(BlenderProvider(context.applicationContext))
        openSettings = { activity ->
            val enabled = activity.getKey<Boolean>("cinetor_blender_enabled", true) ?: true
            AlertDialog.Builder(activity)
                .setTitle(res.getString(R.string.fixture_title))
                .setMessage("Big Buck Bunny (2008), Blender Foundation. CC BY 3.0. This original fixture is not a general movie provider.")
                .setPositiveButton(if (enabled) "Disable fixture" else "Enable fixture") { _, _ ->
                    activity.setKey("cinetor_blender_enabled", !enabled)
                }
                .setNegativeButton("Close", null)
                .show()
        }
    }
}

class BlenderProvider(private val context: Context) : MainAPI() {
    override var name = "Blender Open Movie"
    override var mainUrl = "https://media.w3.org/2010/05/bunny"
    override var lang = "en"
    override val supportedTypes = setOf(TvType.Movie)
    override val hasMainPage = false
    override val hasDownloadSupport = true
    override val usesWebView = false

    private fun enabled() = context.getKey<Boolean>("cinetor_blender_enabled", true) ?: true

    override suspend fun search(query: String): List<SearchResponse> {
        if (!enabled()) return emptyList()
        if (query == "__cinetor_cancel_fixture__") { delay(60000); return emptyList() }
        if (!"big buck bunny".contains(query.lowercase().trim()) && query != "810") return emptyList()
        return listOf(newMovieSearchResponse("Big Buck Bunny", "$mainUrl/movie", TvType.Movie, false))
    }

    override suspend fun load(url: String): LoadResponse? {
        if (!enabled() || url != "$mainUrl/movie") return null
        return newMovieLoadResponse("Big Buck Bunny", url, TvType.Movie, dataUrl = OPAQUE) {
            year = 2008
            plot = "An open movie by the Blender Foundation, licensed under CC BY 3.0."
            addTMDbId("810")
        }
    }

    override suspend fun loadLinks(data: String, isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit, callback: (ExtractorLink) -> Unit): Boolean {
        check(data == OPAQUE) { "Opaque load data must be passed unchanged; TMDB IDs are not loadLinks data" }
        if (!enabled()) return false
        delay(1)
        callback(newExtractorLink(name, "Big Buck Bunny — Blender Foundation (CC BY 3.0)",
            "https://media.w3.org/2010/05/bunny/movie.mp4", ExtractorLinkType.VIDEO))
        return true
    }

    companion object {
        const val OPAQUE = "cinetor-owned-fixture:v1|tmdb:movie:810|full-movie|w3c"
    }
}
