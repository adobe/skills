export function fireAnalyticsEvent(event, data = {}) {
  window.adobeDataLayer = window.adobeDataLayer || [];
  window.adobeDataLayer.push({ event, ...data });
}

export default fireAnalyticsEvent;
