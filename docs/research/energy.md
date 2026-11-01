# Energy score for radio

2026-11-01. Radio should keep the vibe and genre but sometimes drop energy a little. That needs one number per track. Everything below was read from the source named or measured on the real library. Scripts, raw output and readable lists are in `.dev/energy/`, which isn't in git. The lists to check by ear are in `.dev/energy/results.md`.

**How far to trust this.** No score here was checked by listening. The orderings were judged by Claude from knowledge of the songs. How it sounds is Levan's to verify.

## Recommendation

Use a **blend of three Discogs-EffNet heads run on the vectors already stored**: `mood_relaxed` (inverted), `mood_aggressive`, and the Jamendo mood tags as energetic minus calm. Take each one's percentile across the library and average the three. That gives 0 to 1, with library quartiles at 0.26, 0.49 and 0.74.

- It needs no re-analysis and no decoding. 22 head passes over all 5,719 vectors took 0.78 s, so this one is three of those.
- It adds 3.8 MB to the installer.
- It was the best or level with the best on every test below.

**Reliable for "calmer". Not reliable for "slower".** The score has almost no idea of tempo: its rank correlation with measured tempo is 0.06. It follows softness, heaviness and brightness (0.78 with spectral centroid). A slower song with the same weight of arrangement won't read as lower, and a fast light one reads as calm: Chopin's Minute Waltz scores 0.13, under the D-flat Nocturne's 0.26. If literally slower songs matter, this doesn't deliver them, and nothing tested here does either.

It's good enough to try behind the rules in "How the engine would use it". It isn't good enough for small steps: treat a gap under 0.08 as no difference.

## What was tested

- 321 tracks read from `D:\Music`, read-only: 205 named in the first set of pairs, 66 as a seeded spread over 23 genres, 50 more for the second set. No failures. The database was a copy.
- **Pairs** of songs by one artist, calmer first, judged from knowledge.
  - The first 107 were written before any score existed: 8 are the same song acoustic and full band, 62 have an obvious gap, 37 a smaller one.
  - The second 30 were written after the first results and before they were scored. All are smaller steps, and they choose nothing. They exist to catch overfitting.
  - The percentage is how many pairs a score ordered correctly. The bracket is a 95% interval from resampling whole artists.

The weakness is in the test itself: these are famous songs, and "calm" as judged from memory leans towards "soft". That favours what the heads measure. MusAV (below) is the independent check.

## Results

Each row is one number per track, higher meaning more energetic. Heads use stored vectors unless marked.

| Score | First 107 | Its 37 smaller steps | Second 30 | Cost for the library |
| --- | --- | --- | --- | --- |
| **Blend of 3 heads** | **97% (94-100)** | **95% (86-100)** | **90% (75-100)** | under a second |
| emoMusic arousal (MusiCNN) | 93% (87-97) | 86% (74-95) | 93% (84-100) | 9.7 h, new model |
| Jamendo energy minus calm | 95% (90-99) | 92% (79-100) | 90% (78-100) | under a second |
| not sad | 96% (91-100) | 92% (78-100) | 90% (76-100) | under a second |
| not relaxed | 93% (87-98) | 86% (72-97) | 87% (71-100) | under a second |
| aggressive | 93% (87-99) | 89% (75-100) | 83% (66-97) | under a second |
| party | 88% (81-95) | 84% (69-97) | 80% (59-97) | under a second |
| onset rate | 80% (72-88) | 78% (64-92) | 80% (61-94) | 2.9 h |
| spectral centroid | 86% (78-93) | 84% (68-95) | 77% (63-90) | 2.9 h |
| loudness range, inverted | 79% (71-87) | 78% (64-91) | 72% (55-88) | 1.5 h |
| engagement | 87% (80-93) | 84% (71-94) | 70% (50-86) | under a second |
| not acoustic | 88% (79-96) | 78% (63-92) | 70% (48-89) | under a second |
| integrated loudness | 79% (68-89) | 69% (51-85) | 70% (52-87) | 1.5 h |
| danceable | 79% (71-87) | 68% (50-83) | 67% (50-84) | under a second |
| spectral flux | 82% (72-92) | 81% (67-93) | 63% (43-81) | 2.9 h |
| DEAM arousal (MusiCNN) | 73% (60-85) | 73% (56-88) | 60% (40-79) | 9.7 h, new model |
| tempo, autocorrelation | 61% (53-68) | 49% (33-63) | 60% (44-76) | 2.9 h |

Also run: MuSe arousal 64%, electronic 65%. `approachability` scored 23% on stored vectors, so it runs the other way, and it isn't energy either way. An audio blend (onset, centroid, flux) got 88% and only 38% on the same song in two arrangements. A blend of all heads and audio got 94%, no better than the heads alone.

The intervals overlap heavily, so these pairs can't separate the blend from emoMusic arousal or Jamendo alone. What decides it is cost. The three-way blend was fixed before the first result was read, so it wasn't fitted. "Not sad" scores as well, but it describes something else and shouldn't be picked for a lucky number.

**The misses, judged from knowledge:**

- Digital Love 0.82 over One More Time 0.50, and Another One Bites The Dust 0.82 over I Want It All 0.62, are plain errors.
- Going by the second set, fast light solo piano reads as calm: Chopin's waltzes come out under his nocturnes.
- They All Laughed 0.15 is under The Nearness of You 0.17, too close to count either way.
- Rest In Peace (Unplugged) 0.83 is over the band version 0.81, again a gap too small to mean anything.

## Do the scores order things within a genre?

Mostly yes, judged from knowledge, and that's the point of the test. Across the library, genre explains only about half the variance of each of the three heads (0.52 to 0.55) and artist about two thirds (0.67 to 0.70), so a good deal is left inside them. A typical artist with 10 or more tracks spans 0.35 between 10th and 90th percentile, and the narrowest tenth span 0.13.

| Within | Lowest | Highest |
| --- | --- | --- |
| Rock (Classic) | Solitude, Going To California, Yesterday, Us And Them | Thunderstruck, Paradise City, Stand Up And Shout |
| Symphonic metal | In Perfect Harmony, Quiet as the Snow, Forgiven | Dead Gardens, The Kinslayer, Wish I Had An Angel |
| The Beatles | Yesterday 0.07, Let It Be 0.15, And I Love Her 0.19 | Revolution 0.86, I Saw Her Standing There 0.79 |
| Queen | Barcelona 0.25, We Are The Champions 0.29, The Miracle 0.36 | Tear It Up 0.97, Party 0.96, Hammer To Fall 0.87 |
| Rage Against the Machine | Beautiful World 0.27 | Down on the Street 0.99, Bulls on Parade 0.99 |

**Where it runs out of room:**

- **The ends are crowded.** AC/DC runs from The Jack 0.74 to Fire Your Guns 0.97. A 0.1 step at the top may not be heard at all.
- **Classical and lo-fi sit in a narrow band.** Classical tops out at 0.56 with The Ride Of The Valkyries at 0.51, and solo piano stays low whatever it's doing. Chilled Cow and nymano stay between 0.10 and 0.54.
- **Absolute values across genres mean little.** Rolling In The Deep is 0.41. That's right against the rest of Adele and low against rock.

## Are stored vectors valid input?

The heads are specified on per-patch embeddings, and Essentia's tutorial averages the activations over time. What's stored is the mean over patches, scaled to unit length. Measured on 271 tracks, head on stored vector against mean of per-patch predictions, with ranges from the 2nd to the 98th percentile:

| Head | Range per patch | Range stored | Rank correlation | Correlation within an artist |
| --- | --- | --- | --- | --- |
| not relaxed | 0.01..0.99 | 0.13..0.76 | 0.978 | 0.978 |
| aggressive | 0.00..0.99 | 0.04..0.78 | 0.915 | 0.961 |
| danceable | 0.01..1.00 | 0.13..0.90 | 0.975 | 0.957 |
| party | 0.00..0.98 | 0.06..0.78 | 0.972 | 0.963 |
| not acoustic | 0.01..1.00 | 0.11..0.87 | 0.965 | 0.973 |
| engagement | 0.37..1.00 | 0.48..0.68 | 0.893 | 0.872 |
| Jamendo energy | -0.07..0.09 | -0.15..0.13 | 0.987 | 0.976 |

- **Valid for ordering, not as probabilities.** Never threshold a stored-vector output at 0.5. That's why the blend uses percentiles.
- **Averaging costs almost nothing.** The head on the unscaled mean vector matches per patch at 0.98 to 0.997.
- **Unit length is what squeezes the range.** The mean vector's length runs 2.30 to 5.31 (5th to 95th percentile, median 3.19). Multiplying by a constant 3.19 restores the range but not the order, and doesn't improve the pairs, so it isn't needed.
- **Accuracy doesn't suffer.** The blend got 97% on stored vectors and 96% per patch.
- The stored vectors are the ones this pipeline makes: cosine 1.000000 against a recomputation, at worst.
- The heads' metadata names `discogs-effnet-bs64-1` as their embedding model, and we run `bsdynamic-1`. The models page describes the ONNX as the dynamic-batch form of the same model, but the two weren't compared directly.

**Same song, different file** (same artist and title, length within 2%, different audio): over 30 pairs the median gap is 0.033, and the largest are Nightwish's orchestral versions, 0.82 against 0.40, which are really different. Without other arrangements only 7 pairs are left: median 0.004, largest 0.047. That's a small set, and it's where the 0.08 floor comes from.

## The heads, from their metadata JSON

| Model | Input | Trained on | Reported |
| --- | --- | --- | --- |
| `mood_relaxed-discogs-effnet-1` | 1280 | 446 tracks and excerpts, in-house | 0.91 normalized accuracy, 5-fold |
| `mood_aggressive-discogs-effnet-1` | 1280 | 280 tracks and excerpts, in-house | 0.98, 5-fold |
| `danceability-discogs-effnet-1` | 1280 | 306 tracks, in-house | 0.97, 5-fold |
| `mood_party-discogs-effnet-1` | 1280 | 349 | 0.93, 5-fold |
| `mood_acoustic-discogs-effnet-1` | 1280 | 321 | 0.95, 5-fold |
| `mood_happy-discogs-effnet-1` | 1280 | 302 | 0.87, 5-fold |
| `mood_sad-discogs-effnet-1` | 1280 | 230 | 0.90, 5-fold |
| `mood_electronic-discogs-effnet-1` | 1280 | 332 | 0.93, 5-fold |
| `engagement_regression-discogs-effnet-1` | 1280 | 22,211, in-house | Pearson 0.73 |
| `engagement_2c-discogs-effnet-1` | 1280 | 20,215 | 0.74 test |
| `approachability_regression-discogs-effnet-1` | 1280 | 24,598, in-house | Pearson 0.85 |
| `mtg_jamendo_moodtheme-discogs-effnet-1` | 1280 | 18,486 tracks, 56 tags | ROC-AUC 0.76, PR-AUC 0.14 |
| `timbre-discogs-effnet-1` | 1280 | 3,000 excerpts | not given |
| `voice_instrumental-discogs-effnet-1` | 1280 | 1,000 excerpts | 0.96, 5-fold |
| `deam-msd-musicnn-2` | 200, MusiCNN | 1,802 songs | arousal Pearson 0.773, CCC 0.647 |
| `emomusic-msd-musicnn-2` | 200, MusiCNN | 1,000 songs | arousal Pearson 0.821, CCC 0.622 |
| `muse-msd-musicnn-2` | 200, MusiCNN | 41,021 songs | arousal Pearson 0.11, CCC 0.051 |

Things that would trip someone up:

- **There's no arousal head for our embedding.** `classification-heads/deam`, `emomusic` and `muse` hold only MusiCNN and VGGish versions, as of today's directory listing. Those need a second model run over every track.
- **Class order differs per file:** `mood_relaxed` is `[non_relaxed, relaxed]`, `mood_aggressive` is `[aggressive, not_aggressive]`. Index by name.
- **The ONNX names differ from the metadata:** input `embeddings`, output `activations`, not `model/Placeholder`. The arousal heads use `model/Placeholder:0`. Ask the session for its names.
- **Metadata has errors.** DEAM's arousal `R^2 Score` is 589. The emoMusic and MuSe descriptions say DEAM. The changelog records a wrong input shape, 1200 for 1280, fixed in 2025. The arousal heads output `(valence, arousal)`, in that order.
- **The accuracy figures come from tiny sets.** 0.98 from 280 tracks is cross-validation inside its own collection, not evidence it holds for this library.

**The independent check** is [MusAV](https://zenodo.org/record/7316746/files/000078.pdf) (Bogdanov et al., ISMIR 2022): 2,092 previews with human pairwise judgements, scored the same way as here.

| Model | Pairs with full or majority agreement, arousal |
| --- | --- |
| emoMusic on VGGish | 86.42% |
| emoMusic on MusiCNN | 85.61% |
| Spotify API `energy` | 83.31% |
| emoMusic on EffNet (not published on the site) | 82.57% |
| DEAM on MusiCNN | 78.81% |
| DEAM on EffNet | 72.28% |
| MuSe on EffNet | 59.92% |

Three things follow:

- The paper finds the EffNet embeddings consistently the worst for arousal. That's a reason to doubt the numbers here, and to want Levan's ears on the lists.
- Its annotators agree only so far (Krippendorff's alpha 0.48 for arousal), so no score will be right all the time.
- Its dataset spans many genres, while this test is within an artist, so the figures don't compare directly.

## Measured from audio

**[R 128](https://tech.ebu.ch/docs/r/r128.pdf) through ffmpeg's `ebur128`** (`framelog=quiet`, read from the summary). Checked first against EBU's own signals, generated here: [Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf)'s 1 kHz sine at -23 dBFS read -23.0 LUFS, and [Tech 3342](https://tech.ebu.ch/docs/tech/tech3342.pdf)'s -20 then -30 steps read LRA 10. LRA is the 10th to 95th percentile of 3 s loudness, gated at -70 LUFS and 20 LU below.

- **Integrated loudness mostly says who mastered it.** Artist explains 0.76 of its variance, more than any other score, and the acoustic versions here are only 0.6 to 4.8 LU quieter than the band's: 25 (acoustic) is -7.8 LUFS against -7.2. It got all 8 version pairs right, but only by that small margin. It can't be used to compare across albums.
- **Loudness range** is about as weak: 79% and 72%.

**Written for this test.** Known answers on clicks and sines were right: 70, 120 and 174 bpm read 69.9, 119.5 and 172.9, and onset rates were within 2%. They're simple, though, and better ones exist, so these results are a floor for this class of feature rather than its limit.

- **Spectral centroid:** frames of 1024 at 22,050 Hz, magnitude weighted.
- **Onset rate:** log-mel flux with an adaptive threshold, in the manner of [SuperFlux](https://github.com/CPJKU/SuperFlux) without its vibrato filter.
- **Tempo:** autocorrelation weighted by a Gaussian on a log-time axis centred on 120 bpm, the form in [Ellis 2007](https://hajim.rochester.edu/ece/sites/zduan/teaching/ece472/reading/Ellis_2007.pdf). That paper's best width was 1.4 octaves; this test used 1.

**Tempo is the disappointment.** The two versions of one song can disagree: Only Love Can Save Me Now reads 90 and 171, Going To Hell 103 and 57. That's octave error on real music, and a stronger tracker would need another model. Essentia's TempoCNN is published as `.pb` only, with no ONNX, and it wasn't tried.

**Time per track,** mean length 247 s, one at a time on this laptop with other work running:

| Step | Mean | 95th percentile | Library of 5,719 |
| --- | --- | --- | --- |
| `ebur128` over the whole track | 0.91 s | 1.96 s | 1.45 h |
| Decode to 22 kHz | 0.68 s | 1.52 s | 1.08 h |
| Centroid, onsets, tempo in JS | 1.15 s | 2.58 s | 1.83 h |
| All of it | 2.74 s | | 4.35 h |
| Compare: MusiCNN arousal path | 6.13 s | | 9.7 h |
| Compare: heads on stored vectors | | | under 1 s in all |

Reading only the fingerprint's three 30 s stretches keeps most of the ordering (rank correlation with the full track 0.96 to 0.98) and lost about 3 points on centroid.

## How the engine would use it

Tested only as a sound-only simulation: 477 seeds evenly spaced through the library, nearest 60 other songs by cosine, cosine at least 0.6, energy lower by 0.08 to 0.30.

| | Result |
| --- | --- |
| Seeds with a candidate | 92% (median 14 candidates) |
| Seeds under 0.25 with a candidate | 71%, against 98 to 99% above it |
| Cosine of the best match | 0.854 unconstrained, 0.805 calmer |
| Shares a genre tag with the seed | 67% unconstrained, 49% calmer |
| Same artist | 36% of calmer picks |
| Median drop | 0.12 |

**Judged from knowledge, the picks are often right and sometimes not the same vibe:**

- **Good:** Basket Case to Wake Me Up When September Ends, Give It Away to Under The Bridge, Ho Hey to Gale Song, Get Lucky to You Make Me Smile, Drive My Car to Here Comes The Sun.
- **Not the same vibe:** One More Time to Small Bump at cosine 0.67, Beat It to Air Supply, Rolling In The Deep to A Day In The Life.

The genre drop from 67% to 49% is the real cost, so **energy must only choose among what already passes**, never pull in what doesn't. The lists are in `results.md`.

A shape for it, to be tuned by ear:

1. Every 4 to 6 picks, make a calm pick: from candidates above `scoreFloor` under the normal score, keep those 0.08 to 0.30 below the **anchor**, and take the best by the normal score, with the same artist cap and jitter.
2. The anchor is the energy of the session before the dip, such as the median of recent normal picks. Measure from it, not from the last track, or repeated dips ratchet down without limit.
3. Drift back over 2 or 3 picks by requiring energy near a target that climbs from the dip to the anchor, then lift the rule. `seedDecay` will pull the centroid down after a calm pick, which is why the return has to be asked for.
4. **No candidate means no dip.** Play the normal pick and try later. That will be common near the bottom of the scale, where there's little room to go down. A strict genre or score floor makes it more common, and that's the right failure.
5. A bigger minimum drop may be wanted near the top: the crowded end means 0.08 among AC/DC may not be audible. Only listening can settle this.

**Keep the three head outputs** per fingerprint, under a model id as fingerprints do, and rank them when the snapshot is built. Percentiles shift as the library changes, so a stored percentile would go stale.

## What was built

Added the same day, after the research above. It follows "How the engine would use it", with these differences:

- **Nothing is stored.** The head outputs aren't kept per fingerprint. Each snapshot runs the heads and ranks them, since that took 0.3 to 0.8 s for 5,719 vectors, and a snapshot is only rebuilt when the library changes. No migration. On the copied database the scores match `.dev/energy/energy-by-id.json` within 0.0001 for all 5,719.
- **A calm pick comes from the 60 closest that qualify,** not everything above `scoreFloor`. The floor is low enough that the far end of it is music radio would never otherwise play.
- **A calm pick also has to be 0.08 under the last song, and waits if the last song is already 0.08 under the anchor.** The first run didn't have this, and a "dip" could be a step up: Ramble On 0.585 to November Rain 0.711, against an anchor of 0.873.
- **The anchor** is the median of the last 9 ordinary picks in the queue, leaving out calm picks and their return.
- **The drop from the top of the range (point 5 above) wasn't changed.** It still wants listening.
- **The slider** sets how often and how far (every 2 to 3 picks at the calm end, 4 to 6 in the middle, none at the intense end) and, away from the middle, adds up to 0.2 per unit of energy to every candidate's rank. The middle adds nothing. Those end values are a guess, set by the measurements below rather than by ear.

**Simulated on a copy of the database.** 60 runs of 50 songs with the real `topUpAsk` and engine, wander in the middle, from 10 named seeds and 50 evenly spaced ones. Nothing here was listened to.

| Slider | Calm picks per 50 | Gap, median (10th to 90th) | Energy of all songs, median | Shares a genre with the seed |
| --- | --- | --- | --- | --- |
| No energy (as before) | 0 | | 0.53 | 34% |
| 0 (calm) | 13 | 3 (2 to 6) | 0.21 | 31% |
| 0.25 | 11 | 4 (3 to 7) | 0.31 | 33% |
| **0.5 (default)** | **8** | **6 (4 to 8)** | **0.45** | **34%** |
| 0.75 | 4 | 11 (8 to 13) | 0.61 | 33% |
| 1 (intense) | 0 | | 0.73 | 32% |

At the default, a calm pick is a median 0.145 under the anchor (0.09 to 0.24, 10th to 90th) and 0.185 under the song before it. It shares a genre with that song 40% of the time, against 43% for ordinary picks. All 60 runs had at least one.

**Radio already swings about this far by itself.** With energy off, ordinary picks run from 0.17 over the recent median to 0.17 under it (10th to 90th), and 26% of songs are 0.08 or more under it. With the default that's 37%. So a dip isn't bigger than what radio does anyway. What changes is that it's steered, regular, and followed by a climb. Whether that's heard as a difference is the first thing to listen for.

The default also drifts down a little over a run (the median falls 0.04 from the first 6 songs to the last 6), and sits 0.08 under radio without it. Calm seeds pulling the centroid down would explain both, though that was not tested on its own.

### The wave, with its numbers in settings

Levan's ask: mostly the same energy as what's playing, with a short slow-down every 3 to 6 songs, then back up, and the original radio left alone. So the single slider became a switch and five settings (`RadioEnergy`), and ordinary picks are now held near the anchor. The defaults are judgement, not measured preference.

Simulated on a copy of the library, 60 runs of 50 songs from loud seeds (energy 0.75 and up), through a simplified queue loop rather than `topUpAsk`. No listening.

- **Off is the original:** 200 of 200 runs picked exactly what the engine picked before energy (c7f1463), same seeds.
- **Fewer accidental drops:** songs 0.15 or more under the recent median, outside a breather, went from 14% to 7% at the default hold. A tighter hold didn't improve on that (8% at the tightest).
- **Breathers:** 6.2 per 50 songs, median gap 6, 10th to 90th percentile 4 to 11, because a due breather waits when nothing close fits. Median size 0.18 below the recent median.
- **Variety held:** 26 artists per 50 songs and 24% sharing a genre with the seed, the same as off.
- **Quiet seeds barely dip:** 2.5 per 50 from under 0.25, since there's little room below.

## Licenses

Checked 2026-11-01. This is a reading of the terms, not legal advice.

- Every model here is under the one file at `models/LICENSE`. SHA-256 `f0c07609...3ea4`, byte-identical to the copy already fetched for Discogs-EffNet. **Its headline says CC BY-NC-ND 4.0, its link and the [models page](https://essentia.upf.edu/models.html) say CC BY-NC-SA 4.0**, and the body is the ND text. The metadata JSONs have no license field. Commercial terms are available from UPF on request.
- Both forms allow non-commercial sharing of unmodified copies with attribution and the license. ShareAlike only bears on adapted material. [BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode) defines non-commercial as "not primarily intended for or directed towards commercial advantage", which fits a personal player given away.
- **So treat the heads like the existing model.** Keep the weights out of git (`resources/models/` is ignored). Have `npm run fetch:binaries` fetch them with pinned hashes and `LICENSE.txt` beside them, and let the installer carry them. Add one line to the README's credit. Passing on an installer is under the same terms.
- Don't port the weights into code or JSON. Under the ND reading that's an adaptation that can't be shared. Run the ONNX files as published.
- Scores in `library.db` stay on the machine and aren't in the repo.

**To fetch if adopted,** from `https://essentia.upf.edu/models/classification-heads/<name>/`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `mood_relaxed-discogs-effnet-1.onnx` | 514,101 | `8ba6515a1e5943a72b3b475e3a25fc7a2ff04142c3eaa6aa0716fca371efdfff` |
| `mood_aggressive-discogs-effnet-1.onnx` | 514,107 | `de36550b5d1660791ad732ed6de6ebfdc3e65dcf50b928b2578ddf103dbfb400` |
| `mtg_jamendo_moodtheme-discogs-effnet-1.onnx` | 2,739,322 | `7d6270acaa5f4bba4b115a0d6849aca05ed6bd153dcb6d9da4f6ab9f99ef10ff` |

The Jamendo tags used are, on the energetic side, energetic, fast, powerful, heavy, upbeat, action, and on the calm side calm, relaxing, slow, soft, meditative.

**Downloaded for this test** into `.dev/energy/models/`, 12.9 MB in all, each with its metadata JSON of 2 to 4 KB, all under the license above:

- About 514 KB each: `danceability`, `mood_acoustic`, `mood_aggressive`, `mood_electronic`, `mood_happy`, `mood_party`, `mood_relaxed`, `mood_sad`, `timbre`, `voice_instrumental`, `engagement_regression`, `engagement_2c` and `approachability_regression`, each `-discogs-effnet-1.onnx`.
- `mtg_jamendo_moodtheme-discogs-effnet-1.onnx`, 2,739,322 bytes.
- `deam-msd-musicnn-2.onnx` and `muse-msd-musicnn-2.onnx`, 82,032 bytes each; `emomusic-msd-musicnn-2.onnx`, 82,012 bytes.
- `msd-musicnn-1.onnx`, 3,168,334 bytes.

## Still open

- Whether the lists in `results.md` sound right. Everything above is secondary to that.
- Where a dip gets heard at all: 0.08 is a noise floor, not a perceptual one.
- Tuning by ear. The figures under "What was built" include artist and track links, but say nothing about how it sounds.
