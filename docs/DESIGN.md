# Design direction

A first pass for me to criticize. Very visual, minimal chrome, the art is the app. Think of a record sleeve on a dark shelf, not a dashboard. It should feel calm and expensive, with no card soup and no decoration for its own sake.

## The main view

```
┌────────────────────────┬──────────────────┐
│                        │ search    ⚙      │  ← drag strip, window controls float top right
│                        │ Albums Artists … │
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
│                        │ ⏮ ⏯ ⏭   🔊  ⚡    │
└────────────────────────┴──────────────────┘
```

- **Art pane:** a square, full window height, flush left, top and bottom, with no radius, border or shadow. Capped so the list column keeps a usable width (at least about 36% of the window). When the window is too narrow or portrait, the art moves on top, up to about 45% of the height.
- **No art:** a calm gradient from the title's hash, with the album title set large. Never a broken image or a generic music note.
- **No top nav:** everything lives in the list column. A view switcher of plain text tabs (Albums, Artists, Genres, Tracks, Playlists, Queue), search, and a settings gear, which opens Settings as a modal over all of it. Drilling in (artist → album) replaces the list, with a back control at the start of the search row, so it never scrolls away. When the art is on top, search and the gear share the tabs' row while there's room.
- **Transport:** bottom of the list column. Title in a real type size, with the artist and album under it as links to their pages, a waveform seekbar with the time as `0:01 / 2:51` at its left, and the controls. Exclusive-mode switch and signal status live here, because they're a feature, not a setting. In a column too narrow for them, the volume, the switch and the signal fold into one menu. The list fades out above it rather than being cut off.
- **Nothing played yet:** a calm surface and one small line, not a big "Nothing playing". The controls wait, in the places they'll be.
- **Over the art:** lyrics dim the art with a scrim and sit on top of it, large and centered, with the current line bright and the rest faded. When they're synced, a small − and + nudge them earlier or later for this track, with the offset shown between them. EQ opens the same way. Tap the art for lyrics; swipe it for next and previous on touch.

## Look

- **Neutrals with zero chroma:** near-black background, true grays. The only color on screen comes from the album.
- **Album-driven accent:** the current art's color, adjusted for contrast, drives the seekbar, the active row and focus rings. A faint wash of it fades down the top of the list column. It changes smoothly on track change.
- **Type does the work:** Inter Variable, a clear scale, tabular numbers. Big confident now-playing title. Muted metadata.
- **Rows have no borders:** spacing and a subtle hover surface. An album card uses the same surfaces around it, and never touches the art's brightness. The playing row gets accent text and small animated bars that stop when paused.
- **Corners:** art in lists gets a small radius. The main art gets none.
- **Focus:** a clear accent ring, big enough to see from a couch.

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
