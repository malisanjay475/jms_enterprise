'use strict';

const express = require('express');
const request = require('supertest');
const { sniffAttachment } = require('../src/modules/chat/attachmentType');
const { createPrivateUploadGuard } = require('../src/app/uploadSafety');
const { __test } = require('../src/modules/chat/registerChatRoutes');

const pad = (b, n = 64) => Buffer.concat([Buffer.from(b), Buffer.alloc(n)]);

describe('chat attachment type check (real bytes, not the name)', () => {
  test.each([
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0], 'image', '.jpg'],
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image', '.png'],
    ['gif', Buffer.from('GIF89a'), 'image', '.gif'],
    ['pdf', Buffer.from('%PDF-1.7\n'), 'pdf', '.pdf'],
    ['mp3 (ID3)', Buffer.from('ID3'), 'audio', '.mp3'],
    ['mp3 (frame)', [0xff, 0xfb, 0x90, 0x00], 'audio', '.mp3'],
    ['ogg', Buffer.from('OggS'), 'audio', '.ogg']
  ])('%s is accepted', (_n, bytes, kind, ext) => {
    expect(sniffAttachment(pad(bytes))).toMatchObject({ kind, ext });
  });

  test('webp and wav are told apart inside RIFF', () => {
    expect(sniffAttachment(pad(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')))).toMatchObject({ kind: 'image', ext: '.webp' });
    expect(sniffAttachment(pad(Buffer.from('RIFF\0\0\0\0WAVEfmt ')))).toMatchObject({ kind: 'audio', ext: '.wav' });
  });

  test('xlsx is a ZIP holding an Excel workbook; macro workbooks and other ZIPs are refused', () => {
    const zip = (names) => pad(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names)]));
    expect(sniffAttachment(zip('[Content_Types].xml xl/workbook.xml'))).toMatchObject({ kind: 'xlsx', ext: '.xlsx' });
    expect(sniffAttachment(zip('[Content_Types].xml xl/workbook.xml xl/vbaProject.bin'))).toBeNull();
    expect(sniffAttachment(zip('[Content_Types].xml word/document.xml'))).toBeNull();
    expect(sniffAttachment(zip('evil.exe'))).toBeNull();
  });

  test('m4a audio is accepted but mp4 video is not', () => {
    expect(sniffAttachment(pad(Buffer.from('\0\0\0\x20ftypM4A ')))).toMatchObject({ kind: 'audio', ext: '.m4a' });
    expect(sniffAttachment(pad(Buffer.from('\0\0\0\x20ftypisom')))).toBeNull();
  });

  test('phone voice notes (plain MP4 with only a sound track) are audio; any video track is refused', () => {
    const hdlr = (type) => `\0\0\0\x21hdlr\0\0\0\0\0\0\0\0${type}`;
    const mp4 = (...types) => pad(Buffer.from(`\0\0\0\x18ftypmp42 moov ${types.map(hdlr).join(' ')}`));
    expect(sniffAttachment(mp4('soun'))).toMatchObject({ kind: 'audio', mime: 'audio/mp4', ext: '.m4a' });
    expect(sniffAttachment(mp4('vide', 'soun'))).toBeNull();
    expect(sniffAttachment(mp4('soun', 'vide'))).toBeNull();
    expect(sniffAttachment(mp4())).toBeNull();
  });

  test('webm voice notes are audio; webm with a video track is refused', () => {
    const ebml = [0x1a, 0x45, 0xdf, 0xa3];
    expect(sniffAttachment(pad(Buffer.concat([Buffer.from(ebml), Buffer.from('webm A_OPUS')])))).toMatchObject({ kind: 'audio' });
    expect(sniffAttachment(pad(Buffer.concat([Buffer.from(ebml), Buffer.from('webm V_VP8 A_OPUS')])))).toBeNull();
  });

  test.each([
    ['html', '<html><script>alert(1)</script></html>'],
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['exe', 'MZ\x90\x00\x03'],
    ['text', 'just some plain text here']
  ])('%s is refused whatever it is named', (_n, text) => {
    expect(sniffAttachment(pad(Buffer.from(text)))).toBeNull();
  });

  test('tiny or missing input is refused', () => {
    expect(sniffAttachment(Buffer.from('%PDF'))).toBeNull();
    expect(sniffAttachment(null)).toBeNull();
  });
});

describe('chat uploads are never served as static files', () => {
  const app = express();
  app.use(createPrivateUploadGuard((_q, _s, n) => n()));
  app.use((_req, res) => res.status(200).send('static'));

  test.each([
    '/uploads/chat/2026-10/a.png',
    '/UPLOADS/Chat/2026-10/a.png',
    '/uploads//chat/a.png',
    '/uploads/./chat/a.png',
    '/uploads/chat%2Fa.png'
  ])('%s -> 404', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });

  test('other upload folders are unaffected', async () => {
    const res = await request(app).get('/uploads/machines/x.png');
    expect(res.text).toBe('static');
  });
});

describe('chat message output', () => {
  test('deleted messages hide text and file', () => {
    const row = { sync_id: 's', conversation_sync_id: 'c', sender: 'a', body: 'secret', kind: 'image', server_ts: 't', deleted_at: 'x' };
    const out = __test.messageOut(row, { sync_id: 'f', kind: 'image', mime: 'image/png', file_name: 'a.png', size_bytes: 1 });
    expect(out).toMatchObject({ body: '', deleted: true, attachment: null });
  });

  test('list preview labels attachments', () => {
    expect(__test.previewText('image', '')).toBe('📷 Photo');
    expect(__test.previewText('pdf', 'invoice')).toBe('📄 PDF: invoice');
    expect(__test.previewText('text', 'hi')).toBe('hi');
  });
});
