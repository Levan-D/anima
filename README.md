# Music Player

A personal foobar2000-style music player for Windows. It plays local FLAC and MP3 files, with big album art and a giant media list. No streaming, no tag editing, no file conversion.

## Setup

Needs Node 24 or newer.

```sh
npm install
npm run fetch:binaries  # mpv into resources/mpv and the sound model into resources/models, once after cloning
```

## Commands

```sh
npm run dev        # run the app, with its data in .dev/
npm run build      # type-check and production build
npm run typecheck
npm run lint
npm run test       # vitest
npm run test:e2e   # Playwright against the built app
npm run dist       # installer, in release/
```

Before running the app or the tests from Git Bash, run `. scripts/dev-env.sh`. It keeps caches and app data inside `.dev/`, and keeps the tests silent.

The installer isn't code signed, so Windows SmartScreen warns the first time it runs.

## Where data lives

| Data                                               | Location                                            |
| -------------------------------------------------- | --------------------------------------------------- |
| Library index, playlists, lyrics, stats, waveforms | `.player/library.db` in the music folder you choose |
| Settings, album art cache, logs                    | `%APPDATA%\Music Player`                            |

The audio files themselves are never changed.

`.player/` is the one thing the installed app writes to the music folder. Uninstalling leaves it and `%APPDATA%\Music Player` in place.

## Licenses

The app bundles [mpv](https://github.com/mpv-player/mpv) (v0.41.0, GPL) and [FFmpeg](https://github.com/FFmpeg/FFmpeg) (6.1.1 from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), GPL v3). The repo holds neither: `npm run fetch:binaries` and `npm install` download them. The installer does contain them, so it falls under the GPL for those programs. Anyone who passes the installer on has to include their license text and offer their source. The GPL v3 text ships in the app's `resources/ffmpeg/` folder.

## Recommendations

Radio, More like this and Discover run on two things you ask for in Settings, under Data. Nothing is fetched or analyzed by itself.

- **Fingerprints** come from [Discogs-EffNet](https://essentia.upf.edu/models.html), a model from the Music Technology Group at Universitat Pompeu Fabra, run locally. **Its license is non-commercial** (CC BY-NC-ND 4.0 in the license file, CC BY-NC-SA 4.0 on its page), with commercial terms available from them. So it isn't in this repo: `npm run fetch:binaries` downloads it with its license beside it. The installer does hold it, so that license applies to anyone passing the installer on. Without the model the rest of the app works and says so. Radio's energy score uses three classification heads from the same place under the same license (`mood_relaxed`, `mood_aggressive`, `mtg_jamendo_moodtheme`), fetched the same way.
- **Listener data** comes from [MusicBrainz](https://musicbrainz.org) and [ListenBrainz](https://listenbrainz.org). Only artist and track names go out, and the ids those names turn out to have.

## Lyrics

Lyrics come from [LRCLIB](https://lrclib.net), fetched online or imported through Settings from a local `lyrics.db`. They're copyrighted, so they aren't in this repo or the installer.
