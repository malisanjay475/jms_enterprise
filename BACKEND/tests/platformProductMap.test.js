'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  STAGES,
  MODULES,
  WORKSPACES,
  GAPS,
  workspaceForRole,
  getProductMap
} = require('../src/modules/platform/productMap');
const { registerPlatformRoutes } = require('../src/modules/platform/registerPlatformRoutes');

const PUBLIC_DIR = path.join(__dirname, '..', 'PUBLIC');
const DISPOSITIONS = new Set(['keep', 'merge', 'retire']);

function pageHrefs(modules = MODULES) {
  const hrefs = [];
  modules.forEach((mod) => {
    hrefs.push(mod.primaryHref);
    (mod.pages || []).forEach((page) => hrefs.push(page.href));
  });
  WORKSPACES.forEach((workspace) => hrefs.push(workspace.primaryHref));
  return hrefs;
}

describe('platform product map', () => {
  it('orders the job spine from requirement to dispatch', () => {
    expect(STAGES.map((stage) => stage.id)).toEqual([
      'requirement', 'plan', 'run', 'quality', 'move', 'dispatch'
    ]);
  });

  it('gives every module and workspace a unique id', () => {
    const moduleIds = MODULES.map((mod) => mod.id);
    const workspaceIds = WORKSPACES.map((workspace) => workspace.id);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
    expect(new Set(workspaceIds).size).toBe(workspaceIds.length);
  });

  it('points workspaces and modules at real stages and pages', () => {
    const stageIds = new Set([...STAGES.map((stage) => stage.id), 'support']);
    const moduleIds = new Set(MODULES.map((mod) => mod.id));
    const fallbacks = WORKSPACES.filter((workspace) => workspace.fallback);

    expect(fallbacks).toHaveLength(1);
    MODULES.forEach((mod) => {
      expect(stageIds.has(mod.stageId)).toBe(true);
      expect(mod.purpose.length).toBeGreaterThan(10);
      expect(mod.target.length).toBeGreaterThan(10);
      (mod.pages || []).forEach((page) => {
        expect(DISPOSITIONS.has(page.disposition)).toBe(true);
      });
    });
    WORKSPACES.forEach((workspace) => {
      expect(stageIds.has(workspace.stageId)).toBe(true);
      workspace.moduleIds.forEach((id) => expect(moduleIds.has(id)).toBe(true));
      expect(workspace.roles.length).toBeGreaterThan(0);
    });
  });

  it('only links pages that exist on disk', () => {
    pageHrefs().forEach((href) => {
      expect(fs.existsSync(path.join(PUBLIC_DIR, href))).toBe(true);
    });
  });

  it('does not send anyone to the missing purchase report', () => {
    expect(pageHrefs().includes('purchase_reports.html')).toBe(false);
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'purchase_reports.html'))).toBe(false);
    expect(GAPS.some((gap) => gap.text.includes('purchase_reports.html'))).toBe(true);
  });

  it('keeps the planning dedup and the sync algebra on the record', () => {
    const planning = MODULES.find((mod) => mod.id === 'planning');
    const sync = MODULES.find((mod) => mod.id === 'sync');
    expect(planning.preserve.join(' ')).toMatch(/DISTINCT ON \(pb\.id\)/);
    expect(sync.preserve.join(' ')).toMatch(/natural keys|CONFLICT_KEYS/);
    expect(sync.preserve.join(' ')).toMatch(/wait-postgres/);
  });

  it('picks a workspace from the role, and the plant command otherwise', () => {
    expect(workspaceForRole('planner').id).toBe('planning');
    expect(workspaceForRole('PLANNING').id).toBe('planning');
    expect(workspaceForRole('supervisor').id).toBe('moulding');
    expect(workspaceForRole('qc_supervisor').id).toBe('quality');
    expect(workspaceForRole('shifting_supervisor').id).toBe('shifting');
    expect(workspaceForRole('hr').id).toBe('people');
    expect(workspaceForRole('admin').id).toBe('plant');
    expect(workspaceForRole('').id).toBe('plant');
    expect(workspaceForRole('someone-new').id).toBe('plant');
  });

  it('serves the map without a database', async () => {
    const app = express();
    registerPlatformRoutes(app);
    const res = await request(app).get('/api/platform/map');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(1);
    expect(res.body.modules.map((mod) => mod.id)).toEqual(getProductMap().modules.map((mod) => mod.id));
    expect(res.body.stages).toHaveLength(6);
  });

  it('reads the home KPIs from the fields the API actually returns', () => {
    const index = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    expect(index).toContain('data.active_machines');
    expect(index).toContain('data.pending_orders');
    expect(index).toContain('data.dpr_24h');
    expect(index).toContain('workspace.html');
    expect(index).not.toMatch(/animateValue\('kpi-active',\s*data\.active\)/);
  });

  it('points the role workspace at the map and the real KPI fields', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'workspace.html'), 'utf8');
    expect(html).toContain('/platform/map');
    expect(html).toContain('data.active_machines');
    expect(html).toContain('data.pending_orders');
    expect(html).toContain('data.dpr_24h');
  });
});
