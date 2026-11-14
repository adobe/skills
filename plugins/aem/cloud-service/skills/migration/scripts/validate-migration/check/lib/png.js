'use strict';

// Minimal PNG reader for screenshot evidence: verifies the signature, the IHDR
// chunk and its CRC, and the IEND trailer, then returns the image dimensions.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @returns {{width: number, height: number}} @throws when the buffer is not a complete PNG */
function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 45 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  if (buf.readUInt32BE(8) !== 13 || buf.toString('ascii', 12, 16) !== 'IHDR'
      || crc32(buf.subarray(12, 29)) !== buf.readUInt32BE(29)) {
    throw new Error('invalid PNG header');
  }
  if (!buf.subarray(buf.length - 12).equals(IEND)) throw new Error('truncated PNG file');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

module.exports = { pngSize };
