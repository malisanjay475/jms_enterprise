'use strict';

const { __test: { fetchWithTimeout, networkErrorDetail } } = require('../src/local-servers/localNodeAgent');

function netError(code) {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) });
}

describe('Local node agent: calls to MAIN', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('retries once after a network-level failure and succeeds', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(netError('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const res = await fetchWithTimeout('https://main.example/api/x', {}, 1000, { retryDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('names the real cause of both attempts when the retry also fails', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(netError('ECONNRESET'))
      .mockRejectedValueOnce(netError('UND_ERR_CONNECT_TIMEOUT'));
    await expect(fetchWithTimeout('https://main.example/api/x', {}, 1000, { retryDelayMs: 1 }))
      .rejects.toThrow('fetch failed (UND_ERR_CONNECT_TIMEOUT) [first attempt: fetch failed (ECONNRESET)]');
  });

  it('does not retry an HTTP error answer', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await fetchWithTimeout('https://main.example/api/x', {}, 1000, { retryDelayMs: 1 });
    expect(res.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('describes errors without a cause plainly', () => {
    expect(networkErrorDetail(new Error('boom'))).toBe('boom');
  });
});
