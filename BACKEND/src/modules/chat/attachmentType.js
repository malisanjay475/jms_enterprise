'use strict';

// Works out what a chat attachment really is from its first bytes, never from the name
// or the MIME type the browser sent. Only images, PDF, Excel (.xlsx) and audio are
// allowed. Returns { kind, mime, ext } or null to reject.

function startsWith(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(buf, start, end) {
  return buf.slice(start, Math.min(end, buf.length)).toString('latin1');
}

function sniffAttachment(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  // images
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', ext: '.jpg' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', ext: '.png' };
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: '.gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: '.webp' };

  // PDF
  if (ascii(buf, 0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: '.pdf' };

  // xlsx: a ZIP whose entries are an Excel workbook. Macro workbooks (vbaProject.bin)
  // are refused. Entry names sit uncompressed in the ZIP headers, so a byte search works.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const text = buf.toString('latin1');
    if (text.includes('[Content_Types].xml') && text.includes('xl/workbook.xml') && !text.includes('vbaProject.bin')) {
      return { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' };
    }
    return null;
  }

  // audio
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe6) === 0xe2)) {
    return { kind: 'audio', mime: 'audio/mpeg', ext: '.mp3' };
  }
  if (ascii(buf, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: '.ogg' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: '.wav' };
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (brand === 'M4A ' || brand === 'M4B ') return { kind: 'audio', mime: 'audio/mp4', ext: '.m4a' };
    return null; // mp4/mov video and other ISO media
  }
  // WebM (what browsers record voice notes in): audio only if it has no video track.
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    const head = buf.slice(0, 64 * 1024).toString('latin1');
    if (/V_(VP8|VP9|AV1|MPEG|UNCOMPRESSED)/.test(head)) return null;
    if (/A_(OPUS|VORBIS)/.test(head)) return { kind: 'audio', mime: 'audio/webm', ext: '.webm' };
    return null;
  }
  return null;
}

module.exports = { sniffAttachment };
