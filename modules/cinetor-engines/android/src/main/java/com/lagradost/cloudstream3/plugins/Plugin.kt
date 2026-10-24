// SPDX-License-Identifier: GPL-3.0-only
// Adapted from recloudstream/cloudstream 3796406e636356f556c16e04e1da4e37d6a19038.
// Modified October 24, 2026: retains the Android ABI; video actions are explicitly unsupported.
package com.lagradost.cloudstream3.plugins

import android.content.Context
import android.content.res.Resources
import com.lagradost.cloudstream3.actions.VideoClickAction

abstract class Plugin : BasePlugin() {
    @Throws(Throwable::class)
    open fun load(context: Context) { load() }

    fun registerVideoClickAction(element: VideoClickAction) {
        throw UnsupportedOperationException("Cinetor's reviewed Cloudstream profile does not support video-click actions")
    }

    var resources: Resources? = null
    var openSettings: ((context: Context) -> Unit)? = null
}
