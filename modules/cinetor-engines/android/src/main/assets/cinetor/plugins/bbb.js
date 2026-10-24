// SPDX-License-Identifier: GPL-3.0-or-later
// Original Cinetor compatibility fixture, not a third-party scraper.
// Big Buck Bunny (2008), Blender Foundation, CC BY 3.0.
// https://peach.blender.org/about/ | https://creativecommons.org/licenses/by/3.0/
// This fixture resolves only the exact canonical movie identity; no invented catalog.
module.exports = {
  async getStreams(tmdbId, mediaType, season, episode) {
    if (String(tmdbId) !== '810' || mediaType !== 'movie' || season !== undefined || episode !== undefined) return [];
    if (SCRAPER_SETTINGS.enabled === false) return [];
    await new Promise(resolve => setTimeout(resolve, 1));
    const url = new URL('movie.mp4', 'https://media.w3.org/2010/05/bunny/');
    return [{
      url: { url: url.href },
      title: 'Big Buck Bunny — Blender Foundation (CC BY 3.0)',
      name: 'W3C full movie mirror',
      headers: {},
      downloadable: true,
      subtitles: []
    }];
  },
  onSettings() {
    return [{ id: 'enabled', type: 'boolean', title: 'Enable Blender open movie fixture', default: true }];
  }
};
