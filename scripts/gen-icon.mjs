// Generates build/icon.png (512×512) with no external deps — a Nord-themed rounded
// square with frost-colored equalizer bars (matches the app's "now playing" motif).
// Run: node scripts/gen-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZE = 512
const buf = new Uint8Array(SIZE * SIZE * 4) // RGBA, transparent by default

const px = (x, y, [r, g, b, a = 255]) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  buf[i] = r
  buf[i + 1] = g
  buf[i + 2] = b
  buf[i + 3] = a
}
const rect = (x0, y0, w, h, color) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, color)
}
const roundedRect = (x0, y0, w, h, rad, color) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.min(x - x0, x0 + w - 1 - x)
      const dy = Math.min(y - y0, y0 + h - 1 - y)
      if (dx < rad && dy < rad) {
        const ddx = rad - dx
        const ddy = rad - dy
        if (ddx * ddx + ddy * ddy > rad * rad) continue
      }
      px(x, y, color)
    }
  }
}

// Background: full-bleed rounded square, Nord0.
roundedRect(0, 0, SIZE, SIZE, 96, [46, 52, 64, 255])

// Equalizer bars in frost colors (nord8 / nord9 / nord7), centered, varying heights.
const colors = [
  [136, 192, 208], // nord8
  [129, 161, 193], // nord9
  [143, 188, 187], // nord7
  [136, 192, 208],
  [129, 161, 193]
]
const heights = [150, 250, 320, 210, 140]
const barW = 50
const gap = 28
const n = heights.length
const totalW = n * barW + (n - 1) * gap
const startX = Math.round((SIZE - totalW) / 2)
const baseline = 388
for (let i = 0; i < n; i++) {
  const x = startX + i * (barW + gap)
  const h = heights[i]
  roundedRect(x, baseline - h, barW, h, 14, colors[i])
}

// ---- minimal PNG encoder ----
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (bytes) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
// rest zero (compression/filter/interlace)

// raw scanlines, filter byte 0 per row
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  buf.subarray(y * SIZE * 4, (y + 1) * SIZE * 4).forEach((v, i) => {
    raw[y * (SIZE * 4 + 1) + 1 + i] = v
  })
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'icon.png'), png)
console.log(`wrote ${join(outDir, 'icon.png')} (${png.length} bytes, ${SIZE}x${SIZE})`)
