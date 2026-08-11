/**
 * GM-only audition output: plays the preview bus's PCM (preview:pcm) on the host's
 * speakers. A second PcmPlayer instance with its own AudioContext, gain, and output
 * device — fully independent of the local monitor, so auditioning never touches
 * what the table hears.
 */
import { PcmPlayer } from './pcm-player'

export const previewPlayer = new PcmPlayer('preview')
