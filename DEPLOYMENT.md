# JMS Enterprise Deployment Guide

## Release flow
- `feature/*` branches: normal development work
- `develop`: staging deploy branch
- `main`: production deploy branch

## What happens now
- Pull requests should be merged into `develop` first for staging validation.
- Push to `develop` runs backend boot validation, builds a staging image, and deploys staging if staging secrets exist.
- Push to `main` runs backend boot validation, builds an immutable production image, and deploys production with health checks and rollback.
- Production no longer depends on the legacy PM2 workflow.

## Production safety features
- Immutable production image tags: `sha-<commit>`
- Floating convenience tag: `latest`
- Docker health checks on the app container
- VPS deploy waits for health before considering the release successful
- Automatic rollback to the previously successful image if the new image fails health checks
- Automatic database backup before deploy by default
- Separate compose project names can be used for staging and production

## Pull request and branch workflow
- All code changes should start on `feature/*` branches.
- Open pull requests into `develop` first.
- `develop` is the staging integration branch.
- Only tested changes should be promoted from `develop` to `main`.
- `main` should be protected in GitHub and require PR merge only.
- PRs should require the `JMS PR validation` workflow before merge.
- CODEOWNERS is configured so GitHub can auto-request review from the repo owner.

## Required GitHub secrets

### Production
- `HOSTINGER_SSH_HOST`
- `HOSTINGER_SSH_USER`
- `VPS_DEPLOY_PATH`
- `VPS_POSTGRES_PASSWORD`
- `VPS_SSH_PASSWORD` or `HOSTINGER_SSH_KEY`
- `HOSTINGER_SSH_KEY_PASSPHRASE` if the key is encrypted
- `VPS_GEMINI_API_KEY` optional
- `GHCR_PULL_TOKEN` optional if the package is not public
- `V1_HTTP_PORT` optional, defaults to `9091`
- `MAIN_SERVER_URL` optional
- `LOCAL_FACTORY_ID` optional
- `SYNC_API_KEY` optional
- `DB_BACKUP_BEFORE_DEPLOY` optional, defaults to `1`

### Staging
- `STAGING_HOSTINGER_SSH_HOST`
- `STAGING_HOSTINGER_SSH_USER`
- `STAGING_VPS_DEPLOY_PATH`
- `STAGING_VPS_POSTGRES_PASSWORD`
- `STAGING_VPS_SSH_PASSWORD` or `STAGING_HOSTINGER_SSH_KEY`
- `STAGING_HOSTINGER_SSH_KEY_PASSPHRASE` if the key is encrypted
- `STAGING_V1_HTTP_PORT` optional, defaults to `9092`
- `STAGING_VPS_GEMINI_API_KEY` optional
- `STAGING_MAIN_SERVER_URL` optional
- `STAGING_LOCAL_FACTORY_ID` optional
- `STAGING_SYNC_API_KEY` optional
- `STAGING_DB_BACKUP_BEFORE_DEPLOY` optional, defaults to `1`

## Manual deploy and rollback
- Use `.github/workflows/deploy-vps-docker-isolated.yml`
- Default manual deploy uses `latest`
- To roll back, run the workflow manually and provide a previous image tag such as `sha-abc123def456`

## Senior-level workflow
1. Create a feature branch.
2. Test locally.
3. Open a PR into `develop`.
4. Let staging validate and deploy.
5. Smoke test staging.
6. Merge `develop` into `main`.
7. Let production deploy automatically.
8. Verify production health and logs.

## Important note
- This setup is much safer, but no single-container deployment can promise literal zero downtime in all cases.
- What it does guarantee is controlled deploys, automatic health validation, and fast rollback to the previous good image.

## GitHub settings to enable manually
These are GitHub repository settings, so they must be turned on in GitHub UI:

1. Protect `main`
2. Protect `develop`
3. Require pull request before merge
4. Require status checks before merge
5. Select `JMS PR validation` as a required check
6. Require branches to be up to date before merge
7. Restrict direct pushes to `main`
8. Optionally require review from CODEOWNERS
9. Add `staging` and `production` GitHub environments with approval rules if desired
