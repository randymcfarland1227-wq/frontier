/*
 * Life Hub keeps no offline cache. This worker is deliberately empty: registering it for /frontier/
 * means a service worker another app put at the site root (Daylight Matrix's, scope "/") can never
 * control Life Hub pages or answer its requests from a stale cache. No fetch handler = the network.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
