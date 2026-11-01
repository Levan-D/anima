# Design direction

A first pass for me to criticize. Very visual, minimal chrome, the art is the app. Think of a record sleeve on a dark shelf, not a dashboard. It should feel calm and expensive, with no card soup and no decoration for its own sake.

## The main view

```
┌────────────────────────┬──────────────────┐
│                        │ Library Radio … ⚙ │  ← same on every page, window controls float top right
│                        │ Albums …  search │
│                        ├──────────────────┤
│                        │                  │
│     ALBUM ART          │   the giant      │
│     full height,       │   media list     │
│     flush to edges     │                  │
│                        │                  │
│                        ├──────────────────┤
│                        │ Title            │
│                        │ Artist · Album   │
│                        │ ▁▂▅▇▅▃ waveform  │
│                        │ 0:01 / 2:51      │
│                        │ ⏮ ⏯ ⏭ ⏹ 🔊 ━ EQ ≡ │
│                        │ FLAC·96k ●   ⚡ ▣ │
└────────────────────────┴──────────────────┘
```

- **Art pane:** a square, full window height, flush left, top and bottom, with no radius, border or shadow. Capped so the list column keeps a usable width (at least about 36% of the window). When the window is too narrow or portrait, the art moves on top, up to about 45% of the height.
- **No art:** a calm gradient from the title's hash, with the album title set large. Never a broken image or a generic music note.
- **Pages:** one row at the top of every window, in the same place on every page and stopping short of the window controls, reaching over the art when the list column is too narrow to hold it: Library, Radio, Discover, then the Settings gear, lit on its page like the others. Library is the screen drawn above. Discover has no art pane and the whole width, with the transport lying flat at the bottom: track info at the left, the waveform in the middle, the controls at the right. A page keeps its state while it's away. Esc from another page goes to Library.
- **Settings:** a page, from the gear, Ctrl+, or anything that sends you to a tab, such as a toast's "See issues". No art and the whole width: the column of tabs at the left, a divider, the content in a column that stops at a readable width so a form doesn't stretch across a 4K screen, and the transport at the bottom as on Discover. A narrow window puts the tabs along the top. Esc or Back returns to the page you came from, and it's on the same tab next time. Whatever isn't obvious has one muted line under its label in plain words, and whatever goes online says that only names leave the machine.
- **Radio:** a centered column, with no on or off to it. Square art floating in the middle, smaller than the Library's, with what radio would play next to its right on the barrel of a revolver: smaller, on one big circle's arc, falling away in size and opacity, with the last one or two played faint on the left. A track change turns the barrel one step and nothing moves at rest. Pressing one plays it and makes radio what plays next. Under the art the one action there is: Play from here, or quietly Back to your queue once radio has taken over from one. Then the title and artist as links, the signal, the waveform, and the play controls in the middle of a row with everything else at its edges. Narrow, only the barrel's neighbours show, and the controls take a row of their own. Nothing lights on the tab beyond its being the current page.
- **Discover:** names of music I don't own, never anything to play, dressed in the sleeves of what I do own. A suggestion has no art or genre of its own, so it shows up to three covers of the owned artists who recommend it, closest in front, and takes its genres from them. Genre pills run along the top in order of how many suggestions each has, wrap to two lines and then scroll sideways, and any number can be on, with a Clear beside them. With none on, it's ranked rows in as many lanes as fit, each with a small overlapping stack, the name, "Because you like AC/DC, Aerosmith", and how many of my artists point at it. With some on, the best twelve become a carousel of big cards, the covers fanned out and spreading a little under the pointer, and the rest are compact rows under it. The line above says genres are inferred. Any row or card opens a modal with all that's held on it: the genres, labelled inferred; every artist of mine recommending it, strongest first in plain words, each opening that artist in the Library; and up to ten of its songs as text under "Songs to start with", each with the one or two of mine that led there, since none of them play.
- **Library's list column:** plain text tabs (Genres, Artists, Albums, Tracks, Playlists), opening on Albums, at the left and search, of the library only, at the right. Too narrow for both, search shrinks to its icon and takes its width back to be typed in, and the tabs scroll sideways. Drilling in (genre → artist → album) replaces the list, a step at a time, with a back control at the start of the page row, over the column. While the queue is showing, no tab is lit.
- **Transport:** bottom of the list column. Title in a real type size, with the artist and album under it as links to their pages, a waveform seekbar with the time as `0:01 / 2:51` at its left, and the controls: previous, play, next and stop, then mute, volume, the EQ and the Queue at the end. The Queue button or Q shows the queue in place of the list and lights while it does, and pressing again goes back to where the list was. The row under them has the signal on the left, in the smallest type, as `FLAC · 96 kHz` and a tiny dot. It's a feature, not a setting, so it lives here. The dot is green when bit-perfect, blue when altered on purpose (EQ, ReplayGain, volume), and gray when Windows is mixing, resampling or converting, which wins if both are true. Pressing it opens the whole line, `FLAC | 2856 kbps | 96000 Hz | stereo`, what's altering the sound, and a legend of the three in words with the current one marked. On the right of that row are Exclusive and Mini player, icons that light in the accent when on, with room for more to their left. In a column too narrow for a usable slider, only the volume and mute fold, into a menu on that row. The list fades out above it rather than being cut off.
- **Nothing played yet:** a calm surface and one small line, not a big "Nothing playing". The controls wait, in the places they'll be.
- **Over the art:** lyrics dim the art with a scrim and sit on top of it, large and centered, with the current line bright and the rest faded. While playing the text moves steadily so the live line stays around center; a wheel, swipe, drag or keys take over, and three seconds after they stop it eases back, or on play if it's paused. One small pencil at the foot opens a panel: the source in quiet words, − and + with the offset between them, reset and Save when they're synced, then search, load a file and clear on any track. The nudge previews live, and closing without Save drops it. With no lyrics, search and load are there right away. Tap the art for lyrics; swipe it for next and previous on touch.

## Look

- **Neutrals with zero chroma:** near-black background, true grays. The only color on screen comes from the album, with one exception: the signal dot's fixed green and blue, because they have to mean the same thing whatever the album looks like.
- **Album-driven accent:** the current art's color, adjusted for contrast, drives the seekbar, the active row and focus rings. A faint wash of it fades down the top of the list column. It changes smoothly on track change.
- **The waveform:** a solid shape mirrored around its center line, one column to a device pixel, like foobar2000's: lighter peaks around a darker average. Played is in the accent, the rest in muted grays, and silence is a thin line.
- **Type does the work:** Inter Variable, a clear scale, tabular numbers. Big confident now-playing title. Muted metadata.
- **Rows have no borders:** spacing and a subtle hover surface. An album card uses the same surfaces around it, and never touches the art's brightness. The playing row gets accent text and small animated bars that stop when paused. A selected row sits on the same surface as a pressed one, with no color of its own.
- **Corners:** art in lists gets a small radius. The main art gets none.
- **Focus:** a clear accent ring, big enough to see from a couch.

## Modals

The equalizer is one, from E and the transport's button. It fits without scrolling at 1280×800 and up. The switch sits beside the title, for comparing, and saying off dims the curve and says so there, never on the plot. The preamp is on the same row: Auto ticked by default, a stepped or typed value otherwise, and a small "may clip by +X dB" when the value can take the curve's peak over full scale. Under it, one row for the preset (a dropdown that starts with No EQ, an overflow menu, Save and Revert when the curve has been edited) and for adding a band and resetting; then the curve, as large as what's left allows, unboxed, with each node on the line and numbered left to right, renumbering as it crosses another; then the layer switches; then one row for the selected band, which says what its frequency is called ("627 Hz · Honk") and whose values can be stepped or typed.

The curve can be edited on the plot itself: double-click to add a band there, scroll over a node for its Q, right-click a node to delete it, Ctrl+Z and Ctrl+Y to go back and forth. One drag is one step. A history lasts as long as the modal is open, and choosing a preset isn't a step in it.

The plot is a chart, all on one logarithmic axis so every octave is as wide, with the frequency lines of IRN's chart and level lines every 3 dB up to ±12. Behind the curve, none in the way of a node: the zones, always, in alternating neutrals with their names along the top, and the sound words at their ranges, on by default. Tapping, hovering or focusing either says what it is and what boosting or cutting does. Two more are off by default: the instruments, which take more of the modal as range bars by family, lined up with the curve's axis and lighting up their range on it, and ear sensitivity, ISO 226 contours at 40 and 80 phon with a level scale of their own. All three are remembered per machine. The data is a plain module in the feature, with no fetching. Its colors are neutral tokens (`--eq-*`) until they're chosen.

The main view's buttons can be ghosts because everything around them is music. In a modal or on the Settings page nothing is, so what can be clicked has to look it: filled or outlined, never ghost, apart from the close icon and the steppers inside an outlined field. A line divides the tab column from the content, the header from the body, and one section from the next. That line is `<Divider>` everywhere: a hairline, full strength in the middle and fading to nothing at both ends, horizontal or vertical. Never a plain border. A section has a real heading, a label is small and muted, a value is plain text. Modal buttons are `md`, or `sm` at the level of a row, smaller than a finger on screen and brought up to size by an invisible box under a coarse pointer.

## Motion

Few and purposeful. Art crossfades over about 300 ms on track change. Panels fade with a slight rise over about 140 ms. The accent eases over about 600 ms. Nothing bounces, and all of it respects reduced motion.

## Scale

Everything scales from one fluid unit that follows the shorter window axis, with a floor and no ceiling: same layout, proportionally bigger on the TV. Tap targets never go below 44px. On the 10" laptop, the list column has to stay comfortable to use by touch.

CSS can't tell a 65" TV from a 27" 4K monitor, so the interface-size setting is how the TV gets legible. At 100% from 3 m, body text is about 9 arcminutes tall, and it takes about 175% to reach the usual floor of 16.

## Mini player

A small always-on-top strip: art square on the left, title and artist, controls, a thin progress line along the bottom. Draggable. One click returns to the main window.

## Empty and error states

- **No folder yet:** a single calm screen: "Point me at your music" and one button.
- **Scanning:** the list fills in live as tracks arrive, with a slim progress line and a count.
- **Errors:** plain language and the action that fixes it. Never a dead end.
