/**
 * Socials collector — extracts social media links and share buttons.
 */

const SOCIAL_DOMAINS = {
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'linkedin.com': 'linkedin',
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'tiktok.com': 'tiktok',
  'pinterest.com': 'pinterest',
  'github.com': 'github',
  'reddit.com': 'reddit',
  'threads.net': 'threads',
  'mastodon.social': 'mastodon',
  'bsky.app': 'bluesky',
};

export async function collectSocials(page) {
  return page.evaluate((domains) => {
    const socials = [];
    const seen = new Set();

    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;

      for (const [domain, platform] of Object.entries(domains)) {
        if (href.includes(domain)) {
          seen.add(href);
          const isShare =
            href.includes('share') ||
            href.includes('sharer') ||
            href.includes('intent/tweet');
          socials.push({
            platform,
            url: href,
            type: isShare ? 'share' : 'profile',
            text: a.textContent.trim().substring(0, 100) || null,
          });
          break;
        }
      }
    }

    return { socials };
  }, SOCIAL_DOMAINS);
}
