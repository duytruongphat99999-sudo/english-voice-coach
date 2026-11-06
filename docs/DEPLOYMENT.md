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

## Mobile startup fix — 2026-11-06

The origin returned HTML in about 3 ms, while public requests varied between 0.5 and 7 seconds. A fresh Chrome session sometimes stalled for over 20 seconds on styles or hydration modules. Disabling QUIC in a diagnostic browser improved the result, but did not establish a zone-wide transport fault. The public first screen previously fetched two blocking stylesheets and up to ten font subsets/weights, followed by the hydration dependency graph. The service worker also waited indefinitely for a stalled network navigation before using its cached shell.

The public page now embeds its styles, uses system fonts, and preloads its public JavaScript dependencies. The installed, versioned shell opens directly from cache. A newly installed worker activates after its document and all public dependencies have been cached. Private pages and APIs continue to bypass the worker; audio cache and range playback are unchanged.

A hostname-scoped response-header rule named **English Coach - avoid stalled HTTP3** was tested with both removal of `Alt-Svc` and `Alt-Svc: clear`. Public responses still advertised HTTP/3, so this diagnostic rule was disabled. Do not treat it as an enforced HTTP/2 policy. No zone-wide protocol setting was changed.

Verification on public HTTPS after deployment: three fresh Chrome processes entered a lesson in 776–876 ms; three WebKit sessions in 655–971 ms. Installed offline reloads were 135–338 ms across both engines. These are measurements on the deployment machine's network, not a guarantee for every phone or connection. Local checks passed 51 tests; one WebKit microphone test is intentionally skipped because recording needs real hardware.

Repeat the public startup and offline checks without special transport flags:

```sh
cd web
node scripts/verify-startup.mjs https://english.duytruongphatco.com
node scripts/verify-startup.mjs https://english.duytruongphatco.com --webkit
```

Cloudflare's protocol diagnostic reference: https://developers.cloudflare.com/speed/optimization/protocol/troubleshooting/protocol-troubleshooting/

## Chrome-specific blank page follow-up — 2026-11-06

The user reported that the root URL still stayed blank in Chrome while Edge opened quickly. Fresh automated Chrome profiles and the actual Edge profile did not reproduce the failure, including a diagnostic forced-HTTP/3 run. Those measurements were insufficient to confirm a fix for the affected Chrome session.

As a reversible isolation step, **HTTP/3 (with QUIC)** was switched **Off** under Cloudflare **Speed → Settings → Protocol Optimization** for the `duytruongphatco.com` zone. HTTP/2 stays enabled. This is a zone-wide protocol setting, not a hostname rule. HTTPS, authentication, DNS targets, and origin tunnel configuration were not changed. The earlier ineffective response-header rule remains disabled.

After the setting changed, public responses no longer contained `Alt-Svc: h3`. The user performed a Chrome hard reload and confirmed **“Đã hiện giao diện nhanh”**. Three fresh Chrome contexts then entered lessons in 745–778 ms over HTTP/2; the existing browser also reloaded successfully five times. Offline reloads remained 137–197 ms. Because the user's successful test included a hard reload, it supports a Chrome connection/cache-session issue but does not by itself prove QUIC was the sole cause.

Keep HTTP/3 off while this workaround is needed. Before re-enabling it, validate the affected user's regular Chrome session, not just a fresh headless profile. Cloudflare documents Chrome/QUIC stalls and zone-wide HTTP/3 disablement as a diagnostic step in the reference above.

Verify the actual transport as well as app readiness:

```sh
cd web
node scripts/verify-startup.mjs https://english.duytruongphatco.com --expect-http2
```
