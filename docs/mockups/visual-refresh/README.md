# Visual refresh — five directions (Aug 2026)

Five 1920×1080 mockups exploring a visual refresh of QuestStream, all in the Nord
theme (same token palette as `src/renderer/src/styles.css`: amber primary, cyan
"live" accent, Polar Night surfaces). None reuses the current three-pane
Winamp-style layout. Each direction is grounded in UI/UX research on media
players, soundboards, and TTRPG audio tools (summary below).

Open any `N-*.html` in a browser at 1920×1080, or view the matching `.png`.
The HTML files pull display fonts from Google Fonts; the app itself would bundle them.

## The directions

| # | Direction | One-liner | Signature element |
|---|-----------|-----------|-------------------|
| 1 | **The Console** | The mix desk becomes the app: vertical channel strips with faders and live meters for the music bus, each ambience layer, the soundboard bus, and narration duck. | The fader bank with cyan VU meters |
| 2 | **Stage Mode** | A live-performance screen for mid-session: giant waveform, oversized next-up card, big scene cards, 150px soundboard pads with visible hotkeys. | The oversized cyan waveform under a Fraunces display title |
| 3 | **The Gallery** | Prep-focused sidebar navigation + card grid; scenes as aurora-gradient art cards, persistent now-playing rail with a "sounding now" mixer and quick-fire mini pads. | Scene cards as painted aurora tiles |
| 4 | **Session Lanes** | The session as a broadcast timeline: music blocks with waveforms, looping ambience lanes, one-shot strikes painted where they fired, a NOW playhead, and a drawn crossfade wedge. | The playhead + crossfade wedge between tracks |
| 5 | **The Grimoire** | The aesthetic risk: the session as a campaign tome. Scenes are bookmarked chapters, the mix is written as an illuminated page (Melody / Undertones), the soundboard is a margin of sigils, duck is a wax seal. | The open-book page with ribbon-bookmark chapters |

Typography per direction: Space Grotesk + Inter + JetBrains Mono (1, 4),
Fraunces + Inter (2), Outfit (3), Fraunces + Spectral (5).

## Research the directions answer

From user reviews/complaints about VLC, Spotify desktop, foobar2000, MusicBee,
AIMP, Voicemod, EXP Soundboard, Soundpad, Syrinscape, Kenku FM, Tabletop Audio,
and Foundry VTT playlists:

**Recurring complaints**
- Hidden playback state — "what is making noise right now?" is opaque (Foundry
  users install modules just to see it) → the Console's meters, Gallery's
  "Sounding now" rail, Lanes' whole premise.
- Tiny click targets and hover-only controls mid-session → Stage Mode's 150px
  pads, big scene cards, hold-space duck.
- No per-sound volume / mismatched clip loudness (top Soundpad/EXP request) →
  per-strip faders and percentages everywhere; "loudness-matched (R128)" badges.
- Loop hiccups and missing crossfades (Kenku FM's most-thumbed issue) →
  "gapless" labels, crossfade duration shown at the point of use (queue footer,
  next-up card, Lanes wedge).
- Clutter/feature-pushing burying core actions (Spotify backlash) and
  overwhelming first-run mazes (foobar2000/MusicBee) → every direction keeps
  one primary accent (amber) for actions and pushes management chrome out of
  the live surface.
- Redesigns that break muscle memory (Voicemod V3, Spotify) → all five keep
  QuestStream's existing vocabulary: scenes, layers, pads, duck, monitor,
  the amber/cyan token contract, and F-key/number hotkeys.

**Praised patterns adopted**
- Stream Deck / Soundpad-style one-glance pads with hotkeys that work anywhere.
- Mixer-model mental map (music bed + ambience layers + one-shots) — Tabletop
  Audio's SoundPad and Audio Forge are loved for exactly this.
- Fast keyboard-driven search (⌘K in every direction).
- Mini-player / compact modes (Gallery's "Pop out mini-player").
- A visible stop-all/fade-all escape hatch.

## Files

- `N-<name>.html` — the mockup (static, 1920×1080, no build step)
- `N-<name>.png` — 1920×1080 screenshot of the same
- `shared.css` — Nord tokens shared by all five
