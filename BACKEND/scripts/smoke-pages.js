#!/usr/bin/env node
/**
 * Page smoke test: opens every HTML page in PUBLIC/ in a real browser and
 * reports JS errors, console errors, failed asset requests and login redirects.
 * Without --state, /api/* 4xx/5xx/aborts are ignored (empty DB / auth noise);
 * FAIL is for broken HTML/JS or missing same-origin static assets.
 * Read-only: it only loads pages, it never clicks or submits anything.
 *
 * Usage:
 *   node scripts/smoke-pages.js [--base http://localhost:3000] [--state auth.json]
 *                               [--only dpr,planning] [--shots out-dir]
 *
 * --state  Playwright storage state of a logged-in browser. Make one with:
 *            playwright-cli open http://localhost:3000/login.html --headed
 *            (log in by hand)
 *            playwright-cli state-save auth.json
 *          Without it, protected pages are reported as "login" instead of tested.
 *
 * Needs playwright-core: either `npm i -D playwright-core` or the global
 * `npm i -g @playwright/cli` (its bundled copy is found automatically).
 * Exit code 1 when any page fails.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SKIP_PAGES = new Set(['test_hidden.html', 'voice_test.html', 'debug_api.html', 'debug_dashboard.html']);

function parseArgs(argv) {
    const args = { base: 'http://localhost:3000', state: null, only: null, shots: null, timeout: 20000 };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (key in args) args[key] = argv[++i];
    }
    args.base = args.base.replace(/\/+$/, '');
    args.timeout = Number(args.timeout) || 20000;
    return args;
}

function loadPlaywright() {
    const tried = [];
    const tryRequire = (label, loader) => {
        try { return loader(); } catch (err) {
            tried.push(`${label}: ${String(err && err.message || err).split('\n')[0]}`);
            return null;
        }
    };
    // Absolute path from CI (GITHUB_ENV) or a local install next to BACKEND/.
    if (process.env.PLAYWRIGHT_CORE_PATH) {
        const fromEnv = tryRequire('PLAYWRIGHT_CORE_PATH', () => require(process.env.PLAYWRIGHT_CORE_PATH));
        if (fromEnv) return fromEnv;
    }
    const backendRoot = path.join(__dirname, '..');
    const local = tryRequire('BACKEND/node_modules', () =>
        require(require.resolve('playwright-core', { paths: [backendRoot, process.cwd(), process.env.NODE_PATH || backendRoot] }))
    );
    if (local) return local;
    const bare = tryRequire("require('playwright-core')", () => require('playwright-core'));
    if (bare) return bare;
    const direct = tryRequire('direct path', () => require(path.join(backendRoot, 'node_modules', 'playwright-core')));
    if (direct) return direct;
    try {
        const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const fromCli = tryRequire('@playwright/cli', () =>
            require(path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'))
        );
        if (fromCli) return fromCli;
    } catch (err) {
        tried.push(`npm root -g: ${String(err && err.message || err).split('\n')[0]}`);
    }
    throw new Error(
        'playwright-core not found. Install with: npm i -D playwright-core && npx playwright-core install chromium\n' +
        tried.map((t) => `  - ${t}`).join('\n')
    );
}

function isApiPath(url, base) {
    const pathPart = url.startsWith(base) ? url.slice(base.length) : url;
    return /^\/api(\/|$|\?)/.test(pathPart);
}

async function checkPage(context, base, file, opts) {
    const page = await context.newPage();
    const result = { page: file, status: null, jsErrors: [], consoleErrors: [], failedRequests: [], login: false, ms: 0 };
    // Logged-out smoke is about broken HTML/JS/assets. API 401/5xx/aborts on an empty
    // CI DB (or pages that fetch before redirecting to login) are expected noise.
    const loggedOutNoise = (text) => !opts.state && /Unauthorized|status of 401|Failed to fetch|API Error/i.test(text);
    page.on('pageerror', (err) => {
        const text = String(err.message || err).split('\n')[0];
        if (!loggedOutNoise(text)) result.jsErrors.push(text);
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !loggedOutNoise(msg.text())) result.consoleErrors.push(msg.text().split('\n')[0].slice(0, 200));
    });
    page.on('response', (res) => {
        const url = res.url();
        if (!url.startsWith(base)) return;
        if (!opts.state && (res.status() === 401 || isApiPath(url, base))) return;
        if (res.status() >= 400) result.failedRequests.push(`${res.status()} ${url.slice(base.length)}`);
    });
    page.on('requestfailed', (req) => {
        const url = req.url();
        if (!url.startsWith(base)) return;
        if (!opts.state && isApiPath(url, base)) return;
        result.failedRequests.push(`FAILED ${url.slice(base.length)} (${req.failure()?.errorText})`);
    });

    const started = Date.now();
    try {
        const res = await page.goto(`${base}/${file}`, { waitUntil: 'load', timeout: opts.timeout });
        result.status = res ? res.status() : null;
        // Give the page's own fetches time to finish without waiting forever on polling pages.
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        result.login = file !== 'login.html' && /\/login\.html/i.test(page.url());
        if (opts.shots) {
            await page.screenshot({ path: path.join(opts.shots, file.replace(/\.html$/, '.png')), fullPage: false });
        }
    } catch (err) {
        result.jsErrors.push(`navigation: ${String(err.message || err).split('\n')[0]}`);
    }
    result.ms = Date.now() - started;
    await page.close();
    return result;
}

function verdict(r) {
    if (r.login) return 'LOGIN';
    if ((r.status && r.status >= 400) || r.jsErrors.length || r.failedRequests.length) return 'FAIL';
    if (r.consoleErrors.length) return 'WARN';
    return 'OK';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const publicDir = path.join(__dirname, '..', 'PUBLIC');
    let pages = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html') && !SKIP_PAGES.has(f)).sort();
    if (args.only) {
        const wanted = args.only.split(',').map((s) => s.trim().replace(/\.html$/, '') + '.html');
        pages = pages.filter((p) => wanted.includes(p));
    }
    if (args.shots) fs.mkdirSync(args.shots, { recursive: true });

    const log = (...parts) => {
        // stderr is line-buffered even when Actions captures output (stdout may not be).
        process.stderr.write(`${parts.join(' ')}\n`);
    };

    log(`loading playwright-core…`);
    const { chromium } = loadPlaywright();
    log(`launching chromium…`);
    // Prefer plain Chromium (CI / playwright install). Fall back to system Chrome when present.
    const browser = await chromium.launch({ headless: true }).catch((err) => {
        log(`chromium.launch failed (${err.message}); trying channel=chrome`);
        return chromium.launch({ channel: 'chrome', headless: true });
    });
    const context = await browser.newContext({
        storageState: args.state || undefined,
        viewport: { width: 1366, height: 768 },
    });

    log(`Smoke testing ${pages.length} pages on ${args.base}${args.state ? ' (logged in)' : ' (not logged in)'}`);
    const results = [];
    for (const file of pages) {
        const r = await checkPage(context, args.base, file, args);
        r.verdict = verdict(r);
        results.push(r);
        log(`${r.verdict.padEnd(5)} ${file.padEnd(32)} ${String(r.ms).padStart(6)} ms`);
        for (const e of r.jsErrors) log(`        js:      ${e}`);
        for (const e of [...new Set(r.failedRequests)]) log(`        request: ${e}`);
        for (const e of [...new Set(r.consoleErrors)].slice(0, 3)) log(`        console: ${e}`);
    }
    await browser.close();

    const count = (v) => results.filter((r) => r.verdict === v).length;
    log(`\nOK ${count('OK')} | WARN ${count('WARN')} | FAIL ${count('FAIL')} | LOGIN ${count('LOGIN')}`);
    // Explicit exit so CI always sees the code even if something else holds the event loop.
    process.exit(count('FAIL') ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(2);
});
