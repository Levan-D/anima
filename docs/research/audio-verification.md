# Audio verification

2026-11-01. Everything the app promises about sound, what backs it, and what's left for a real device. Everything marked **measured** ran through the real `Player` and mpv 0.41 into `--ao=pcm` or `--ao=null`, with no device and no sound. Real files were read only.

To run it again:

```sh
npx vitest run src/main/playback/player.audit.bytes.test.ts src/main/playback/player.curve.bytes.test.ts src/main/playback/player.nyquist.bytes.test.ts src/main/playback/player.eq.bytes.test.ts src/main/playback/player.bytes.test.ts src/main/playback/player.jump.bytes.test.ts src/main/playback/player.reopen.bytes.test.ts src/main/playback/player.resume.test.ts src/main/headphones/headphones.bytes.test.ts --silent=false
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
| The predicted line's difference from measured is what the filters do | `predictedLine` | Impulse through the Player at 44.1 and 96 kHz, 5 bands, every 8th point from 40 Hz, on a made-up measurement. Control: the line drawn at the other rate | **Holds, under 0.001 dB.** The control misses by over 0.1 dB at 15 kHz, so the method can tell. This says nothing about an ear, only that the EQ half of the sum is exact |
| "Hold to hear EQ off" applies exactly the computed gain | `matchedOff` | Tone through the Player against the same file untouched: from the start of the file, and switched during it as a hold does. `--ao=pcm`, float | **Holds:** computed −6.25 dB, written −6.2500 dB from the start of a file, and −6.263 on the way from on to off and back during one, with on the same either side. Band filters at 0 dB change nothing else |
| The off side is level with the EQ on | Sum over the curve, 100 Hz to 10 kHz, power mean | Pink noise band-limited to that range, 20 s, RMS of each side | **Within 0.08 dB,** on this signal, which is the one the sum assumes. Music with another spectrum will land elsewhere, and this is not a loudness model. The screen says "Matched by curve, not by loudness measurement" |
| EQ off, or on and flat, is untouched | PLAN | Bytes, from the start of a file | **Holds** |
| Turning the EQ off gets back bit-perfect | Implied by the status | `player.reopen.bytes.test.ts`: `--ao=pcm` with no forced format, 16-bit FLACs and LAME MP3s, EQ off during the first of three, against ffmpeg's own s16 decode and mpv's. Control: the EQ left on | **Holds from the next file boundary.** To there it's doubles, and the status says "Converted to 64-bit float". After it, every following track is byte-identical to its decode at the source format (1,764,000 frames) and the status only then says bit-perfect. Only that boundary reopens: the writer starts over there and not at the next. It's done by not holding the next file, so mpv goes idle and plays out first (`gapless-audio=no` was tried and measured reopening mid-song). Skipped with shared, volume, mute, ReplayGain, a format the EQ didn't cause, or the next track in the same CUE file. Next or a jump keeps the output, and the end of that track is the boundary. **Cost:** no samples lost or added (882,000 of 882,000 frames in the first track), and at most about 80 ms on `--ao=null` over 7 runs, which only says what the software adds. On a device it isn't gapless, and how long isn't measured |
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

### A jump chosen by hand

Levan heard loud static on Next in Radio, in exclusive, on real hardware, and not on Next in the Library. **It wasn't reproduced, and can't be here.** Everything mpv hands over is clean, so what follows narrows it down rather than proves a cause, and the fix is a best inference until it's heard.

| Claim | Source | How measured | Result |
|---|---|---|---|
| mpv writes garbage at a jump | Levan's report | Before the fix, paced through a named pipe: noise files that can't line up with themselves, and real pairs, each file against its decode alone. Next and a pick, Library and Radio, same rate, 44.1 to 48 and 96 kHz, s16 into 24-bit and MP3 with no forced format, EQ on and off, the EQ toggled in the same tick as Next | **No.** Generated files with the EQ off: the old file exact to the cut, the new one exact from its frame 0, with 0 frames between, so no noise, no repeat and no format mix-up. Real 16/44.1 into 24/96: exact on both sides of the reopen. A real same-rate pair was inconclusive, since that track opens silent and couldn't be lined up. With the EQ on, only the commands and the reopens were compared then, and the level and the new track's end after the fix, in `player.jump.bytes.test.ts`. So on these the static isn't in what mpv hands over |
| Radio's Next does something different | The report | The commands sent on each, in order | **No.** Both send `playlist-next`, `playlist-remove 0`, `loadfile append`. No second load and no reopen of its own. A pick past the next one is one `loadfile replace` |
| What does differ is what's next | `files` in a copy of the library database | Adjacent tracks in an album against random pairs | **Rate differs: 0.8% in an album (41 of 5,036), 12.4% at random. Bit depth: 0.9% against 38.5%.** So a Next in Radio far more often closes and reopens the output, or carries a format over, which fits the amber dot. Random pairs stand in for what radio picks: its real picks weren't measured |
| Only a jump resets the output | `player/loadfile.c`, `audio/out/buffer.c` and `ao_wasapi.c` at v0.41.0 | Read | **Holds.** Leaving a file early calls `ao_reset`, which is `IAudioClient::Stop` and `Reset`, then `Start` on one fresh buffer. A natural end doesn't, which fits natural changes sounding fine. A change of rate also tears the client down and makes a new one |
| A known cause | [mpv #1529](https://github.com/mpv-player/mpv/issues/1529) (2015), the `--wasapi-exclusive-buffer` manual text, [mpv #13996](https://github.com/mpv-player/mpv/issues/13996), [MPD #2545](https://github.com/MusicPlayerDaemon/MPD/pull/2545) | Read. **Related, not the same report** | #1529: stale audio after a seek, exclusive only, "Stop returns before it has actually stopped the stream", not confirmed cured. The manual: "reportedly on some devices there are glitches following stream resets". MPD: a separate player, whose pop fixes had no effect in exclusive. None says static on a track change |
| The other builder's reopen after the EQ goes off | Its diff | EQ off, then Next, and the two in the same tick | **Nothing points to it.** Same commands and no extra reopen in that run, where the output stayed in doubles, and it only acts when the EQ had set the format. Its bytes weren't compared. Now committed, with its own tests |
| `volume` lands block by block, and 100 is untouched | `process_plane` in `ao.c`: applied as the output takes data, and skipped at gain 1 | Blocks paced with `arealtime` | **Holds.** Blocks came out at 0.67, 0.33, 0, and the new track is exact afterwards. A filter would lag by the whole buffer, and `pause` stops dead with audio still in the device, so neither was used |
| The fall is silent before the reset | This fix | `player.jump.bytes.test.ts`, Library and Radio, and the control without it | **Holds.** Nothing over the level, the last gain is 0 ahead of the new track, then silence, then the new track exact. Without the fade it goes from the old file straight to the new one's frame 0 |
| No click at the jump | This fix | The same | **Reduced, not gone.** `volume` moves in steps, measured as a third of the level each where a stop is all of it, so about 9.5 dB less. This writer wakes when it likes and sometimes takes one block across the whole fall, so that's seen most runs and not all |
| Natural changes are untouched | PLAN | Byte comparison with the fade on, and the existing gapless tests | **Holds,** byte for byte, and the volume is sent once, at startup |
| A run of presses | PLAN | Two Nexts at once, real mpv | **Holds:** one move, to where they ended up, and the volume lands exactly on the slider |
| Latency | Asked for: under about 150 ms | `--ao=null`, median of 5, press to the rise starting | **12 ms without, 128 ms with: about 116 ms added.** Timers here tick about every 15 ms, so 40 + 20 + 20 takes that long. About 30 ms of the new track's start stays silent, by design |
| A seek | `ao_reset` as above | The same fade, with fake and real mpv | **Holds.** Only while playing. A seek while paused has nothing to fade |

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
| EQ just turned off, output still in doubles | Output | "Converted to 64-bit float", until the next file boundary reopens it | Measured |
| The moment of that reopen | None | "Waiting for the signal" | Measured: every bit-perfect state had s16 going out |

**Not in what the status can see:** Windows' volume or enhancements, a driver, a DAC's own processing. "Bit-perfect" means nothing in this app changed it, and that mpv handed it over in the file's format.

## Decisions for Levan

1. **Turning the EQ off in exclusive restores bit-perfect at the next file boundary, not mid-song.** Decided by Levan: that one boundary may not be gapless, and it's only done when the EQ caused the format and nothing else is altering the signal. It stays gapless within a CUE file and leaves it for the next real boundary.
2. **Pause and Stop keep the device** in exclusive, on purpose, since Levan wants that. Measured in `player.reopen.bytes.test.ts`: `current-ao` stays through both, and the writer's file only grows, so the output never reopened. Other apps stay silent until quit or a shared switch.
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
- [ ] **EQ on and off in exclusive:** does the sound break, and does the status go as described. Then how long the gap is at the next track, where the output reopens, and whether the dot turns bit-perfect there.
- [ ] **Exclusive fallback:** Bluetooth, or another app holding the device, gives the toast and shared mode, and it carries on from the same place.
- [ ] **Different-rate tracks in exclusive:** how long the gap is when the output reopens. Mixed-rate albums are where to hear it.
- [ ] **The static on Next in Radio, which is what decides whether this is fixed.** In exclusive: Next, Previous, a pick and a seek, between tracks of the same rate and of different rates. Then the same with exclusive off. If it's still there after the fade, the driver is making it with no audio in its buffers, and the levers left are `--wasapi-exclusive-buffer`, as the manual suggests, or closing the output for a moment. Whether it only happens across rates says which. Also listen for the click at the jump, and for a track's first 30 ms being missed.
- [ ] **Music into Noise, by ear,** through your DAC, and an MP3 album with a LAME header.
- [ ] **How overs actually sound:** a hard clip in exclusive, and whatever Windows' mixer does in shared. A −12 dB bass cut on a loud master is the case to try.
- [ ] **The 2 dB drop** when the first band leaves flat.
- [ ] **Hold to hear EQ off:** does it switch without a click, and do the two sides sound level on your music. How a real pair compares with the predicted line is only something ears can say.
- [ ] **Whether the 2 dB of Auto on a small curve is too much,** which is a question of taste.
