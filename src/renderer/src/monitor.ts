/**
 * Local monitoring / jukebox: plays the bot's mixed PCM (the exact frames Discord
 * receives) on the host's own speakers. The heavy lifting — 48kHz worklet ring
 * buffer, gain, sink selection, autoplay-resume guard — lives in PcmPlayer.
 */
import { PcmPlayer } from './pcm-player'

export const localMonitor = new PcmPlayer('monitor')
