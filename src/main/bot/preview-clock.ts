/**
 * Drift-corrected pacing for the preview engine's frame pump (grimoire Phase 3).
 *
 * The live mix is clocked by @discordjs/voice's AudioPlayer pulling a frame every
 * 20ms. The preview bus has no AudioPlayer, so it pumps itself with a timer — and a
 * naive setInterval(20) drifts (each tick's lateness accumulates; see the cadence
 * diagnostics in Mixer.ts for the bug class). Instead, each tick schedules the next
 * against the absolute timeline: target(n) = startedAt + n * FRAME_MS.
 */
export const FRAME_MS = 20

/**
 * Milliseconds to wait before sending frame `framesSent` (0-based count of frames
 * already sent). Never negative; when the pump has fallen behind, returns 0 so the
 * caller catches up one frame per tick (bounded burst — one frame per invocation,
 * so a long stall recovers gradually instead of flooding the IPC channel).
 */
export function nextPumpDelay(startedAtMs: number, framesSent: number, nowMs: number): number {
  const target = startedAtMs + framesSent * FRAME_MS
  const delay = target - nowMs
  if (delay <= 0) return 0
  // A future target can only be at most one frame away in normal operation; clamp
  // defensively so a bad clock jump can't park the pump.
  return Math.min(delay, FRAME_MS)
}
