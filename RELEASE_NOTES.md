# Unreleased — the grimoire redesign

The whole UI was rebuilt around three regions: a **scene bookmark rail**, a center
**workspace**, and a live-mix **margin** with the sigil soundboard and the wax-seal
DUCK. Every flow got an honest, plain-language surface:

- **Scenes are editable documents** — a scene builder (track order + start marker,
  per-scene crossfade and end-of-list behavior, ambience layers, per-scene sound
  pads, GM note), a read-only scene page (opening never touches the audio), Play
  with Music/Ambience include toggles, and F1–F8 one-press recall. The old
  "replace the current mix?" dialog is gone — nothing is lost by switching.
- **A GM-only preview bus** — audition scenes, drafts, and imports privately while
  the table keeps hearing the live mix, on an isolated second audio path that
  structurally cannot reach the Discord send (enforced by test).
- **A non-blocking import workbench** — paste a link or drop files and keep
  working; arrivals stream into a table; duplicates say "Already in your library".
- **Audition-first tag triage** — listen and tag in one pass (Space / Enter / S),
  with a streaming waveform and a carry-forward toggle.
- **The ⌘K seeker** — tracks, scenes, and actions from one input, anywhere.

# QuestStream v0.1.0

A bring-your-own-audio mixer for tabletop game masters. Build a soundtrack from your own
files or links, layer ambience and one-shot effects, snapshot whole **scenes**, and play it
to your table — on your own speakers or streamed into a Discord voice channel.

## Install (Linux · Flatpak · x86_64)

```bash
# one-time: the Flathub remote provides the shared runtime this bundle references
flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo

# install the downloaded bundle, then run
flatpak install --user ./QuestStream-0.1.0-x86_64.flatpak
flatpak run io.github.WilderSelf.QuestStream
