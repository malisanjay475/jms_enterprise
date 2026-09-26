'use strict';

const fs = require('fs');
const path = require('path');

// The ERP change feed hands each change to ONE caller, so only production may pull
// from it. These guard the ERP_PULL_ENABLED switch that keeps staging off the feed.
describe('ERP_PULL_ENABLED switch (only production pulls from the ERP)', () => {
  const root = path.join(__dirname, '..', '..');
  const legacy = fs.readFileSync(path.join(__dirname, '..', 'src', 'legacy', 'registerLegacyRoutes.js'), 'utf8');

  it('blocks every ERP call at the single choke point (erpAuthedGet)', () => {
    expect(legacy).toMatch(/async function erpAuthedGet\(url\) \{\s*if \(!isErpPullEnabled\(\)\) \{/);
    expect(legacy).toMatch(/function isErpPullEnabled\(\) \{\s*return String\(process\.env\.ERP_PULL_ENABLED \?\? '1'\)\.trim\(\) !== '0';/);
  });

  it('does not start ERP AutoSync, and Run now refuses, when pulling is disabled', () => {
    const start = legacy.slice(legacy.indexOf('function startErpAutoSync'));
    expect(start.slice(0, 2000)).toMatch(/if \(!isErpPullEnabled\(\)\) \{[\s\S]*?return;/);
    const runNow = legacy.slice(legacy.indexOf("app.post('/api/reports/erp-autosync/run-now'"));
    expect(runNow.slice(0, 800)).toMatch(/if \(!isErpPullEnabled\(\)\) \{\s*return res\.status\(403\)/);
  });

  it('staging deploys set ERP_PULL_ENABLED=0, and the env writer defaults staging to 0', () => {
    const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-v1-staging.yml'), 'utf8');
    expect((wf.match(/ERP_PULL_ENABLED: "0"/g) || []).length).toBe(2);
    expect((wf.match(/envs: [^\n]*ERP_PULL_ENABLED/g) || []).length).toBe(2);

    const sh = fs.readFileSync(path.join(root, 'scripts', 'vps-safe-deploy.sh'), 'utf8');
    expect(sh).toMatch(/ERP_PULL_ENABLED=\$\{ERP_PULL_ENABLED:-\$\(default_erp_pull_enabled\)\}/);
    expect(sh).toMatch(/"\$\{DEPLOY_ENVIRONMENT:-production\}" == "staging" \]\]; then echo 0; else echo 1; fi/);

    const compose = fs.readFileSync(path.join(root, 'docker-compose.vps-v1-isolated.yml'), 'utf8');
    expect(compose).toMatch(/ERP_PULL_ENABLED: \$\{ERP_PULL_ENABLED:-1\}/);
  });
});
