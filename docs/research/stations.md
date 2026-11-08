# Mood stations: defining a station by example

2026-11-07 to 2026-11-08. Whether a radio station like "Study" can be defined from songs Levan picks, rather than from words or genre tags, and what the app can and can't learn from what it stores. Scripts, raw output and readable lists are in `.dev/stations/`, which isn't in git: `station.mjs` (the classifier and its tests), `swing.mjs` (loudness), `words.mjs` (how much is sung), `marks-study.json` (Levan's marks), `round1.md` and `round-marks.md`.

**How far to trust this.** Nothing here was checked by listening. The yes and no answers are Levan's, given from memory of the songs. Every test rests on a handful of example albums, so the percentages are rough. The method is a standard one; whether its picks suit a study session is Levan's to hear.

## Recommendation

Define a station by **yes and no examples** (songs, albums, artists or genres), then a **short check round** in which the person marks the songs the classifier is least sure about. Fit a **weighted logistic regression on the stored 1280-number fingerprints**. Gate the result with **rules taken from the yes examples**: the voice head, the energy blend and how much of a song is sung. A song plays when it passes the gates and ranks in the **top 10% of the unmarked library**. Yes examples are always in; no examples are always out.

- No text model and no new analysis of the music. The voice head (514 KB) is the only new file.
- Fitting is a second or two in the recommendation worker, so it's redone per snapshot and never stored, like energy.
- It finds a sound-defined mood reliably. It can't learn lines the fingerprint doesn't carry, and should say so instead of guessing (under "Grading itself").

## Why examples, not words

- Fitting a linear head on frozen pretrained embeddings is the standard way to learn a new music label from few examples: MuLan evaluates its embeddings with a per-class logistic regression ([Huang et al., ISMIR 2022](https://archives.ismir.net/ismir2022/paper/000067.pdf)), and few-shot audio work fits one binary logistic regression per new class ([Wang et al. 2021](https://arxiv.org/pdf/2110.09600)). Combining embeddings helps in the long tail ([2024](https://arxiv.org/pdf/2409.07730)).
- **Examples beat descriptions.** On extending a music annotation schema, ridge heads on frozen CLAP features beat zero-shot text prompts at every budget tried, from 8 labelled tracks up; even the mean of 8 labels beat zero-shot CLAP and Music Flamingo. Fitting on text-prompt similarities helped only at 128 tracks ([arXiv 2610.06920](https://arxiv.org/html/2610.06920v1)). Only the figures carry the exact errors.
- Text-to-audio models exist under usable licenses: [Microsoft CLAP](https://github.com/microsoft/clap) is MS-PL and LAION's [`clap-htsat-unfused`](https://huggingface.co/laion/clap-htsat-unfused/blob/main/README.md) is Apache-2.0. But neither publishes an ONNX build, `larger_clap_general`'s license wasn't confirmed, and either would mean a second model run over every track, as the MusiCNN arousal models would ([energy.md](energy.md): 9.7 h). Not worth it when examples do better.
- Pandora stations work the same way, seeds plus thumbs, by its own community moderators' account. The recurring complaint is that a thumbs-up keeps pulling a station after it's removed ([community thread](https://community.pandora.com/t5/My-Collection/Removed-thumb-up-has-permanently-altered-station/m-p/75336)). Hence every example and mark stays visible and removable. These are forum posts, not Pandora documentation.

## What Study needs, from the research on distraction

- **Lyrics cost reading comprehension; instrumental music costs about nothing.** Liked and disliked lyrical music both hurt reading against instrumental ([Perham & Currie 2014](https://www.Gwern.net/doc/music/music-distraction/2014-perham.pdf)). A meta-analysis summarised in the follow-up literature puts lyrical music at d = −0.35 and instrumental at about 0, overall d = −0.19 ([Frontiers 2024](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1363562/full), which also finds lyrics hurt against silence). Those effect sizes come from secondary descriptions; the primary meta-analysis wasn't read.
- **What disrupts is change in the sound, speech above all** (the changing-state account). Vocal music was more disruptive than instrumental in serial recall, and instrumental music with irrelevant pitch changes disrupts memory for tones ([Kattner & Meinhardt 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7066211/)).
- So wordless vocals sit between the two, and no source settles where the line goes. The examples decide it, which is what Levan did: FKJ's sparse vocals yes, Men I Trust's catchy lyrics no.
- Nothing found supports a particular tempo or genre for studying.

## The test: Study

Library: the 5,719 stored vectors of the 2026-11-01 database copy. Examples, each one group:

| | Example | Songs |
| --- | --- | --- |
| yes | Lo Fi Hip Hop (genre tag) | 176 |
| yes | Mozart, Classical Works | 12 |
| yes | Einaudi, In A Time Lapse | 14 |
| yes | Jim Brickman, By Heart: Piano Solos | 12 |
| yes | Jim Guthrie, Planet Coaster | 16 |
| no | Schubert, Classical Works | 7 |
| no | Bach, Classical Works | 11 |
| no | Darren Korb, Bastion | 22 |
| no | Darren Korb, Transistor | 23 |

Later rounds added 30 single songs Levan marked from the lists: 11 yes, 19 no.

**The classifier.** Vectors z-scored per dimension over the library. L2 logistic regression, λ = 0.01, full batch, Adam from zero at a rate of 0.01, 300 steps. Every yes group weighs the same in total, as does every no group, and the unmarked library is one negative block of the same weight. A single marked song weighs a fifth of an album. λ was fixed beforehand, not tuned.

**The 300 steps are part of the method.** They stop well short of the optimum, which holds the classifier back more than λ does. Run to the optimum instead (L-BFGS, checked to converge), the same Study examples rank songs differently (rank correlation 0.52 with the 300-step fit), the station grows from 102 songs to 170, and the leave-one-out test gets worse where it mattered: hidden Bastion and Transistor land at the 72nd percentile instead of the 35th, and Planet Coaster at the 78th instead of the 90th. Everything below was measured with the 300-step fit, so the app uses it.

**Leave one example out.** Each group is hidden in turn, the rest train it, and its songs are ranked among the unmarked library: median percentile (100 = top), and the share in the top 10%. Round three, with all 30 marks:

| Hidden | Similarity to the yes songs | Classifier, yes only | Classifier, yes and no |
| --- | --- | --- | --- |
| yes: Lo-fi | 81 (19%) | 100 (100%) | 100 (100%) |
| yes: Mozart | 74 (0%) | 100 (100%) | **5 (0%)** |
| yes: Einaudi | 93 (57%) | 99 (93%) | 99 (79%) |
| yes: Brickman | 85 (25%) | 100 (92%) | 100 (92%) |
| yes: Planet Coaster | 84 (25%) | 97 (69%) | 90 (44%) |
| no: Schubert | 92 (71%) | 100 (100%) | **100 (100%)** |
| no: Bach | 83 (9%) | 100 (100%) | **100 (100%)** |
| no: Bastion | 63 (9%) | 91 (50%) | 35 (32%) |
| no: Transistor | 66 (0%) | 94 (57%) | 36 (13%) |

What it shows:

- **Lo-fi, Einaudi and Brickman are found again when hidden,** by the classifier and in every round. Hidden lo-fi came out on top even when only the piano and classical examples trained it, so it learns "calm instrumental", not each album.
- **No examples are needed.** With yes examples alone, Schubert and Bach rank at the top of the library.
- **One no generalises within an artist:** Bastion alone pushes hidden Transistor down.
- **Mozart yes and Bach or Schubert no can't be separated.** Hidden Mozart falls to the bottom, hidden Bach and Schubert stay at the top, and 30 single marks didn't move it. To the fingerprint these albums are one thing.
- **Planet Coaster improved with marks,** from the 60th percentile in round one to the 90th. The Korb no's, also soundtracks, are what held it down.
- **Plain similarity is worse** than the classifier for every yes example.

**Training songs overfit.** With 1280 dimensions and few groups, examples score far above anything unseen, so a cut taken from the yes songs' own scores left 2 songs in the station. The cut is a rank among the unmarked library instead, the top 10%, which is where hidden yes examples landed.

**Marks steer it sensibly, and mostly by artist.** Round two's 6 yes marks brought in their relatives (Chopin waltzes, more Vivaldi, Coltrane ballads, Brubeck), and the no marks dropped theirs. One Vivaldi yes made Vivaldi the biggest artist in the pool, with 9 to 10 songs, so a per-artist limit when playing is needed.

**Size.** Round three: 109 songs beyond the 241 yes examples.

## The gates

- **Voice:** `voice_instrumental-discogs-effnet-1` on the stored vector, rescaled by the median norm as in [energy.md](energy.md). Cut at the 5th percentile of yes songs, but never above a single song marked yes. 0.68 at first, 0.60 once two FKJ songs were marked yes. The app runs it on the stored vector as it is, as it does the energy heads: the cut moves (0.54) since it comes from the yes songs anyway, and round three's station gains one song, Nightwish's Vista.
- **Energy:** the existing blend, cut at the 95th percentile of yes songs: 0.47.
- On their own, at the first cuts, the two gates let through 381 of 5,426 unmarked songs. They drop most of Korb, which is right, and keep all of Schubert and most of Bach.
- **The voice head can't tell vocal chops from lyrics between about 0.6 and 0.85.** Lowering the cut to 0.60 let in Of Monsters and Men, Daughter, Daft Punk and a track titled "[LYRICS]". Men I Trust's Plain View has full lyrics and scores 0.79. Heilung's chanting scored 0.95, as instrumental.

## Levan's reason for Bach and Schubert: swings in intensity

Most of his songs by them go high then low, several times a song. Tested as loudness on 771 songs (every example, every mark, every song with energy ≤ 0.5 and voice ≥ 0.5), read from `D:\Music`:

- **LRA**, the loudness range: ffmpeg's `ebur128`, EBU R128's measure, 10th to 95th percentile of short-term loudness.
- **Swings**: turning points of the 3 s short-term loudness, sampled each second, at least 8 LU apart. Quiet at either end ignored. The 8 LU was fixed before looking.

| Group | Songs | LRA, median (10th–90th) | Swings a minute, median |
| --- | --- | --- | --- |
| yes Mozart | 12 | 13.5 (8.8–14.0) | 4.0 |
| yes Brickman | 12 | 11.4 (6.7–14.1) | 3.8 |
| yes Einaudi | 14 | 17.1 (8.8–20.2) | 1.9 |
| yes lo-fi | 176 | 8.5 (4.7–12.9) | 1.2 |
| yes Planet Coaster | 16 | 6.6 (3.5–10.0) | 0.9 |
| no Schubert | 7 | 14.6 (8.6–20.9) | 3.2 |
| no Bach | 11 | 8.0 (6.9–10.9) | 2.0 |
| no Korb | 45 | 4.4 (2.7–9.1) | 0.7 |

**It doesn't hold as loudness.** Mozart swings more than Bach and has the wider range. Schubert's Unfinished does swing (LRA 21), but Einaudi goes wider. What Levan hears in the Bach concertos may be the trade between full orchestra and soloist, a change of texture that moves loudness by less than 8 LU. That wasn't tested: it would mean running the model along whole songs, about 4 hours for the library.

**The fingerprint can't see a song's shape by design.** It averages three 30-second stretches centred at 20%, 50% and 80% of the song (`chunkStarts`), so anything about how a song moves from start to end is lost.

## How much is sung, from stored lyrics

The `lyrics` table holds what LRCLIB or the lyrics dump gave: 4,770 found (4,398 timed), 419 marked instrumental, 530 never looked up, in the database copy. Counted without reading out a word of text:

- **sung share:** each timed line lasts until the next, at most 10 s; the share of the song covered by lines with words.
- **words a minute:** words over the song's length.

| | Song | Words a minute | Sung share |
| --- | --- | --- | --- |
| yes | FKJ – 10 Years Ago | 35 | 0.49 |
| yes | FKJ – 100 Roses | 28 | 0.33 |
| yes | Tom Misch – Tick Tock | 5 | 0.05 |
| no | FKJ – Brother | 39 | 0.64 |
| no | FKJ – Skyline | 42 | 0.69 |
| no | Men I Trust – Plain View | 62 | 0.69 |
| no | The Sound You Need – Conqueror (Kartell Remix) | 56 | 0.71 |
| no | MF Doom – Eye | 65 | 0.94 |

- **Sung share separates Levan's answers; words a minute doesn't** (Daughter's Medicine: 31 a minute, sung 0.79). It's only 8 songs, and the cut, the most any yes song is sung, comes from one of them.
- As a gate (sung share at most 0.49, unknown passes) it removed Of Monsters and Men, Daughter, Alice Phoebe Lou, Pink Martini and Courtney Barnett from the station. It missed Daft Punk (0.41) and the "[LYRICS]" track (0.38), both under FKJ's line.
- **A wrong match costs a song:** Leonard Cohen's Treaty (String Reprise) was dropped because the sung Treaty's lyrics are stored for it.
- **Coverage:** 140 of the 176 lo-fi songs were never looked up. Unknown has to pass, because unknown isn't no.

## In the app

`src/main/recommend/stations.ts` is the method, pure and with no imports so `.dev/stations/compare.mjs` runs it as it is. On round three's inputs it matches `station.mjs`: rank correlation of scores 1.0000, the same 102 songs, the same gates, and the same leave-one-out medians for all nine examples. `sungShare` in `main/lyrics/lrc.ts` uses the app's own LRC parser: over the 4,398 timed lyrics it's within 2 points of `words.mjs` for all but 16, and within 5 for all.

**Cost.** One fit is about 4.4 s on this laptop over 5,719 vectors (300 passes over 5,719 × 1,280). Building a station is one fit; grading is one more per album, artist or genre example, 9 for Study, so about 40 s. That's too slow to sit behind a button as it is.

## Grading itself

The leave-one-out test is cheap enough to run in the app (one fit per example group), and it gives the station a grade:

- **Clear:** hidden yes examples land in the top 10% and hidden no examples don't.
- **Fuzzy:** they're spread out; more examples or another check round.
- **"These sound alike to the app":** a yes and a no example that keep landing together, as Mozart and Bach did. The fix is marking songs rather than whole albums, or accepting the app can't hear the difference.

## Still open

- Whether Study sounds right. Everything above is secondary to that.
- How the classifier holds up for a station with vocals (workout, cozy). Only Study was tested.
- The texture-change idea for Bach, untested.
- λ, the 10% cut and the 0.2 weight of a single mark were set once and never tuned. With this few examples, tuning them would fit the test.

## Licenses

The voice head is under the same `models/LICENSE` as the energy heads: read as CC BY-NC-ND 4.0 or BY-NC-SA 4.0 in [energy.md](energy.md), fetched by `npm run fetch:binaries` with a pinned hash, never in git. From `https://essentia.upf.edu/models/classification-heads/voice_instrumental/`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `voice_instrumental-discogs-effnet-1.onnx` | 514,114 | `20155e4c439714b0c45c08644b73c8e12d9dccb173bd4ab9934bf1e5aee837ca` |

A fresh download through `npm run fetch:binaries` on 2026-11-08 matched it.

Lyrics never leave the database and their text is never printed; the scripts only count.
