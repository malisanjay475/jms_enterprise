const { ERP_API_TOKEN, ERP_WHITELIST_IPS } = process.env;

/**
 * Middleware: Validate Bearer Token
 */
function validateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn(`[ERP Auth] Missing or Invalid Header from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Missing valid Bearer token' });
    }

    const token = authHeader.split(' ')[1];

    if (token !== ERP_API_TOKEN) {
        console.warn(`[ERP Auth] Invalid Token Attempt from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid credentials' });
    }

    next();
}

/**
 * Middleware: IP Whitelisting
 * Only runs if ERP_WHITELIST_IPS is set in .env
 */
function whitelistIP(req, res, next) {
    if (!ERP_WHITELIST_IPS) return next(); // Skip if not configured

    const allowedIPs = ERP_WHITELIST_IPS.split(',').map(ip => ip.trim());
    const incomingIP = req.ip.replace('::ffff:', ''); // Clean IPv6 prefix if present

    if (!allowedIPs.includes(incomingIP)) {
        console.warn(`[ERP Auth] Blocked IP: ${incomingIP}`);
        return res.status(403).json({ error: 'Forbidden: IP not whitelisted' });
    }

    next();
}

module.exports = { validateToken, whitelistIP };
