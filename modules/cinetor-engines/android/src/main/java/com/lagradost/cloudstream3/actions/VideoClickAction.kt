// SPDX-License-Identifier: GPL-3.0-or-later
package com.lagradost.cloudstream3.actions

/**
 * Fail-closed linkage boundary for an explicitly excluded app-UI API.
 * This is not a working implementation of Cloudstream's VideoClickAction API:
 * no extension requiring that API is in the reviewed registry.
 */
abstract class VideoClickAction {
    init { throw UnsupportedOperationException("Video-click actions are unsupported by the Cinetor native profile") }
}
