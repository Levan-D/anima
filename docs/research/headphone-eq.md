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

Stage 6 is built too: see "Match to target". Built before it: stages 1 to 4 and both additions below. See PLAN, "Headphone measurements". AutoEq is pinned at 7ae0f56 (2025-07-20): rig names come from its `dbtools/squig_crawler.py`, `oratory1990_crawler.py`, `innerfidelity_crawler.py` and `headphonecom_crawler.py`, and `measurements/crinacle` holds only a name index. Some of the index's Rtings entries are only in a lower-case `rtings` folder, so both are tried.

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
| Senselab/Aizu | 5128, [Ravizza et al. 2023](https://aes2.org/publications/elibrary-page/?id=22281) **[snippet]** | Yes, [32 curves and every rating](https://zenodo.org/records/8388242) **[read]** | CC BY 4.0. See "Preference range" |

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

**Correction to step 2 [run]:** AutoEq's results also use `min_mean_error`, shifting the target by the mean error from 100 Hz to 10 kHz. On the HD 660 S that's −1.43 dB, which is the constant between its CSV's `target` column and the target file. Without it the preset's miss reads 1.47 dB at 100 to 1k, not 0.10. The offset doesn't change the sound, only where a cap on boost falls.

**Why narrow highs are unwise:** a narrow treble peak on the rig sits somewhere else on a real head (table above, and Lindau 2010), so correcting it digs a notch where nothing was wrong. Step 4 and the 10 kHz averaging are AutoEq's guards against that. Dips get protected for a related reason: filling one takes a boost at a frequency that may not need it.

### Does 10 bands suffice?

Yes, with shelves. It's what AutoEq outputs for most apps, and the first five filters already do most of it. Sennheiser HD 660 S, oratory1990 preset, filter sum against AutoEq's `equalization` **[run]**:

| | 20–100 | 100–1k | 1–6k | 6–10k |
|---|---|---|---|---|
| 5 filters, rms (max) dB | 0.22 (0.52) | 0.16 (0.43) | 0.52 (1.10) | 0.69 (1.46) |
| 10 filters, rms (max) dB | 0.22 (0.52) | 0.11 (0.23) | 0.28 (1.01) | 0.55 (1.23) |

Fit error is well under the measurement's own uncertainty. More bands would chase noise. One headphone, so this is an example, not a proof.

The final miss against target for that preset, `raw + parametric_eq − target`, rms (max) **[run]**: 2.70 (6.30) at 20–100 Hz, because of the +6 dB cap; 0.10 (0.23) at 100–1k; 0.43 (1.61) at 1–6k; 2.21 (5.08) at 6–10k; 2.85 (7.33) above 10k, by design. So even a perfect preset doesn't land on the line, and the display shouldn't imply it does.

## Match to target

Our own fit, built 2026-11-02. It's stage 6: the button fits one measurement to one target and Bass, with the listener's settings. The preset stays as it was.

**License [read]:** [`LICENSE`](https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/LICENSE) at the pinned commit 7ae0f56 is MIT, (c) 2018-2022 Jaakko Pasanen. So the code may be ported with the notice, which is `THIRD_PARTY_NOTICES.md` and ships with the installer. No AutoEq data is in the repo: it only runs on what the user fetched.

**What was read at that commit [read]:** `autoeq/frequency_response.py` (`interpolate`, `center`, `compensate`, `_smoothen`, `equalize`, `protection_mask`, `limited_ltr_slope`, `find_rtl_start`, `process`, `_optimize_peq_filters`), `autoeq/peq.py` whole, `autoeq/constants.py`, `autoeq/utils.py`. SciPy's source wasn't read: `savgol_filter` and `find_peaks` are written from memory of what they do, and what makes that safe is the comparison in the next line.

**The port is exact where it can be checked [run]:** `correctionCurve`, fed AutoEq's own `raw` and `target` columns for the HD 660 S, against its `equalization` column: **rms 0.005 dB, worst 0.07 dB at 6.8 kHz**, where the file rounds to 0.01 dB. One headphone.

**What differs from AutoEq, on purpose:**

- **The minimizer.** SLSQP isn't here, so it's Levenberg-Marquardt inside the bounds, with the same residuals and starting point, scored through `curveDb`. Deterministic: nothing random, repeat runs are identical.
- **Alignment:** the rule on screen, 300 Hz to 3 kHz, so what's fitted is what's drawn. The offset from AutoEq's is 0.87 dB on this pair, and it's why the two columns below are each read in their own alignment.
- **The cap holds on the fit,** not just on its aim, through a penalty on going over and a last trim of the low shelf. AutoEq's preset reaches +6.32 dB where its aim stops at +6, so ours misses the deep bass by a little more. That's the one place it's worse: 2.84 against 2.70 at 20 to 100 Hz.
- **A small price on peak gain,** so spare peaks fade out rather than sit as a boost and a cut fighting. It moves the table by about 0.01 dB.
- **Bass is added after the seal's share,** since it's a preference and the seal says nothing about it, and it's under the cap like the rest.
- **Low-end settings only move bands at 500 Hz and under,** from the fit without them, so a change in the bass doesn't send the treble somewhere else. Unfrozen, a +2 dB limit moved 6 to 10 kHz by up to 1.26 dB. Frozen, it moves it by 0.00.

**Result, HD 660 S (oratory1990, GRAS 43AG), Harman over-ear 2018, rms (max) dB, 44.1 kHz [run].** The preset's first row reproduces the numbers in "Does 10 bands suffice?" exactly: 2.70 (6.29), 0.10 (0.24), 0.43 (1.60), 2.21 (5.09), 2.86 (7.36), when read in those bands.

| Measured + EQ against target | 20–100 | 100–500 | 500–2k | 2–6k | 6–10k | 10–20k |
|---|---|---|---|---|---|---|
| AutoEq's preset, its alignment | 2.70 (6.29) | 0.12 (0.24) | 0.17 (0.47) | 0.51 (1.60) | 2.21 (5.09) | 2.86 (7.36) |
| Our fit, same alignment | 2.84 (6.74) | 0.10 (0.20) | 0.06 (0.13) | 0.51 (1.52) | 2.27 (4.88) | 2.90 (7.53) |
| AutoEq's preset, the app's alignment | 3.32 (7.16) | 0.92 (1.11) | 0.84 (1.07) | 1.12 (2.46) | 2.81 (5.95) | 2.77 (6.49) |
| **Our fit, as the button does it** | 3.37 (7.50) | 0.04 (0.09) | 0.07 (0.17) | 0.42 (1.37) | 2.87 (5.86) | 2.98 (7.66) |

Every miss above 6 kHz and in the deep bass is the method: the cap, and the refusal to chase the treble. Fit time on this machine is about 400 ms in Node and about 1 s from press to applied with a setting away from default, so it's in a worker with a loading state. The 96 kHz curve of the same bands differs from 44.1 kHz by up to 1.32 dB above 10 kHz, as any preset does.

### What limits low-frequency boost

The short answer: **nothing published lets a spec predict it.** This is what was found, and how thin it is.

- **Excursion and displacement limits, loudspeakers.** Klippel defines a peak displacement limit from measured distortion, per driver, and AES2's older definition has known problems ([AN 04](https://www.klippel.de/fileadmin/_migrated/content_uploads/AN_04_Peak_Displacement_Xmax.pdf), [AN 05](https://ty3.klippel.de/fileadmin/klippel/Files/Know_How/Application_Notes/AN_05_Displacement_Limits.pdf), **[snippet]**: the PDFs didn't read here). It's measured on the driver, not read off its size. **Not found for headphones:** any measurement of diaphragm excursion against level and frequency.
- **Pressure chamber.** Poldy's AES tutorial treats a headphone at low frequencies as a pressure chamber, with leakage as what breaks it ([AES 120 tutorial, unofficial copy](https://es.scribd.com/document/97905157/Aes-Tutorial-48-Headphone-Fundamentals), **[snippet]**). So how much excursion a boost costs depends on the seal as well as the driver. No numbers for that were read.
- **Whether it matters at listening levels.** Temme, Olive and others equalized five headphones to one response and asked about distortion and preference; Rtings' summary is that high multitone distortion didn't reliably mean worse ratings ([AES 2014](https://aes.org/publications/elibrary-page/?id=17441), via [Rtings](https://www.rtings.com/headphones/learn/research/distortion-audibility), **[snippet]**). Olive and Lelièvre 2026 found THD correlated best with detection thresholds, and a report of that talk disagrees with its author about what follows ([AES 10263](https://aes.org/publications/elibrary-page/?id=23209), [report](https://positive-feedback.com/show-reports/aes-european-conference-copenhagen-2026/), **[snippet]**: AES blocks the text). Rtings' own listening tests are headlined that most of it is inaudible, but the page wouldn't render here. None of these is about boost by EQ.

**Driver size, which Levan asked about: no sourced relationship found.** Retailers list 20 to 50 mm and explain nothing with it, and no source links diameter to low-frequency distortion or a usable limit. So it has no field. **Planar against dynamic:** Stereophile's plots show low bass distortion on some planars, and a forum post says most dynamics rise under 100 Hz ([HE1000 measurements](https://stereophile.com/content/exceptionally-pleasing-hifiman-he1000-planar-magnetic-headphone-measurements), [Head-Fi](https://www.head-fi.org/f/threads/headphone-drivers-and-performance-differences.842922/), **[pointer]**). Individual examples and vendor explanation, not a study. So no field either. Sensitivity and impedance: nothing found at all.

**THD as data: no.** Rtings publishes weighted THD and graphs at 94 and 104 dB SPL ([method](https://www.rtings.com/headphones/tests/sound-quality/harmonic-distortion), **[snippet]**), and its terms forbid reproduction (read above). Stereophile prints THD+N plots at 90 and 100 dB as images. Low levels there can be mostly noise floor, and a measurer in the field argues THD alone doesn't quantify what's perceived ([Headphone Test Lab](https://www.c3514832.myzen.co.uk/words-additional-content-headphone-distortion-measurement), **[read]**). A person can look at one and form a view, which is what Bass handling is for. There's nothing here to feed a fit.

**What's still open:** the AES full texts, the Handbook's Poldy chapter, and any measured excursion on a headphone.

### Match settings

Three made it, per measurement, and each visibly moves the curve. Numbers are that same pair and target. "Moves" is rms (max) against the default fit.

| Setting | Choices | What it does | Where it comes from | Moves 20–100 | Moves elsewhere |
|---|---|---|---|---|---|
| **Bass handling** | Little +3, Some +6 (default), Well +10, or any value from 0 to +12 | The most boost under 100 Hz, easing over the octave above into the general +6 | **+6 is AutoEq's default. +3 and +10 are a judgement call,** since nothing above supports a number | +2: 3.56 (4.11). +10: 2.32 (3.97) | +2: 100–500 0.09 (0.30), 0.00 above 500 |
| **Fit or seal** | Open (default) 100%, Seals well 75%, Varies 50% | How much of the correction under 100 Hz is kept, easing back to whole by 200 Hz | **The ordering comes from "How far to trust it" and Lindau: open is safest, a closed pair that varies the least safe. The percentages are a judgement call** | 75%: 0.82 (1.50). 50%: 1.71 (2.54) | 100–500 up to 0.42 (1.11) |
| **Correct up to** | 2 kHz, 6 kHz, 10 kHz (default) | Fades the correction out over half an octave above. At 10 kHz nothing fades, and AutoEq's mean above 10 kHz does the job | The rows of "How far to trust it" | | 6 kHz: 6–10k 4.10 (5.40). 2 kHz: 2–6k 1.76 (2.97), 6–10k 5.27 (5.98) |

**The crossover is 100 Hz with a one octave handover.** 100 Hz is the line in the trust table, and where AutoEq's own bass shelf sits (105 Hz). The handover is steeper than nothing but under the 18 dB per octave limit at any setting, so the cap puts no step in the correction. A judgement call, like the table it's from.

**A low limit, before and after, rms (max) against target [run]:**

| | 20–100 | 100–500 | 500–2k | 2–6k | 6–10k | 10–20k |
|---|---|---|---|---|---|---|
| Default, +6 | 3.37 (7.50) | 0.04 (0.09) | 0.07 (0.17) | 0.42 (1.37) | 2.87 (5.86) | 2.98 (7.66) |
| Limit +2 | 6.51 (11.58) | 0.07 (0.25) | 0.07 (0.17) | 0.42 (1.37) | 2.87 (5.86) | 2.98 (7.66) |
| Limit +10 | 1.22 (3.53) | 0.05 (0.14) | 0.07 (0.15) | 0.42 (1.37) | 2.87 (5.86) | 2.98 (7.66) |

Limit +2 peaks at +1.97 dB under 100 Hz, at 44.1, 48 and 96 kHz, and through the real Player. That error is the point of the setting: it asked for less.

**Bass runs into the limit, and that's worth knowing.** On this pair at Bass +4, 30 Hz doesn't move at the default limit, since it's already at the cap (−0.05 dB), and 50 Hz neither, with +1.3 at 70 Hz and +2.2 at 100 Hz, where the shelf is half up anyway. At limit +10 it's +3.5 at 50 Hz and +3.1 at 70 Hz, though still +0.5 at 30 Hz, where the error is bigger than even that limit. Above 400 Hz it's 0.06 dB or less. So the slider says "raise Bass handling if Bass seems to do little" in the text beside it.

**Tried and left out:**

- **How exact, as bands:** 5 bands misses 500 to 2k by 0.78 against 0.07, and 7 bands is within 0.1 of 10 everywhere. Nothing's gained from fewer: 10 costs nothing here.
- **How exact, as smoothing:** 1/6 and 1/3 octave move the fit by at most 0.07 dB rms, so it's a control that does nothing. Only a full octave changes anything, halving the cut at 5.5 kHz (2–6k 1.10 (2.84) against 0.41). One feature on one pair isn't a reason for a control.
- **Driver diameter, planar or dynamic, sensitivity, impedance, THD:** above.

**Not known:** whether any of the three is right for a given ear. They only do what they say to a curve. In another headphone's data, the cap or the seal may have less to do, and on a pair that needs no bass boost, Bass handling does nothing.

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
- **The bundled mpv** (FFmpeg git-2025-12-21), impulse through the HD 660 S preset: within 0.004 dB of `curveDb` at 44.1 kHz, 0.02 dB at 96 kHz **[run]**. The worst is at 20 Hz, probably my analysis window. Later, each kind of band through the whole Player at 44.1, 48, 96 and 192 kHz: ffmpeg's default of 32-bit float missed by up to 0.15 dB on a low shelf at 192 kHz, and with `r=f64` on each band, as the chain now does, everything is within 0.01 dB from 40 Hz up **[run]**.
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
3. **Band above Nyquist.** Fixed. `af_biquads.c` bypasses a filter with `w0 > π` with only a warning at setup **[read]**, and that's what happens **[run]**: peak, low shelf and high shelf above Nyquist all pass a tone through within 0.02 dB, no samples lost, on 32, 22.05 and 11.025 kHz files (`player.nyquist.bytes.test.ts`). Exactly on Nyquist it isn't bypassed: top and bottom of the filter cancel, so a low shelf is its full gain everywhere, and a peak or a high shelf does nothing **[run]**. `curveDb` now agrees with both, the curve stops at the file's Nyquist, and the band's node dims and its editor says it's inactive. Three files in this library have such a low rate. The headroom still counts the band at the rates where it's active, since the chain is the same for every file.
4. **`LS`/`HS` with no Q** in `apoFile.ts` got Q 0.707, a guess. Fixed: it's S = 0.9, from APO's source, above. The old guess was off by 0.16 dB at 6 dB. Slope forms like `LSC 10.8 dB` and `LS 12dB` fail to parse, so the whole file is refused rather than misread, which is right.
5. **Not a bug, but worth knowing:** auto preamp on this preset is −7.5 dB where the file says −6.3: ours takes the peak across the rates, which is −6.5, and adds the margin from "Clipping". Importing keeps the file's value as a manual preamp, so that preset then shows "may clip by +1.2 dB".
6. **Clamp at ±12 dB.** AutoEq's filters may go to ±20. Import clamps and reports it, so a clamped preset no longer matches its curve. Worth keeping visible.

### Clipping: a peak-based preamp isn't enough

`preampDb` guarantees the **magnitude curve** stays at or below 0 dB. That isn't a limit on sample peaks: a filter can raise peaks by rearranging phase even with |H| ≤ 1. The true bound is the sum of |h[n]| (L1 norm).

- L1 bound after preamp **[run]**: HD 660 S preset **+5.59 dB**; +6 dB peak +1.16; +6 dB shelf +0.48. **A pure cut, with preamp 0, still has a bound: −6 dB peak Q 1 is +3.98 dB, −7.3 dB at Q 4.4 is +4.00 dB.** This worst case needs a signal shaped to exploit it, so music gets nowhere near.
- Real music **[run]**: first 90 s of 32 tracks from `D:\Music` (read only), HD 660 S preset, preamp −6.5 dB: **3 of 32 went over 0 dBFS, worst +0.37 dBFS.** Mean peak change −2.9 dB. Sample peaks only, no inter-sample peaks. It's a small spread-out sample, not the library.
- The chain runs in float: mpv's log shows `[lavfi] float` after the `volume` filter, including at 0 dB **[run]**. Nothing clips inside. Overs reach the output stage, whose behavior on a real device I didn't test, per the no-sound rule. Plausibly a hard clip when converted to a device's integer format.
- **Without `volume` first, the biquad stayed in s16** on a 16-bit FLAC **[run]**. `chainSpec` always puts `volume` first, so this is fine today, but it's load-bearing and isn't stated anywhere. Add a test or comment.
- `eqCurve.ts` said "Automatic headroom never gets there", and the UI only showed "may clip" with a manual preamp. True of the curve, not of the signal. Fixed.

**Done, with the numbers.** 420 whole tracks from `D:\Music` (read only), through ffmpeg with the same filters, in float, sample peaks, chosen to spread rather than to be typical: 63 genres, 122 FLAC at 44.1 kHz, 52 at 48, 53 at 88.2, 48 at 96, 33 at 192, 76 MP3 at 44.1, 33 at 48, 3 lower. 278 of them already peak within 0.5 dB of full scale, so this library's masters leave no room. **Over by the source itself, before any EQ: 62 of the 112 MP3s, by up to +2.05 dBFS**, because MP3 decodes past full scale and that's nothing to do with us. No FLAC. Each cell below is how many of the 420 pass 0 dBFS after the curve with the curve's own top brought to 0 dB, plus the margin:

| Curve | Preamp at margin 0 | Margin 0 | 0.5 | 1 | 1.5 | 2 | Worst over at 0 |
|---|---|---|---|---|---|---|---|
| HD 660 S AutoEq preset | −6.50 | 18 | 7 | 1 | 0 | 0 | +1.08 |
| AutoEq-like IEM, 10 bands | −4.20 | 17 | 2 | 0 | 0 | 0 | +0.98 |
| Low shelf +6 | −6.00 | 6 | 1 | 0 | 0 | 0 | +0.70 |
| Low shelf +12 | −12.00 | 0 | 0 | 0 | 0 | 0 | −0.43 |
| High shelf +4 | −4.00 | 3 | 0 | 0 | 0 | 0 | +0.34 |
| High shelf +12 | −12.00 | 0 | 0 | 0 | 0 | 0 | −1.13 |
| V shape, +6 / −3 / +6 | −6.00 | 9 | 1 | 1 | 0 | 0 | +1.16 |
| Peak +6, Q 1 | −6.00 | 5 | 0 | 0 | 0 | 0 | +0.25 |
| Peak +12, Q 4 at 8 kHz | −12.00 | 0 | 0 | 0 | 0 | 0 | −2.77 |
| **Cut only:** −7.3 dB, Q 4.4 | 0 | **210** | 118 | 49 | 22 | 4 | **+2.47** |
| **Cut only:** −6 dB, Q 1 | 0 | **178** | 116 | 60 | 24 | 5 | **+2.69** |
| **Cut only:** −3 dB at 300 Hz | 0 | **192** | 104 | 29 | 8 | 1 | **+2.27** |
| **Cut only:** low shelf −12 at 60 Hz | 0 | **261** | 232 | 202 | 167 | 134 | **+4.09** |

**The surprise is the cuts.** A cut with no preamp went over on about half the library. Boosts bring so much down with them that 1 dB is plenty, and a cut brings nothing down. So one fixed margin would either miss the cuts or cost every boost level it doesn't need.

**The rule chosen: the curve's top plus 1 dB, and at least 2 dB down.** A curve whose top is 1 dB or more gets a margin of 1 dB, and a cut or a tiny boost gets 2 dB. On the same 420 tracks and 13 curves, that leaves 12 of 5,040 pairs over, leaving out the deep bass cut. The worst is +0.69 dBFS, and the worst tracks counted have 1 to 9 samples over in a whole track, in runs of 1 or 2. 5 of those 12 have a source already over.

**What it doesn't cover: a deep cut in the bass.** The −12 dB low shelf at 60 Hz still has 134 of 420 over, up to +2.09 dBFS, with 19,526 samples over on one track, in runs of up to 112. That's what taking bass out of a limited master does. Bring the preamp down by hand for a curve like that.

Nothing here is a guarantee, in the code or on screen. These are sample peaks of this sample, and inter-sample peaks would be higher. There's no limiter, since it's non-linear and adds delay. Auto says "Room for most music, not a guarantee", and "may clip" by hand now means how much less room it leaves than Auto would.

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

## Preference range

Built 2026-11-02 from an open dataset, as an in-house band. Headphones.com's GraphWorks bounds weren't looked at: its terms forbid copying them and nothing here comes from them. **Verdict: honest from 100 Hz to 10 kHz, for an over-ear on a 5128, as "these curves were rated about as well as the best". Not honest in the bass, not above 10 kHz, and never as a score.**

**Source [read]:** [Zenodo 8388242](https://zenodo.org/records/8388242), CC BY 4.0, both files whole, md5 matching the record. The companion paper (AES 155, paper 127) **wasn't read**: AES returns 403. What it did comes from the record and from [SoundGuys' account](https://www.soundguys.com/soundguys-headphone-preference-curve-validated-in-aes-paper-102536) **[read, secondary, and it has an interest: its curve is in the test]**. All numbers below are **[run]** on the two CSVs, with assessor means as the unit (56 by 32).

**What the curves are**

- Eardrum responses on a B&K 5128C, each moved so its peak is about 0 dB, as 30 third-octave gains. They aren't diffuse-field compensated: the `DF5128` row is itself the DF shape, up 12.9 dB from 500 Hz to 3.2 kHz. So a raw 5128 measurement goes straight against them, with no DF reference at all. The peak normalising carries no meaning, since stimuli were loudness matched to BS.1770, so curves here are re-aligned by the app's 300 Hz to 3 kHz rule.
- `HP1`-`HP8` are eight closed over-ears measured on the 5128, `Mod1` and `Mod2` are hand-made edits of each, `AvgAllmeas` their average. `DF5128` and `FF5128` are the rig's fields. `Soundguys` and the four `APHarm` rows are from the literature. `APHarm` is translated by the authors, method not known to me: `APHarm2018` runs 3.6 dB above AutoEq's Harman 2018 at 6 to 10 kHz and up to 11.5 dB at 16 kHz. It isn't the same curve.
- All were played on one DT 770 Pro through a 30-band EQ, per SoundGuys. So nothing narrower than a third octave was tested, and no open headphone was.
- **Flaws.** `HP6` and its two mods have +17.3 at 20 kHz, between −17.3s. 23 of 32 rows have 16, 20 and 25 kHz equal and 31 have 20 and 25 kHz equal, so the top is filled in and it can't be told whether 16 kHz was measured. `Soundguys` has 0.0 at 25 kHz. One row is spelled differently in each file.

**The ratings.** 16,128: each of 56 assessors (30 DK, 26 JP) rated every curve once per song, on 9 songs (7 shared, 2 local to each country), in pages of 8. Every one of the 2,016 pages has a 0 and a 100, and curves are shuffled across pages (1,980 distinct groupings, every pair met 88 to 142 times). So ratings are relative within a page, with no absolute meaning, and no curve was ever repeated on a song: **a true test-retest isn't possible.** Whether the 0 to 100 was an instruction or a rescale isn't known, though the 0.22 steps suggest raw slider positions. Ranks within a page agree with the scale (Spearman 0.995).

**Are differences real? Yes, at panel level.** Repeated-measures F(31,1705) = 36.4, p < 1e-160, partial η² 0.40. Split-half panels of 28: median r 0.96, worst 0.88. ICC(3,k) 0.97, and ICC(3,1) only 0.39: one person's opinion says little. One assessor across songs (4 against 5): median r 0.51, 14% under 0.2. Assessor against the rest: median r 0.67, 3 of 56 negative. **DK against JP:** r 0.93, mean difference 3.2 points, largest 15.7, interaction permutation p 0.16. Not separate groups, by this test.

| Curve | Mean | 95% CI | SD across assessors | | Curve | Mean | 95% CI |
|---|---|---|---|---|---|---|---|
| APHarm2018v2 | 62.7 | ±3.2 | 11.8 | | HP5 | 56.7 | ±3.0 |
| HP3Mod1 | 62.4 | ±5.5 | 20.6 | | HP1 | 55.8 | ±3.5 |
| HP3Mod2 | 61.5 | ±4.8 | 17.8 | | APHarm2015 | 55.6 | ±3.2 |
| APHarm2018 | 61.0 | ±3.3 | 12.4 | | DF5128 | 44.7 | ±5.0 |
| HP3 | 60.8 | ±4.9 | 18.3 | | HP7 | 39.0 | ±4.6 |
| AvgAllmeas | 60.6 | ±3.1 | 11.7 | | HP8 | 30.5 | ±4.0 |
| HP1Mod2, HP2Mod2, HP2, Soundguys | 58.8 to 58.2 | ±3.3 to 3.8 | | | FF5128 | 24.7 | ±4.7 |

**The method, and the pass marks, were fixed before the first run.** A curve qualifies if a paired t test against the top curve on assessor means isn't significant at .05, Holm-corrected over 31. The band is the min and max per third octave of qualifying curves. Six tests had to pass: real differences, at least 5 curves from 3 families, excursion from a leave-one-out band predicting rating, narrower than random sets of curves in at least half the ranges, stable under bootstrap, and under 6 dB wide from 100 Hz to 6 kHz.

**Result:** 11 qualify: APHarm2018v2, HP3Mod1, HP3Mod2, APHarm2018, HP3, AvgAllmeas, HP1Mod2, HP2Mod2, HP2, Soundguys, HP5. Seven families, with most edges set by curves from headphones: HP3 and its mods and HP5 most of all. Within 100 Hz to 10 kHz, 7 of 42 edges come from a literature curve. Median width (largest) in dB:

| | 31–100 | 100–500 | 500–2k | 2–6k | 6–10k | 10–16k |
|---|---|---|---|---|---|---|
| **The band** | 9.3 (10.3) | 3.3 (4.4) | 2.5 (3.7) | 4.2 (8.3) | 5.7 (5.9) | 8.3 (16.6) |
| Random 11 curves, median | 9.3 | 6.8 | 3.4 | 7.5 | 5.2 | 15.0 |
| Share of random sets as narrow | 0.59 | 0.003 | 0.013 | 0.001 | 0.77 | 0.026 |
| Bootstrap 5 to 95% | 4.0–9.3 | 3.0–3.7 | 1.5–2.6 | 4.1–6.7 | 3.3–5.9 | 5.4–10.8 |
| Without HP5 | 5.0 | 3.2 | 2.1 | 4.2 | 5.1 | 7.6 |
| Same rig, two labs, mean difference | 2.8 | 1.3 | 1.0 | 1.9 | 2.8 | 4.9 |

The last row is the HypetheSonics and Rtings 5128 sets, 4 headphones in both, which is few, and the QuietComfort alone reaches 8.3 at 6 to 10 kHz. Other alignments move the band's widths by up to 2 dB (2–6k: 4.2 to 6.1). Nothing is known from 16 to 20 kHz, nor below 31 Hz.

**How well it passed.** All six, two of them barely. Leave-one-out excursion against rating at 100 Hz to 10 kHz: Spearman −0.83. But being inside isn't enough: 10 of the 21 significantly worse curves leave it by under 1 dB rms, and HP5Mod1 and HP5Mod2 stay wholly inside at about 54. HP5 itself qualifies in 54% of bootstraps, and the set is 6 to 16 curves (5 to 95%). 6 curves qualify in at least 94%.

**Where it was cut, after seeing the result, and said so here.** These are judgement, and tighter than the rule asked.

- **Below 100 Hz: not drawn.** The selection is no narrower than chance (0.59), level there has r 0.01 to 0.11 with rating, and HP5 alone sets the low edge at 31 to 50 Hz. A shape here would tell people their bass is outside something the data doesn't support.
- **Above 10 kHz: not drawn.** The file's flat top, HP5's −21.6 dB fill at 16 kHz making 16.6 dB of width, and the plot already refuses this region.
- **6 to 10 kHz: drawn and fading**, though it also fails against chance (0.77). Level at 8 to 12.5 kHz does track rating (r 0.30, 0.46, 0.50), which is also the paper's reported finding, and the range is about twice the same-rig spread. A closer call than the bass, and a reasonable person could stop at 6 kHz.

**Against Harman and Olive.** `APHarm2018` is inside, as it qualified. Against a band without itself, it's out by 0.7 dB at 80 Hz and 0.1 dB at 400 Hz. Against Olive's classes the bass **disagrees**: at 31 to 80 Hz the band runs from 7.3 dB under `APHarm2018` to 0.6 over, with no room for the 15% wanting 4 to 6 dB more, and more room than the 21% wanting 2 dB less. That's no refutation. Nothing tested goes above +3.3 dB, and the highest (HP7Mod1) is on a poorly rated curve. Bass against rating over 32 curves: r 0.07. Per assessor: 7 significantly positive, 5 negative, of 56. The clean paired edits lean against more bass: HP1Mod1 +6 dB, −5.4 points. HP7Mod1 +3 dB, −13.8. HP3Mod1 −3 dB, +1.6. That's a third reason not to draw it, and why the Bass slider doesn't move the band.

**Rigs.** At the pinned commit, 102 of 2,922 over-ear entries in AutoEq's index are on a 5128 (3.5%): 69 Rtings and 33 HypetheSonics, or 98 of 2,062 names. `update_result_indexes.py` tags HypetheSonics' over-ears as 5128 **[read]**. Levan's stored HD 660 S is oratory1990's on GRAS 43AG, which `rigMatch` calls different, so it stays off. His AirPods Pro 2 is correctly tagged 5128 from Rtings' folder, but it's an in-ear, and only over-ears were rated. **HypetheSonics has the HD 660 S on a 5128**, and it's fetched by the app's own search. Against it, third octave: inside within 0.7 dB from 100 Hz to 4 kHz, 3.5 dB under at 5 kHz, 1.2 dB under at 6.3 and 8 kHz. One unit, and it's an open headphone where the curves are mostly closed.

**Diffuse field references, for the record.** The band needs neither. If something later does, `DF5128` in this file is licensed and could be bundled, but it's third octave, peak-normalised, flat above 16 kHz, and credited to B&K per SoundGuys, so its authors' license may not settle its origin. AutoEq's `Diffuse field 5128` is finer and has no stated terms. They agree within 1.3 dB to 100 Hz, 0.8 to 2 kHz, 1.9 to 10 kHz, then 3.7 at 16 kHz: a fetched AutoEq curve is the better reference, this row the one that can ship.

**License [read].** [CC BY 4.0 §3(a)](https://creativecommons.org/licenses/by/4.0/legalcode) asks for the creators, any copyright notice given (the record has none), a license notice, a warranty disclaimer notice and a link, and for adapted material, a statement that it was changed. §2(a)(6) forbids implying endorsement. All of this is in `THIRD_PARTY_NOTICES.md` and short form on screen. The raw files stay in `.dev/preference/`, and the app never fetches them. **Not settled, and I'm not a lawyer:** the file's license can't grant more than its authors held in the Harman and SoundGuys curves they included, and 7 band edges take those rows' values. They're min and max points, not the curves, but it's a reason to keep those rows out of the repo.

**In the app.** `src/shared/preferenceRange.ts` holds 21 points. A grey shape, hidden in Difference, off for any other rig or form with why. It feeds nothing: Match to target doesn't read it, and no number comes from it.

**What would change this:** bass variants at +3 to +6 dB on already-preferred curves would allow a bass range. Curves from open headphones would widen who it covers. The paper's text, for what `AP` means and how the curves were rendered, might change the description but not the numbers. **Not checked:** the paper itself, playback level, listeners' hearing, and whether preferring a third-octave curve on a DT 770 carries to the same response on another headphone.

## What I couldn't verify

- **AES papers:** 8867, 8994, 9382, 9840, 9841, 9919, 22281, 22696, 22928, 23068, 23157. The AES site returned 403, and full text is paywalled or blocked. Details come from Olive's 2022 article (read in full), Listen Inc's note (read in full) and snippets.
- **Where AutoEq's target numbers came from** (digitized, or given by Harman). The latest commit on those files is only a reformat, and I didn't dig further back. It matters for trust and for licensing.
- **Who else's target has numeric data:** nothing public found for The Headphone Show, Crinacle or SoundGuys. Absence in my search isn't proof.
- **Rtings' research pages:** rendered as navigation only, so those claims are from snippets. The terms page I did read.
- **Crinacle's and Headphones.com's data terms and rig details,** and oratory1990's Reddit list directly (blocked; mirror comments only).
- **Equalizer APO when running:** its source was read through a mirror, and not run here. The IEC 60318-4 and ISO 226 standards themselves.
- **Real-device clipping,** by rule. **How well any of this sounds:** Levan's to judge.
- **Legal advice:** this isn't. Terms were read for what they say.
- **Headphone excursion, and distortion under EQ boost:** see "What limits low-frequency boost". The AES papers and Rtings' pages were out of reach there too.
- **Not researched:** an amp's output impedance interacting with a headphone's impedance curve, which also moves a real response.

## Keeping AutoEq's curves

As of 2026-11-02 AutoEq's `targets` folder has 61 CSVs, about 550 KB **[run]**. Levan asked to keep them all rather than fetch one at a time. The first time the Headphones section opens, the app lists the folder at AutoEq's current head through GitHub's API and downloads each into app data. Refetch does the same, skipping any whose git blob id hasn't changed, and a curve AutoEq removes stays. Measurements and their presets stay pinned to `AUTOEQ_COMMIT`. AutoEq's data has no stated license, so nothing here is bundled, and the download still happens on this machine at the person's own request.

Five files aren't headphone targets and are skipped: `zero`, `711 5128 delta`, `All Harman Targets`, `Innerfidelity transformation 2016 to 2017` and `Harman loudspeaker in-room flat 2013`.

The rig is worked out from the file's name in `autoEqTargetInfo`, and this is the weak part. The original twelve were researched. The database prefixes (Rtings, Innerfidelity, Headphone.com Legacy, HMS II.3) are taken as HMS II.3, and Harman and oratory1990 curves as the family of rig only, with no exact model, since the 2013 to 2017 fixtures aren't confirmed here. Anything else comes back unknown, so it can be picked and isn't drawn against a measurement. That's Diffuse field ISO 11904-1, AutoEq in-ear and the JM-1 curves, and any curve added later.
