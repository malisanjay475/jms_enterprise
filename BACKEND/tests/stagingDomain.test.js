'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Staging is served at https://staging.jmsocean.cloud through the same Traefik as
// production. The one thing that must never happen: staging registering production's
// `jms` router / jmsocean.cloud host (Traefik would round-robin live users onto the
// staging database). These guard the compose labels and the deploy .env writer.
describe('staging.jmsocean.cloud routing', () => {
  const root = path.join(__dirname, '..', '..');
  const compose = fs.readFileSync(path.join(root, 'docker-compose.vps-v1-isolated.yml'), 'utf8');
  const sh = path.join(root, 'scripts', 'vps-safe-deploy.sh');
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-v1-staging.yml'), 'utf8');

  it('app router/service names and host are parameterised with production defaults', () => {
    expect(compose).toContain('traefik.http.routers.${TRAEFIK_ROUTER:-jms}.rule=Host(`${TRAEFIK_HOST:-jmsocean.cloud}`)');
    expect(compose).toContain('traefik.http.services.${TRAEFIK_ROUTER:-jms}.loadbalancer.server.port=3000');
    expect(compose).toContain('traefik.http.routers.${TRAEFIK_ROUTER:-jms}.service=${TRAEFIK_ROUTER:-jms}');
    // no hard-coded production router left on the app service
    const appLabels = compose.slice(compose.indexOf('    labels:'), compose.indexOf('  # Web pgAdmin'));
    expect(appLabels).not.toMatch(/routers\.jms[.-]/);
    expect(compose).toContain('traefik.enable=${TRAEFIK_PGADMIN_ENABLE:-true}');
  });

  const hasBash = (() => { try { execFileSync('bash', ['-c', 'true']); return true; } catch (e) { return false; } })();
  const resolve = (env) => execFileSync('bash', ['-c',
    'source <(sed -n "/^resolve_traefik_settings()/,/^}/p" "$SH"); resolve_traefik_settings; echo "$TRAEFIK_ROUTER|$TRAEFIK_HOST|$TRAEFIK_WWW_HOST|$TRAEFIK_WWW_PATH|$TRAEFIK_PGADMIN_ENABLE"'],
  { env: { ...process.env, SH: sh.split(path.sep).join('/'), ...env } }).toString().trim();

  (hasBash ? it : it.skip)('the .env writer forces staging names even if production values are passed', () => {
    expect(resolve({ DEPLOY_ENVIRONMENT: 'staging', TRAEFIK_ROUTER: 'jms', TRAEFIK_HOST: 'jmsocean.cloud' }))
      .toBe('jms-staging|staging.jmsocean.cloud|staging.jmsocean.cloud|/__no-www-on-staging__|false');
    expect(resolve({ DEPLOY_ENVIRONMENT: 'production' }))
      .toBe('jms|jmsocean.cloud|www.jmsocean.cloud|/|true');
  });

  it('staging workflow routes through Traefik and keeps the plain port on loopback', () => {
    expect((wf.match(/TRAEFIK_ENABLE: "true"/g) || []).length).toBe(2);
    expect((wf.match(/TRAEFIK_HOST: staging\.jmsocean\.cloud/g) || []).length).toBe(2);
    expect((wf.match(/V1_HTTP_BIND: "127\.0\.0\.1"/g) || []).length).toBe(2);
    expect(wf).not.toMatch(/V1_HTTP_BIND: "0\.0\.0\.0"/);
    expect((wf.match(/envs: [^\n]*TRAEFIK_ROUTER,TRAEFIK_HOST/g) || []).length).toBe(2);
  });
});
