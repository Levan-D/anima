# Third-party notices

## Preference ratings and 32 magnitude frequency response curves

The numbers in `src/shared/preferenceRange.ts`, shown as "Preference range (SenseLab data, ours)", are derived from:

Gabriele Ravizza, Julián Villegas, Christer P. Volk and Tore Stegenborg-Andersen, "Preference ratings and 32 magnitude frequency response curves", version 1.0, Zenodo, 2023, https://doi.org/10.5281/zenodo.8388242, licensed under the Creative Commons Attribution 4.0 International license, https://creativecommons.org/licenses/by/4.0/. Its companion paper is "An over-ear headphone target curve for Brüel & Kjær head and torso simulator type 5128 measurements", Proc. 155 Audio Eng. Soc. Conv., October 2023.

**Changed:** this project selected 11 of the 32 curves from the ratings, aligned them over 300 Hz to 3 kHz, and took their lowest and highest values from 100 Hz to 10 kHz. The original files aren't included. The method is in `docs/research/headphone-eq.md`. The dataset is offered as is, with no warranties, as the license sets out. Its authors didn't make this range and don't endorse it or this project.

## AutoEq

`src/shared/headphoneCorrection.ts` and `src/shared/headphoneMatch.ts` are reimplemented from `autoeq/frequency_response.py`, `autoeq/peq.py` and `autoeq/constants.py` of [AutoEq](https://github.com/jaakkopasanen/AutoEq) at commit 7ae0f56d53074872b028649617a22bbb4232feb7. This notice covers that code only. AutoEq's measurements, targets and results aren't in this repo, and its owner has said the license was never meant to cover them.

```
MIT License

Copyright (c) 2018-2022 Jaakko Pasanen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Noto Music

The treble clef in the app's icon, `build/icon.ico` and `resources/icons/app.png`, is drawn from the Noto Music font by `scripts/make-app-icon.mjs`. Copyright 2022 The Noto Project Authors (https://github.com/notofonts/music), licensed under the SIL Open Font License, Version 1.1, https://openfontlicense.org. The font itself isn't in this repo.

## Vercel React Best Practices

`.claude/skills/vercel-react-best-practices/` is Vercel Engineering's agent skill from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/react-best-practices`), included unchanged. It's a guide for the coding agent and isn't part of the app. Its `SKILL.md` declares `license: MIT` and `author: vercel`; the upstream repository has no license file or copyright line of its own.
