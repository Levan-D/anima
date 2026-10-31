# Recommendation data: model and listener services

2026-11-01. Read from each service's docs, then checked by calling it, because the docs and the services disagree in places. Recheck before trusting any of this again: the ListenBrainz labs endpoints have no stability promise.

## Discogs-EffNet

- `discogs-effnet-bsdynamic-1.onnx`, 18,027,718 bytes, from https://essentia.upf.edu/models/feature-extractors/discogs-effnet/. SHA-256 pinned in `scripts/fetch-binaries.mjs`. Input `melspectrogram` of shape `[n, 128, 96]`, outputs `embeddings` (`[n, 1280]`) and `activations` (400 styles, unused).
- **License:** the file served as `models/LICENSE` is headed CC BY-NC-ND 4.0, while the models page says CC BY-NC-SA 4.0. Both are non-commercial. Fine for me. Passing on an installer that holds it deserves a real read first.
- `onnxruntime-node` 1.31.1, MIT. As installed it's 296 MB; the installer keeps only `bin/napi-v6/win32/x64/{onnxruntime.dll,onnxruntime_binding.node}` and the JS, about 32 MB. `npm install` blocks its postinstall script here, and on Windows that loses nothing: it only downloads GPU runtimes for Linux.
- It loads in a worker thread, under Electron 45, and from `app.asar.unpacked` in a packaged build (checked with `electron-builder --dir`). The DLL has to be unpacked beside the binding.
- Cost on this laptop: 0.9 to 1.2 s a track at 2 inference threads, about 350 MB resident while it runs. The spike's table for other thread counts is in `.dev/recs-spike/results.md`, which isn't in git: 1.0 s at 4 threads for 3.4 cores, 1.2 s at 2 for 1.5 cores, 1.4 s at 1.
- Cosines between tracks: 0.36 median over all pairs, 0.56 at the 90th percentile, 0.74 at the 99th. Nearest other-artist neighbour: median 0.75. That's what `audioFloor` and `audioCeiling` in `recommend/engine.ts` come from.

## MusicBrainz

- `GET https://musicbrainz.org/ws/2/artist/?query=<lucene>&fmt=json&limit=n`, and the same under `/recording/`. No account. Each result has `id`, `name`, `score`, sometimes `aliases`. Lucene specials take a backslash.
- **Limit:** about 1 request a second per IP, averaged. Over it, 503, and the docs don't mention `Retry-After`. A 503 also comes at random when the servers are busy, with `Retry-After: 0`, so it's retried with a pause of its own. Headers `x-ratelimit-*` describe the servers' shared budget, not this client.
- **User-Agent:** should name the app and give a way to reach it. `music-player v<version> (personal local player)` gets 200s, and carries no contact on purpose. If it's ever refused, that's why.
- The top search result isn't the artist: "Beck" gives Rufus Beck first. Match the name, then aliases ("Kanye West" is an alias of Ye), and no match is no answer. Homonyms aren't told apart: the first exact name wins.

## ListenBrainz

- Docs say at most one call a second, with `X-RateLimit-*` headers and 429 on the main API. The labs host sends no such headers.
- `GET https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<mbid>&algorithm=<name>`: no account. A flat array of `{ artist_mbid, name, comment, type, gender, score, reference_mbid }`, up to 100, best first. `score` is an integer with no fixed scale. **`name` can be null** on a row whose id has been merged.
- `POST https://labs.api.listenbrainz.org/similar-recordings/json` with `[{ "recording_mbids": [...], "algorithm": "..." }]`: no account. Flat array of `{ recording_mbid, recording_name, artist_credit_name, release_name, score, reference_mbid, ... }`. The GET form takes one id only, and most single recordings answer nothing, so send all of a song's recordings at once. Results are names, so nothing needs a second lookup.
- `algorithm` must be one of a fixed list, and a wrong one gets a 400 that names the valid ones. In use: `session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30`.
- **Refused without a token (401), despite what older docs imply:** `/1/metadata/lookup/` (name to ids) and `/1/popularity/top-recordings-for-artist/`. So there are no top tracks per artist without an account. What Discover shows as tracks are only the ones that came back as neighbours of my own tracks.
- `/1/lb-radio/artist/<mbid>` works without a token but gives recording ids and no names, and `/1/metadata/recording/` would take a second call for each.
- `labs.api.listenbrainz.org/mbid-mapping/json` is a 404 now.

## Coverage, measured 2026-10-31

An even stride through my artists and tracks, not picked by hand.

| Sample | Result |
| --- | --- |
| 40 artists, MusicBrainz id found | 35, before aliases were searched. One more was a 503 that outlasted the retries, and Kanye West was the alias case |
| Those with similar artists | All 35. Median answer 100 artists |
| Those with a similar artist I own | 34 of 40 |
| Tracks covered by those artists | 487 of 537 (91%) |
| 30 tracks, recording found by name | 25 |
| With similar tracks | 14 of 30 (47%), averaging 35 |

Artist data is plenty. Track data is about half, at two requests a track. The agreed fallback was to add Last.fm if coverage was poor, and it isn't, so Last.fm isn't in: `artist.getSimilar` and `track.getSimilar` take names and an API key with no user session, `limit`, `autocorrect=1`, `format=json`, and give `match` from 0 to 1. Its terms ask for non-commercial use, caching by HTTP headers, and at most 100 MB held. The tables have a `source` column for it.

## What a full run takes

- Fingerprints: 5,719 tracks at 0.9 to 1.2 s: 1.5 to 2 hours.
- Listener data: 412 artists at two requests each with each service paced at 1.1 s and two lookups at once, about 8 minutes. Then 5,719 tracks the same way, about 2 hours. 80 lookups took 112 s in a check.
- 40 artists and 40 tracks stored 3,006 artist rows and 433 track rows, so the whole library is roughly 40,000 and 80,000.
