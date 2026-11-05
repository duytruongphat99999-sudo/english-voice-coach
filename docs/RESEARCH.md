# Design and learning references

Reviewed 2026-11-05. Existing Astro + Preact implementation retained; no source code or skill packages copied from these projects.

- https://github.com/JesusOrihuela/idiomap — offline PWA, short activities and topic-based language learning.
- https://github.com/raskell-io/manabi — local progress and record-and-compare speaking practice.
- https://github.com/open-spaced-repetition/ts-fsrs — the private coach already uses FSRS-6. v6 of the package changes to FSRS-7 with breaking APIs; the private scheduler is intentionally kept on its existing version rather than silently migrating personal history.
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers — service worker lifecycle, cache boundaries and offline requests.
- https://docs.astro.build/en/guides/upgrade-to/v7/ — Astro upgrade and supported integration versions.

The public review scheduler is a small confidence-based interval scheduler (1, 2, 4… days, capped at 60; forgotten cards after 10 minutes), not an FSRS implementation. It uses explicit recall confidence rather than claiming an automatic pronunciation score measures memory.

Visual direction combines the user's education/course, Modern & Clean, Friendly and restrained Bento references. Stitch generated a mobile reference; unsupported claims from generated mockups (AI scoring, engineer certification) were omitted from the implementation.

Public audio was generated locally using speaches / Kokoro-82M-v1.0-ONNX, voice af_heart, speed 0.95. It is synthetic speech. Model reference: https://huggingface.co/hexgrad/Kokoro-82M . Each clip is served as a static MP3. Font: Be Vietnam Pro (SIL OFL; license bundled under web/public/fonts/OFL.txt).
