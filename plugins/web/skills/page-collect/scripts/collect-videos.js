/**
 * Videos collector — extracts video embeds and sources.
 */

const VIDEO_HOSTS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'wistia.com',
  'wistia.net',
  'dailymotion.com',
  'twitch.tv',
];

export async function collectVideos(page) {
  return page.evaluate((hosts) => {
    const videos = [];

    for (const video of document.querySelectorAll('video')) {
      const sources = [];
      const src = video.getAttribute('src');
      if (src) sources.push({ src, type: null });
      for (const source of video.querySelectorAll('source')) {
        sources.push({
          src: source.getAttribute('src'),
          type: source.getAttribute('type'),
        });
      }
      videos.push({
        type: 'native',
        poster: video.getAttribute('poster') || null,
        sources,
      });
    }

    for (const iframe of document.querySelectorAll('iframe[src]')) {
      const src = iframe.getAttribute('src');
      const isVideo = hosts.some(
        (h) => src.includes(h)
      );
      if (isVideo) {
        videos.push({
          type: 'embed',
          src,
          width: iframe.getAttribute('width') || null,
          height: iframe.getAttribute('height') || null,
        });
      }
    }

    return { videos };
  }, VIDEO_HOSTS);
}
