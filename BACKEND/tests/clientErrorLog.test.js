'use strict';

const http = require('http');
const net = require('net');
const { createClientErrorHandler, clientAddress } = require('../src/app/clientErrorLog');

function fakeSocket(ip) {
  return { remoteAddress: ip, writable: true, end: jest.fn() };
}

describe('Client error log', () => {
  it('summarises request timeouts per client address instead of a stack trace each', () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const handler = createClientErrorHandler('HTTP CLIENT', { log, intervalMs: 60000 });
    const timeout = Object.assign(new Error('Request timeout'), { code: 'ERR_HTTP_REQUEST_TIMEOUT' });
    const a = fakeSocket('::ffff:192.168.1.50');
    handler(timeout, a);
    handler(timeout, fakeSocket('::ffff:192.168.1.50'));
    handler(timeout, fakeSocket('192.168.1.61'));
    expect(a.end).toHaveBeenCalledWith('HTTP/1.1 400 Bad Request\r\n\r\n');
    expect(log.error).not.toHaveBeenCalled();
    const line = handler.flush();
    expect(line).toBe('[HTTP CLIENT] 3 request(s) timed out before the full request arrived (slow or dropped client connection): 192.168.1.50 x2, 192.168.1.61 x1');
    expect(handler.flush()).toBeNull(); // counters reset
    handler.stop();
  });

  it('logs other client errors in one line with the address, and ignores dropped connections', () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const handler = createClientErrorHandler('HTTP CLIENT', { log });
    handler(Object.assign(new Error('Parse Error'), { code: 'HPE_INVALID_METHOD' }), fakeSocket('10.0.0.5'));
    expect(log.error).toHaveBeenCalledWith('[HTTP CLIENT] HPE_INVALID_METHOD from 10.0.0.5: Parse Error');
    const dead = fakeSocket('10.0.0.6');
    handler(Object.assign(new Error('reset'), { code: 'ECONNRESET' }), dead);
    expect(dead.end).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    handler.stop();
  });

  it('catches a real stalled request on a live server', async () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const handler = createClientErrorHandler('HTTP CLIENT', { log, intervalMs: 60000 });
    const server = http.createServer({ connectionsCheckingInterval: 100 }, (req, res) => res.end('ok'));
    server.headersTimeout = 300;
    server.requestTimeout = 300;
    server.on('clientError', handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const reply = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('POST /api/dpr/submit HTTP/1.1\r\nHost: x\r\n'));
      let data = '';
      s.on('data', (d) => { data += d; });
      s.on('close', () => resolve(data));
      s.on('error', () => resolve(data));
    });
    server.close();
    handler.stop();
    expect(reply).toMatch(/^HTTP\/1\.1 400/);
    expect(handler.flush()).toMatch(/1 request\(s\) timed out.*127\.0\.0\.1 x1/);
  }, 15000);

  it('strips the IPv4-mapped prefix', () => {
    expect(clientAddress({ remoteAddress: '::ffff:192.168.2.11' })).toBe('192.168.2.11');
    expect(clientAddress({})).toBe('unknown');
  });
});
