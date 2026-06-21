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
