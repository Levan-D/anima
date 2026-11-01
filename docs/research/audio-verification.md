# Audio verification

2026-11-01. Everything the app promises about sound, what backs it, and what's left for a real device. Everything marked **measured** ran through the real `Player` and mpv 0.41 into `--ao=pcm` or `--ao=null`, with no device and no sound. Real files were read only.

To run it again:

```sh
npx vitest run src/main/playback/player.audit.bytes.test.ts src/main/playback/player.curve.bytes.test.ts src/main/playback/player.nyquist.bytes.test.ts src/main/playback/player.eq.bytes.test.ts src/main/playback/player.bytes.test.ts src/main/playback/player.resume.test.ts --silent=false
MUSIC_PLAYER_REAL_LIBRARY='D:\Music' npx vitest run src/main/playback/player.audit.realFiles.test.ts src/main/playback/player.realFiles.test.ts --silent=false
```

The real-file tests need the database copy that `playerRealLibrary.spec.ts` makes. The clipping survey was a throwaway under `.dev/audio-audit/`, and its numbers are in [headphone-eq.md](headphone-eq.md).

Sources: mpv's [`player/audio.c`](https://github.com/mpv-player/mpv/blob/v0.41.0/player/audio.c) and [`demux/demux.c`](https://github.com/mpv-player/mpv/blob/v0.41.0/demux/demux.c) at v0.41.0, read through a summarizing fetch, with the logic then measured. FFmpeg's [`af_biquads.c`](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/af_biquads.c). The [FLAC format](https://www.rfc-editor.org/rfc/rfc9639.html) for its MD5, from memory of the layout, and confirmed by the hashes matching.

## What failed, and what was done

| Found | Size | Done |
|---|---|---|
| A cut with no preamp went over full scale on about half the library | Up to +2.7 dBFS, and +4.09 on a −12 dB bass shelf | **Fixed:** Auto is at least 2 dB down |
| Auto's "never gets there" | 3 of 32 over at first, 18 of 420 on the same preset | **Fixed:** margin, and honest wording |
| Curve drawn at 44.1 kHz whatever the file | 1.5 dB at 96 kHz | **Fixed** |
| A band above Nyquist drawn as if active | Its whole gain | **Fixed** |
| ffmpeg's float biquads missing the curve at 192 kHz | Up to 0.15 dB on a low shelf | **Fixed:** `r=f64`, now under 0.01 dB |
| Restore grabbed the device in exclusive | Other apps muted at startup | **Fixed:** nothing opens until Play |
| Dot said "Altered by Windows" with the EQ on, in exclusive | Wrong cause | **Fixed:** a format change while the EQ is on counts as the EQ's. Renamed "Altered on the way out", since in exclusive it's mpv converting, not Windows |
| "Mixed to 1 channels" | Wording | **Fixed:** "Mixed to mono" |
| APO's `LS`/`HS` read wrongly | 0.16 dB with no Q. With a Q, the frequency was off by up to about 19% at 6 dB | **Fixed**, from its source |
| Chart notes against their numbers | Up to over an octave | **Fixed:** [instrument-ranges.md](instrument-ranges.md) |

## The table

Every row's date is 2026-11-01.

### Gapless

| Claim | Source | How measured | Result |
|---|---|---|---|
| FLAC to FLAC is byte-identical to each decoded alone | Spike, `--gapless-audio` in the manual | Generated, and 3 real pairs each at 16/44.1, 24/44.1, 24/96, 24/192. s32 | **Holds.** Control with `gapless-audio=no` fails, so the method can tell |
| Music.flac to Noise.flac, Nightwish/Human II Nature/Human | Spike | Real files, s32 | **Holds** |
| The same with EQ on: each file filtered as if alone | PLAN | Real files, float, against each alone through the same chain | **Holds,** 34,562,048 frames. The filters restart at the boundary, by mpv's design, so a filter's ringing doesn't carry across |
| Holds after a queue change | PLAN | Paused, a track put next, resumed | **Holds:** 1, 3, 2 as asked, byte for byte |
| Holds at an Endless boundary | PLAN | `suggest` adds the next track, output compared | **Holds** |
| Holds when radio takes over | PLAN | `player.radio.bytes.test.ts`: the current track carries on into a pick, output compared | **Holds** |
| MP3 to MP3 with a LAME header | ffmpeg and mpv honoring delay and padding | Generated, one signal cut in two and encoded apart, and 3 real pairs | **Holds:** byte-identical to each alone, exactly the source's length. Error from the source is 0.00546 around the join against 0.00533 mid-file, so the join is no worse than the codec |
| MP3 with no such header | Measured here, not a promise | Same, written with `-write_xing 0` | **Can't be gapless.** 1,800 frames too long per file, about 41 ms, with 1,774 near-silent frames at the join. **198 of this library's 795 MP3s have no Xing or Info header,** 5 have one with no encoder tag. Nothing can tell a player what's padding in those |
| Files of different rates | The manual, `gapless-audio=weak` | 44.1 into 48 kHz | **Not gapless, by design.** The output reopens, which the writer shows by starting its file again. How long that is on a device isn't measured |

### Bit-perfect

| Claim | Source | How measured | Result |
|---|---|---|---|
| Volume 100, EQ off, ReplayGain off is what the file holds | Signal status | Against ffmpeg's own decode, and against **the MD5 the encoder stored in the FLAC**, which no decoder here touched | **Holds** in the file written, at 16-bit (`--audio-format=s16`, 10 real files) and 24-bit (s32, low byte zero, 2 real files at 96 kHz), all matching. Of the 15 tried, 3 have no MD5, which the format allows, and those are skipped |
| Volume 99 isn't | Signal status | Bytes differ | **Holds** |
| What reaches a device | Nothing measured | Needs a device | **Unverified** |

### ReplayGain

mpv reads `REPLAYGAIN_TRACK_GAIN` first: without one, nothing applies, whatever the album tag says. A missing peak counts as 1. An unreadable peak loses the gain with it. Album falls back to track only when the album gain is missing. Then gain is `min(gain, 1/peak)`, since `--replaygain-clip` is off.

| Claim | Source | How measured | Result |
|---|---|---|---|
| Track and Album apply the tag | Manual, `audio.c` | Generated FLAC, 11 tag shapes, 3 modes, against the tag | **Holds, within 0.02 dB,** and the status agrees in every case |
| Clipping protection | `compute_replaygain` | +12 dB with peak 0.5 gives +6.02 | **Holds** |
| A boost with no peak tag | `decode_peak` defaults to 1 | +6 dB tag | **Applies nothing,** 0.000 dB. This surprises: the tag says +6, and mpv is protecting a peak it assumes is at full scale |
| An album gain with no album peak | As above | +4 album | **Applies nothing** on a boost. A cut would apply |
| An album gain alone | `decode_rgain` | −5 album | **Ignored.** Measured 0.000 |
| An unreadable peak or gain | `decode_rgain` | "loud" | **Ignored,** including a good track gain next to a bad peak |
| Lower-case tag names, MP3 tags | Measured | −4 dB; MP3 −6 and −9 | **Hold** |
| Real tracks | Tags as foobar wrote them | 60 real tracks, 10 s each, both modes, against the tag and its peak | **Holds:** worst 0.0000007 dB across 120 checks. 4 were cut short by their peak. All 60 are tagged |

### Volume

The slider shows no number, just its position, so "50" means the middle of it.

| Claim | Source | How measured | Result |
|---|---|---|---|
| The law is cubic | `audio.c`, `pow(gain, 3)` | Tone through the Player, float | **Holds:** 100 is 0 dB, 90 is −2.745, 75 is −7.496, **50 is −18.062**, 25 is −36.124, 10 is −60, 1 is −120. So the slider's middle is about a tenth of the level |
| Mute is silence | Status says Muted | Peak of what's written | **Holds:** exactly 0 |
| Volume comes after the output format | Measured | +6 dB preamp, volume 50, out as s16 | **Holds, and matters:** tops out at −18.06 dBFS, so it clipped first. Turning down doesn't save an over on an integer output |

### Preamp and EQ

| Claim | Source | How measured | Result |
|---|---|---|---|
| Auto is the curve's top plus 1 dB, at least 2 dB down | Chosen from 420 tracks | Survey, [Clipping](headphone-eq.md) | 12 of 5,040 track-curve pairs over, worst +0.69 dBFS, 1 to 9 samples a track |
| **Auto isn't a guarantee** | The same | The −12 dB bass shelf | **134 of 420 over,** up to +2.09 dBFS, runs up to 112 samples. Stated on screen as "Room for most music, not a guarantee". Sample peaks only |
| Auto and a preamp by hand apply what they show | Curve | Full-scale tone at the band, +6 dB peak | **Holds,** within 0.05 dB: Auto reaches −1.00 dBFS, −7 reaches −1.00, −6 reaches 0, −3 reaches +3.00, +3 reaches +9.00 |
| "May clip by about +X dB" | `clipDb`: how much less room than Auto | The same tone, and the survey | **Accurate as an estimate, and not exact.** It says +4 where the tone reaches +3, because it counts the margin for music too. It can also understate: +2 on a −6 dB cut where the survey's worst was +2.69. With no filter it's exact: +2 reaches +2.00. So it now says "about", and a preamp set exactly to the curve's top now warns of +1 |
| Stays over full scale inside, in float | `chainSpec` | +6 dB preamp out as float reaches +6 | **Holds.** Nothing clips inside the chain |
| Nothing in the chain runs in integers | Research | Boost then equal cut on a full-scale 16-bit tone, out as s16 | **Holds,** within 0.01 dB. Control: plain biquads with no `volume` clip by over 1 dB |
| Each band type matches the curve on screen | `eqCurve.ts` | Impulse through the Player at 44.1, 48, 96, 192 kHz: peak at 1 and 15 kHz, Q 0.5, 1.41, 4, ±; shelves at Q 0.4, 0.707, 1.4; a 10-band preset, Auto and by hand. 60 points from 40 Hz | **Holds, under 0.01 dB at every rate** |
| A band above Nyquist does nothing | `af_biquads.c` | Tones at 32, 22.05, 11.025 kHz, each kind | **Holds,** within 0.02 dB, with no samples lost. Curve agrees |
| A band exactly on Nyquist | Measured | 16 kHz on 32 kHz | Runs: a low shelf is its gain everywhere, the others nothing. Curve agrees |
| EQ off, or on and flat, is untouched | PLAN | Bytes, from the start of a file | **Holds** |
| Turning the EQ off gets back bit-perfect | Implied by the status | `--ao=null` with no forced format, during a file | **Only once the output reopens.** The output stays in the doubles it opened in, as `gapless-audio=weak` keeps it. The status says so: "Converted to 64-bit float", in the third color. The samples aren't damaged, but it isn't what the file holds until then. See the decisions |
| Turning the EQ on during a file | Measured | The same | Output stays in the file's format, s16 here, so overs clip right there rather than reaching the device in float. The status doesn't mention it, and it isn't an alteration of its own |

### Stop, seek and restore

| Claim | Source | How measured | Result |
|---|---|---|---|
| A seek leaves no filter state | Research, mpv rebuilds | EQ on, after 5 s of audio, seek, compared with the file started there through a fresh chain | **Holds,** byte-identical, at 60 and 137.5 s |
| Stop leaves no filter state | PLAN | The same, from the top | **Holds** |
| A seek lands where it says, FLAC | Player | A file whose samples count, so each one says where it is | **Holds:** 0 or −1 frame, that's 23 µs. The position shown is what was asked for |
| The same, MP3 | Player | Against the file decoded whole | **Holds:** 0 frames off at 7.25 and 33.333 s, past the first second, which is where it was compared |
| Restore plays from the saved place | Player | Saved at 10 s, compared with the file started there | **Holds,** byte-identical, and exactly the right length |
| Restore opens nothing before Play | This fix | `current-ao` on `--ao=null`, with a control that a paused load does open it | **Holds.** Whether a real device stays free is below |

### The signal status

Driven through real mpv on `--ao=null`, with the output forced where needed. `exclusive` here is only a setting, since `null` ignores it, so **these prove what the status says given what mpv reports, and not what a device does.**

| State | Dot | Says | Verified |
|---|---|---|---|
| Nothing open yet, or a restored track before Play | None | "Waiting for the signal" | Measured |
| Exclusive, s16 in and out, nothing else | Bit-perfect | Nothing | Measured. **True on a device only if WASAPI really takes s16 at that rate** |
| MP3, floatp in, float out | Bit-perfect | Nothing | Measured, on `null`. A device won't usually take float in exclusive, so see the next rows |
| MP3, or anything, going out in another format | Output | "Converted to 16-bit" | Measured |
| Shared | Output | "Windows is mixing" | Measured, and always said in shared mode. The mixing itself is real-device |
| Resampled | Output | "Resampled to 48 kHz" | Measured with `--audio-samplerate`. Who does it on a device isn't measured |
| Downmixed | Output | "Mixed to mono" | Measured with `--audio-channels` |
| EQ on | On purpose | "EQ is on", and any format change | Measured |
| EQ on, with less room than Auto | On purpose | Also "EQ may clip by about +7 dB" | Measured |
| EQ on but flat | Bit-perfect | Nothing | Measured |
| ReplayGain | On purpose, only when the gain isn't 0 | "ReplayGain is changing the level" | Measured, against every tag shape |
| Volume under 100 | On purpose | "Volume is below 100" | Measured |
| Muted | On purpose | "Muted" | Measured |
| Both | Output wins | Both listed | Measured |
| EQ just turned off, output still in doubles | Output | "Converted to 64-bit float" | Measured |

**Not in what the status can see:** Windows' volume or enhancements, a driver, a DAC's own processing. "Bit-perfect" means nothing in this app changed it, and that mpv handed it over in the file's format.

## Decisions for Levan

1. **Turning the EQ off in exclusive doesn't restore bit-perfect until the output reopens.** It could reopen on purpose (`ao-reload`), at the cost of a small gap each time. It's told truthfully now. Left as it is.
2. **Pause and Stop keep the device** in exclusive, since mpv keeps its output open, so other apps stay silent until quit or a shared switch. The fix only covers restore, as asked. It could close on Stop. Left as it is.
3. **A deep bass cut can still clip under Auto.** Auto could come down further with the depth of a cut, or a limiter could go in. Neither done: it's stated instead.
4. **The first move off flat drops the level by 2 dB**, since Auto is at least that. It's a real jump when comparing. Worth listening to.
5. **Most MP3s here pass full scale on their own:** 62 of 112 in the sample, up to +2.05 dBFS, with no EQ. In float that's harmless until the mixer, and on an integer output it clips. Bringing volume down doesn't help there. Only ReplayGain or a preamp would, and only ReplayGain's tags know the peak.
6. **MP3s with no header can't be gapless.** 198 of 795. Re-encoding or tagging belongs to foobar, not here.

The curve's rate before Play uses the library's rate for a restored track rather than 44.1 kHz, since it's known and right. 44.1 kHz is for when nothing is known.

## What only a device or ears can check

Not run, by rule: no sound and no real output.

- [ ] **Exclusive at startup:** with exclusive on and a saved place, launch while Discord or foobar is playing. They should keep playing until you press Play.
- [ ] **Exclusive on Play:** the other apps go silent, and your DAC's display shows the file's real rate. Try 44.1 and 96 kHz.
- [ ] **What format WASAPI really takes,** for 16-bit, 24-bit and MP3. The Signal popover says. If a 16-bit file says "Converted", your device doesn't offer 16-bit, and it's bit-transparent but not called bit-perfect.
- [ ] **EQ on and off in exclusive:** does the sound break, and does the status go as described.
- [ ] **Exclusive fallback:** Bluetooth, or another app holding the device, gives the toast and shared mode, and it carries on from the same place.
- [ ] **Different-rate tracks in exclusive:** how long the gap is when the output reopens. Mixed-rate albums are where to hear it.
- [ ] **Music into Noise, by ear,** through your DAC, and an MP3 album with a LAME header.
- [ ] **How overs actually sound:** a hard clip in exclusive, and whatever Windows' mixer does in shared. A −12 dB bass cut on a loud master is the case to try.
- [ ] **The 2 dB drop** when the first band leaves flat.
- [ ] **Whether the 2 dB of Auto on a small curve is too much,** which is a question of taste.
