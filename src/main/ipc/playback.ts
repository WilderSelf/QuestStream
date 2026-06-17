import { IPC } from '../../shared/ipc'
import type { Song } from '../../shared/types'
import type { IpcContext } from './context'

/** Playback IPC: Discord connection/voice, the player, ambience layers, local monitor. */
export function registerPlaybackIpc(ctx: IpcContext): void {
  const { bot, config, handle } = ctx

  // ---- discord ----
  // Never hand the raw token back to the renderer — only whether one is configured.
  handle(IPC.discordHasToken, () => !!config.token)
  handle(IPC.discordSetToken, (_e, token: string) => {
    config.token = token
  })
  handle(IPC.discordConnect, () => bot.connect(config.token))
  handle(IPC.discordDisconnect, () => bot.disconnect())
  handle(IPC.discordGetGuilds, () => bot.getGuilds())
  handle(IPC.discordGetVoiceChannels, (_e, guildId: string) => bot.getVoiceChannels(guildId))
  handle(IPC.discordJoin, (_e, guildId: string, channelId: string) => bot.join(guildId, channelId))
  handle(IPC.discordLeave, () => bot.leave())

  // ---- player ----
  handle(IPC.playerPlay, (_e, song: Song) => bot.play(song))
  handle(IPC.playerPrefetch, (_e, song: Song) => bot.prefetch(song))
  handle(IPC.playerPause, () => bot.pause())
  handle(IPC.playerResume, () => bot.resume())
  handle(IPC.playerStop, () => bot.stop())
  handle(IPC.playerSeek, (_e, seconds: number) => bot.seek(seconds))
  handle(IPC.playerSetVolume, (_e, volume: number) => bot.setVolume(volume))
  handle(IPC.playerSetMusicVolume, (_e, volume: number) => bot.setMusicVolume(volume))
  handle(IPC.playerDuck, (_e, on: boolean) => bot.duck(on))

  // ---- ambience ----
  handle(IPC.ambiencePlay, (_e, slotId: string, song: Song, volume: number) =>
    bot.playAmbience(slotId, song, volume)
  )
  handle(
    IPC.ambiencePlayRandom,
    (_e, slotId: string, songs: Song[], volume: number, minSec: number, maxSec: number) =>
      bot.playRandomAmbience(slotId, songs, volume, minSec, maxSec)
  )
  handle(IPC.ambienceStop, (_e, slotId: string) => bot.stopAmbience(slotId))
  handle(IPC.ambienceSetVolume, (_e, slotId: string, volume: number) => bot.setAmbienceVolume(slotId, volume))
  handle(IPC.ambienceSetPaused, (_e, slotId: string, paused: boolean) => bot.setAmbiencePaused(slotId, paused))

  // ---- local monitor ----
  handle(IPC.monitorEnable, (_e, on: boolean) => bot.setMonitor(on))
}
