# Production deployment notes

Public URL: https://english.duytruongphatco.com/

## Cloudflare cache boundary

The zone has a generic **Cache HTML** rule matching paths ending in `/`. It overrides no-store and can retain an old homepage after deployment. This caused old HTML to reference removed build assets and broke an offline install over public HTTPS, although local tests passed.

On 2026-11-05 a final cache rule was deployed for this app only:

Name: **English Coach - fresh app shell and private routes**

Expression:

```text
(http.host eq "english.duytruongphatco.com") and not (starts_with(http.request.uri.path, "/_assets/") or starts_with(http.request.uri.path, "/fonts/") or starts_with(http.request.uri.path, "/audio/study/") or starts_with(http.request.uri.path, "/icon"))
```

Action: **Bypass cache**. Browser TTL: **Respect origin TTL**. Order: last, after the general HTML caching rule. No authentication, DNS, WAF or other hostname settings were changed.

Static hashed assets, fonts, audio and icons remain cacheable. HTML, service worker, manifest, private pages and APIs reach the origin. Private routes still require the signed application cookie.

The service worker also installs its offline document from `/index.html?evc-build=<build hash>` to avoid mixing an old CDN homepage with a new build's dependency manifest.

After deployment, verify the public homepage and `/sw.js` are DYNAMIC/BYPASS without a stale Age header, `/api/today` is 401 for guests, and all built dependency URLs exist. Test an offline reload over the public hostname, not just localhost.

Owner-only HTTPS verification on the deployment machine:

```sh
cd web
node scripts/verify-release.mjs https://english.duytruongphatco.com --owner
```

This reads the local ignored `.env` password, verifies login/read-only routes, and never prints credentials. The production data remains on the self-hosted machine, outside Git.
