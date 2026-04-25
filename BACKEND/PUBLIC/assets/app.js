window.JPSMS = window.JPSMS || {};
const BRAND_NAME = 'JMS OCEAN';

(function ensureBrandAssets() {
    if (typeof document === 'undefined') return;

    const setLink = (rel, href, type) => {
        let link = document.head.querySelector(`link[rel="${rel}"]`);
        if (!link) {
            link = document.createElement('link');
            link.rel = rel;
            document.head.appendChild(link);
        }
        link.href = href;
        if (type) link.type = type;
    };

    setLink('icon', '/favicon.ico', 'image/x-icon');
    setLink('apple-touch-icon', '/apple-touch-icon.png', 'image/png');
})();

/**
 * Mobile App Shell Injection (PWA)
 * Automatically adds bottom navigation on small screens
 */
(function initMobileApp() {
    const path = window.location.pathname.toLowerCase();
    if (window.innerWidth > 768 || path.endsWith('/login.html') || path.includes('/vendor/login.html')) return;
    const mobileUser = (() => {
        try {
            return JSON.parse(localStorage.getItem('user') || '{}');
        } catch (_err) {
            return {};
        }
    })();
    const canViewSettings = ['admin', 'superadmin'].includes(String(mobileUser.role_code || '').toLowerCase());

    // Bottom Nav HTML
    const navHTML = `
    <nav class="mobile-nav">
        <a href="/index.html" class="nav-item ${window.location.pathname.includes('index') || window.location.pathname === '/' ? 'active' : ''}">
            <i class="bi bi-grid-1x2-fill"></i>
            <span>Home</span>
        </a>
        <a href="/planning.html" class="nav-item ${window.location.pathname.includes('planning') ? 'active' : ''}">
            <i class="bi bi-calendar-event"></i>
            <span>Plan</span>
        </a>
        <a href="/dpr.html" class="nav-item ${window.location.pathname.includes('dpr') ? 'active' : ''}">
             <i class="bi bi-pencil-square"></i>
            <span>DPR</span>
        </a>
        <a href="/analyze.html" class="nav-item ${window.location.pathname.includes('analyze') ? 'active' : ''}">
            <i class="bi bi-graph-up-arrow"></i>
            <span>Stats</span>
        </a>
        ${canViewSettings ? `
         <a href="/settings.html" class="nav-item ${window.location.pathname.includes('settings') ? 'active' : ''}">
            <i class="bi bi-gear-fill"></i>
            <span>Settings</span>
        </a>` : ''}
    </nav>`;

    // Inject if not present
    if (!document.querySelector('.mobile-nav')) {
        document.body.insertAdjacentHTML('beforeend', navHTML);
    }
})();

(function (exports) {
    const API_BASE = '/api';

    function readStoredJson(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_err) {
            return fallback;
        }
    }

    function getStoredFactories() {
        return readStoredJson('jpsms_allowed_factories', []);
    }

    function userCanSelectAllFactories(user = readStoredJson('user', {})) {
        return localStorage.getItem('jpsms_can_all_factories') === 'true'
            || user?.can_select_all_factories === true
            || user?.global_access === true
            || String(user?.role_code || '').toLowerCase() === 'superadmin'
            || String(user?.username || '').toLowerCase() === 'superadmin';
    }

    function isAdminLikeUser(user = readStoredJson('user', {})) {
        const role = String(user?.role_code || '').toLowerCase();
        return role === 'admin' || role === 'superadmin';
    }

    function isSuperadminUser(user = readStoredJson('user', {})) {
        return String(user?.role_code || '').toLowerCase() === 'superadmin';
    }

    function formatSidebarLabel(value) {
        return String(value || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, ch => ch.toUpperCase())
            .trim() || 'Operator';
    }

    function getPermissionActionCandidates(action) {
        const normalizedAction = String(action || 'view').toLowerCase();
        if (normalizedAction === 'add' || normalizedAction === 'delete') {
            return [normalizedAction, 'other', 'edit'];
        }
        if (normalizedAction === 'other') {
            return ['other', 'add', 'delete', 'edit'];
        }
        return [normalizedAction];
    }

    function normalizePermissionsObject(permissions = {}) {
        if (!permissions || typeof permissions !== 'object') return {};
        const normalized = {};

        Object.entries(permissions).forEach(([feature, config]) => {
            if (!config || typeof config !== 'object' || Array.isArray(config)) {
                normalized[feature] = config;
                return;
            }

            const nextConfig = {};
            ['view', 'add', 'edit', 'print', 'delete'].forEach(action => {
                const candidates = getPermissionActionCandidates(action);
                for (const candidate of candidates) {
                    if (config[candidate] !== undefined) {
                        nextConfig[action] = config[candidate] === true;
                        break;
                    }
                }
            });

            normalized[feature] = nextConfig;
        });

        return normalized;
    }

    function getCurrentFactoryScope() {
        const id = localStorage.getItem('jpsms_factory_id');
        const name = localStorage.getItem('jpsms_factory_name');
        return {
            id,
            name: name || (id === 'all' ? 'All Factories' : ''),
            isAll: id === 'all'
        };
    }

    function setCurrentFactoryScope(factoryId, factoryName) {
        if (factoryId === null || factoryId === undefined || factoryId === '') {
            localStorage.removeItem('jpsms_factory_id');
        } else {
            localStorage.setItem('jpsms_factory_id', String(factoryId));
        }

        if (factoryName) {
            localStorage.setItem('jpsms_factory_name', factoryName);
        } else {
            localStorage.removeItem('jpsms_factory_name');
        }
    }

    function getWriteFactoryScope() {
        const id = localStorage.getItem('jpsms_write_factory_id');
        const name = localStorage.getItem('jpsms_write_factory_name');
        return {
            id,
            name: name || (id === 'all' ? 'All Factories' : ''),
            isAll: id === 'all'
        };
    }

    function setWriteFactoryScope(factoryId, factoryName) {
        if (factoryId === null || factoryId === undefined || factoryId === '') {
            localStorage.removeItem('jpsms_write_factory_id');
        } else {
            localStorage.setItem('jpsms_write_factory_id', String(factoryId));
        }

        if (factoryName) {
            localStorage.setItem('jpsms_write_factory_name', factoryName);
        } else {
            localStorage.removeItem('jpsms_write_factory_name');
        }
    }

    // --- API ---
    async function request(endpoint, options = {}) {
        if (!options.skipLoader) toggleLoader(true);
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const currentUser = readStoredJson('user', {});
        if (currentUser?.username) headers['X-User-Name'] = currentUser.username;

        // Inject Factory Context
        const factoryId = localStorage.getItem('jpsms_factory_id');
        if (factoryId) headers['X-Factory-ID'] = factoryId;
        const writeFactoryId = localStorage.getItem('jpsms_write_factory_id');
        if (writeFactoryId) headers['X-Write-Factory-ID'] = writeFactoryId;

        if (options.body instanceof FormData) {
            delete headers['Content-Type']; // Let browser set boundary
        }

        // Add 10s Timeout to ALL requests (Prevents "Unlimited Loading")
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);

        try {
            const res = await fetch(API_BASE + endpoint, {
                ...options,
                headers,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Request failed');
            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            console.error('API Error:', err);
            // Ignore abort errors (usually manual navigation or timeout)
            if (err.name !== 'AbortError') {
                toast(err.message === 'The user aborted a request.' ? 'Request Timed Out' : err.message, 'error');
            }
            throw err;
        } finally {
            if (!options.skipLoader) toggleLoader(false);
        }
    }

    exports.api = {
        get: (url) => request(url),
        post: (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) }),
        put: (url, body) => request(url, { method: 'PUT', body: JSON.stringify(body) }),
        delete: (url) => request(url, { method: 'DELETE' }),
        upload: (url, formData) => request(url, { method: 'POST', body: formData }),
        request: (url, options) => request(url, options) // Expose generic just in case
    };

    exports.factories = {
        getAllowed: () => getStoredFactories(),
        canSelectAll: (user) => userCanSelectAllFactories(user),
        getCurrentScope: () => getCurrentFactoryScope(),
        setCurrentScope: (factoryId, factoryName) => setCurrentFactoryScope(factoryId, factoryName),
        getWriteScope: () => getWriteFactoryScope(),
        setWriteScope: (factoryId, factoryName) => setWriteFactoryScope(factoryId, factoryName)
    };

    // --- Auth ---
    exports.auth = {
        login: async (username, password) => {
            const res = await exports.api.post('/login', { username, password });
            if (res.ok) {
                localStorage.setItem('token', 'dummy-token-for-now'); // Simulating token
                localStorage.setItem('user', JSON.stringify(res.data));
                localStorage.setItem('jpsms_allowed_factories', JSON.stringify(res.factories || []));
                localStorage.setItem('jpsms_can_all_factories', res.can_select_all_factories ? 'true' : 'false');
                return { user: res.data, factories: res.factories || [] };
            } else {
                throw new Error(res.error || 'Login failed');
            }
        },
        logout: () => {
            // Reset loader state on logout
            loaderCount = 0;
            toggleLoader(false);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('jpsms_allowed_factories');
            localStorage.removeItem('jpsms_can_all_factories');
            localStorage.removeItem('jpsms_factory_id');
            localStorage.removeItem('jpsms_factory_name');
            localStorage.removeItem('jpsms_write_factory_id');
            localStorage.removeItem('jpsms_write_factory_name');
            window.location.href = '/login.html'; // Redirect to login
        },
        getUser: () => JSON.parse(localStorage.getItem('user') || '{}'),
        requireAuth: () => {
            const u = JSON.parse(localStorage.getItem('user') || '{}');
            if (!u.username) {
                window.location.href = '/login.html';
                throw new Error('Unauthorized');
            }
            // Strict lockout for Mobile-only roles if they try to access Desktop Shell pages
            const path = window.location.pathname.toLowerCase();
            if (u.role_code === 'qc_supervisor' && !path.includes('qcsupervisor.html')) {
                window.location.href = '/QCSupervisor.html';
                throw new Error('Redirecting to Mobile Portal');
            }
            if (u.role_code === 'supervisor' && !path.includes('supervisor.html')) {
                window.location.href = '/supervisor.html';
                throw new Error('Redirecting to Supervisor Portal');
            }
            if (u.role_code === 'shifting_supervisor' && !path.includes('shifting_supervisor.html')) {
                window.location.href = '/shifting_supervisor.html';
                throw new Error('Redirecting to Shifting Portal');
            }
            const currentScope = getCurrentFactoryScope();
            const writeScope = getWriteFactoryScope();
            if (!writeScope.id && currentScope.id) {
                setWriteFactoryScope(currentScope.id, currentScope.name);
            }
            return u;
        },
        can: (feature, action = 'view') => {
            const u = JSON.parse(localStorage.getItem('user') || '{}');
            if (isAdminLikeUser(u)) return true; // Admin/Superadmin have full access

            // 1. Granular Check
            const p = u.permissions || {};
            const actionCandidates = getPermissionActionCandidates(action);
            // permission keys: "planning_edit", "masters_edit", "ai_access"
            for (const actionKey of actionCandidates) {
                const flatKey = `${feature}_${actionKey}`;
                if (p[flatKey] !== undefined) return p[flatKey] === true;
            }

            // If feature key exists
            if (p[feature] !== undefined) {
                // Handle Nested Objects (e.g. planning: { view: true })
                if (typeof p[feature] === 'object' && p[feature] !== null) {
                    for (const actionKey of actionCandidates) {
                        if (p[feature][actionKey] !== undefined) {
                            return p[feature][actionKey] === true;
                        }
                    }
                    return false;
                }
                // Handle Simple Flags (e.g. ai_access: true)
                return p[feature] === true;
            }

            // 2. Role Fallback (Legacy)
            if (feature === 'masters' && action === 'edit') return ['supervisor', 'manager', 'planner'].includes(u.role_code);
            if (feature === 'planning' && action === 'edit') return ['supervisor', 'manager', 'planner'].includes(u.role_code);
            if (feature === 'planning' && action === 'view') return true; // Explicitly allow view for everyone authenticated
            return true;
        },
        hasRole: (role) => {
            const u = JSON.parse(localStorage.getItem('user') || '{}');
            if (String(role || '').toLowerCase() === 'admin') return isAdminLikeUser(u);
            return u.role_code === role;
        },
        normalizePermissions: (permissions = {}) => normalizePermissionsObject(permissions),
        isAdminLike: (user = readStoredJson('user', {})) => isAdminLikeUser(user),
        isSuperadmin: (user = readStoredJson('user', {})) => isSuperadminUser(user),
        // Auto-Logout Timer
        initAutoLogout: () => {
            let warningTimer;
            let logoutTimer;
            let countdownInterval;

            // 29 Minutes Warning, 30 Minutes Logout
            const WARNING_TIME = 29 * 60 * 1000;
            const LOGOUT_TIME = 30 * 60 * 1000;

            // Function Hoisting Solution: Define resetTimers first
            const resetTimers = () => {
                // Only if logged in
                if (!localStorage.getItem('token')) return;

                console.log('[Auto-Logout] Activity detected. Resetting timers.');

                clearTimeout(warningTimer);
                clearTimeout(logoutTimer);
                clearInterval(countdownInterval);

                hideWarning();

                // Set new timers
                warningTimer = setTimeout(showWarning, WARNING_TIME);
                logoutTimer = setTimeout(() => {
                    console.warn('[Auto-Logout] Timeout reached. Logging out.');
                    exports.auth.logout();
                }, LOGOUT_TIME);
            };

            const hideWarning = () => {
                const m = document.getElementById('session-warning-modal');
                if (m) {
                    m.style.display = 'none';
                    const btn = m.querySelector('#stay-logged-in-btn');
                    if (btn) btn.textContent = 'Stay Logged In';
                }
            };

            const showWarning = () => {
                const m = getModal();
                m.style.display = 'flex';

                // Live Countdown
                let left = 60;
                const span = m.querySelector('#session-countdown');

                clearInterval(countdownInterval);
                countdownInterval = setInterval(() => {
                    left--;
                    if (span) span.textContent = left;
                    if (left <= 0) clearInterval(countdownInterval);
                }, 1000);
            };

            // Create Modal if not exists
            const getModal = () => {
                let m = document.getElementById('session-warning-modal');
                if (!m) {
                    m = document.createElement('div');
                    m.id = 'session-warning-modal';
                    m.style.position = 'fixed';
                    m.style.top = '0'; m.style.left = '0';
                    m.style.width = '100vw'; m.style.height = '100vh';
                    m.style.background = 'rgba(0,0,0,0.5)';
                    m.style.zIndex = '99999';
                    m.style.display = 'none'; // Hidden by default
                    m.style.alignItems = 'center';
                    m.style.justifyContent = 'center';
                    m.innerHTML = `
                        <div style="background:white; padding:25px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2); text-align:center; max-width:400px;">
                            <h3 style="margin-top:0; color:#dc2626;">Session Expiring</h3>
                            <p style="color:#555; margin:15px 0;">You have been inactive for a while. You will be logged out in <span id="session-countdown" style="font-weight:bold">60</span> seconds.</p>
                            <button id="stay-logged-in-btn" class="btn btn-primary" style="padding:10px 20px; font-size:1rem; cursor:pointer;">Stay Logged In</button>
                        </div>
                    `;
                    document.body.appendChild(m);

                    // Button click forces simple reset
                    const btn = m.querySelector('#stay-logged-in-btn');
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation(); // Stop bubbling
                        console.log('[Auto-Logout] User clicked Stay Logged In');
                        btn.textContent = 'Resuming...';
                        resetTimers();
                    });
                }
                return m;
            };

            // Throttle Main Reset
            let lastReset = 0;
            const throttledReset = () => {
                const now = Date.now();
                if (now - lastReset > 5000) {
                    resetTimers();
                    lastReset = now;
                }
            };

            // Events
            ['load', 'mousemove', 'mousedown', 'click', 'scroll', 'keypress', 'touchstart'].forEach(evt => {
                window.addEventListener(evt, throttledReset, { passive: true });
            });

            // Start
            resetTimers();
        }

    };

    function applyViewportLayoutMode() {
        if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return;
        const width = window.innerWidth || document.documentElement.clientWidth || 0;
        const height = window.innerHeight || document.documentElement.clientHeight || 0;
        const mobile = width <= 768;
        const compact = width <= 1440;
        const tight = width <= 1280 || height <= 820;
        const short = height <= 760;
        const autoCollapse = width <= 1366 || height <= 820;
        const body = document.body;

        body.classList.toggle('viewport-compact', compact);
        body.classList.toggle('viewport-tight', tight);
        body.classList.toggle('viewport-short', short);
        body.classList.toggle('sidebar-auto-collapsed', !mobile && autoCollapse);

        const sb = document.querySelector('.sidebar');
        if (sb) {
            if (mobile) {
                sb.classList.remove('auto-collapsed');
            } else {
                sb.classList.remove('mobile-open');
                sb.classList.toggle('auto-collapsed', autoCollapse);
                body.classList.remove('mobile-sidebar-open');
            }
        }

        refreshMobileSidebarControls();
    }

    let viewportLayoutWatcherBound = false;
    function ensureViewportLayoutWatcher() {
        if (viewportLayoutWatcherBound || typeof window === 'undefined') {
            applyViewportLayoutMode();
            return;
        }
        viewportLayoutWatcherBound = true;

        let resizeTimer = null;
        const scheduleApply = () => {
            if (resizeTimer) window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                resizeTimer = null;
                applyViewportLayoutMode();
            }, 60);
        };

        window.addEventListener('resize', scheduleApply, { passive: true });
        window.addEventListener('orientationchange', scheduleApply, { passive: true });
        window.addEventListener('load', applyViewportLayoutMode, { passive: true });
        applyViewportLayoutMode();
    }

    function isMobileShellViewport() {
        if (typeof window === 'undefined') return false;
        return (window.innerWidth || document.documentElement.clientWidth || 0) <= 1024;
    }

    function refreshMobileSidebarControls() {
        if (typeof document === 'undefined' || !document.body) return;

        const body = document.body;
        const sidebar = document.querySelector('.sidebar');
        const fab = document.getElementById('mobileSidebarFab');
        const backdrop = document.getElementById('mobileSidebarBackdrop');
        const enabled = Boolean(sidebar) && isMobileShellViewport();
        const open = enabled && sidebar.classList.contains('mobile-open');

        body.classList.toggle('mobile-sidebar-enabled', enabled);
        body.classList.toggle('mobile-sidebar-open', open);

        if (sidebar) {
            sidebar.id = sidebar.id || 'appSidebar';
            sidebar.setAttribute('aria-hidden', open ? 'false' : 'true');
        }

        if (fab) {
            fab.hidden = !enabled;
            fab.setAttribute('aria-expanded', open ? 'true' : 'false');
            fab.setAttribute('aria-controls', sidebar?.id || 'appSidebar');
        }

        if (backdrop) {
            backdrop.hidden = !open;
        }
    }

    function ensureMobileSidebarControls() {
        if (typeof document === 'undefined' || !document.body) return;

        let fab = document.getElementById('mobileSidebarFab');
        if (!fab) {
            fab = document.createElement('button');
            fab.id = 'mobileSidebarFab';
            fab.type = 'button';
            fab.className = 'mobile-sidebar-fab';
            fab.setAttribute('aria-label', 'Open sidebar menu');
            fab.innerHTML = '<i class="bi bi-list"></i>';
            fab.onclick = () => exports.toggleSidebar();
            document.body.appendChild(fab);
        }

        let backdrop = document.getElementById('mobileSidebarBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('button');
            backdrop.id = 'mobileSidebarBackdrop';
            backdrop.type = 'button';
            backdrop.className = 'mobile-sidebar-backdrop';
            backdrop.hidden = true;
            backdrop.setAttribute('aria-label', 'Close sidebar menu');
            backdrop.onclick = () => exports.closeSidebar();
            document.body.appendChild(backdrop);
        }

        if (!document.body.hasAttribute('data-mobile-sidebar-esc-bound')) {
            document.body.setAttribute('data-mobile-sidebar-esc-bound', 'true');
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    exports.closeSidebar();
                }
            });
        }

        refreshMobileSidebarControls();
    }

    exports.closeSidebar = () => {
        const sb = document.querySelector('.sidebar');
        if (!sb) return;
        sb.classList.remove('mobile-open');
        refreshMobileSidebarControls();
    };

    exports.toggleSidebar = () => {
        const sb = document.querySelector('.sidebar');
        if (sb) {
            if (isMobileShellViewport()) {
                sb.classList.toggle('mobile-open');
                refreshMobileSidebarControls();
            } else {
                sb.classList.toggle('collapsed');
                localStorage.setItem('sidebar_collapsed', sb.classList.contains('collapsed'));
                applyViewportLayoutMode();
            }
        }
    };

    // Start Auto-Logout Monitor
    if (typeof document !== 'undefined') {
        // try { exports.auth.initAutoLogout(); } catch (e) { console.error(e); }
        try { ensureViewportLayoutWatcher(); } catch (e) { console.error(e); }
    }

    // --- Store (Frontend State) ---
    exports.store = {
        get me() { return exports.auth.getUser(); }
    };

    // --- Toast ---
    // --- Global Loader ---
    let loaderCount = 0;
    function createLoader() {
        if (document.getElementById('global-loader')) return;
        const div = document.createElement('div');
        div.id = 'global-loader';
        div.innerHTML = `
            <div class="loader-content">
                <div class="loader-icon-container">
                    <div class="loader-icon"><i class="bi bi-stars"></i></div>
                    <div class="loader-glow"></div>
                </div>
                <div class="loader-text">${BRAND_NAME}</div>
                <div class="loader-sub">
                    Loading Experience
                </div>
                <div class="loader-progress-container">
                    <div class="loader-progress-bar"></div>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }

    function toggleLoader(show) {
        if (show) {
            loaderCount++;
            createLoader();
            const l = document.getElementById('global-loader');
            if (l) requestAnimationFrame(() => {
                if (loaderCount > 0) l.classList.add('visible');
            });
        } else {
            loaderCount = Math.max(0, loaderCount - 1);
            if (loaderCount === 0) {
                const l = document.getElementById('global-loader');
                if (l) l.classList.remove('visible');
            }
        }
    }

    const PREMIUM_MOTION_SELECTORS = [
        '.header',
        '.card',
        '.modal-content',
        '.machine',
        '.line-row',
        '.section',
        '.panel',
        '.tile',
        '.widget',
        '.stat-card',
        '.stats-card',
        '.metric-card',
        '.summary-card',
        '.chart-card',
        '.dashboard-card',
        '.info-card',
        '.table-card',
        '.table-wrap',
        '.form-group',
        '.filters',
        '.filter-bar',
        '.hero',
        '.hero-card',
        '.mobile-nav .nav-item'
    ];
    let premiumMotionObserver = null;
    let premiumMotionMutationObserver = null;
    let premiumMotionRefreshTimer = null;

    function revealMotionTarget(node) {
        if (!(node instanceof HTMLElement) || node.classList.contains('motion-visible')) return;
        requestAnimationFrame(() => node.classList.add('motion-visible'));
    }

    function collectMotionTargets(root = document) {
        const seen = new Set();
        const targets = [];
        const scopes = [];

        if (root && typeof root.matches === 'function') {
            scopes.push(root);
        }
        if (!root || typeof root.querySelectorAll !== 'function') {
            scopes.push(document);
        } else if (root !== document) {
            scopes.push(root);
        } else {
            scopes.push(document);
        }

        PREMIUM_MOTION_SELECTORS.forEach(selector => {
            scopes.forEach(scope => {
                try {
                    if (scope !== document && typeof scope.matches === 'function' && scope.matches(selector) && !seen.has(scope)) {
                        seen.add(scope);
                        targets.push(scope);
                    }
                    const nodes = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
                    nodes.forEach(node => {
                        if (!seen.has(node)) {
                            seen.add(node);
                            targets.push(node);
                        }
                    });
                } catch (_err) {
                    // Ignore invalid selector usage for individual scopes
                }
            });
        });

        return targets;
    }

    function refreshPremiumMotion(root = document) {
        if (typeof document === 'undefined' || !document.body) return;
        const reduceMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        let order = 0;

        collectMotionTargets(root).forEach(node => {
            if (!(node instanceof HTMLElement)) return;
            if (node.id === 'global-loader' || node.closest('#global-loader')) return;
            if (node.dataset.motionBound !== 'true') {
                node.dataset.motionBound = 'true';
                node.classList.add('motion-target');
            }
            node.style.setProperty('--motion-order', String(order % 7));
            order++;

            if (reduceMotion) {
                node.classList.add('motion-visible');
                return;
            }

            if (!premiumMotionObserver) {
                revealMotionTarget(node);
                return;
            }

            premiumMotionObserver.observe(node);
            const rect = node.getBoundingClientRect();
            if (rect.top <= window.innerHeight * 0.9) {
                revealMotionTarget(node);
                premiumMotionObserver.unobserve(node);
            }
        });
    }

    function schedulePremiumMotionRefresh(root = document) {
        if (premiumMotionRefreshTimer) clearTimeout(premiumMotionRefreshTimer);
        premiumMotionRefreshTimer = setTimeout(() => refreshPremiumMotion(root), 40);
    }

    function initPremiumMotion() {
        if (typeof document === 'undefined' || !document.body) return;
        if (document.body.dataset.premiumMotionInit === 'true') return;
        document.body.dataset.premiumMotionInit = 'true';

        const reduceMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!reduceMotion && 'IntersectionObserver' in window) {
            premiumMotionObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting || entry.intersectionRatio > 0.12) {
                        entry.target.classList.add('motion-visible');
                        premiumMotionObserver.unobserve(entry.target);
                    }
                });
            }, {
                threshold: 0.12,
                rootMargin: '0px 0px -48px 0px'
            });
        }

        if (!reduceMotion && 'MutationObserver' in window) {
            premiumMotionMutationObserver = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    const hasElementNode = Array.from(mutation.addedNodes || []).some(node => node && node.nodeType === 1);
                    if (hasElementNode) {
                        schedulePremiumMotionRefresh(document);
                        break;
                    }
                }
            });
            premiumMotionMutationObserver.observe(document.body, { childList: true, subtree: true });
        }

        requestAnimationFrame(() => document.body.classList.add('motion-ready'));
        refreshPremiumMotion(document);
    }

    exports.motion = {
        init: initPremiumMotion,
        refresh: schedulePremiumMotionRefresh
    };

    // Auto-Init Loader on Script Run
    if (typeof document !== 'undefined') {
        createLoader();
        const l = document.getElementById('global-loader');
        if (l) l.classList.add('visible');
        loaderCount = 1;

        // 1. Force Clear Safety (Stop "Unlimited Time" Loading)
        // If something hangs for > 5 seconds, kill the loader
        setTimeout(() => {
            if (loaderCount > 0) {
                console.warn('Loader Stuck? Forcing clear.');
                loaderCount = 0;
                toggleLoader(false);
            }
        }, 5000);

        // 2. DOMContentLoaded (Also Super Fast)
        document.addEventListener('DOMContentLoaded', () => {
            initPremiumMotion();
            schedulePremiumMotionRefresh(document);
            toggleLoader(false);
        });

        // 3. Window Load (Fallback)
        window.addEventListener('load', () => {
            schedulePremiumMotionRefresh(document);
            toggleLoader(false);
        });

        // 4. Ultimate Fallback (1.5s max)
        setTimeout(() => { if (loaderCount > 0) toggleLoader(false); }, 1500);

        if (document.readyState !== 'loading') {
            initPremiumMotion();
            schedulePremiumMotionRefresh(document);
        }
    }

    // --- Toast ---
    function toast(msg, type = 'info') {
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.bottom = '20px';
        div.style.right = '20px';
        div.style.padding = '12px 24px';
        div.style.borderRadius = '8px';
        div.style.color = '#fff';
        div.style.background = type === 'error' ? '#ef4444' : '#22c55e';
        div.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        div.style.zIndex = '9999';
        div.textContent = msg;
        document.body.appendChild(div);
        setTimeout(() => div.remove(), 3000);
    }
    exports.toast = toast;
    exports.toggleLoader = toggleLoader;

    // --- UI Helpers ---
    exports.ui = {
        /**
         * Enables click-to-select behavior on rows
         * @param {string|HTMLElement} container Selector or Element containing the rows
         * @param {string} itemSelector Selector for the individual rows
         */
        enableRowSelection: (container, itemSelector) => {
            const root = typeof container === 'string' ? document.querySelector(container) : container;
            if (!root) return;

            // Remove existing listeners to prevent duplicates (rudimentary way)
            // Ideally we check if attached, but delegation makes it safe to just re-attach or rely on one-time init.
            // We'll use a simple attribute check
            if (root.hasAttribute('data-row-select-init')) return;
            root.setAttribute('data-row-select-init', 'true');

            function handleSelect(e) {
                const row = e.target.closest(itemSelector);
                if (!row) return;

                // Clear all siblings
                root.querySelectorAll(itemSelector).forEach(r => r.classList.remove('selected'));

                // Select clicked
                row.classList.add('selected');
            }

            root.addEventListener('click', handleSelect);
            root.addEventListener('dblclick', handleSelect); // Redundant but explicit for users ensuring double click works
        }
    };

    // --- Navigation Config ---
    const MENU_CONFIG = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: 'bi-grid-1x2-fill',
            href: 'index.html',
            items: [
                { id: 'dash_planning', label: 'Planning', icon: 'bi-calendar3', href: 'index.html?view=planning' },
                { id: 'dash_moulding', label: 'Moulding', icon: 'bi-box-seam', href: 'production_dashboard.html' },
                { id: 'dash_shifting', label: 'Shifting', icon: 'bi-arrow-left-right', href: 'index.html?view=shifting' },
                { id: 'dash_packing', label: 'Packing', icon: 'bi-box2-fill', href: 'index.html?view=packing' }
            ]
        },
        {
            id: 'planning',
            label: 'Planning Board',
            icon: 'bi-calendar-week',
            href: 'planning.html',
            items: [
                { id: 'plan_create', label: 'Create Plan', icon: 'bi-plus-circle', href: 'planning.html?action=create' },
                { id: 'plan_master', label: 'Master Plan', icon: 'bi-table', href: 'planning.html?view=master' },
                { id: 'plan_timeline', label: 'Machine Timeline', icon: 'bi-clock-history', href: 'planning.html?view=timeline' },
                { id: 'plan_map', label: 'Machine Grid', icon: 'bi-grid-3x3', href: 'planning.html?view=map' },
                { id: 'plan_print_jc', label: 'Print JobCard', icon: 'bi-printer', href: 'planning.html?view=print_jc' },
                { id: 'plan_completed', label: 'Complete Production Plan', icon: 'bi-check-circle-fill', href: 'planning.html?view=prod_complete' },
                { id: 'mould_drop', label: 'Mould Change Report', icon: 'bi-exclamation-triangle', href: 'planning.html?view=mould_change' }
            ]
        },
        {
            id: 'analyze',
            label: 'Analyze',
            icon: 'bi-bar-chart-fill',
            href: 'analyze.html',
            items: [
                { id: 'ana_order', label: 'Order Analyze', icon: 'bi-cart', href: 'analyze.html?view=order' },
                { id: 'ana_mould', label: 'Mould Analyze', icon: 'bi-diagram-3', href: 'analyze.html?view=mould' },
                { id: 'ana_sup', label: 'Supervisor Analyze', icon: 'bi-person-badge', href: 'analyze.html?view=supervisor' },
                { id: 'ana_plant', label: 'Plant Analyze', icon: 'bi-building', href: 'analyze.html?view=plant' },
                { id: 'ana_machine', label: 'Machine Analyze', icon: 'bi-cpu', href: 'analyze.html?view=machine' }
            ]
        },
        {
            id: 'raw_material',
            label: 'Raw Material',
            icon: 'bi-moisture',
            href: 'raw_material_jobwise.html',
            items: [
                { id: 'rm_jobwise', label: 'Jobwise RM', icon: 'bi-clipboard-check', href: 'raw_material_jobwise.html' }
            ]
        },
        {
            id: 'dpr',
            label: 'DPR',
            icon: 'bi-file-earmark-bar-graph',
            href: 'dpr.html',
            items: [
                { id: 'dpr_hourly', label: 'DPR Hourly', icon: 'bi-clock-history', href: 'dpr.html?view=hourly' },
                { id: 'dpr_summary', label: 'Compliance Summary', icon: 'bi-calendar-check', href: 'dpr.html?view=summary' },
                { id: 'dpr_daily_rep', label: 'Daily Report (NEW)', icon: 'bi-bar-chart-fill', href: 'dpr_daily_report.html' },
                { id: 'dpr_job_sum', label: 'Job Summary', icon: 'bi-file-earmark-medical', href: 'job_summary.html' },
                { id: 'dpr_setup', label: 'DPR Setup', icon: 'bi-folder-check', href: 'dpr.html?view=setup' },
                { id: 'dpr_settings', label: 'DPR Settings', icon: 'bi-gear', href: 'dpr.html?view=settings' }
            ]
        },
        {
            id: 'purchase',
            label: 'Purchase',
            icon: 'bi-bag-fill',
            href: 'purchase_orders.html',
            items: [
                { id: 'purch_vendors', label: 'Vendor Master', icon: 'bi-person-lines-fill', href: 'purchase_vendors.html' },
                { id: 'purch_orders', label: 'Purchase Orders', icon: 'bi-cart', href: 'purchase_orders.html' },
                { id: 'purch_grn', label: 'GRN / Update', icon: 'bi-check2-square', href: 'purchase_grn.html' },
                { id: 'purch_reports', label: 'Purchase Reports', icon: 'bi-file-earmark-bar-graph', href: 'purchase_reports.html' }
            ]
        },
        {
            id: 'masters',
            label: 'Masters',
            icon: 'bi-database-fill',
            href: 'masters.html',
            items: [
                { id: 'master_order', label: 'Order Master', icon: 'bi-cart-fill', href: 'masters.html?type=orders' },
                { id: 'master_machine', label: 'Machine Master', icon: 'bi-hdd-network', href: 'masters.html?type=machines' },
                { id: 'master_orjr', label: 'OR-JR Status', icon: 'bi-graph-up', href: 'masters.html?type=orjr' },
        { id: 'master_orjr_wise_summary', label: 'ORJR Wise Summary', icon: 'bi-table', href: 'masters.html?type=orjrwise' },
        { id: 'master_orjr_wise_detail', label: 'ORJR Wise Detail', icon: 'bi-file-earmark-richtext', href: 'masters.html?type=orjrwisedetail' },
        { id: 'master_jc_detail', label: 'JC Detail', icon: 'bi-journal-richtext', href: 'masters.html?type=jcdetails' },
        { id: 'master_boplanning_detail', label: 'BO Planning Detail', icon: 'bi-clipboard-data', href: 'masters.html?type=boplanningdetail' },
                { id: 'master_wip_stock', label: 'WIP Stock', icon: 'bi-box-seam-fill', href: 'masters.html?type=wipstock' },
                { id: 'master_mould', label: 'Mould Master', icon: 'bi-gem', href: 'masters.html?type=moulds' }
            ]
        },
        {
            id: 'quality',
            label: 'Quality',
            icon: 'bi-check-circle-fill',
            href: 'Quality.html',
            items: [
                { id: 'qc_dash', label: 'QC Dashboard', icon: 'bi-grid-1x2', href: 'Quality.html?view=dashboard' },
                { id: 'qc_comp', label: 'Compliance Summary', icon: 'bi-table', href: 'Quality.html?view=compliance' },
                { id: 'qc_hour', label: 'Quality Hourly', icon: 'bi-clock-history', href: 'Quality.html?view=hourly' },
                { id: 'qc_app', label: 'Supervisor App', icon: 'bi-phone', href: 'QCSupervisor.html' }
            ]
        },
        {
            id: 'hr',
            label: 'HR',
            icon: 'bi-people-fill',
            href: 'hr.html',
            items: [
                { id: 'hr_operators', label: 'Machine Operators', icon: 'bi-person-badge', href: 'hr.html?view=operators' },
                { id: 'hr_scan', label: 'Engineer Scan', icon: 'bi-qr-code-scan', href: 'hr.html?view=scan' },
                { id: 'hr_history', label: 'Scan History', icon: 'bi-clock-history', href: 'hr.html?view=history' }
            ]
        },
        {
            id: 'shifting',
            label: 'Shifting Module',
            icon: 'bi-box-seam',
            href: 'shifting_reports.html',
            items: [
                { id: 'shift_live', label: 'Live Production', icon: 'bi-activity', href: 'shifting_reports.html?view=live' },
                { id: 'shift_reconcile', label: 'Job Reconciliation', icon: 'bi-clipboard-check', href: 'shifting_reports.html?view=reconcile' },
                { id: 'shift_summary', label: 'Shifting Summary', icon: 'bi-table', href: 'shifting_summary.html' },
                { id: 'shift_logs', label: 'Shifting Logs', icon: 'bi-clock-history', href: 'shifting_logs.html' }
            ]
        },
        {
            id: 'wip',
            label: 'WIP Internal',
            icon: 'bi-cone-striped', // Construction/WIP Icon
            href: 'wip.html',
            items: [
                { id: 'wip_appr', label: 'Approvals', icon: 'bi-check-circle', href: 'wip.html?view=approvals' },
                { id: 'wip_stock', label: 'Stock View', icon: 'bi-box-seam', href: 'wip.html?view=stock' },
                { id: 'wip_logs', label: 'Outward Logs', icon: 'bi-journal-text', href: 'wip.html?view=logs' }
            ]
        },
        {
            id: 'reports',
            label: 'Reports',
            icon: 'bi-file-earmark-bar-graph',
            href: 'reports.html',
            items: [
                { id: 'rep_wip', label: 'WIP Report', icon: 'bi-box-seam', href: 'reports.html?view=wip' },
                { id: 'rep_jms_plan', label: 'JMS Plan', icon: 'bi-clipboard2-data', href: 'reports.html?view=jms-plan' }
            ]
        },
        {
            id: 'users',
            label: 'User Management',
            icon: 'bi-person-gear',
            href: 'users.html',
            items: []
        },
        {
            id: 'notifications',
            label: 'Notifications',
            icon: 'bi-bell',
            href: 'notifications.html',
            items: []
        },
        {
            id: 'settings',
            label: 'Settings',
            icon: 'bi-sliders',
            href: 'settings.html',
            visibleIf: (user) => isAdminLikeUser(user),
            items: [
                {
                    id: 'settings_factory',
                    label: 'Create Factory',
                    icon: 'bi-plus-circle',
                    href: 'settings.html?view=factory',
                    visibleIf: (user) => isSuperadminUser(user)
                }
            ]
        },
        {
            id: 'joy',
            label: 'Joy Learning',
            icon: 'bi-stars',
            href: 'joy.html',
            items: [
                { id: 'joy_training', label: 'Training Center', icon: 'bi-cpu-fill', href: 'joy.html?view=train' },
                { id: 'joy_brain', label: 'Brain / My Learning', icon: 'bi-memory', href: 'joy.html?view=brain' },
                { id: 'joy_tutorials', label: 'Tutorials', icon: 'bi-book-half', href: 'joy.html?view=tutorials' },
                { id: 'joy_teach', label: 'Teach & Share', icon: 'bi-easel2-fill', href: 'joy.html?view=teach' },
                { id: 'joy_resources', label: 'Resources', icon: 'bi-box-seam-fill', href: 'joy.html?view=resources' },
                { id: 'joy_community', label: 'Community', icon: 'bi-people-fill', href: 'joy.html?view=community' }
            ]
        },
        {
            id: 'grinding',
            label: 'Grinding',
            icon: 'bi-recycle',
            href: 'grinding.html',
            items: [
                { id: 'grind_job', label: 'Job Wise Rejection', icon: 'bi-list-task', href: 'grinding.html?view=job_rejection' }
            ]
        },
        {
            id: 'packing',
            label: 'Packing',
            icon: 'bi-box2-fill',
            href: 'assembly.html',
            items: [
                { id: 'pack_assembly', label: 'Assembly Planning', icon: 'bi-grid-3x3-gap-fill', href: 'assembly.html' },
                { id: 'pack_scan', label: 'Production Scanning', icon: 'bi-upc-scan', href: 'scanning.html' },
                { id: 'pack_scan', label: 'Scanning (List)', icon: 'bi-list-ul', href: 'scanning_list.html' },
                { id: 'pack_scan', label: 'Dashboard', icon: 'bi-speedometer2', href: 'scanning_dashboard.html' },
                { id: 'pack_barcode', label: 'Barcode Print', icon: 'bi-printer', href: 'barcode_printer.html' },
                { id: 'pack_settings', label: 'Settings', icon: 'bi-gear', href: 'packing_settings.html' }
            ]
        }
    ];

    exports.MENU = MENU_CONFIG; // Export for users.html

    // --- Render Sidebar ---
    exports.renderShell = (activePage) => {
        const user = exports.auth.getUser();
        const factoryScope = exports.factories.getCurrentScope();
        const allowedFactories = exports.factories.getAllowed();
        const inferredFactoryName = factoryScope.name
            || (allowedFactories.length === 1 ? allowedFactories[0].name : '')
            || (userCanSelectAllFactories(user) ? 'All Factories' : 'No Unit Selected');
        const factoryLabel = String(inferredFactoryName || 'No Unit Selected').toUpperCase();
        const roleLabel = formatSidebarLabel(user.role || user.role_code || 'operator');
        const canSwitchFactory = isAdminLikeUser(user);
        const canShowEntry = (entry) => {
            try {
                return typeof entry?.visibleIf === 'function' ? entry.visibleIf(user) !== false : true;
            } catch (e) {
                console.warn('Visibility Error:', e);
                return false;
            }
        };

        // Prevent double render (idempotency)
        if (document.querySelector('.sidebar')) {
            ensureMobileSidebarControls();
            applyViewportLayoutMode();
            return;
        }
        console.log('[App] Rendering Shell for:', activePage);

        let navHtml = '';
        const isAdmin = exports.auth.isAdminLike(user);
        const perms = user.permissions || {};

        MENU_CONFIG.forEach(menu => {
            if (!canShowEntry(menu)) return;

            // Check Parent Permission (View)
            // Use .can() to respect Role Fallback
            let canViewParent = false;
            try {
                canViewParent = exports.auth.can(menu.id, 'view');
            } catch (e) { console.warn('Auth Error:', e); }

            if (canViewParent) {
                // Render Items
                let subHtml = '';
                const visibleSubItems = [];
                if (menu.items && menu.items.length > 0) {
                    menu.items.forEach(sub => {
                        if (!canShowEntry(sub)) return;

                        const canViewSub = exports.auth.can(sub.id, 'view');

                        if (canViewSub) {
                            visibleSubItems.push(sub);
                            // Robust Active Check
                            const subPath = sub.href.split('?')[0];
                            const subParams = new URLSearchParams(sub.href.split('?')[1] || '');
                            const currentParams = new URLSearchParams(window.location.search);
                            const currentPath = window.location.pathname.substring(1);

                            let match = (currentPath === subPath);
                            if (match) {
                                for (const [key, val] of subParams.entries()) {
                                    if (currentParams.get(key) !== val) { match = false; break; }
                                }
                            }
                            const subActive = match ? 'active-link' : '';

                            subHtml += `
                            <li>
                                <a href="${sub.href}" target="_self" class="sub-link ${subActive}">
                                    <i class="bi ${sub.icon || 'bi-chevron-right'}" style="font-size:0.9rem; margin-right:6px; opacity:0.8"></i> <span class="nav-text">${sub.label}</span>
                                </a>
                            </li>`;
                        }
                    });
                }

                // Check Matching for Parent Highlighting
                const isParentActive = visibleSubItems.some(sub => {
                    const subPath = sub.href.split('?')[0];
                    const subParams = new URLSearchParams(sub.href.split('?')[1] || '');
                    const currentParams = new URLSearchParams(window.location.search);
                    const currentPath = window.location.pathname.substring(1);
                    let match = (currentPath === subPath);
                    if (match) {
                        for (const [key, val] of subParams.entries()) {
                            if (currentParams.get(key) !== val) return false;
                        }
                        return true;
                    }
                    return false;
                }) || (menu.id === activePage);

                const hasSub = subHtml.length > 0;

                navHtml += `
                <li class="nav-item ${isParentActive ? 'active' : ''}">
                    <a href="${menu.href}" target="_self" class="nav-link-main">
                        <i class="bi ${menu.icon || 'bi-circle'}"></i> 
                        <span class="nav-text">${menu.label}</span>
                    </a>
                    ${hasSub ? `<ul class="nav-sub">${subHtml}</ul>` : ''}
                </li>`;
            }
        });

        const html = `
      <div class="brand" style="justify-content: space-between; padding: 20px 15px;">
         <a href="/index.html" class="brand-logo" aria-label="${BRAND_NAME} Home">
             <img src="/assets/jms-logo.png" alt="JMS logo">
             <span>${BRAND_NAME}</span>
         </a>
         <i class="bi bi-list" id="sidebar-toggle" style="font-size:1.5rem; color: var(--sidebar-text); cursor:pointer; transition: color 0.2s;"></i>
      </div>
      <ul class="nav-links">
        ${navHtml}
      </ul>
      <div class="user-profile">
        <div class="sidebar-avatar-shell">
          <div class="sidebar-avatar-fallback">
            ${(user.username || 'U').charAt(0).toUpperCase()}
          </div>
          <span class="sidebar-avatar-dot"></span>
        </div>
          <div class="sidebar-user-meta">
          <div class="sidebar-user-name">${user.username || 'Guest'}</div>
          <div class="sidebar-role-label">${roleLabel}</div>
          <div class="sidebar-user-unit">${inferredFactoryName || 'No Unit Selected'}</div>
        </div>
        
        <div class="sidebar-user-actions">
             ${canSwitchFactory ? `
            <button onclick="localStorage.removeItem('jpsms_factory_id'); localStorage.removeItem('jpsms_factory_name'); localStorage.removeItem('jpsms_write_factory_id'); localStorage.removeItem('jpsms_write_factory_name'); window.location.href='/login.html'" class="btn btn-outline" style="padding:2px 4px;font-size:0.9rem;border:none;background:transparent;color:var(--sidebar-text);" title="Switch Unit">
                <i class="bi bi-arrow-repeat"></i>
            </button>` : ''}

            <button onclick="JPSMS.auth.logout()" class="btn btn-outline" style="padding:2px 4px;font-size:1rem;border:none;background:transparent;color:white;" title="Logout">
                <i class="bi bi-box-arrow-right"></i>
            </button>
          </div>
      </div>
    `;

        const sidebar = document.createElement('div');
        sidebar.className = 'sidebar app-shell-sidebar';
        sidebar.id = 'appSidebar';
        sidebar.innerHTML = html;

        // Restore Collapsed State
        const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed'); // Optional for main content adjustment
        }

        // Toggle Logic
        const toggleBtn = sidebar.querySelector('#sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                if (isMobileShellViewport()) {
                    exports.closeSidebar();
                    return;
                }

                sidebar.classList.toggle('collapsed');
                const collapsed = sidebar.classList.contains('collapsed');
                localStorage.setItem('sidebar_collapsed', collapsed);

                // Adjust Main Content margin if needed via global class
                if (collapsed) document.body.classList.add('sidebar-collapsed');
                else document.body.classList.remove('sidebar-collapsed');
            };
        }

        /* 
          Note: app.css handles the .collapsed styles:
          - width: 70px
          - hide .brand-logo span, .nav-text, .nav-sub
          - align icons center 
        */

        document.body.prepend(sidebar);
        ensureMobileSidebarControls();
        applyViewportLayoutMode();

        // Inject Hamburger if Header Exists
        setTimeout(() => {
            const header = document.querySelector('.header');
            if (header && !document.getElementById('sidebarToggle')) {
                const btn = document.createElement('button');
                btn.id = 'sidebarToggle';
                btn.className = 'btn icon';
                btn.style.marginRight = '12px';
                btn.style.background = 'transparent';
                btn.style.border = '1px solid var(--border)';
                btn.style.color = 'var(--text-muted)';
                btn.innerHTML = '<i class="bi bi-list" style="font-size:1.2rem"></i>';
                btn.onclick = exports.toggleSidebar;

                // Insert at start
                header.insertBefore(btn, header.firstChild);
            }
        }, 100);

        // CSS for nested menus (injected here for simplicity, or should be in app.css)
        const style = document.createElement('style');
        style.textContent = `
            .nav-sub { list-style:none; padding-left: 15px; margin-top:5px; margin-bottom:10px; }
            .nav-sub li { margin-bottom: 4px; }
            .sub-link { color: var(--sidebar-text); text-decoration: none; font-size: 0.9rem; display:flex; align-items:center; gap:6px; transition:color 0.2s; }
            .sub-link:hover { color: #fff; }
            .sub-link.active-link { color: var(--accent-cyan, #01a8dd) !important; font-weight: 700; background: rgba(255,255,255,0.08); border-radius: 4px; padding-left:4px; }
            .nav-item.active .nav-link-main { color: #fff; font-weight: 600; }
        `;
        document.head.appendChild(style);

        let main = document.querySelector('.main-content');
        if (!main) {
            const wrapper = document.createElement('div');
            wrapper.className = 'main-content';
            wrapper.id = 'pageContent';
            while (document.body.childNodes.length > 1) {
                // Move content
                wrapper.appendChild(document.body.childNodes[1]);
            }
            document.body.appendChild(wrapper);
        } else {
            main.id = 'pageContent';
        }

        schedulePremiumMotionRefresh(document);
    };

    // --- Notification Helper ---
    function initNotificationBell() {
        const header = document.querySelector('.header');
        if (!header) return;

        // Create container if not exists
        let notifContainer = document.getElementById('notifBellContainer');
        if (!notifContainer) {
            notifContainer = document.createElement('div');
            notifContainer.id = 'notifBellContainer';
            notifContainer.style.cssText = 'position:relative; margin-right:20px; cursor:pointer; display:flex; align-items:center;';
            notifContainer.onclick = () => window.location.href = 'notifications.html';

            notifContainer.innerHTML = `
                <i class="bi bi-bell" style="font-size:1.4rem; color:var(--primary);"></i>
                <span id="notifBadge" style="position:absolute; top:-5px; right:-5px; 
                      background:#ef4444; color:white; font-size:0.7rem; font-weight:700; 
                      padding:1px 5px; border-radius:10px; border:2px solid #f8fafc; display:none; min-width:18px; text-align:center;">0</span>
            `;

            // Insert before user-info
            const userInfo = header.querySelector('.user-info');
            if (userInfo) header.insertBefore(notifContainer, userInfo);
            else header.appendChild(notifContainer);
        }

        checkUnread();
    }

    // Poll for notifications
    async function checkUnread() {
        try {
            const user = exports.auth.getUser();
            if (!user || !user.username) return;

            const res = await exports.api.request('/notifications/unread-count?user=' + user.username, { method: 'GET', skipLoader: true });
            if (res.ok) {
                const count = res.count;
                const badge = document.getElementById('notifBadge');
                if (badge) {
                    badge.innerText = count > 99 ? '99+' : count;
                    badge.style.display = count > 0 ? 'inline-block' : 'none';
                }
            }
        } catch (e) { console.error('Notif poll error', e); }
    }

    // Start Polling Global
    setInterval(checkUnread, 30000);

    // Decorate RenderShell to add Bell
    const _originalRender = exports.renderShell;
    exports.renderShell = function (page) {
        _originalRender(page);
        schedulePremiumMotionRefresh(document);
        setTimeout(() => {
            initNotificationBell();
            schedulePremiumMotionRefresh(document);
        }, 200);
    };

})(window.JPSMS);
