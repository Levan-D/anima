# Headphone EQ: measurements, targets and honest correction

2026-11-01. For the idea: load a headphone's measured response, see it against a target, see how the EQ moves it.

Confidence tags: **[read]** I read the primary text. **[run]** I ran it here (AutoEq data at master, the bundled mpv, `--ao=null` or `--ao=pcm`, no sound). **[snippet]** Only a search snippet or a secondary summary, because the page was paywalled or blocked. **[pointer]** A forum or blog. Treat it as a lead, not a fact.

## Verdict

It can be built well, as a **model-level prediction**. It can't be built as a statement about what Levan hears.

- The EQ half is exact. Our curve matches mpv's real output within 0.02 dB and AutoEq's own curve within 0.07 dB **[run]**.
- The headphone half is uncertain, and more so going up in frequency. The same model on different rigs spreads about 1 dB from 100 Hz to 2 kHz, 4 dB from 2 to 6 kHz, 7 dB from 6 to 10 kHz and 12 dB above that **[run]**.
- So the graph is trustworthy from about 100 Hz to about 6 kHz. It must say so, and must get visibly less assertive above that.

### Staged plan

1. **Import a measurement.** The user picks a file and declares its source and rig. Parse `frequency,raw` CSV and tab-separated REW text, validated once in main, stored in app data. Draw it on its own scale with a 1/12-octave smoothed view and raw on demand. Align it by a stated rule.
2. **Predicted line.** Measured + `curveDb` at the track's real sample rate. Label it "Predicted", with the source line (see "Wording").
3. **Targets.** Import or fetch, tagged with a rig. Show the difference only when the rigs match. Otherwise explain why it's hidden.
4. **Fetch from AutoEq on request.** Search its index, download one headphone's CSV and `ParametricEQ.txt` from a pinned commit into app data. Nothing third-party in the repo.
5. **Headroom fix** (see "Clipping"). This is worth doing whether or not the rest happens.
6. **Optional: our own fit.** Port AutoEq's method (its code is MIT) to a worker. Importing its presets gets most of the value, so do this last or never.

### Bundle or import

| What | Bundle in the public repo? | How to get it |
|---|---|---|
| Our DSP, the parser, ISO 226 values | Yes | Already there |
| AutoEq **code** (a port) | Yes, keeping the MIT notice | |
| AutoEq **measurements, targets, results** | No | Download on the user's request |
| oratory1990 PDFs and values | No | User import, or via AutoEq |
| Rtings data | No | Their terms forbid reproduction. Don't fetch it directly either |
| Crinacle, squig sites, Headphones.com | No | User's own files only |
| Harman target values | No, until someone gives a source and terms | Via AutoEq's file, labelled |
| A flat line, or a tilt we define ourselves | Yes | Our own math. Say what it is, not "Harman" |

### What I'd refuse to build

- **A "Harman match" score or percentage,** or Olive's predicted preference number. That model was built on Harman's fixture and targets, and other fixtures "have not been validated" ([Listen Inc's sequence notes](https://www.listeninc.com/wp/media/seq_note_Harman_Predictive_Model_In_Ear_Headphones_v2-1.pdf), **[read]**).
- **Measurements from different rigs overlaid as if comparable,** or a target applied across rigs with no warning.
- **"Your headphones now measure flat to target"** or anything that says a user's own pair or ears were measured.
- **One-click correction of narrow features above about 6 to 8 kHz.**
- **Reading a frequency response back out of a ParametricEQ preset.** It's a correction against an unknown target, so it says nothing certain about the headphone.

### Two things not asked for, worth having

1. **Bass offset on the target.** Olive's clustering gives 64% who prefer the target, 15% who prefer 4 to 6 dB more bass, 21% who prefer 2 dB less. He suggests a bass control as the simple fix ([Olive 2022](https://acousticstoday.org/wp-content/uploads/2022/03/The-Perception-and-Measurement-of-Headphone-Sound-Quality-What-Do-Listeners-Prefer-Sean-E.-Olive.pdf), **[read]**). One slider, on the target line.
2. **Level-matched before and after.** The preset's preamp makes EQ about 6 dB quieter, so a plain on/off comparison flatters "off". Harman's own tests are level-matched and blind ([SoundGuys on Olive's pilot](https://www.soundguys.com/harman-research-targets-the-bruel-kjaer-5128-112247), **[snippet]**).

## 1. Target curves

**Harman, not Harman Kardon: confirmed.** The research is by Sean Olive, Todd Welti, Elisabeth McMullin and later Omid Khonsaripour of Harman International. Harman Kardon is one of the brands Harman owns ([GRAS case study](https://www.grasacoustics.com/fileadmin-gras/Images/Consumer_Audio/Household_Appliances/GRAS_Case_Harman_Final_02182021pdf.pdf), **[read]**). Olive left: his 2025 paper lists "Sean Olive Audio Consulting" **[snippet]**.

**What it's based on** ([Olive 2022](https://acousticstoday.org/wp-content/uploads/2022/03/The-Perception-and-Measurement-of-Headphone-Sound-Quality-What-Do-Listeners-Prefer-Sean-E.-Olive.pdf), **[read]**). The in-room response of an accurate loudspeaker in a semi-reflective room, falling about 1 dB per octave. Tested through a virtual method: one replicator headphone equalized to imitate each headphone, double blind. Validated against real headphones at r = 0.86 to 0.99. First tested with 10 trained listeners, then 283 in four countries, mostly Harman employees. The result is a preference finding, not a physical truth, and it's a majority rather than everyone.

| Version | Source | Rig | Notes |
|---|---|---|---|
| Over-ear 2013 | [AES 134, Olive, Welti, McMullin](https://www.aes.org/e-lib/online/browse.cfm?elib=16768), and [AES 135 paper 8994](https://aes.org/publications/elibrary-page/?id=17042) | Fixture details not read | Paywalled **[snippet]** |
| Over-ear 2015 | [AES 139 paper 9382, Olive, Welti](https://aes.org/e-lib/browse.cfm?elib=17940) | Same line of work | The link between this paper and the "2015" label is inferred **[snippet]** |
| Over-ear 2018 | [AES 144 paper 9919](https://aes.org/publications/elibrary-page/?id=19436) | GRAS 45CA with a **custom pinna** (Listen, **[read]**) | Olive 2022 describes "an ear simulator according to IEC 60318-1 equipped with a custom pinna" |
| In-ear 2017 | [AES 143, Parts 1 and 2](https://aes.org/publications/elibrary/elibrary-page/?id=19237) | GRAS RA0045 (IEC 60318-4) (Listen, **[read]**) | 71 listeners, 30 models **[snippet]** |
| In-ear 2019 | No primary paper found | Same RA0045, presumably | AutoEq carries the label. I can't source its exact origin |
| 5128 equivalents | [Olive and Clark, AES 159 paper 394, 2025](https://aes2.org/publications/elibrary-page/?id=23068) | B&K 5128 and GRAS 45CA-10 | Says the target is often misused on other fixtures, causing errors **[snippet]** |

Year labels and their differences are as AutoEq names them. I couldn't confirm them against Harman's own text. Differences between AutoEq's files **[run]**, aligned at 1 kHz:

- 2015 minus 2013: about +1.8 dB at 20 to 100 Hz, +1.6 dB at 6 to 10 kHz.
- 2018 minus 2015: about −0.8 dB at 2 to 6 kHz, up to 5.1 dB in places above 10 kHz.
- In-ear 2019 minus over-ear 2018: +3.2 dB mean at 20 to 100 Hz. That agrees with Olive's "additional 4 dB of bass" **[read]**. An [AES section report](https://aes.org/sections/reports/?ID=3148) snippet says about 10 dB, which the data doesn't support.

**Other targets**

| Target | Rig | Published as numbers? | Terms |
|---|---|---|---|
| Diffuse field | Defined per fixture. Standards: [ITU-R BS.708, IEC 60268-7, Møller 1995](https://www.aes.org/e-lib/browse.cfm?elib=10274), via Olive 2022 | AutoEq has `Diffuse field GRAS KEMAR`, `5128`, `ISO 11904-1` | Provenance and terms not stated |
| Free field | As above. Olive: "fell out of favor" but still in the IEC standard | Not found as a file | |
| The Headphone Show / Resolve | 5128. DF baseline with a downward tilt, stated "still a work in progress" in 2023 ([forum, by Resolve](https://forum.headphones.com/t/developing-a-new-headphone-reference-target/20094), **[pointer]**) | **None found.** AutoEq's `Diffuse field 5128 -1dB per octave` is generic, not theirs | Unknown. Treat as unavailable |
| Crinacle / IEF | GRAS and 711 | Couldn't verify. AutoEq has `crinacle EARS + 711 Harman`, a translation | Unknown |
| SoundGuys | 5128 ([their page](https://www.soundguys.com/soundguys-house-curve-54290), **[read]**) | Charts only. "Available to the public", no terms and no numbers. They supply it to Rtings [under an agreement](https://www.soundguys.com/rtings-com-adds-soundguys-curves-to-headphone-comparisons-136929/) | Don't bundle. Their write-ups have an interest: their curve is in the tests |
| Rtings | 5128 now, HMS II.3 before. A hybrid, then DF with −1 dB/oct tilt ([research page](https://www.rtings.com/headphones/learn/research/frequency-response-1-8), **[snippet]**) | No | Reproduction forbidden, see below |
| Senselab/Aizu | 5128, [Ravizza et al. 2023](https://aes2.org/publications/elibrary-page/?id=22281) **[snippet]** | Not found | |

**Can the numbers go in a public repo? Not as things stand.** I'm not a lawyer.

- US: facts aren't copyrightable, only original selection and arrangement ([Feist](https://www.law.cornell.edu/supremecourt/text/499/340), **[read]**). A curve that's a design choice is less clearly a bare fact than a measurement is. Other countries differ, and I didn't research the EU database right.
- AutoEq's MIT license doesn't cover its data. The owner: "the license was intended to cover only the code, and not the data" ([issue 790](https://github.com/jaakkopasanen/AutoEq/issues/790), **[read]**). That issue also shows the rights holders were never identified.
- So a public repo re-publishing those files has no permission to point to. A fetch on the user's request has no such problem and costs almost nothing to build.

## 2. Measurement data

| Source | Where | Format | Terms | Use |
|---|---|---|---|---|
| [AutoEq](https://github.com/jaakkopasanen/AutoEq) | `measurements/<source>/data/...` | CSV `frequency,raw` **[read]** | Data unlicensed, see above | **Primary fetch** |
| AutoEq results | `results/<source>/<form>/<name>/` | `ParametricEQ.txt` (Equalizer APO), `FixedBandEQ.txt`, `GraphicEQ.txt`, min-phase WAVs, a PNG, and in many folders a CSV with `frequency,raw,smoothed,error,error_smoothed,equalization,parametric_eq,fixed_band_eq,equalized_raw,equalized_smoothed,target` **[read]** | Same | Presets. The README covers 6,033 models, and says these are not for normal users since [autoeq.app](https://autoeq.app) exists |
| oratory1990 | [PDFs, listed on Reddit](https://www.reddit.com/r/oratory1990/wiki/index/list_of_presets/) (Reddit blocked, not read). AutoEq's `name_index.tsv` links the Dropbox PDFs | PDF, parsed to CSV by AutoEq | None stated | Via AutoEq. Upstream ranks it high |
| Crinacle | [CrinGraph](https://github.com/mlochbaum/CrinGraph) README: his measurements "aren't public" **[read]** | AutoEq has presets. Its `measurements/crinacle` listing shows an index file, and the raw files weren't listed | Not found | Presets, or a user's own file |
| Rtings | Site only | No public file. Some access is paid **[snippet]** | ["any reproduction, total or partial, of the contents of RTINGS is totally forbidden"](https://rtings.com/company/terms-of-use) **[read]** | No direct fetch. AutoEq also holds Rtings-derived data, and I can't say on what basis |
| Headphones.com | Own graph tool, details not reached. Rigs per **[pointer]** | Unverified | Unverified | User's own file |
| [squig.link](https://documentation.squig.link/squigglers/managing-a-database) | Per-reviewer sites | REW `.txt`, tab-delimited, 20 to 20,000 Hz, 48 points per octave; `<name> L.txt`, `R.txt`, `Target.txt` **[read]** | Not addressed; code is [0BSD](https://github.com/mlochbaum/CrinGraph) | User import. Don't scrape |

A user-supplied file sidesteps the licensing entirely, so the parser should treat it as the normal path.

## 3. Correctness

### Rigs aren't comparable

- Harman's over-ear target was developed on a GRAS 45CA with a custom pinna, and "B&K 4128, B&K 5218, G.R.A.S. KEMAR, etc." aren't validated against it ([Listen](https://www.listeninc.com/wp/media/seq_note_Harman_Predictive_Model_In_Ear_Headphones_v2-1.pdf), **[read]**).
- Translating a target needs the same headphones measured on both fixtures ([Olive 2024 via SoundGuys](https://www.soundguys.com/harman-target-soundguys-preference-curve-validated-125420/), **[snippet]**). The fixtures' acoustic impedance differs, so no universal delta curve is correct for every headphone ([Olive and Clark 2025](https://aes2.org/publications/elibrary-page/?id=23068), **[snippet]**).
- 5128 vs earlier rigs: Rtings says there's no direct conversion **[snippet]**.
- IEC 60318-4 ear simulators are specified only for 100 Hz to 10 kHz, per Rtings' account **[snippet]**. I didn't read the IEC standard.

Numbers from AutoEq's files, aligned at 1 kHz **[run]**:

| | 20–100 | 100–500 | 500–2k | 2–6k | 6–10k | 10–20k |
|---|---|---|---|---|---|---|
| DF on 5128 minus DF on GRAS KEMAR, mean (max) | −0.3 (0.4) | +0.3 (0.6) | −0.2 (2.1) | +0.6 (2.8) | +2.2 (4.5) | +1.5 (4.2) |
| AutoEq's 5128 target minus Harman 2018, mean (max) | +0.1 (0.3) | −0.1 (0.3) | +0.3 (0.7) | +0.9 (1.8) | +2.8 (4.5) | +6.4 (11.9) |
| **HD 660 S across 5 sources, median max−min** | **2.9** | **0.8** | **0.7** | **4.1** | **7.4** | **11.6** |
| Same, worst point | 6.2 | 1.1 | 2.3 | 7.1 | 13.3 | 26.0 |

The five: oratory1990, Rtings HMS II.3, Innerfidelity, Super Review, HypetheSonics. That's one headphone and it mixes rig, unit and seating, so read it as an order of magnitude. Two Crinacle sets had no CSV I could fetch.

### Unit, seal and placement

- Same measurer, same model, different unit (Innerfidelity samples) **[run]**. K701 A vs B: rms 1.0 dB at 500 to 2k, 2.2 at 6 to 10k, 4.1 above 10k. LCD-XC 1 vs 2: 3.4 at 2 to 6k. Beats Solo 1 vs 2: **8.9 dB rms at 20 to 100 Hz**, a closed on-ear, where seal rules. Three pairs only, and rig or setup may have changed between measurements.
- Across people, the same headphone can deviate up to 20 dB, and it varies on re-seating. Leakage is the supposed cause at low frequencies, and the cavity's sound field gets more sensitive at high ones. They recommend averaging several seatings ([Lindau and Brinkmann 2010](https://www.isca-archive.org/pqs_2010/lindau10_pqs.pdf), **[read]**, citing others).
- Harman's custom pinna exists because leakage on stiff pinnae doesn't match humans (Olive 2022). In-ears show about 4 dB more at 100 Hz on an artificial ear, maybe a better seal than on a real ear ([Breebaart 2017](https://pubs.aip.org/asa/jasa/article/141/6/EL526/917945/No-correlation-between-headphone-frequency), **[read]**).
- High-frequency SNR is itself a limit: on a standard HATS with a 1/2" capsule, high-frequency output sits near background noise, and ±1 dB needs at least 10 dB SNR ([Tsunoda et al., AES 143](https://www.bksv.com/media/doc/bn2104.pdf), **[read]**, Sony, aimed mainly above 20 kHz).

**How far to trust it, my reading of the above:**

| Range | Trust | Why |
|---|---|---|
| Below 100 Hz | Shape yes, level no | Seal dominates. Good for open headphones, poor for closed and on-ear |
| 100 Hz to 2 kHz | High, about ±1 dB | Rigs agree. Features are broad |
| 2 to 6 kHz | Medium, about ±2 dB | Rig and pinna differences begin |
| 6 to 10 kHz | Broad trend only | About 7 dB spread, narrow peaks move with head and seating |
| Above 10 kHz | Don't correct | About 12 dB spread. Average level at most |

These bands are a judgment, not a published standard. No source I could read gives exact limits.

### Normalization

- **AutoEq:** centers both measurement and target at 1 kHz, by default. `min_mean_error` instead shifts by the mean error from 100 Hz to 10 kHz, to avoid bias from a notch at 1 kHz ([`frequency_response.py`](https://github.com/jaakkopasanen/AutoEq/blob/master/autoeq/frequency_response.py), **[read]**).
- **Harman:** the model's sequence normalizes L/R to 500 Hz (Listen, **[read]**). Olive's Figure 5 uses 500 Hz too.
- **CrinGraph:** default is pink-noise loudness using ISO 226 weighting, with fixed frequency as an option ([docs](https://raw.githubusercontent.com/mlochbaum/CrinGraph/master/Documentation.md), **[read]**).

The offset only moves the picture, never the sound, as long as the preamp isn't part of it. Recommendation: align over a band (mean of 300 Hz to 3 kHz, on the smoothed curve) and name the rule on screen. A single-frequency anchor lets a local wiggle tilt the whole reading. 1 kHz only where we must reproduce AutoEq's plot exactly.

### How AutoEq computes a correction

All **[read]** in [`frequency_response.py`](https://github.com/jaakkopasanen/AutoEq/blob/master/autoeq/frequency_response.py), [`peq.py`](https://github.com/jaakkopasanen/AutoEq/blob/master/autoeq/peq.py) and [`constants.py`](https://github.com/jaakkopasanen/AutoEq/blob/master/autoeq/constants.py).

1. Interpolate to a log grid (step 1.01, 20 Hz to 20 kHz).
2. Center at 1 kHz. Target likewise, plus any bass, treble or tilt signature.
3. `error = raw − target`.
4. Smooth: **1/12 octave**, moving through a 6 to 8 kHz sigmoid to **2 octaves** in the treble ("to avoid problems caused by peakiness").
5. `equalization = −smoothed error`, slope-limited to **18 dB/octave** with protection around dips, positive gain capped at **+6 dB** (treble cap also +6, `treble_gain_k` 1), final smoothing 1/5 octave.
6. Fit biquads: minimize RMS between filter sum and `equalization`, where **above 10 kHz both are replaced by their mean**, plus a sharpness penalty. Peak: Fc 20 to 10,000 Hz, Q 0.18 to 6, gain ±20. Shelf: Q 0.4 to 0.7 (overshoots outside that, by its own comment). Shelf gain ±20.
7. Default 10-band shape in presets: low shelf at 105 Hz, high shelf at 10 kHz, Q 0.7, plus 8 peaks.

**Why narrow highs are unwise:** a narrow treble peak on the rig sits somewhere else on a real head (table above, and Lindau 2010), so correcting it digs a notch where nothing was wrong. Step 4 and the 10 kHz averaging are AutoEq's guards against that. Dips get protected for a related reason: filling one takes a boost at a frequency that may not need it.

### Does 10 bands suffice?

Yes, with shelves. It's what AutoEq outputs for most apps, and the first five filters already do most of it. Sennheiser HD 660 S, oratory1990 preset, filter sum against AutoEq's `equalization` **[run]**:

| | 20–100 | 100–1k | 1–6k | 6–10k |
|---|---|---|---|---|
| 5 filters, rms (max) dB | 0.22 (0.52) | 0.16 (0.43) | 0.52 (1.10) | 0.69 (1.46) |
| 10 filters, rms (max) dB | 0.22 (0.52) | 0.11 (0.23) | 0.28 (1.01) | 0.55 (1.23) |

Fit error is well under the measurement's own uncertainty. More bands would chase noise. One headphone, so this is an example, not a proof.

The final miss against target for that preset, `raw + parametric_eq − target`, rms (max) **[run]**: 2.70 (6.30) at 20–100 Hz, because of the +6 dB cap; 0.10 (0.23) at 100–1k; 0.43 (1.61) at 1–6k; 2.21 (5.08) at 6–10k; 2.85 (7.33) above 10k, by design. So even a perfect preset doesn't land on the line, and the display shouldn't imply it does.

## 4. An honest display

**Lines**

- **Measured:** as loaded. 1/12-octave smoothed by default, raw on demand, like AutoEq. Say which.
- **Target:** only if its rig matches.
- **Predicted:** measured + `curveDb` at the current track's rate. Nothing else. No smoothing beyond measured's, no shift.
- **Compensated view:** measured − target, a flat line meaning "on target". Useful and easy to read, but it hides what the target is, so keep it a toggle and name the target.

**Scale.** Keep one dB-per-pixel for everything or the sum stops looking like a sum. The plot is ±12 dB today (`EQ_MAX_GAIN_DB`). HD 660 S against target is already −12.6 dB at 20 Hz, so the overlay needs a wider range or a separate panel with the same scale.

**Uncertainty.** Fade the measured and predicted lines above 6 kHz, and grey the area above 10 kHz. Don't draw a numeric error band: I don't have data that justifies a specific width per headphone.

**How accurate is the prediction?** Two different answers.

- Our EQ's effect on the signal: within about 0.1 dB of what mpv does **[run]**. That part is fact.
- The sum as what reaches an ear: unknown for this person. Below 2 kHz it's a good guide. Above 6 kHz it's a broad trend.

**Wording**

Say:
- "Predicted, not measured: oratory1990's HD 660 S (GRAS) plus your EQ"
- "Your pair and your head will differ, most of all above 6 kHz and in the bass if it doesn't seal"
- "Harman over-ear 2018 is defined on another rig. Not shown against this measurement"
- "Aligned over 300 Hz to 3 kHz"

Don't say: "corrected", "flat", "accurate", "your headphones", "% match", "the right sound". A target is a majority preference, not correctness.

**Honesty on rig matching:** even oratory1990 and Harman aren't truly the same rig: he's described using RA0045 with a KB5000 pinna ([his 2019 comment, on a Reddit mirror](https://lr.sudovanilla.org/r/oratory1990/comments/cgryqy/oratory1990s_list_of_eq_presets_update_23719/ewr1siu/?context=3), **[pointer]**), and Harman used a custom pinna. So three states, not two: *defined on this rig*, *same family, approximate* (show with "approximate"), and *different rig* (hide). AutoEq's translated targets (`Rtings Harman over-ear 2018`, `HMS II.3 ...`) count as approximate, as AutoEq's own.

## 5. Our DSP

### Filters: all the same math

- **ffmpeg:** `equalizer`, `lowshelf`, `highshelf` in [`af_biquads.c`](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/af_biquads.c) are the RBJ cookbook forms, with `A = 10^(g/40)`, `alpha = sin(w0)/(2·w)` for `t=q`, shelf term `2·sqrt(A)·alpha` **[read]**. `poles` defaults to 2. Docs: [equalizer, bass/lowshelf, treble/highshelf](https://ffmpeg.org/ffmpeg-filters.html) **[read]**.
- **`src/shared/eqCurve.ts`:** the same coefficients. **It matches.**
- **The bundled mpv** (FFmpeg git-2025-12-21), impulse through the HD 660 S preset: within 0.004 dB of `curveDb` at 44.1 kHz, 0.02 dB at 96 kHz **[run]**. The worst is at 20 Hz, probably my analysis window.
- **AutoEq:** `peq.py` uses the same RBJ forms. Our curve vs its `parametric_eq` column: max 0.068 dB at 44.1 kHz, rms 0.02 dB, which is rounding in the file **[run]**. So its results are computed for 44.1 kHz.
- **Equalizer APO: read in source, not run.** SourceForge's tree is a 404, so this is the [mirror/equalizerapo](https://github.com/mirror/equalizerapo) copy (77 commits, upstream revision not stated, so it may trail the release) **[read]**. [`BiQuad.cpp`](https://raw.githubusercontent.com/mirror/equalizerapo/master/filters/BiQuad.cpp) uses the same RBJ forms, `A = 10^(g/40)`, `alpha = sn/(2Q)`, shelf term `2·sqrt(A)·alpha`. [`BiQuadFilterFactory.cpp`](https://raw.githubusercontent.com/mirror/equalizerapo/master/filters/BiQuadFilterFactory.cpp) and [`BiQuadFilter.cpp`](https://raw.githubusercontent.com/mirror/equalizerapo/master/filters/BiQuadFilter.cpp) settle what the [configuration reference](https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/) leaves open:
  - **`LS`, `HS`, `LSC`, `HSC` with no Q: slope S = 0.9, on Fc.** Its comment says this was found by experimenting with Room EQ Wizard. `apoFile.ts` turns it into the equivalent Q at the file's gain. An edit to the gain afterwards keeps that Q, where an S would have moved with it.
  - **`LS` or `HS` with a Q: Fc is a corner, moved to the centre** by `10^(|g| / 80 / S)`, up for low and down for high, with S worked out from Q. 100 Hz at +6 dB, Q 0.707 is really 118.9 Hz. `LSC` and `HSC` use Fc as given, and they're what AutoEq writes and what we write. `apoFile.ts` used to ignore this, and now applies it.
  - A slope such as `LS 12dB` or `LSC 10.8 dB` is still refused with the line named, though it's now known what they mean: S = dB / 12, with the same corner rule on `LS` and `HS`.

### What Q means

[Cookbook](https://www.w3.org/TR/audio-eq-cookbook/) **[read]**: for a peak, Q is such that A·Q is the classic EE Q, and BW is measured between midpoint-gain frequencies. S = 1 is the steepest monotonic shelf, and S maps to `Q = 1 / sqrt((A + 1/A)(1/S − 1) + 2)`, so S = 1 is Q = 0.707 at any gain.

Sizes of a mix-up **[run]**:

| Mix-up | Worst difference |
|---|---|
| Peak Q meant as classic (A·Q), Q 1, ±6 dB | 0.99 dB |
| Same at +3 dB / +12 dB | 0.26 dB / 3.50 dB |
| Shelf S = 1 read as Q = 1, +6 dB at 105 Hz | 1.14 dB |
| Shelf S = 0.5 read as Q 0.707, +6 dB | 0.91 dB |
| Shelf S = 0.9 vs Q 0.707, +6 / +12 dB | 0.16 / 0.33 dB |

Shelf overshoot with RBJ Q at +6 dB **[run]**: none at Q ≤ 0.7. Q 1: +0.44 dB over and under. Q 1.4: +1.40. Q 2: +2.86. Allowed by our range, and the curve shows it truthfully.

### Mismatches found

1. **Sample rate on screen.** Fixed: the curve now uses the rate mpv decoded, then the library's rate for a track not open yet, then 44.1 kHz with nothing to go on. It was fixed at 44.1 kHz, and off by this on the HD 660 S preset **[run]**: at 48 kHz at most 0.32 dB. At 96 kHz, 0.30 dB at 10 kHz and about **1.5 dB at 15 to 20 kHz**. The same `bands` mean a different curve per file, because of the bilinear transform. Measured now through the Player with an impulse: see `player.curve.bytes.test.ts`.
2. **Headroom can fail.** See below.
3. **Band above Nyquist.** `af_biquads.c` bypasses a filter with `w0 > π` with only a warning at setup **[read]**, untested. A 20 kHz band on a 32 kHz file does nothing while `curveDb` still counts it. Only low-rate files.
4. **`LS`/`HS` with no Q** in `apoFile.ts` got Q 0.707, a guess. Fixed: it's S = 0.9, from APO's source, above. The old guess was off by 0.16 dB at 6 dB. Slope forms like `LSC 10.8 dB` and `LS 12dB` fail to parse, so the whole file is refused rather than misread, which is right.
5. **Not a bug, but worth knowing:** auto preamp on this preset is −6.5 dB where the file says −6.3, because ours takes the peak across four rates. Importing keeps the file's value as a manual preamp.
6. **Clamp at ±12 dB.** AutoEq's filters may go to ±20. Import clamps and reports it, so a clamped preset no longer matches its curve. Worth keeping visible.

### Clipping: a peak-based preamp isn't enough

`preampDb` guarantees the **magnitude curve** stays at or below 0 dB. That isn't a limit on sample peaks: a filter can raise peaks by rearranging phase even with |H| ≤ 1. The true bound is the sum of |h[n]| (L1 norm).

- L1 bound after preamp **[run]**: HD 660 S preset **+5.59 dB**; +6 dB peak +1.16; +6 dB shelf +0.48. **A pure cut, with preamp 0, still has a bound: −6 dB peak Q 1 is +3.98 dB, −7.3 dB at Q 4.4 is +4.00 dB.** This worst case needs a signal shaped to exploit it, so music gets nowhere near.
- Real music **[run]**: first 90 s of 32 tracks from `D:\Music` (read only), HD 660 S preset, preamp −6.5 dB: **3 of 32 went over 0 dBFS, worst +0.37 dBFS.** Mean peak change −2.9 dB. Sample peaks only, no inter-sample peaks. It's a small spread-out sample, not the library.
- The chain runs in float: mpv's log shows `[lavfi] float` after the `volume` filter, including at 0 dB **[run]**. Nothing clips inside. Overs reach the output stage, whose behavior on a real device I didn't test, per the no-sound rule. Plausibly a hard clip when converted to a device's integer format.
- **Without `volume` first, the biquad stayed in s16** on a 16-bit FLAC **[run]**. `chainSpec` always puts `volume` first, so this is fine today, but it's load-bearing and isn't stated anywhere. Add a test or comment.
- `eqCurve.ts` says "Automatic headroom never gets there", and the UI only shows "may clip" with a manual preamp. True of the curve, not of the signal.

**Recommendation:** add a small fixed margin to Auto, say 1 dB, which covers what I measured, and reword the note as "curve" headroom. Not a limiter by default, since it's non-linear and adds lookahead delay. An honest "headroom" line beats a guarantee we can't make. Choose the number with a larger sample of the library, which is cheap: ffmpeg's `astats` over all of it, in a worker.

## 6. ISO 226

**The values were right.** All 116 numbers in `equalLoudness.ts` (frequency, α_f, L_U, T_f, 29 each) are identical to two independent copies **[run]**: [IoSR's `iso226.m`](https://github.com/IoSR-Surrey/MatlabToolbox/blob/master/%2Biosr/%2Bauditory/iso226.m) and [Mathias's gist](https://gist.github.com/sammosummo/777debf946d0356acada). The 60 phon contour matches the gist's printed output to 5e-9 dB.

**The formula is right.** It matches Eq. (1) of the 2003 edition as quoted in [Suzuki, Takeshima and Kurakata 2024](https://doi.org/10.1250/ast.e23.66) **[read]**. Spot values: 40 phon at 20 Hz is 99.85 dB. 1 kHz gives the phon value within 0.012 dB, a rounding effect of the formula.

**What changed in the code:** no values. The header now cites what was checked and drops "section 4.1 and table 1", which I couldn't confirm. Added one test against the published contour. **I didn't read ISO 226:2003 itself (paywalled).** The evidence is two implementations agreeing, plus the review's equation.

**ISO 226:2023:** lower threshold at 20 Hz by 0.4 dB (ISO 389-7:2019), reference exponent α_r changed from 0.25 to 0.30, a rewritten formula. Differences from 2003 are −0.6 to +0.3 dB, and within ±0.3 dB above 10 phon, and the authors call them practically the same **[read]**. Experimental data has a 5 to 6 dB standard deviation anyway. I found the 2023 formula but not its α_f table, which is paywalled, so I wouldn't switch. Staying on 2003 is right, and citing it as such.

**Validity:** per IoSR's notes, valid to 90 phon at 20 Hz to 4 kHz and to 80 phon at 5 to 12.5 kHz. Our 40 and 80 phon lines are in range, and 80 is the edge.

**Also:** contours are free-field loudness for pure tones. They're not a headphone target and shouldn't sit with one without saying so.

## Frequency-chart spot check

Fixed since: see [instrument-ranges.md](instrument-ranges.md). This table is what was found at the time. Pitches are computed from A4 = 440 Hz. Reference: [VSL Synchron Prime ranges](https://www.vsl.co.at/instruments/starter-editions/prime-orchestra) **[read]**, which are a sample library's ranges (mostly sounding, not always stated, and some timpani and unpitched entries are key mappings), and [Wolfe, UNSW](https://www.phys.unsw.edu.au/jw/voice.html) **[snippet]**.

`chartData.ts` follows IRN's chart by design, so this is about that chart's accuracy and where our notes disagree with our numbers.

| Item | App | Reference | Finding |
|---|---|---|---|
| Piano | 27–4200 Hz, A0–C8 | 27.5–4186 Hz | Right |
| Double bass | 41 Hz, fringe to 30 | E1 41.2; VSL low B0 30.9 | Right |
| Tenor trombone | 82 Hz, E2 | E2 82.4 | Right |
| Mains hum word | 49–67 Hz | 50/60 Hz | Right |
| **Tuba** | note says "B0, 29 Hz" | B0 is 30.9, 29.1 is B♭0. VSL bass tuba low C1 to D1 (33–37) | **Note contradicts itself** |
| **Cello** | 56 Hz, note says C2 | C2 is 65.4 | **Number is low, disagrees with its note.** VSL top A5 (880), app 520 |
| **French horn** | 55 Hz, note says B1 | B1 is 61.7; VSL C2 65.4 | **Disagrees with its note** |
| **Bassoon** | 55–575 Hz, note says B♭1 to E5 | B♭1 58.3, E5 659; VSL to F5 698 | **Disagrees with its note** |
| **Harp** | 29 Hz, note says B♭0 | VSL B0 30.9 to G♯7 3322 | **Low note wrong**, top a bit low |
| **Violin** | fundamentals to 1300, "E6" | VSL to G7 (3136) | **Top understated by over an octave** |
| Viola | 125–1000, "C3 to C6" | C3 130.8; VSL to F6 1397 | Top understated |
| **Timpani** | fundamentals 62–687 | VSL rolls C2–C4 (65–262) | **Top looks like modes, not played pitch** |
| Tenor sax | 120–725, "B2 to F5" | VSL G2–E5 (98–659) | Low end high |
| Bass trombone | 58–400 | VSL F1–C4 (44–262) | Differs, down to instrument variants |
| Contrabassoon | 29–200 | VSL A♯0–C4 (29–262) | Top a little low |
| Piccolo | 630–4000, "E5 to B7" | VSL C5–C8 (523–4186) | Slightly narrow |
| **Male vocal** | fundamentals 101–919 | Voice spans about 60 to over 1500 across types | **919 is far above a male singing range,** unverified per type |
| Female vocal | low 245 | As above | Low end looks high, unverified |

Not checked: drums' other spans, the sound-word bands (subjective anyway), harmonic ends, alto sax, guitar, organ.

The notes are the part a reader takes literally, so the mismatched note and number pairs are the first thing to fix.

## What I couldn't verify

- **AES papers:** 8867, 8994, 9382, 9840, 9841, 9919, 22281, 22696, 22928, 23068, 23157. The AES site returned 403, and full text is paywalled or blocked. Details come from Olive's 2022 article (read in full), Listen Inc's note (read in full) and snippets.
- **Where AutoEq's target numbers came from** (digitized, or given by Harman). The latest commit on those files is only a reformat, and I didn't dig further back. It matters for trust and for licensing.
- **Who else's target has numeric data:** nothing public found for The Headphone Show, Crinacle or SoundGuys. Absence in my search isn't proof.
- **Rtings' research pages:** rendered as navigation only, so those claims are from snippets. The terms page I did read.
- **Crinacle's and Headphones.com's data terms and rig details,** and oratory1990's Reddit list directly (blocked; mirror comments only).
- **Equalizer APO when running:** its source was read through a mirror, and not run here. The IEC 60318-4 and ISO 226 standards themselves.
- **Real-device clipping,** by rule. **How well any of this sounds:** Levan's to judge.
- **Legal advice:** this isn't. Terms were read for what they say.
- **Not researched:** an amp's output impedance interacting with a headphone's impedance curve, which also moves a real response.
