#!/usr/bin/env node
/**
 * Page smoke test: opens every HTML page in PUBLIC/ in a real browser and
 * reports JS errors, console errors, failed requests and login redirects.
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
    try { return require('playwright-core'); } catch (_) { /* fall through to global */ }
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, '@playwright', 'cli', 'node_modules', 'playwright-core'));
}

async function checkPage(context, base, file, opts) {
    const page = await context.newPage();
    const result = { page: file, status: null, jsErrors: [], consoleErrors: [], failedRequests: [], login: false, ms: 0 };
    const loggedOutNoise = (text) => !opts.state && /Unauthorized|status of 401/.test(text);
    page.on('pageerror', (err) => {
        const text = String(err.message || err).split('\n')[0];
        if (!loggedOutNoise(text)) result.jsErrors.push(text);
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error' && !loggedOutNoise(msg.text())) result.consoleErrors.push(msg.text().split('\n')[0].slice(0, 200));
    });
    page.on('response', (res) => {
        const url = res.url();
        // Logged out, every protected API answers 401; that is the LOGIN verdict, not a failure.
        if (res.status() === 401 && !opts.state) return;
        if (res.status() >= 400 && url.startsWith(base)) result.failedRequests.push(`${res.status()} ${url.slice(base.length)}`);
    });
    page.on('requestfailed', (req) => {
        if (req.url().startsWith(base)) result.failedRequests.push(`FAILED ${req.url().slice(base.length)} (${req.failure()?.errorText})`);
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

    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const context = await browser.newContext({
        storageState: args.state || undefined,
        viewport: { width: 1366, height: 768 },
    });

    console.log(`Smoke testing ${pages.length} pages on ${args.base}${args.state ? ' (logged in)' : ' (not logged in)'}\n`);
    const results = [];
    for (const file of pages) {
        const r = await checkPage(context, args.base, file, args);
        r.verdict = verdict(r);
        results.push(r);
        console.log(`${r.verdict.padEnd(5)} ${file.padEnd(32)} ${String(r.ms).padStart(6)} ms`);
        for (const e of r.jsErrors) console.log(`        js:      ${e}`);
        for (const e of [...new Set(r.failedRequests)]) console.log(`        request: ${e}`);
        for (const e of [...new Set(r.consoleErrors)].slice(0, 3)) console.log(`        console: ${e}`);
    }
    await browser.close();

    const count = (v) => results.filter((r) => r.verdict === v).length;
    console.log(`\nOK ${count('OK')} | WARN ${count('WARN')} | FAIL ${count('FAIL')} | LOGIN ${count('LOGIN')}`);
    process.exitCode = count('FAIL') ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 2; });
