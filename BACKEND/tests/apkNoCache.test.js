'use strict';

const { cacheControlForAsset } = require('../src/app/staticCachePolicy');

describe('App installers are never cached', () => {
  test.each([
    '/qc-app/jms-qc.apk',
    '/qc-app/shifting/jms-shifting.apk',
    '/qc-app/chat/jms-chat.apk',
    '/qc-app/jms-qc.apk?v=1305',
    'D:\\JMS\\BACKEND\\PUBLIC\\qc-app\\JMS-QC.APK'
  ])('%s', (p) => {
    expect(cacheControlForAsset(p)).toBe('no-store');
  });

  test('images keep their 7 days', () => {
    expect(cacheControlForAsset('/assets/logo.png')).toBe('public, max-age=604800');
  });
});
