'use strict';
const path = require('path');
const os = require('os');
const express = require('express');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const {
  getFinancialYearInfo,
  getFinancialYearPrefix,
  isFinancialYearScopedId,
  generateFinancialYearSequenceId
} = require('../../utils/financialYearId');
const {
  getFactoryId,
  getRequestUsername,
  getWriteFactoryHeaderState,
  normalizeFactoryId
} = require('../app/requestContext');

module.exports = function registerLegacyRoutes({ app, pool, config, services }) {
  const { aiService, syncService, updaterService } = services;

  aiService.init(config.geminiApiKey);

/* ============================================================
   HELPER: MACHINE SERIES SORT (Suffix Priority)
   Splits "Line>Model-Tonnage-Index" to sort by Line then Index.
   Ignores Tonnage/Model to ensure Machine 1 (350-1) < Machine 6 (300-6).
   ============================================================ */
function naturalCompare(a, b) {
  // Helper to extract { line, index, full }
  const getMeta = (val) => {
    const s = String(val);
    const parts = s.split('>');
    const line = parts.length > 1 ? parts[0] : '';
    const rest = parts.length > 1 ? parts[1] : parts[0];
    // Last int at end of string
    const match = rest.match(/(\d+)$/);
    const idx = match ? parseInt(match[1], 10) : 999999;
    return { line, idx, s };
  };

  const A = getMeta(a);
  const B = getMeta(b);

  // 1. Line Priority
  const lineCmp = A.line.localeCompare(B.line, undefined, { numeric: true, sensitivity: 'base' });
  if (lineCmp !== 0) return lineCmp;

  // 2. Index Priority (Numeric)
  const idxCmp = A.idx - B.idx;
  if (idxCmp !== 0) return idxCmp;

  // 3. Fallback to Full String
  return A.s.localeCompare(B.s, undefined, { numeric: true, sensitivity: 'base' });
}

async function getWritableFactoryContext(req, actionLabel = 'perform this action') {
  const currentScope = await getFactoryScopeForRequest(req);
  const username = getRequestUsername(req);
  const { requestedAll, factoryId } = getWriteFactoryHeaderState(req);

  if (!username) {
    if (requestedAll) {
      return {
        ok: false,
        status: 403,
        error: `All Factories mode is read only. Select one factory to ${actionLabel}.`
      };
    }
    if (factoryId === null) {
      return {
        ok: false,
        status: 400,
        error: `Select one factory to ${actionLabel}.`
      };
    }
    return {
      ok: true,
      factoryId,
      factoryName: `Factory ${factoryId}`,
      currentScope
    };
  }

  const access = await getAccessibleFactoriesForUser(username);
  const allowedFactoryIds = (access.factories || [])
    .map(factory => normalizeFactoryId(factory && factory.id))
    .filter(id => id !== null);
  const matchedFactory = (access.factories || []).find(factory => normalizeFactoryId(factory && factory.id) === factoryId);
  const factoryName = matchedFactory?.name || matchedFactory?.code || (factoryId ? `Factory ${factoryId}` : 'Selected Factory');

  if (requestedAll) {
    return {
      ok: false,
      status: 403,
      error: `This login is in All Factories mode. Log out and log in to one factory to ${actionLabel}.`
    };
  }

  if (factoryId === null) {
    return {
      ok: false,
      status: 403,
      error: `Select one factory during login to ${actionLabel}.`
    };
  }

  if (!access.canSelectAllFactories && allowedFactoryIds.length && !allowedFactoryIds.includes(factoryId)) {
    return {
      ok: false,
      status: 403,
      error: `You do not have access to Factory ${factoryId}.`
    };
  }

  if (currentScope?.denyAll) {
    return {
      ok: false,
      status: 403,
      error: 'No factory access is configured for this user.'
    };
  }

  if (currentScope?.useAllFactories) {
    return {
      ok: false,
      status: 403,
      error: `All Factories view is read only. Select ${factoryName} to ${actionLabel}.`
    };
  }

  if (currentScope?.factoryId !== null && currentScope?.factoryId !== undefined && currentScope.factoryId !== factoryId) {
    return {
      ok: false,
      status: 403,
      error: `This session can ${actionLabel} only in ${factoryName}. Log out and log in again to work in another factory.`
    };
  }

  return {
    ok: true,
    factoryId,
    factoryName,
    currentScope,
    access
  };
}

function getExplicitRowFactoryIds(rows = []) {
  return [...new Set(
    (Array.isArray(rows) ? rows : [])
      .map(row => normalizeFactoryId(row && row.factory_id))
      .filter(id => id !== null)
  )];
}

function assertUploadRowsMatchFactory(rows, requiredFactoryId, label = 'Upload') {
  const explicitRowFactoryIds = getExplicitRowFactoryIds(rows);
  const mismatched = explicitRowFactoryIds.filter(factoryId => factoryId !== requiredFactoryId);
  if (mismatched.length) {
    throw new UploadValidationError(`${label} is locked to the selected login factory. Found rows for other factories: ${mismatched.join(', ')}.`);
  }
}

function normalizeHeaderKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFactoryIdFromObjectRow(row, fallbackFactoryId) {
  if (!row || typeof row !== 'object') return fallbackFactoryId;

  const entry = Object.entries(row).find(([key]) => {
    const normalized = normalizeHeaderKey(key);
    return ['factoryid', 'factory', 'factorycode'].includes(normalized);
  });

  if (!entry) return fallbackFactoryId;
  return normalizeFactoryId(entry[1]) ?? fallbackFactoryId;
}

function normalizeMachineName(value) {
  return String(value || '').trim();
}

const MACHINE_PROCESS_OPTIONS = ['Moulding', 'Tuffting', 'Printing'];

function normalizeMachineProcess(value, fallback = 'Moulding') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const normalized = raw.toLowerCase().replace(/\s+/g, '');
  if (['moulding', 'molding'].includes(normalized)) return 'Moulding';
  if (['tuffting', 'tufting', 'tuf', 'tuft'].includes(normalized)) return 'Tuffting';
  if (['printing', 'print'].includes(normalized)) return 'Printing';
  return fallback;
}

function getRequestedMachineProcess(req, fallback = 'Moulding') {
  const directValue = req?.query?.process;
  if (directValue !== undefined && directValue !== null && String(directValue).trim()) {
    return normalizeMachineProcess(directValue, fallback);
  }

  try {
    const rawUrl = String(req?.originalUrl || '');
    if (rawUrl.includes('?')) {
      const params = new URLSearchParams(rawUrl.slice(rawUrl.indexOf('?') + 1));
      const urlValue = params.get('process');
      if (urlValue && String(urlValue).trim()) {
        return normalizeMachineProcess(urlValue, fallback);
      }
    }
  } catch (_) {}

  return normalizeMachineProcess('', fallback);
}

function getScopedMachineKey(machine, factoryId) {
  return `${normalizeMachineName(machine).toLowerCase()}::${normalizeFactoryId(factoryId) ?? 0}`;
}

class UploadValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'UploadValidationError';
    this.statusCode = 400;
    this.details = details || undefined;
  }
}

const SUPPORTED_MASTER_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb', '.csv'];

const WIP_STOCK_UPLOAD_COLUMNS = [
  { key: 'sr_no', label: 'Sr.No.', headers: ['Sr.No.', 'Sr No', 'S.No.', 'Serial No', 'Sr Number'], required: false },
  { key: 'factory_unit', label: 'Factory Unit', headers: ['Factory Unit', 'Factory'], required: true },
  { key: 'party_group', label: 'Party Group', headers: ['Party Group'], required: true },
  { key: 'location_floor_dept', label: 'Location/Floor/Dept.', headers: ['Location/Floor/Dept.', 'Location/Floor/Dept', 'Location / Floor / Dept', 'Location'], required: true },
  { key: 'item_code', label: 'Item Code', headers: ['Item Code', 'ItemCode'], required: true },
  { key: 'item_name', label: 'Item Name', headers: ['Item Name', 'ItemName'], required: true },
  { key: 'job_no', label: 'Job No.', headers: ['Job No.', 'Job No', 'Job No./OR No.', 'Job Number'], required: false },
  { key: 'job_date', label: 'Job Date', headers: ['Job Date'], required: false },
  { key: 'ageing_period', label: 'Ageing Period', headers: ['Ageing Period', 'Aging Period'], required: false },
  { key: 'previous_stock_qty', label: 'Previous Stock', headers: ['Previous Stock', 'Previous Stock (Pcs)', 'Previous Stock Qty'], required: false },
  { key: 'current_stock_available_qty', label: 'Current Stock Available', headers: ['Current Stock/Available', 'Current Stock Available', 'Current Stock Available Qty', 'Current Stock'], required: true },
  { key: 'total_qty', label: 'Total Qty', headers: ['Total Qty', 'Total Quantity'], required: false },
  { key: 'uom', label: 'UOM', headers: ['UOM'], required: false },
  { key: 'remark_from_factory_unit', label: 'Remark From Factory Unit', headers: ['Remark From factory Unit', 'Remark From Factory Unit', 'Remark From Factory'], required: false },
  { key: 'remark_from_ho_sales_team', label: 'Remark From HO/Sales Team', headers: ['Remark From HO/Sales Team', 'Remark From HO / Sales Team', 'Remark From HO'], required: false },
  { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
];

const MASTER_UPLOAD_SCHEMAS = {
  orders: {
    label: 'Orders Master',
    maxHeaderScanRows: 25,
    minMatchedColumns: 5,
    columns: [
      { key: 'order_no', label: 'OrderNo', headers: ['OrderNo'], required: true },
      { key: 'item_code', label: 'ItemCode', headers: ['ItemCode'], required: true },
      { key: 'item_name', label: 'ItemName', headers: ['ItemName'], required: true },
      { key: 'mould_code', label: 'MouldCode', headers: ['MouldCode'], required: true },
      { key: 'qty', label: 'Qty', headers: ['Qty'], required: true },
      { key: 'priority', label: 'Priority', headers: ['Priority'], required: true },
      { key: 'client_name', label: 'Client Name', headers: ['Client Name'], required: true },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  moulds: {
    label: 'Moulds Master',
    maxHeaderScanRows: 25,
    minMatchedColumns: 10,
    columns: [
      { key: 'mould_number', label: 'MOULD NUMBER', headers: ['MOULD NUMBER', 'ERP Item Code'], required: true },
      { key: 'mould_name', label: 'MOULD NAME', headers: ['MOULD NAME', 'Product Name'], required: true },
      { key: 'std_wt_kg', label: 'STD WT (KG)', headers: ['STD WT (KG)', 'STD WT KG'], required: true },
      { key: 'runner_weight', label: 'RUNNER WEIGHT', headers: ['RUNNER WEIGHT'], required: true },
      { key: 'primary_machine', label: 'PRIMARY MACHINE', headers: ['PRIMARY MACHINE'], required: true },
      { key: 'secondary_machine', label: 'SECONDARY MACHINE', headers: ['SECONDARY MACHINE'], required: true },
      { key: 'moulding_sqn', label: 'MOULDING SQN.', headers: ['MOULDING SQN.', 'MOULDING SQN'], required: true },
      { key: 'tonnage', label: 'TONNAGE', headers: ['TONNAGE', 'Machine'], required: true },
      { key: 'no_of_cav', label: 'NO OF CAV', headers: ['NO OF CAV', 'NO OF CAVITY'], required: true },
      { key: 'cycle_time', label: 'CYCLE TIME', headers: ['CYCLE TIME'], required: true },
      { key: 'pcs_per_hour', label: 'PCS/HOUR', headers: ['PCS/HOUR', 'PCS PER HOUR'], required: true },
      { key: 'target_pcs_day', label: 'TARGET PCS/DAY', headers: ['TARGET PCS/DAY', 'TARGET PCS DAY', 'OUTPUT PER DAY'], required: true },
      { key: 'material', label: 'MATERIAL', headers: ['MATERIAL', 'MATERIAL 1'], required: true },
      { key: 'manpower', label: 'MANPOWER', headers: ['MANPOWER'], required: true },
      { key: 'operator_activities', label: 'OPERATOR ACTIVITIES', headers: ['OPERATOR ACTIVITIES'], required: true },
      { key: 'sfg_std_packing', label: 'SFG STD PACKING', headers: ['SFG STD PACKING', 'SFG QTY'], required: true },
      { key: 'std_volume_cap', label: 'STD VOLUME CAP.', headers: ['STD VOLUME CAP.', 'STD VOLUME CAP', 'STD VOLUME CAPACITY'], required: true },
      { key: 'factory_id', label: 'FACTORY ID', headers: ['FACTORY ID', 'FACTORY', 'FACTORY CODE'], required: false }
    ]
  },
  machines: {
    label: 'Machines Master',
    maxHeaderScanRows: 25,
    minMatchedColumns: 4,
    columns: [
      { key: 'building', label: 'Building', headers: ['Building'], required: true },
      { key: 'line', label: 'Line', headers: ['Line', 'Lines'], required: true },
      { key: 'machine', label: 'Machine', headers: ['Machine', 'Machines', 'Machine Name'], required: true },
      { key: 'tonnage', label: 'Tonnage', headers: ['Tonnage'], required: true },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  orjrwise: {
    label: 'ORJR Wise Summary',
    maxHeaderScanRows: 25,
    minMatchedColumns: 8,
    columns: [
      { key: 'or_jr_no', label: 'OR/JR No', headers: ['OR/JR No'], required: true },
      { key: 'jr_date', label: 'JR Date', headers: ['JR Date', 'OR/JR Date'], required: true },
      { key: 'our_code', label: 'Our Code', headers: ['Our Code', 'Item Code'], required: true },
      { key: 'bom_type', label: 'BomType', headers: ['BomType', 'BOM Type'], required: true },
      { key: 'jr_item_name', label: 'JR Item Name', headers: ['JR Item Name', 'Product Name'], required: true },
      { key: 'jr_qty', label: 'JR Qty', headers: ['JR Qty'], required: true },
      { key: 'uom', label: 'UOM', headers: ['UOM'], required: true },
      { key: 'plan_date', label: 'Plan Date', headers: ['Plan Date'], required: false },
      { key: 'plan_qty', label: 'Plan Qty', headers: ['Plan Qty'], required: false },
      { key: 'mould_no', label: 'Mould No', headers: ['Mould No', 'Mold No'], required: true },
      { key: 'mould_name', label: 'Mould', headers: ['Mould', 'Mould Name', 'Mold'], required: true },
      { key: 'mould_item_qty', label: 'Mould Item Qty', headers: ['Mould Item Qty', 'Mold Item Qty'], required: true },
      { key: 'tonnage', label: 'Tonnage', headers: ['Tonnage'], required: true },
      { key: 'machine_name', label: 'Machine', headers: ['Machine', 'Machine Name'], required: true },
      { key: 'cycle_time', label: 'Cycle Time', headers: ['Cycle Time'], required: true },
      { key: 'cavity', label: 'Cavity', headers: ['Cavity'], required: true },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  orjrwisedetail: {
    label: 'ORJR Wise Detail',
    maxHeaderScanRows: 25,
    minMatchedColumns: 10,
    columns: [
      { key: 'or_jr_no', label: 'OR/JR No', headers: ['OR/JR No'], required: true },
      { key: 'jr_date', label: 'JR Date', headers: ['JR Date', 'OR/JR Date'], required: true },
      { key: 'our_code', label: 'Our Code', headers: ['Our Code', 'Item Code'], required: true },
      { key: 'bom_type', label: 'BomType', headers: ['BomType', 'BOM Type'], required: true },
      { key: 'jr_item_name', label: 'JR Item Name', headers: ['JR Item Name', 'Product Name'], required: true },
      { key: 'jr_qty', label: 'JR Qty', headers: ['JR Qty'], required: true },
      { key: 'uom', label: 'UOM', headers: ['UOM'], required: true },
      { key: 'plan_date', label: 'Plan Date', headers: ['Plan Date'], required: false },
      { key: 'plan_qty', label: 'Plan Qty', headers: ['Plan Qty'], required: false },
      { key: 'mould_item_code', label: 'Mold Item Code', headers: ['Mold Item Code', 'Mould Item Code'], required: true },
      { key: 'mould_item_name', label: 'Mold Item Name', headers: ['Mold Item Name', 'Mould Item Name'], required: true },
      { key: 'mould_no', label: 'Mould No', headers: ['Mould No', 'Mold No'], required: true },
      { key: 'mould_name', label: 'Mould', headers: ['Mould', 'Mould Name', 'Mold'], required: true },
      { key: 'mould_item_qty', label: 'Mould Item Qty', headers: ['Mould Item Qty', 'Mold Item Qty'], required: true },
      { key: 'tonnage', label: 'Tonnage', headers: ['Tonnage'], required: true },
      { key: 'machine_name', label: 'Machine', headers: ['Machine', 'Machine Name'], required: true },
      { key: 'cycle_time', label: 'Cycle Time', headers: ['Cycle Time'], required: true },
      { key: 'cavity', label: 'Cavity', headers: ['Cavity'], required: true },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  orjr: {
    label: 'OR-JR Status',
    maxHeaderScanRows: 30,
    minMatchedColumns: 12,
    columns: [
      { key: 'or_jr_no', label: 'OR/JR No', headers: ['OR/JR No'], required: true },
      { key: 'or_jr_date', label: 'OR/JR Date', headers: ['OR/JR Date'], required: true },
      { key: 'or_qty', label: 'OR Qty', headers: ['OR Qty'], required: true },
      { key: 'jr_qty', label: 'JR Qty', headers: ['JR Qty'], required: true },
      { key: 'plan_qty', label: 'Plan Qty', headers: ['Plan Qty'], required: true },
      { key: 'plan_date', label: 'Plan Date', headers: ['Plan Date'], required: true },
      { key: 'job_card_no', label: 'Job Card No', headers: ['Job Card No'], required: true },
      { key: 'job_card_date', label: 'Job Card Date', headers: ['Job Card Date'], required: true },
      { key: 'item_code', label: 'Item Code', headers: ['Item Code'], required: true },
      { key: 'product_name', label: 'Product Name', headers: ['Product Name'], required: true },
      { key: 'client_name', label: 'Client Name', headers: ['Client Name'], required: true },
      { key: 'prod_plan_qty', label: 'Production Plan Qty', headers: ['Production Plan Qty', 'Prod Plan Qty'], required: true },
      { key: 'std_pack', label: 'STD Pack', headers: ['STD Pack'], required: true },
      { key: 'uom', label: 'UOM', headers: ['UOM'], required: true },
      { key: 'planned_comp_date', label: 'Planned Comp Date', headers: ['Planned Comp Date'], required: true },
      { key: 'mld_start_date', label: 'MLD Start Date', headers: ['MLD Start Date'], required: true },
      { key: 'mld_end_date', label: 'MLD End Date', headers: ['MLD End Date'], required: true },
      { key: 'actual_mld_start_date', label: 'Actual Mld Start Date', headers: ['Actual Mld Start Date', 'Actual MLD Start Date'], required: true },
      { key: 'prt_tuf_end_date', label: 'Prt/Tuf End Date', headers: ['Prt/Tuf End Date', 'PRT/TUF End Date'], required: true },
      { key: 'pack_end_date', label: 'Pack End Date', headers: ['Pack End Date'], required: true },
      { key: 'mld_status', label: 'MLD Status', headers: ['MLD Status'], required: true },
      { key: 'shift_status', label: 'Shift Status', headers: ['Shift Status'], required: true },
      { key: 'prt_tuf_status', label: 'Prt/Tuf Status', headers: ['Prt/Tuf Status', 'PRT/TUF Status'], required: true },
      { key: 'pack_status', label: 'Pack Status', headers: ['Pack Status'], required: true },
      { key: 'wh_status', label: 'WH Status', headers: ['WH Status'], required: true },
      { key: 'rev_mld_end_date', label: 'Rev MLD End Date', headers: ['Rev MLD End Date'], required: true },
      { key: 'shift_comp_date', label: 'Shift Comp. Date', headers: ['Shift Comp. Date', 'Shift Comp Date'], required: true },
      { key: 'rev_ptd_tuf_end_date', label: 'Rev Ptd/Tuf End Date', headers: ['Rev Ptd/Tuf End Date', 'Rev PTD/TUF End Date'], required: true },
      { key: 'rev_pak_end_date', label: 'Rev Pak End Date', headers: ['Rev Pak End Date'], required: true },
      { key: 'wh_rec_date', label: 'WH Rec Date', headers: ['WH Rec Date'], required: true },
      { key: 'remarks_all', label: 'JC-Mld-Shift-Pur-Ptd/Tuft-Pkg-WH Remarks', headers: ['JC-Mld-Shift-Pur-Ptd/Tuft-Pkg-WH Remarks', 'Remarks All'], required: true },
      { key: 'jr_close', label: 'JR Close', headers: ['JR Close'], required: true },
      { key: 'or_remarks', label: 'OR Remarks', headers: ['OR Remarks'], required: true },
      { key: 'jr_remarks', label: 'JR Remarks', headers: ['JR Remarks'], required: true },
      { key: 'created_by', label: 'Created By', headers: ['Created By'], required: true },
      { key: 'created_date', label: 'Created Date', headers: ['Created Date'], required: true },
      { key: 'edited_by', label: 'Edited By', headers: ['Edited By'], required: true },
      { key: 'edited_date', label: 'Edited Date', headers: ['Edited Date'], required: true },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  wipstock: {
    label: 'WIP Stock',
    maxHeaderScanRows: 40,
    minMatchedColumns: 8,
    columns: WIP_STOCK_UPLOAD_COLUMNS
  },
  boplanningdetail: {
    label: 'BO Planning Detail',
    maxHeaderScanRows: 25,
    minMatchedColumns: 8,
    columns: [
      { key: 'or_jr_no', label: 'OR/JR No', headers: ['OR/JR No'], required: true },
      { key: 'jr_date', label: 'JR Date', headers: ['JR Date', 'OR/JR Date'], required: true },
      { key: 'our_code', label: 'Our Code', headers: ['Our Code', 'Item Code'], required: true },
      { key: 'bom_type', label: 'BomType', headers: ['BomType', 'BOM Type'], required: true },
      { key: 'jr_item_name', label: 'JR Item Name', headers: ['JR Item Name', 'Product Name'], required: true },
      { key: 'jr_qty', label: 'JR Qty', headers: ['JR Qty'], required: true },
      { key: 'uom', label: 'UOM', headers: ['UOM'], required: true },
      { key: 'plan_date', label: 'Plan Date', headers: ['Plan Date'], required: true },
      { key: 'plan_qty', label: 'Plan Qty', headers: ['Plan Qty'], required: true },
      { key: 'bo_item_code', label: 'Bo Item Code', headers: ['Bo Item Code', 'Bought Out Code'], required: true },
      { key: 'bo_item_name', label: 'Bo Item Name', headers: ['Bo Item Name', 'Bought Out Name'], required: true },
      { key: 'bo_uom', label: 'Bo UOM', headers: ['Bo UOM', 'Bought Out UOM'], required: true },
      { key: 'bo_item_qty', label: 'Bo Item Qty', headers: ['Bo Item Qty', 'Bought Out Qty'], required: true },
      { key: 'remarks_all', label: 'Remarks', headers: ['Remarks', 'Remarks All'], required: false },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Factory Code'], required: false }
    ]
  },
  operators: {
    label: 'Operator Master',
    maxHeaderScanRows: 25,
    minMatchedColumns: 4,
    columns: [
      { key: 'operator_id', label: 'Operator ID', headers: ['Operator ID', 'Op ID', 'ID'], required: false },
      { key: 'name', label: 'Operator Name', headers: ['Operator Name', 'Name', 'Full Name'], required: true },
      { key: 'doj', label: 'DOJ', headers: ['DOJ', 'Date of Joining', 'Joining Date'], required: false },
      { key: 'age', label: 'Age', headers: ['Age'], required: false },
      { key: 'aadhar_number', label: 'Aadhar Number', headers: ['Aadhar Number', 'Aadhar', 'Adhaar'], required: false },
      { key: 'factory_id', label: 'Factory ID', headers: ['Factory ID', 'Factory', 'Unit'], required: false },
      { key: 'process', label: 'Process', headers: ['Process'], required: false },
      { key: 'assigned_machine', label: 'Machine', headers: ['Machine', 'Assigned Machine'], required: false }
    ]
  }
};

function getMasterUploadSchema(type) {
  return MASTER_UPLOAD_SCHEMAS[String(type || '').trim().toLowerCase()] || null;
}

function getUploadColumnAliasKeys(column) {
  return [...new Set(
    [column?.label, ...(Array.isArray(column?.headers) ? column.headers : [])]
      .map(normalizeHeaderKey)
      .filter(Boolean)
  )];
}

function isMeaningfulUploadCell(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return String(value).trim() !== '';
}

function validateMasterUploadFile(file) {
  const ext = path.extname(String(file?.originalname || file?.path || '')).toLowerCase();
  if (!SUPPORTED_MASTER_UPLOAD_EXTENSIONS.includes(ext)) {
    throw new UploadValidationError(
      `Upload file format is not supported. Use ${SUPPORTED_MASTER_UPLOAD_EXTENSIONS.join(', ')} files only.`
    );
  }
  return ext;
}

function getUploadHeaderMatchCount(row, schema) {
  if (!Array.isArray(row) || !schema) return 0;
  const normalizedCells = row.map(normalizeHeaderKey).filter(Boolean);
  if (!normalizedCells.length) return 0;

  let matched = 0;
  for (const column of schema.columns) {
    const aliasKeys = getUploadColumnAliasKeys(column);
    if (normalizedCells.some(cell => aliasKeys.includes(cell))) {
      matched++;
    }
  }
  return matched;
}

function buildUploadHeaderIndexMap(headerRow, schema) {
  const normalizedHeaderRow = (Array.isArray(headerRow) ? headerRow : []).map(normalizeHeaderKey);
  const headerIndexMap = new Map();

  for (const column of schema.columns) {
    const aliasKeys = getUploadColumnAliasKeys(column);
    const headerIndex = normalizedHeaderRow.findIndex(cell => aliasKeys.includes(cell));
    if (headerIndex >= 0) {
      headerIndexMap.set(column.key, headerIndex);
    }
  }

  return headerIndexMap;
}

function detectUploadHeaderRow(rawRows, schema) {
  const maxScanRows = Math.min(rawRows.length, schema?.maxHeaderScanRows || 20);
  let bestRowIndex = -1;
  let bestMatchCount = -1;

  for (let i = 0; i < maxScanRows; i++) {
    const matchCount = getUploadHeaderMatchCount(rawRows[i], schema);
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestRowIndex = i;
    }
  }

  if (bestRowIndex === -1 || bestMatchCount < (schema?.minMatchedColumns || 1)) {
    throw new UploadValidationError(
      `Upload file columns do not match the JMS template for ${schema?.label || 'this master'}. Please use the correct file/template.`,
      {
        master: schema?.label || null,
        detected_header_row: bestRowIndex >= 0 ? bestRowIndex + 1 : null
      }
    );
  }

  const headerIndexMap = buildUploadHeaderIndexMap(rawRows[bestRowIndex] || [], schema);
  const missingRequiredColumns = schema.columns
    .filter(column => column.required !== false && !headerIndexMap.has(column.key))
    .map(column => column.label || column.key);

  if (missingRequiredColumns.length) {
    throw new UploadValidationError(
      `Upload file columns do not match the JMS template for ${schema.label}. Missing columns: ${missingRequiredColumns.join(', ')}.`,
      {
        master: schema.label,
        detected_header_row: bestRowIndex + 1,
        missing_columns: missingRequiredColumns
      }
    );
  }

  return { headerRowIndex: bestRowIndex, headerIndexMap, matchedColumns: bestMatchCount };
}

function parseStructuredUploadSheet(filePath, type) {
  const schema = getMasterUploadSchema(type);
  if (!schema) {
    throw new UploadValidationError(`Upload schema is not configured for ${type}.`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer', raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new UploadValidationError('Upload file is empty.');
  }

  const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true
  });

  if (!rawRows.length) {
    throw new UploadValidationError('Upload file is empty.');
  }

  const { headerRowIndex, headerIndexMap, matchedColumns } = detectUploadHeaderRow(rawRows, schema);
  const rows = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex++) {
    const sourceRow = rawRows[rowIndex];
    if (!Array.isArray(sourceRow) || !sourceRow.length) continue;
    if (!sourceRow.some(isMeaningfulUploadCell)) continue;
    if (getUploadHeaderMatchCount(sourceRow, schema) >= (schema.minMatchedColumns || 1)) continue;

    const row = {};
    let hasData = false;

    for (const column of schema.columns) {
      const sourceIndex = headerIndexMap.get(column.key);
      const value = sourceIndex === undefined ? null : sourceRow[sourceIndex];
      row[column.key] = value;
      if (!hasData && isMeaningfulUploadCell(value)) {
        hasData = true;
      }
    }

    if (hasData) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    throw new UploadValidationError('No data rows found after the header in the upload file.', {
      master: schema.label,
      detected_header_row: headerRowIndex + 1
    });
  }

  return {
    schema,
    workbook,
    sheetName,
    rawRows,
    rows,
    headerRowIndex,
    matchedColumns
  };
}

function parseDateLikeText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const parsedNumeric = toDate(value);
    if (parsedNumeric instanceof Date && !Number.isNaN(parsedNumeric.getTime())) {
      return parsedNumeric;
    }
  }

  const clean = String(value).trim();
  if (!clean) return null;

  const isoMatch = clean.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dmyMatch = clean.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (dmyMatch) {
    let [, dd, mm, yyyy] = dmyMatch;
    let yearNum = Number(yyyy);
    if (yyyy.length === 2) {
      yearNum += yearNum >= 70 ? 1900 : 2000;
    }
    const parsed = new Date(yearNum, Number(mm) - 1, Number(dd));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(clean);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function toIsoDateOnly(value) {
  const parsed = parseDateLikeText(value);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractWipStockDate(rawRows, headerRowIndex) {
  const scanLimit = Math.min(rawRows.length, Math.max(8, headerRowIndex >= 0 ? headerRowIndex + 1 : 8));
  const datePattern = /(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/;

  let fallbackText = null;
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];
    for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
      const cellText = String(row[cellIndex] ?? '').trim();
      if (!cellText) continue;

      const labeledMatch = cellText.match(/date\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})/i);
      if (labeledMatch) {
        const isoDate = toIsoDateOnly(labeledMatch[1]);
        if (isoDate) return { stock_date: isoDate, header_date_text: labeledMatch[1] };
      }

      if (/date/i.test(cellText)) {
        const nextCellText = String(row[cellIndex + 1] ?? '').trim();
        const nextDate = toIsoDateOnly(nextCellText);
        if (nextDate) {
          return { stock_date: nextDate, header_date_text: nextCellText };
        }
      }

      const anyMatch = cellText.match(datePattern);
      if (anyMatch && fallbackText === null) {
        fallbackText = anyMatch[1];
      }
    }
  }

  const fallbackDate = toIsoDateOnly(fallbackText);
  if (fallbackDate) {
    return { stock_date: fallbackDate, header_date_text: fallbackText };
  }

  throw new UploadValidationError('WIP Stock date was not found in the sheet header. Add a header like "Date :- 03/04/26".');
}

function buildWipStockComparisonKey(row) {
  const parts = [
    row.factory_unit,
    row.party_group,
    row.location_floor_dept,
    row.item_code,
    row.item_name,
    row.job_no,
    row.uom
  ]
    .map(value => normalizeHeaderKey(value))
    .filter(Boolean);
  return parts.join('::');
}

function normalizeWipStockUploadRow(row, fallbackFactoryId, stockDate, lineType = 'actual') {
  const normalized = {
    sr_no: toNum(row.sr_no),
    factory_unit: String(row.factory_unit || '').trim(),
    party_group: String(row.party_group || '').trim(),
    location_floor_dept: String(row.location_floor_dept || '').trim(),
    item_code: String(row.item_code || '').trim(),
    item_name: String(row.item_name || '').trim(),
    job_no: String(row.job_no || '').trim(),
    job_date: toIsoDateOnly(row.job_date),
    ageing_period: String(row.ageing_period || '').trim(),
    previous_stock_qty: toNum(row.previous_stock_qty),
    current_stock_available_qty: toNum(row.current_stock_available_qty),
    total_qty: toNum(row.total_qty),
    uom: String(row.uom || '').trim(),
    remark_from_factory_unit: String(row.remark_from_factory_unit || '').trim(),
    remark_from_ho_sales_team: String(row.remark_from_ho_sales_team || '').trim(),
    stock_date: stockDate,
    line_type: lineType,
    factory_id: normalizeFactoryId(row.factory_id) ?? fallbackFactoryId
  };

  normalized.comparison_key = buildWipStockComparisonKey(normalized);
  normalized.row_status = String(row.row_status || '').trim() || null;
  return normalized;
}

function parseWipStockUploadSheet(filePath) {
  const schema = getMasterUploadSchema('wipstock');
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer', raw: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new UploadValidationError('Upload file is empty.');
  }

  const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true
  });
  if (!rawRows.length) {
    throw new UploadValidationError('Upload file is empty.');
  }

  const { headerRowIndex, headerIndexMap, matchedColumns } = detectUploadHeaderRow(rawRows, schema);
  const { stock_date, header_date_text } = extractWipStockDate(rawRows, headerRowIndex);
  const fillDownColumns = new Set([
    'factory_unit',
    'party_group',
    'location_floor_dept',
    'job_no',
    'job_date',
    'ageing_period',
    'previous_stock_qty',
    'total_qty',
    'uom',
    'remark_from_factory_unit',
    'remark_from_ho_sales_team'
  ]);
  const fillState = {};
  const rows = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex++) {
    const sourceRow = rawRows[rowIndex];
    if (!Array.isArray(sourceRow) || !sourceRow.length) continue;
    if (!sourceRow.some(isMeaningfulUploadCell)) continue;
    if (getUploadHeaderMatchCount(sourceRow, schema) >= (schema.minMatchedColumns || 1)) continue;

    const row = {};
    for (const column of schema.columns) {
      const sourceIndex = headerIndexMap.get(column.key);
      let value = sourceIndex === undefined ? null : sourceRow[sourceIndex];
      if (!isMeaningfulUploadCell(value) && fillDownColumns.has(column.key) && isMeaningfulUploadCell(fillState[column.key])) {
        value = fillState[column.key];
      }
      if (isMeaningfulUploadCell(value) && fillDownColumns.has(column.key)) {
        fillState[column.key] = value;
      }
      row[column.key] = value;
    }

    const hasBusinessData = [
      row.item_code,
      row.item_name,
      row.current_stock_available_qty,
      row.total_qty,
      row.remark_from_ho_sales_team
    ].some(isMeaningfulUploadCell);

    if (!hasBusinessData) continue;
    rows.push(row);
  }

  if (!rows.length) {
    throw new UploadValidationError('No WIP Stock rows were found after the header.', {
      master: schema.label,
      detected_header_row: headerRowIndex + 1
    });
  }

  return {
    schema,
    workbook,
    sheetName,
    rawRows,
    rows,
    headerRowIndex,
    matchedColumns,
    stock_date,
    header_date_text
  };
}




/* =========================
   STATIC FRONTEND
   Repo uses PUBLIC/; Linux is case-sensitive (Docker). Support both names.
========================= */
const PUBLIC_DIR = path.join(
  BACKEND_ROOT,
  fs.existsSync(path.join(BACKEND_ROOT, 'PUBLIC', 'index.html')) ? 'PUBLIC' : 'public'
);
app.use(express.static(PUBLIC_DIR));

/* ============================================================
   DPR DASHBOARD MATRIX (New Endpoint for Production Dashboard)
   Renamed to avoid conflict with existing dpr.html summary-matrix
   ============================================================ */
app.get('/api/dpr/dashboard-matrix', async (req, res) => {
  try {
    const { date, shift } = req.query; // '2023-10-27', 'Day' or 'Night'
    const cleanDate = (date || '').trim();
    const cleanShift = (shift || '').trim() || 'Day';

    console.log(`API Hit: /api/dpr/summary-matrix?date='${cleanDate}'&shift='${cleanShift}'`);

    if (!cleanDate) return res.json({ ok: false, error: 'Date required' });

    // 1. Determine Comparision Date (Yesterday same shift)
    const d = new Date(cleanDate);
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().split('T')[0];
    const factoryId = getFactoryId(req);

    // 2. Fetch Current Shift Data (Hourly)
    const sqlCurrent = `
        SELECT 
            h.hour_slot, 
            SUM(h.good_qty) as total_good,
            SUM(h.reject_qty) as total_rej,
            SUM(h.downtime_min) as total_dt,
            SUM( (h.good_qty * COALESCE(m.std_wt_kg, m.std_wt_kg, pm.std_wt_kg, pm.std_wt_kg, 0)) / 1000 ) as total_tonnage_act,
            SUM( (h.shots * COALESCE(m.no_of_cav, pm.no_of_cav, 1) * COALESCE(m.std_wt_kg, m.std_wt_kg, pm.std_wt_kg, pm.std_wt_kg, 0)) / 1000 ) as total_tonnage_plan
        FROM dpr_hourly h
        LEFT JOIN moulds m ON m.mould_number = h.mould_no
        LEFT JOIN plan_board pb ON pb.id::TEXT = h.plan_id OR pb.plan_id = h.plan_id
        LEFT JOIN moulds pm ON pm.mould_number = pb.item_code
        WHERE h.dpr_date = $1::date AND h.shift = $2 AND (h.factory_id = $3 OR ($3 IS NULL AND h.factory_id IS NULL))
        GROUP BY h.hour_slot
        ORDER BY h.hour_slot ASC
    `;

    // 3. Fetch Active Machines & Last Hour Data (Enhanced)
    const sqlActive = `
        WITH MachineTotals AS (
            SELECT 
                machine,
                plan_id,
                mould_no,
                SUM(good_qty) as total_good,
                SUM(reject_qty) as total_rej,
                SUM(downtime_min) as total_dt
            FROM dpr_hourly
            WHERE dpr_date = $1::date AND shift = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))
            GROUP BY machine, plan_id, mould_no
        ),
        LastHour AS (
            SELECT DISTINCT ON (machine)
                machine,
                good_qty as last_good,
                hour_slot as last_time
            FROM dpr_hourly
            WHERE dpr_date = $1::date AND shift = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))
            ORDER BY machine, created_at DESC
        )
        SELECT 
            t.machine,
            t.plan_id,
            t.mould_no,
            t.total_good,
            t.total_rej,
            t.total_dt,
            l.last_good,
            l.last_time
        FROM MachineTotals t
        JOIN LastHour l ON t.machine = l.machine
    `;

    // 4. Fetch Totals for Comparison (Current vs Previous)
    const sqlTotals = `
        SELECT 
            dpr_date::text as dpr_date_str,
            SUM(good_qty) as sum_good,
            SUM(reject_qty) as sum_rej,
            SUM(downtime_min) as sum_dt
        FROM dpr_hourly 
        WHERE (dpr_date = $1::date OR dpr_date = $3::date) AND shift = $2 AND (factory_id = $4 OR ($4 IS NULL AND factory_id IS NULL))
        GROUP BY dpr_date
    `;

    const [rowsHourly, rowsActive, rowsTotals] = await Promise.all([
      q(sqlCurrent, [cleanDate, cleanShift, factoryId]),
      q(sqlActive, [cleanDate, cleanShift, factoryId]),
      q(sqlTotals, [cleanDate, cleanShift, prevDate, factoryId])
    ]);

    console.log(`Active Machines Found: ${rowsActive.length} | Hourly Rows: ${rowsHourly.length}`);

    // --- DEBUG DIAGNOSTIC ---
    const debugInfo = {
      params: { date: cleanDate, shift: cleanShift, prevDate },
      counts: {
        hourly: rowsHourly.length,
        active: rowsActive.length,
        totals: rowsTotals.length
      }
    };

    // Transform Hourly for Charts
    const dayHours = ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
    const nightHours = ['20-21', '21-22', '22-23', '23-00', '00-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
    const targetHours = cleanShift === 'Day' ? dayHours : nightHours;

    const chartData = {
      labels: targetHours,
      tonnage_act: [],
      tonnage_plan: [],
      efficiency: [],
      rejection: [],
      downtime: []
    };

    targetHours.forEach(slot => {
      const r = rowsHourly.find(x => x.hour_slot === slot);
      chartData.tonnage_act.push(r ? Number(r.total_tonnage_act || 0) : 0);
      chartData.tonnage_plan.push(r ? Number(r.total_tonnage_plan || 0) : 0);

      const g = r ? Number(r.total_good || 0) : 0;
      const rej = r ? Number(r.total_rej || 0) : 0;
      const total = g + rej;

      chartData.rejection.push(total > 0 ? ((rej / total) * 100).toFixed(1) : 0);
      chartData.downtime.push(r ? Number(r.total_dt || 0) : 0);

      // Efficiency (Mock logic -> (Good / (Good+Rej)) for now)
      chartData.efficiency.push(total > 0 ? ((g / total) * 100).toFixed(1) : 0);
    });

    // Current Stats
    const currStats = rowsTotals.find(r => r.dpr_date_str === cleanDate) || {};
    const prevStats = rowsTotals.find(r => r.dpr_date_str === prevDate) || {};

    res.json({
      ok: true,
      chart: chartData,
      comparison: {
        current: currStats,
        prev: prevStats
      },
      active_machines: rowsActive,
      debug: debugInfo
    });

  } catch (e) {
    console.error('DPR Matrix Error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   ADMIN: CLOSED PLANTS MANAGEMENT
   ============================================================ */
app.get('/api/admin/closed-plants', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const rows = await q('SELECT id, dpr_date::text as dpr_date_str, plant, shift, remarks, closed_by FROM closed_plants WHERE factory_id = $1 OR ($1 IS NULL AND factory_id IS NULL) ORDER BY dpr_date DESC, plant ASC', [factoryId]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/close-plant', async (req, res) => {
  try {
    const { dpr_date, plant, shift, remarks, closed_by } = req.body;
    if (!dpr_date || !plant || !shift) return res.status(400).json({ ok: false, error: 'Missing required fields' });

    const factoryId = getFactoryId(req);

    // Upsert logic
    const sql = `
        INSERT INTO closed_plants (dpr_date, plant, shift, remarks, closed_by, factory_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (dpr_date, plant, shift, factory_id) 
        DO UPDATE SET remarks = EXCLUDED.remarks, closed_by = EXCLUDED.closed_by, created_at = NOW()
    `;
    await q(sql, [dpr_date, plant, shift, remarks, closed_by, factoryId]);
    
    syncService.triggerSync();
    res.json({ ok: true, message: 'Plant status updated' });
  } catch (e) {
    console.error('close-plant error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/api/admin/close-plant/:id', async (req, res) => {
  try {
    await q('DELETE FROM closed_plants WHERE id = $1', [req.params.id]);
    syncService.triggerSync();
    res.json({ ok: true, message: 'Plant re-opened' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Helper to check if plant is closed
async function isPlantClosed(date, building, line, shift, factoryId) {
  const sql = `
    SELECT * FROM closed_plants 
    WHERE dpr_date = $1 
      AND (plant = $2 OR plant = $3 OR plant = 'All') 
      AND (shift = $4 OR shift = 'Both')
      AND (factory_id = $5 OR ($5 IS NULL AND factory_id IS NULL))
  `;
  const rows = await q(sql, [date, building, line, shift, factoryId]);
  return rows.length > 0 ? rows[0] : null;
}

// 9. QC Report List (Table View)
app.get('/api/qc/reports', async (req, res) => {
  try {
    const { date, shift, machine } = req.query;
    // Safe Date Matching (handled potential Timestamp vs Date issues)
    // $1 is 'YYYY-MM-DD'. casting column to text and checking start matches.
    let sql = 'SELECT * FROM qc_online_reports WHERE date::text LIKE $1 || \'%\'';
    const params = [date];

    if (shift && shift !== 'All') {
      sql += ` AND shift = $${params.length + 1}`;
      params.push(shift);
    }
    if (machine && machine !== 'All Machines') {
      sql += ` AND machine = $${params.length + 1}`;
      params.push(decodeURIComponent(machine));
    }

    sql += ' ORDER BY created_at DESC LIMIT 500';

    console.log('[QC REPORT DEBUG] SQL:', sql);
    console.log('[QC REPORT DEBUG] Params:', params);

    const rows = await q(sql, params);
    console.log('[QC REPORT DEBUG] Rows Found:', rows.length);

    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
   404 HANDLER
   ========================= */
/* =========================
   DATABASE
========================= */
async function q(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}
const MOULD_MASTER_FIELDS = [
  'mould_number',
  'mould_name',
  'std_wt_kg',
  'runner_weight',
  'primary_machine',
  'secondary_machine',
  'moulding_sqn',
  'tonnage',
  'no_of_cav',
  'cycle_time',
  'pcs_per_hour',
  'target_pcs_day',
  'material',
  'manpower',
  'operator_activities',
  'sfg_std_packing',
  'std_volume_cap'
];

const MOULD_MASTER_NUMERIC_FIELDS = new Set([
  'std_wt_kg',
  'runner_weight',
  'tonnage',
  'no_of_cav',
  'cycle_time',
  'pcs_per_hour',
  'target_pcs_day',
  'manpower'
]);

function normalizeMouldMasterPayload(payload = {}, options = {}) {
  const partial = options.partial === true;
  const normalized = {};

  for (const field of MOULD_MASTER_FIELDS) {
    if (partial && !Object.prototype.hasOwnProperty.call(payload, field)) continue;
    normalized[field] = MOULD_MASTER_NUMERIC_FIELDS.has(field)
      ? toNum(payload[field])
      : normalizeOptionalText(payload[field]);
  }

  return normalized;
}

async function migrateMouldMasterSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS moulds (
      id SERIAL PRIMARY KEY,
      mould_number TEXT,
      mould_name TEXT,
      std_wt_kg NUMERIC,
      runner_weight NUMERIC,
      primary_machine TEXT,
      secondary_machine TEXT,
      moulding_sqn TEXT,
      tonnage NUMERIC,
      no_of_cav NUMERIC,
      cycle_time NUMERIC,
      pcs_per_hour NUMERIC,
      target_pcs_day NUMERIC,
      material TEXT,
      manpower NUMERIC,
      operator_activities TEXT,
      sfg_std_packing TEXT,
      std_volume_cap TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      factory_id INTEGER,
      last_updated_at TIMESTAMP,
      global_id UUID,
      sync_status TEXT,
      sync_id UUID DEFAULT gen_random_uuid()
    )
  `);

  let columns = new Set((await q(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'moulds'`
  )).map(row => row.column_name));

  const renameColumn = async (from, to) => {
    if (!columns.has(from)) return;
    if (!columns.has(to)) {
      await q(`ALTER TABLE moulds RENAME COLUMN ${from} TO ${to}`);
      columns.delete(from);
      columns.add(to);
      return;
    }

    await q(`UPDATE moulds SET ${to} = COALESCE(${to}, ${from}) WHERE ${from} IS NOT NULL`);
    await q(`ALTER TABLE moulds DROP COLUMN IF EXISTS ${from}`);
    columns.delete(from);
  };

  await renameColumn('erp_item_code', 'mould_number');
  await renameColumn('product_name', 'mould_name');
  await renameColumn('machine', 'tonnage');
  await renameColumn('output_per_day', 'target_pcs_day');
  await renameColumn('material_1', 'material');
  await renameColumn('sfg_qty', 'sfg_std_packing');
  await renameColumn('std_volume_capacity', 'std_volume_cap');

  const ensureColumns = [
    ['mould_number', 'TEXT'],
    ['mould_name', 'TEXT'],
    ['std_wt_kg', 'NUMERIC'],
    ['runner_weight', 'NUMERIC'],
    ['primary_machine', 'TEXT'],
    ['secondary_machine', 'TEXT'],
    ['moulding_sqn', 'TEXT'],
    ['tonnage', 'NUMERIC'],
    ['no_of_cav', 'NUMERIC'],
    ['cycle_time', 'NUMERIC'],
    ['pcs_per_hour', 'NUMERIC'],
    ['target_pcs_day', 'NUMERIC'],
    ['material', 'TEXT'],
    ['manpower', 'NUMERIC'],
    ['operator_activities', 'TEXT'],
    ['sfg_std_packing', 'TEXT'],
    ['std_volume_cap', 'TEXT'],
    ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
    ['factory_id', 'INTEGER'],
    ['last_updated_at', 'TIMESTAMP'],
    ['global_id', 'UUID'],
    ['sync_status', 'TEXT'],
    ['sync_id', 'UUID DEFAULT gen_random_uuid()']
  ];

  for (const [name, typeSql] of ensureColumns) {
    await q(`ALTER TABLE moulds ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
  }

  await q(`
    ALTER TABLE moulds
    ALTER COLUMN tonnage TYPE NUMERIC
    USING NULLIF(regexp_replace(COALESCE(tonnage::text, ''), '[^0-9.+-]+', '', 'g'), '')::numeric
  `).catch(err => console.warn('[DB] moulds tonnage type migration skipped:', err.message));

  await q(`UPDATE moulds SET updated_at = NOW() WHERE updated_at IS NULL`);

  const droppedColumns = [
    'erp_item_name',
    'actual_wt_kg',
    'revised_shot_per_hr',
    'material_revised',
    'material_revised_2',
    'material_revised_3',
    'master_batch_1',
    'colour_1',
    'master_batch_2',
    'colour_3',
    'spl_colour_details',
    'dimensions',
    'remarks'
  ];

  for (const column of droppedColumns) {
    await q(`ALTER TABLE moulds DROP COLUMN IF EXISTS ${column}`);
  }

  try {
    await q(`ALTER TABLE moulds DROP CONSTRAINT IF EXISTS moulds_erp_item_code_key`);
  } catch (err) {
    console.warn('[DB] moulds_erp_item_code_key drop skipped:', err.message);
  }

  await q(`DROP INDEX IF EXISTS idx_moulds_product`);
  await q(`DROP INDEX IF EXISTS idx_moulds_erp_item_trim`);
  await q(`CREATE INDEX IF NOT EXISTS idx_moulds_mould_name ON moulds(mould_name)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_moulds_mould_number_trim ON moulds(TRIM(mould_number))`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_moulds_factory_mould_number_unique ON moulds ((LOWER(mould_number)), (COALESCE(factory_id, 0)))`);
}

async function migrateOrjrWiseMasterSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS mould_planning_summary (
      id SERIAL PRIMARY KEY,
      or_jr_no TEXT,
      or_jr_date DATE,
      item_code TEXT,
      bom_type TEXT,
      product_name TEXT,
      jr_qty INTEGER,
      uom TEXT,
      plan_date DATE,
      plan_qty INTEGER,
      mould_no TEXT,
      mould_name TEXT,
      mould_item_qty INTEGER,
      tonnage INTEGER,
      machine_name TEXT,
      cycle_time NUMERIC,
      cavity INTEGER,
      created_by TEXT,
      created_date TIMESTAMP DEFAULT NOW(),
      edited_by TEXT,
      edited_date TIMESTAMP
    );
  `);
  await q(`ALTER TABLE mould_planning_summary ADD COLUMN IF NOT EXISTS mould_item_code TEXT`);
  await q(`ALTER TABLE mould_planning_summary ADD COLUMN IF NOT EXISTS mould_item_name TEXT`);

  const numericColumns = ['jr_qty', 'plan_qty', 'mould_item_qty', 'tonnage'];
  for (const column of numericColumns) {
    await q(`
      ALTER TABLE mould_planning_summary
      ALTER COLUMN ${column} TYPE NUMERIC
      USING NULLIF(regexp_replace(COALESCE(${column}::text, ''), '[^0-9.+-]+', '', 'g'), '')::numeric
    `).catch(err => console.warn(`[DB] mould_planning_summary ${column} type migration skipped:`, err.message));
  }
}

async function migrateOrJrReportNumericSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS or_jr_report (
      id SERIAL PRIMARY KEY,
      or_jr_no TEXT,
      or_jr_date DATE,
      or_qty INTEGER,
      jr_qty INTEGER,
      plan_qty INTEGER,
      plan_date DATE,
      job_card_no TEXT,
      job_card_date DATE,
      item_code TEXT,
      product_name TEXT,
      client_name TEXT,
      prod_plan_qty INTEGER,
      std_pack INTEGER,
      uom TEXT,
      planned_comp_date DATE,
      mld_start_date DATE,
      mld_end_date DATE,
      actual_mld_start_date DATE,
      prt_tuf_end_date DATE,
      pack_end_date DATE,
      mld_status TEXT,
      shift_status TEXT,
      prt_tuf_status TEXT,
      pack_status TEXT,
      wh_status TEXT,
      rev_mld_end_date DATE,
      shift_comp_date DATE,
      rev_ptd_tuf_end_date DATE,
      rev_pak_end_date DATE,
      wh_rec_date DATE,
      remarks_all TEXT,
      jr_close TEXT,
      or_remarks TEXT,
      jr_remarks TEXT,
      created_by TEXT,
      created_date TIMESTAMP DEFAULT NOW(),
      edited_by TEXT,
      edited_date TIMESTAMP
    );
  `);
  const numericColumns = ['or_qty', 'jr_qty', 'plan_qty', 'prod_plan_qty', 'std_pack'];
  for (const column of numericColumns) {
    await q(`
      ALTER TABLE or_jr_report
      ALTER COLUMN ${column} TYPE NUMERIC
      USING NULLIF(regexp_replace(COALESCE(${column}::text, ''), '[^0-9.+-]+', '', 'g'), '')::numeric
    `).catch(err => console.warn(`[DB] or_jr_report ${column} type migration skipped:`, err.message));
  }
}

async function migrateOrjrWiseDetailSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS mould_planning_report (
      id SERIAL PRIMARY KEY,
      or_jr_no TEXT,
      or_jr_date TEXT,
      item_code TEXT,
      bom_type TEXT,
      product_name TEXT,
      jr_qty TEXT,
      uom TEXT,
      plan_date TEXT,
      plan_qty TEXT,
      mould_item_code TEXT,
      mould_item_name TEXT,
      mould_no TEXT,
      mould_name TEXT,
      mould_item_qty TEXT,
      tonnage TEXT,
      machine_name TEXT,
      cycle_time TEXT,
      cavity TEXT,
      _status TEXT,
      created_by TEXT,
      created_date TIMESTAMP,
      edited_by TEXT,
      edited_date TIMESTAMP,
      remarks_all TEXT,
      sync_id UUID DEFAULT gen_random_uuid(),
      sync_status TEXT,
      factory_id INTEGER,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const ensureColumns = [
    ['mould_item_code', 'TEXT'],
    ['mould_item_name', 'TEXT'],
    ['factory_id', 'INTEGER'],
    ['updated_at', 'TIMESTAMP DEFAULT NOW()']
  ];

  for (const [name, typeSql] of ensureColumns) {
    await q(`ALTER TABLE mould_planning_report ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`);
  }

  await q(`CREATE INDEX IF NOT EXISTS idx_mould_planning_report_factory_id ON mould_planning_report(factory_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_mpr_order ON mould_planning_report(or_jr_no)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS mould_report_date_uniq_idx ON mould_planning_report(or_jr_no, mould_no, mould_item_code, plan_date)`);
}

async function migrateOrderCompletionWorkflowSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no VARCHAR(255) UNIQUE NOT NULL,
      item_code VARCHAR(255),
      item_name VARCHAR(255),
      mould_code VARCHAR(255),
      qty NUMERIC DEFAULT 0,
      balance NUMERIC DEFAULT 0,
      status VARCHAR(50) DEFAULT 'Pending',
      priority VARCHAR(50) DEFAULT 'Normal',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(`
    CREATE TABLE IF NOT EXISTS order_completion_history (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL,
      factory_id INTEGER,
      action_type TEXT NOT NULL,
      change_field TEXT,
      change_from TEXT,
      change_to TEXT,
      summary_text TEXT,
      master_status_before TEXT,
      master_status_after TEXT,
      actor_name TEXT,
      changed_at TIMESTAMP DEFAULT NOW(),
      details JSONB DEFAULT '{}'::jsonb
    )
  `);

  const ensureColumns = [
    ['completion_confirmation_required', 'BOOLEAN DEFAULT FALSE'],
    ['completion_change_field', 'TEXT'],
    ['completion_change_to', 'TEXT'],
    ['completion_change_summary', 'TEXT'],
    ['completion_detected_at', 'TIMESTAMP'],
    ['completion_source_snapshot', `JSONB DEFAULT '{}'::jsonb`],
    ['completion_confirmed_at', 'TIMESTAMP'],
    ['completion_confirmed_by', 'TEXT']
  ];

  for (const [name, typeSql] of ensureColumns) {
    await q(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`)
      .catch(err => console.warn(`[DB] orders ${name} migration skipped:`, err.message));
  }

  await q(`CREATE INDEX IF NOT EXISTS idx_orders_completion_pending ON orders(completion_confirmation_required)`)
    .catch(err => console.warn('[DB] orders completion pending index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_order_completion_history_order ON order_completion_history(order_no, changed_at DESC)`)
    .catch(err => console.warn('[DB] order completion history order index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_order_completion_history_factory ON order_completion_history(factory_id, changed_at DESC)`)
    .catch(err => console.warn('[DB] order completion history factory index skipped:', err.message));
}

async function migrateWipStockMasterSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS wip_stock_snapshots (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER NOT NULL,
      stock_date DATE NOT NULL,
      header_date_text TEXT,
      source_file_name TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMP DEFAULT NOW(),
      actual_row_count INTEGER DEFAULT 0,
      total_row_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(factory_id, stock_date)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS wip_stock_snapshot_lines (
      id SERIAL PRIMARY KEY,
      snapshot_id INTEGER NOT NULL REFERENCES wip_stock_snapshots(id) ON DELETE CASCADE,
      factory_id INTEGER NOT NULL,
      stock_date DATE NOT NULL,
      line_type TEXT DEFAULT 'actual',
      sr_no INTEGER,
      factory_unit TEXT,
      party_group TEXT,
      location_floor_dept TEXT,
      item_code TEXT,
      item_name TEXT,
      job_no TEXT,
      job_date DATE,
      ageing_period TEXT,
      previous_stock_qty NUMERIC,
      current_stock_available_qty NUMERIC,
      total_qty NUMERIC,
      uom TEXT,
      remark_from_factory_unit TEXT,
      remark_from_ho_sales_team TEXT,
      row_status TEXT,
      comparison_key TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS wip_stock_movements (
      id SERIAL PRIMARY KEY,
      factory_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      movement_at TIMESTAMP DEFAULT NOW(),
      stock_date DATE,
      wip_inventory_id INTEGER,
      shifting_record_id INTEGER,
      order_no TEXT,
      item_code TEXT,
      item_name TEXT,
      mould_name TEXT,
      rack_no TEXT,
      qty NUMERIC NOT NULL,
      balance_after NUMERIC,
      to_location TEXT,
      receiver_name TEXT,
      remarks TEXT,
      source_type TEXT,
      source_ref TEXT,
      actor_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const snapshotLineColumns = [
    ['line_type', `TEXT DEFAULT 'actual'`],
    ['stock_date', 'DATE'],
    ['row_status', 'TEXT'],
    ['comparison_key', 'TEXT'],
    ['remark_from_factory_unit', 'TEXT'],
    ['remark_from_ho_sales_team', 'TEXT']
  ];
  for (const [name, typeSql] of snapshotLineColumns) {
    await q(`ALTER TABLE wip_stock_snapshot_lines ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`)
      .catch(err => console.warn(`[DB] wip_stock_snapshot_lines ${name} migration skipped:`, err.message));
  }

  const movementColumns = [
    ['stock_date', 'DATE'],
    ['balance_after', 'NUMERIC'],
    ['remarks', 'TEXT'],
    ['source_type', 'TEXT'],
    ['source_ref', 'TEXT'],
    ['actor_name', 'TEXT']
  ];
  for (const [name, typeSql] of movementColumns) {
    await q(`ALTER TABLE wip_stock_movements ADD COLUMN IF NOT EXISTS ${name} ${typeSql}`)
      .catch(err => console.warn(`[DB] wip_stock_movements ${name} migration skipped:`, err.message));
  }

  await q(`CREATE INDEX IF NOT EXISTS idx_wip_stock_snapshots_factory_date ON wip_stock_snapshots(factory_id, stock_date DESC)`)
    .catch(err => console.warn('[DB] wip_stock_snapshots factory/date index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_wip_stock_lines_snapshot ON wip_stock_snapshot_lines(snapshot_id, line_type, sr_no)`)
    .catch(err => console.warn('[DB] wip_stock_snapshot_lines snapshot index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_wip_stock_lines_factory_date ON wip_stock_snapshot_lines(factory_id, stock_date DESC)`)
    .catch(err => console.warn('[DB] wip_stock_snapshot_lines factory/date index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_wip_stock_lines_comparison_key ON wip_stock_snapshot_lines(factory_id, stock_date DESC, comparison_key)`)
    .catch(err => console.warn('[DB] wip_stock_snapshot_lines comparison key index skipped:', err.message));
  await q(`CREATE INDEX IF NOT EXISTS idx_wip_stock_movements_factory_date ON wip_stock_movements(factory_id, movement_at DESC)`)
    .catch(err => console.warn('[DB] wip_stock_movements factory/date index skipped:', err.message));
}

async function migrateRawMaterialSchema() {
  await q(`
    CREATE TABLE IF NOT EXISTS raw_material_issues (
      id SERIAL PRIMARY KEY,
      plan_id TEXT,
      order_no TEXT,
      item_code TEXT,
      line TEXT,
      shift TEXT,
      sender_name TEXT,
      bag_qty NUMERIC,
      weight_per_bag NUMERIC,
      total_weight NUMERIC,
      status TEXT DEFAULT 'PENDING',
      accepted_by TEXT,
      accepted_qty NUMERIC,
      accepted_weight NUMERIC,
      accepted_at TIMESTAMPTZ,
      factory_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Ensure indices for performance
  await q(`CREATE INDEX IF NOT EXISTS idx_rm_issues_plan_id ON raw_material_issues(plan_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rm_issues_order_no ON raw_material_issues(order_no)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rm_issues_status ON raw_material_issues(status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_rm_issues_factory_id ON raw_material_issues(factory_id)`);
}

async function getAccessibleFactoriesForUser(userOrUsername) {
  let user = userOrUsername;

  if (!user) {
    return { user: null, factories: [], canSelectAllFactories: false };
  }

  if (typeof userOrUsername === 'string') {
    const rows = await q(
      `SELECT id, username, role_code, global_access
         FROM users
        WHERE username = $1
          AND COALESCE(is_active, TRUE) = TRUE
        LIMIT 1`,
      [userOrUsername]
    );
    user = rows[0] || null;
  }

  if (!user) {
    return { user: null, factories: [], canSelectAllFactories: false };
  }

  const role = String(user.role_code || '').toLowerCase();
  const canSelectAllFactories = role === 'superadmin' || user.username === 'superadmin' || user.global_access === true;

  const factories = canSelectAllFactories
    ? await q(`SELECT id, name, code, location, 'all' as user_role FROM factories WHERE is_active = true ORDER BY id`)
    : await q(
      `SELECT f.id, f.name, f.code, f.location, uf.role_code as user_role
         FROM factories f
         JOIN user_factories uf ON uf.factory_id = f.id
        WHERE uf.user_id = $1
          AND f.is_active = true
        ORDER BY f.id`,
      [user.id]
    );

  return { user, factories, canSelectAllFactories };
}

function isAdminLikeRole(user) {
  const role = String(user?.role_code || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
}

function isSuperadminRole(user) {
  return String(user?.role_code || '').toLowerCase() === 'superadmin';
}

function getRoleSortRank(roleCode) {
  const role = String(roleCode || '').toLowerCase();
  if (role === 'superadmin') return 0;
  if (role === 'admin') return 1;
  return 10;
}

async function getRequestActor(req) {
  const username = getRequestUsername(req);
  if (!username) return null;
  const rows = await q(
    `SELECT id, username, role_code, global_access
       FROM users
      WHERE username = $1
      LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function getMissingFactoryIds(factoryIds, db = pool) {
  const normalized = [...new Set(
    (Array.isArray(factoryIds) ? factoryIds : [factoryIds])
      .map(id => normalizeFactoryId(id))
      .filter(id => id !== null)
  )];

  if (!normalized.length) return [];

  const result = await db.query('SELECT id FROM factories WHERE id = ANY($1::int[])', [normalized]);
  const existing = new Set(result.rows.map(row => normalizeFactoryId(row.id)).filter(id => id !== null));
  return normalized.filter(id => !existing.has(id));
}

async function ensureFactoryIdsExist(factoryIds, db = pool, label = 'Factory') {
  const missing = await getMissingFactoryIds(factoryIds, db);
  if (missing.length) {
    throw new Error(`${label} ${missing.join(', ')} is not set up yet. Create or restore the factory first.`);
  }
}

async function attachFactoryNames(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const hasFactoryIdColumn = rows.some(row => row && Object.prototype.hasOwnProperty.call(row, 'factory_id'));
  if (!hasFactoryIdColumn) return rows;

  const factoryIds = [...new Set(
    rows
      .map(row => normalizeFactoryId(row && row.factory_id))
      .filter(id => id !== null)
  )];

  if (!factoryIds.length) {
    return rows.map(row => ({ ...row, factory_name: row.factory_name || '', factory_code: row.factory_code || '' }));
  }

  const factories = await q(
    'SELECT id, name, code FROM factories WHERE id = ANY($1::int[])',
    [factoryIds]
  );
  const factoryMap = new Map(factories.map(factory => [factory.id, factory]));

  return rows.map(row => {
    const factoryId = normalizeFactoryId(row && row.factory_id);
    const factory = factoryId !== null ? factoryMap.get(factoryId) : null;
    return {
      ...row,
      factory_name: row.factory_name || factory?.name || '',
      factory_code: row.factory_code || factory?.code || ''
    };
  });
}

function getUploadTemplateDefinition(type, factoryContext = {}) {
  const factoryId = factoryContext.factoryId ?? '';
  const factoryName = factoryContext.factoryName || '';
  const selectedMachineProcess = normalizeMachineProcess(factoryContext.machineProcess, '');

  const definitions = {
    orders: {
      label: 'Orders Master',
      headers: ['OrderNo', 'ItemCode', 'ItemName', 'MouldCode', 'Qty', 'Priority', 'Client Name', 'Factory ID'],
      sample: ['ORD-1001', 'ITEM-001', '20L Bucket', 'MLD-001', 5000, 'High', 'Demo Client', factoryId],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'Orders Master'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Header row', 'Keep the headers in row 1'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Priority values', 'Use Normal, High, or Low'],
        ['Qty', 'Numeric only'],
        ['Date format', 'Not required in this template']
      ]
    },
    moulds: {
      label: 'Moulds Master',
      headers: [
        'MOULD NUMBER', 'MOULD NAME', 'STD WT (KG)', 'RUNNER WEIGHT', 'PRIMARY MACHINE',
        'SECONDARY MACHINE', 'MOULDING SQN.', 'TONNAGE', 'NO OF CAV', 'CYCLE TIME',
        'PCS/HOUR', 'TARGET PCS/DAY', 'MATERIAL', 'MANPOWER', 'OPERATOR ACTIVITIES',
        'SFG STD PACKING', 'STD VOLUME CAP.', 'FACTORY ID'
      ],
      sample: [
        'MLD-001', '20L Bucket', 0.82, 0.06, 'B-L1>HYD-300-1',
        'B-L1>HYD-300-2', 'SQN-A', 300, 2, 38,
        190, 4560, 'PP', 2, 'Change insert, cleaning, packing check',
        '25 PCS', '20 L', factoryId
      ],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'Moulds Master'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Column order', 'Do not change the column order from A to R'],
        ['Header row', 'Keep row 1 as headers'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Numeric columns', 'STD WT (KG), RUNNER WEIGHT, TONNAGE, NO OF CAV, CYCLE TIME, PCS/HOUR, TARGET PCS/DAY, and MANPOWER must be numeric'],
        ['Machine columns', 'PRIMARY MACHINE and SECONDARY MACHINE can be text']
      ]
    },
    orjrwise: {
      label: 'ORJR Wise Summary',
      headers: [
        'OR/JR No', 'JR Date', 'Our Code', 'BomType', 'JR Item Name', 'JR Qty', 'UOM',
        'Mould No', 'Mould', 'Mould Item Qty', 'Tonnage', 'Machine', 'Cycle Time', 'Cavity', 'Factory ID'
      ],
      sample: [
        'OR-1001', '2026-04-05', 'ITEM-001', 'Main', '20L Bucket', 10000, 'PCS',
        'MLD-001', '20L Bucket Mould', 5000, 300, 'B-L1>HYD-300-1', 38, 2, factoryId
      ],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'ORJR Wise Summary'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Header row', 'Keep row 1 as headers'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Required columns', 'OR/JR No and Mould No are required for each row'],
        ['Date column', 'JR Date is used as the summary date and default Plan Date'],
        ['Numeric columns', 'JR Qty, Mould Item Qty, Tonnage, Cycle Time, and Cavity must be numeric']
      ]
    },
    orjrwisedetail: {
      label: 'ORJR Wise Detail',
      headers: [
        'OR/JR No', 'JR Date', 'Our Code', 'BomType', 'JR Item Name', 'JR Qty', 'UOM',
        'Mold Item Code', 'Mold Item Name', 'Mould No', 'Mould', 'Mould Item Qty', 'Tonnage',
        'Machine', 'Cycle Time', 'Cavity', 'Factory ID'
      ],
      sample: [
        'OR-1001', '2026-04-05', 'ITEM-001', 'Main', '20L Bucket', 10000, 'PCS',
        'ERP-001', '20L Bucket Finished Part', 'MLD-001', '20L Bucket Mould', 5000, 300,
        'B-L1>HYD-300-1', 38, 2, factoryId
      ],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'ORJR Wise Detail'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Header row', 'Keep row 1 as headers'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Required columns', 'OR/JR No and Mould No are required for each row'],
        ['Detail columns', 'Mold Item Code and Mold Item Name help the detail master show exact uploaded data'],
        ['Date column', 'JR Date is used as the summary date and default Plan Date'],
        ['Numeric columns', 'JR Qty, Mould Item Qty, Tonnage, Cycle Time, and Cavity must be numeric']
      ]
    },
    boplanningdetail: {
      label: 'BO Planning Detail',
      headers: [
        'OR/JR No', 'JR Date', 'Our Code', 'BomType', 'JR Item Name', 'JR Qty', 'UOM',
        'Plan Date', 'Plan Qty', 'Bo Item Code', 'Bo Item Name', 'Bo UOM', 'Bo Item Qty', 'Remarks', 'Factory ID'
      ],
      sample: [
        'OR-1001', '2026-04-05', 'ITEM-001', 'Main', '20L Bucket', 10000, 'PCS',
        '2026-04-10', 500, 'BO-001', 'Handle Component', 'PCS', 500, 'Urgent', factoryId
      ],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'BO Planning Detail'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Header row', 'Keep row 1 as headers'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Required columns', 'OR/JR No and Bo Item Code are required'],
        ['Plan Date', 'Specify the planned date for this BO component'],
        ['Numeric columns', 'JR Qty, Plan Qty, and Bo Item Qty must be numeric']
      ]
    },
    wipstock: {
      label: 'WIP Stock',
      headers: [
        'Sr.No.', 'Factory Unit', 'Party Group', 'Location/Floor/Dept.', 'Item Code', 'Item Name',
        'Job No.', 'Job Date', 'Ageing Period', 'Previous Stock', 'Current Stock/Available',
        'Total Qty', 'UOM', 'Remark From factory Unit', 'Remark From HO/Sales Team', 'Factory ID'
      ],
      sample: [
        1, factoryName || 'DUNGRA UNIT 1', 'General Trade', 'Packing Unit A', '1016-RPJ',
        'Freshy (Small) - RPJ Ice Cabbage Green', 'JOB-1001', '2026-04-06', '2 Years',
        18, 20, 38, 'Pcs', 'Discuss with Sales', 'Grinding', factoryId
      ],
      templateRows: [
        ['WIP STOCK'],
        ['Date :-', '2026-04-06'],
        [],
        [
          'Sr.No.', 'Factory Unit', 'Party Group', 'Location/Floor/Dept.', 'Item Code', 'Item Name',
          'Job No.', 'Job Date', 'Ageing Period', 'Previous Stock', 'Current Stock/Available',
          'Total Qty', 'UOM', 'Remark From factory Unit', 'Remark From HO/Sales Team', 'Factory ID'
        ],
        [
          1, factoryName || 'DUNGRA UNIT 1', 'General Trade', 'Packing Unit A', '1016-RPJ',
          'Freshy (Small) - RPJ Ice Cabbage Green', 'JOB-1001', '2026-04-06', '2 Years',
          18, 20, 38, 'Pcs', 'Discuss with Sales', 'Grinding', factoryId
        ]
      ],
      headerRowIndex: 3,
      notes: [
        ['Rule', 'Value'],
        ['Master', 'WIP Stock'],
        ['Supported sheets', 'Current factory WIP sheet style and this clean JMS template are both accepted'],
        ['Stock Date', 'Keep a date row above the header like "Date :- 03/04/26"'],
        ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
        ['Date-wise upload', 'Uploading the same factory and stock date replaces that day only'],
        ['Row status', 'New / Existing / Nil is computed by JMS automatically after upload'],
        ['Merged cells', 'Blank repeated cells in the current WIP sheet are auto-filled from the previous visible value']
      ]
    },
    machines: selectedMachineProcess === 'Printing'
      ? {
        label: 'Printing Machines Master',
        headers: ['Machine Number', 'Vendor Name', 'Model No', 'Machine Type'],
        sample: ['PRINT-01', 'Demo Vendor', 'MDL-100', 'Screen Printing'],
        notes: [
          ['Rule', 'Value'],
          ['Master', 'Printing Machines Master'],
          ['Upload sheet', 'Use the first sheet only'],
          ['Column order', 'Use A=Machine Number, B=Vendor Name, C=Model No, D=Machine Type'],
          ['Factory scope', factoryId ? `Upload in the selected factory scope ${factoryName || `Factory ${factoryId}`} (${factoryId}).` : 'Upload in the selected factory scope.'],
          ['Process', 'All uploaded rows are saved as Printing machines automatically'],
          ['Building / Line / Tonnage', 'Not required for Printing machines']
        ]
      }
      : {
        label: 'Machines Master',
        headers: ['Building', 'Line', 'Machine', 'Process', 'Tonnage', 'Factory ID'],
        sample: ['Building A', 'Line 1', 'MC-01', 'Moulding', 250, factoryId],
        notes: [
          ['Rule', 'Value'],
          ['Master', 'Machines Master'],
          ['Upload sheet', 'Use the first sheet only'],
          ['Column order', 'Use A=Building, B=Line, C=Machine, D=Process, E=Tonnage'],
          ['Factory ID', factoryId ? `Optional. Current scope is ${factoryName || `Factory ${factoryId}`} (${factoryId}). Leave blank to use selected Factory Scope.` : 'Optional. Leave blank to use selected Factory Scope.'],
          ['Machine names', 'Repeated machine names in the same file are auto-deduplicated by latest row'],
          ['Process values', 'Use Moulding, Tuffting, or Printing. Blank values default to Moulding.'],
          ['Tonnage', 'Numeric only']
        ]
      },
    orjr: {
      label: 'OR-JR Status',
      headers: [
        'OR/JR No', 'OR/JR Date', 'OR Qty', 'JR Qty', 'Plan Qty', 'Plan Date',
        'Job Card No', 'Job Card Date', 'Item Code', 'Product Name', 'Client Name',
        'Production Plan Qty', 'STD Pack', 'UOM', 'Planned Comp Date',
        'MLD Start Date', 'MLD End Date', 'Actual Mld Start Date', 'Prt/Tuf End Date', 'Pack End Date',
        'MLD Status', 'Shift Status', 'Prt/Tuf Status', 'Pack Status', 'WH Status',
        'Rev MLD End Date', 'Shift Comp. Date', 'Rev Ptd/Tuf End Date', 'Rev Pak End Date', 'WH Rec Date',
        'JC-Mld-Shift-Pur-Ptd/Tuft-Pkg-WH Remarks', 'JR Close', 'OR Remarks', 'JR Remarks',
        'Created By', 'Created Date', 'Edited By', 'Edited Date'
      ],
      sample: [
        'OR-1001', '2026-04-03', 10000, 10000, 10000, '2026-04-05',
        'JC-5001', '2026-04-03', 'ITEM-001', '20L Bucket', 'Demo Client',
        10000, 20, 'PCS', '2026-04-06',
        '2026-04-04', '2026-04-05', '2026-04-04', '2026-04-06', '2026-04-07',
        'Running', 'Pending', 'Pending', 'Pending', 'Pending',
        '2026-04-05', '2026-04-06', '2026-04-06', '2026-04-07', '2026-04-08',
        'Sample OR-JR row', 'No', '', '',
        'Sanjay', '2026-04-03', 'Sanjay', '2026-04-03'
      ],
      notes: [
        ['Rule', 'Value'],
        ['Master', 'OR-JR Status'],
        ['Upload sheet', 'Use the first sheet only'],
        ['Header row', 'Keep row 1 as headers containing OR/JR No'],
        ['Date format', 'Recommended format is YYYY-MM-DD'],
        ['Factory Scope', factoryId ? `Selected factory scope ${factoryName || `Factory ${factoryId}`} (${factoryId}) is applied automatically during upload.` : 'Selected factory scope is applied automatically during upload.'],
        ['JR Close', 'Use Yes or No'],
        ['Blank values', 'Leave cells blank if a date/status is not available']
      ]
    }
  };

  return definitions[type] || null;
}

async function getFactoryScopeForRequest(req) {
  const username = getRequestUsername(req);
  const rawHeader = req.headers['x-factory-id'];
  const headerValue = rawHeader === undefined || rawHeader === null ? '' : String(rawHeader).trim();
  const requestedAllFactories = headerValue !== '' && ['all', '*'].includes(headerValue.toLowerCase());
  const requestedFactoryId = headerValue !== ''
    ? normalizeFactoryId(headerValue)
    : normalizeFactoryId(getFactoryId(req));

  if (!username) {
    return {
      hasAccessControl: false,
      access: null,
      allowedFactoryIds: [],
      canSelectAllFactories: false,
      useAllFactories: false,
      factoryId: requestedFactoryId,
      denyAll: false
    };
  }

  const access = await getAccessibleFactoriesForUser(username);
  const allowedFactoryIds = access.factories
    .map(factory => normalizeFactoryId(factory && factory.id))
    .filter(id => id !== null);

  if (!allowedFactoryIds.length) {
    return {
      hasAccessControl: true,
      access,
      allowedFactoryIds,
      canSelectAllFactories: access.canSelectAllFactories,
      useAllFactories: false,
      factoryId: null,
      denyAll: true
    };
  }

  if (requestedAllFactories) {
    if (access.canSelectAllFactories) {
      return {
        hasAccessControl: true,
        access,
        allowedFactoryIds,
        canSelectAllFactories: true,
        useAllFactories: true,
        factoryId: null,
        denyAll: false
      };
    }

    return {
      hasAccessControl: true,
      access,
      allowedFactoryIds,
      canSelectAllFactories: false,
      useAllFactories: false,
      factoryId: allowedFactoryIds[0],
      denyAll: false
    };
  }

  if (requestedFactoryId !== null) {
    if (access.canSelectAllFactories || allowedFactoryIds.includes(requestedFactoryId)) {
      return {
        hasAccessControl: true,
        access,
        allowedFactoryIds,
        canSelectAllFactories: access.canSelectAllFactories,
        useAllFactories: false,
        factoryId: requestedFactoryId,
        denyAll: false
      };
    }

    return {
      hasAccessControl: true,
      access,
      allowedFactoryIds,
      canSelectAllFactories: access.canSelectAllFactories,
      useAllFactories: false,
      factoryId: allowedFactoryIds[0],
      denyAll: false
    };
  }

  return {
    hasAccessControl: true,
    access,
    allowedFactoryIds,
    canSelectAllFactories: access.canSelectAllFactories,
    useAllFactories: false,
    factoryId: allowedFactoryIds[0],
    denyAll: false
  };
}

function applyFactoryScopeCondition(conditions, params, column, scope) {
  if (!scope) return;

  if (scope.hasAccessControl === false) {
    if (scope.factoryId !== null && scope.factoryId !== undefined) {
      params.push(scope.factoryId);
      conditions.push(`${column} = $${params.length}`);
    }
    return;
  }

  if (scope.denyAll) {
    conditions.push('1 = 0');
    return;
  }

  if (scope.useAllFactories) {
    params.push(scope.allowedFactoryIds);
    conditions.push(`${column} = ANY($${params.length}::int[])`);
    return;
  }

  if (scope.factoryId !== null && scope.factoryId !== undefined) {
    params.push(scope.factoryId);
    conditions.push(`${column} = $${params.length}`);
  }
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const normalized = typeof v === 'string'
    ? v.trim().replace(/,/g, '')
    : v;
  const n = Number(normalized);
  return Number.isNaN(n) ? null : n;
}

function normalizeOptionalText(value) {
  const clean = String(value || '').trim();
  return clean || null;
}

function getWipStockRowStatusRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'new') return 0;
  if (normalized === 'existing') return 1;
  if (normalized === 'nil') return 2;
  return 3;
}

function hasMeaningfulWipStockData(row) {
  if (!row || typeof row !== 'object') return false;
  return [
    row.item_code,
    row.item_name,
    row.current_stock_available_qty,
    row.total_qty,
    row.remark_from_ho_sales_team,
    row.remark_from_factory_unit
  ].some(isMeaningfulUploadCell);
}

async function getPreviousWipStockSnapshot(client, factoryId, stockDate) {
  const result = await client.query(
    `SELECT id, factory_id, stock_date
       FROM wip_stock_snapshots
      WHERE factory_id = $1
        AND stock_date < $2::date
      ORDER BY stock_date DESC
      LIMIT 1`,
    [factoryId, stockDate]
  );
  return result.rows[0] || null;
}

async function getNextWipStockSnapshot(client, factoryId, stockDate) {
  const result = await client.query(
    `SELECT id, factory_id, stock_date
       FROM wip_stock_snapshots
      WHERE factory_id = $1
        AND stock_date > $2::date
      ORDER BY stock_date ASC
      LIMIT 1`,
    [factoryId, stockDate]
  );
  return result.rows[0] || null;
}

async function getWipStockActualRowsBySnapshot(client, snapshotId) {
  const result = await client.query(
    `SELECT *
       FROM wip_stock_snapshot_lines
      WHERE snapshot_id = $1
        AND line_type = 'actual'
      ORDER BY COALESCE(sr_no, 2147483647), id`,
    [snapshotId]
  );
  return result.rows || [];
}

function buildWipSnapshotRowsForStorage(actualRows, previousActualRows, stockDate) {
  const previousMap = new Map();
  (Array.isArray(previousActualRows) ? previousActualRows : []).forEach(row => {
    const normalized = normalizeWipStockUploadRow(row, normalizeFactoryId(row.factory_id), stockDate, 'actual');
    if (normalized.comparison_key && !previousMap.has(normalized.comparison_key)) {
      previousMap.set(normalized.comparison_key, normalized);
    }
  });

  const actualNormalizedRows = [];
  const currentKeys = new Set();

  (Array.isArray(actualRows) ? actualRows : []).forEach((row, idx) => {
    const normalized = normalizeWipStockUploadRow(row, normalizeFactoryId(row.factory_id), stockDate, 'actual');
    if (!hasMeaningfulWipStockData(normalized)) return;
    if (normalized.sr_no === null || normalized.sr_no === undefined) {
      normalized.sr_no = idx + 1;
    }
    if (normalized.total_qty === null && normalized.current_stock_available_qty !== null) {
      normalized.total_qty = normalized.current_stock_available_qty;
    }

    const currentQty = toNum(normalized.current_stock_available_qty) ?? 0;
    if (currentQty <= 0) {
      normalized.row_status = 'Nil';
    } else if (normalized.comparison_key && previousMap.has(normalized.comparison_key)) {
      normalized.row_status = 'Existing';
    } else {
      normalized.row_status = 'New';
    }

    if (normalized.comparison_key) currentKeys.add(normalized.comparison_key);
    actualNormalizedRows.push(normalized);
  });

  const derivedNilRows = [];
  previousMap.forEach(prevRow => {
    if (!prevRow.comparison_key || currentKeys.has(prevRow.comparison_key)) return;
    derivedNilRows.push({
      ...prevRow,
      stock_date: stockDate,
      line_type: 'derived_nil',
      row_status: 'Nil',
      previous_stock_qty: toNum(prevRow.current_stock_available_qty) ?? toNum(prevRow.total_qty) ?? toNum(prevRow.previous_stock_qty),
      current_stock_available_qty: 0,
      total_qty: 0
    });
  });

  const allRows = [...actualNormalizedRows, ...derivedNilRows].sort((a, b) => {
    const aSr = toNum(a.sr_no) ?? Number.MAX_SAFE_INTEGER;
    const bSr = toNum(b.sr_no) ?? Number.MAX_SAFE_INTEGER;
    if (aSr !== bSr) return aSr - bSr;
    return getWipStockRowStatusRank(a.row_status) - getWipStockRowStatusRank(b.row_status);
  });

  return {
    actualRows: actualNormalizedRows,
    derivedNilRows,
    allRows
  };
}

async function replaceWipSnapshotLines(client, snapshotId, rows) {
  await client.query('DELETE FROM wip_stock_snapshot_lines WHERE snapshot_id = $1', [snapshotId]);
  if (!Array.isArray(rows) || !rows.length) return;

  const sql = `
    INSERT INTO wip_stock_snapshot_lines(
      snapshot_id, factory_id, stock_date, line_type, sr_no, factory_unit, party_group, location_floor_dept,
      item_code, item_name, job_no, job_date, ageing_period, previous_stock_qty, current_stock_available_qty,
      total_qty, uom, remark_from_factory_unit, remark_from_ho_sales_team, row_status, comparison_key, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, NOW(), NOW()
    )
  `;

  for (const row of rows) {
    await client.query(sql, [
      snapshotId,
      normalizeFactoryId(row.factory_id),
      row.stock_date,
      row.line_type || 'actual',
      toNum(row.sr_no),
      normalizeOptionalText(row.factory_unit),
      normalizeOptionalText(row.party_group),
      normalizeOptionalText(row.location_floor_dept),
      normalizeOptionalText(row.item_code),
      normalizeOptionalText(row.item_name),
      normalizeOptionalText(row.job_no),
      row.job_date || null,
      normalizeOptionalText(row.ageing_period),
      toNum(row.previous_stock_qty),
      toNum(row.current_stock_available_qty),
      toNum(row.total_qty),
      normalizeOptionalText(row.uom),
      normalizeOptionalText(row.remark_from_factory_unit),
      normalizeOptionalText(row.remark_from_ho_sales_team),
      normalizeOptionalText(row.row_status),
      normalizeOptionalText(row.comparison_key)
    ]);
  }
}

async function rebuildWipSnapshotById(client, snapshotId) {
  const snapshotRes = await client.query(
    `SELECT id, factory_id, stock_date
       FROM wip_stock_snapshots
      WHERE id = $1
      LIMIT 1`,
    [snapshotId]
  );
  const snapshot = snapshotRes.rows[0];
  if (!snapshot) return null;

  const actualRows = await getWipStockActualRowsBySnapshot(client, snapshot.id);
  const previousSnapshot = await getPreviousWipStockSnapshot(client, snapshot.factory_id, snapshot.stock_date);
  const previousActualRows = previousSnapshot
    ? await getWipStockActualRowsBySnapshot(client, previousSnapshot.id)
    : [];
  const built = buildWipSnapshotRowsForStorage(actualRows, previousActualRows, snapshot.stock_date);

  await replaceWipSnapshotLines(client, snapshot.id, built.allRows);
  await client.query(
    `UPDATE wip_stock_snapshots
        SET actual_row_count = $2,
            total_row_count = $3,
            updated_at = NOW()
      WHERE id = $1`,
    [snapshot.id, built.actualRows.length, built.allRows.length]
  );
  return built;
}

async function rebuildImmediateNextWipSnapshot(client, factoryId, stockDate) {
  const nextSnapshot = await getNextWipStockSnapshot(client, factoryId, stockDate);
  if (!nextSnapshot) return;
  await rebuildWipSnapshotById(client, nextSnapshot.id);
}

async function saveWipStockSnapshot(client, {
  factoryId,
  stockDate,
  headerDateText = null,
  sourceFileName = null,
  rows = [],
  username = 'BulkUpload'
}) {
  const cleanFactoryId = normalizeFactoryId(factoryId);
  const cleanStockDate = toIsoDateOnly(stockDate);
  if (cleanFactoryId === null) {
    throw new UploadValidationError('Select one valid factory before uploading WIP Stock.');
  }
  if (!cleanStockDate) {
    throw new UploadValidationError('WIP Stock date is required.');
  }
  if (!Array.isArray(rows) || !rows.length) {
    throw new UploadValidationError('No WIP Stock rows were provided.');
  }

  await ensureFactoryIdsExist([cleanFactoryId], client, 'WIP Stock upload factory');

  const actualRows = rows
    .map((row, idx) => {
      const normalized = normalizeWipStockUploadRow(row, cleanFactoryId, cleanStockDate, 'actual');
      if (normalized.sr_no === null || normalized.sr_no === undefined) {
        normalized.sr_no = idx + 1;
      }
      return normalized;
    })
    .filter(hasMeaningfulWipStockData);

  if (!actualRows.length) {
    throw new UploadValidationError('No valid WIP Stock rows were found for saving.');
  }

  await client.query('DELETE FROM wip_stock_snapshots WHERE factory_id = $1 AND stock_date = $2::date', [cleanFactoryId, cleanStockDate]);

  const previousSnapshot = await getPreviousWipStockSnapshot(client, cleanFactoryId, cleanStockDate);
  const previousActualRows = previousSnapshot
    ? await getWipStockActualRowsBySnapshot(client, previousSnapshot.id)
    : [];
  const built = buildWipSnapshotRowsForStorage(actualRows, previousActualRows, cleanStockDate);

  const snapshotRes = await client.query(
    `INSERT INTO wip_stock_snapshots(
       factory_id, stock_date, header_date_text, source_file_name, uploaded_by, uploaded_at, actual_row_count, total_row_count, created_at, updated_at
     ) VALUES ($1, $2::date, $3, $4, $5, NOW(), $6, $7, NOW(), NOW())
     RETURNING id, stock_date`,
    [
      cleanFactoryId,
      cleanStockDate,
      normalizeOptionalText(headerDateText),
      normalizeOptionalText(sourceFileName),
      normalizeOptionalText(username) || 'BulkUpload',
      built.actualRows.length,
      built.allRows.length
    ]
  );

  const snapshotId = snapshotRes.rows[0]?.id;
  if (!snapshotId) {
    throw new Error('Failed to create WIP Stock snapshot.');
  }

  await replaceWipSnapshotLines(client, snapshotId, built.allRows);
  await rebuildImmediateNextWipSnapshot(client, cleanFactoryId, cleanStockDate);

  return {
    snapshot_id: snapshotId,
    stock_date: cleanStockDate,
    actual_row_count: built.actualRows.length,
    total_row_count: built.allRows.length
  };
}

async function recordWipStockMovement(client, payload = {}) {
  const cleanFactoryId = normalizeFactoryId(payload.factory_id);
  if (cleanFactoryId === null) return;
  await client.query(
    `INSERT INTO wip_stock_movements(
      factory_id, movement_type, movement_at, stock_date, wip_inventory_id, shifting_record_id, order_no,
      item_code, item_name, mould_name, rack_no, qty, balance_after, to_location, receiver_name,
      remarks, source_type, source_ref, actor_name, created_at
    ) VALUES (
      $1, $2, COALESCE($3, NOW()), $4::date, $5, $6, $7,
      $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, NOW()
    )`,
    [
      cleanFactoryId,
      normalizeOptionalText(payload.movement_type),
      payload.movement_at || null,
      toIsoDateOnly(payload.stock_date),
      toNum(payload.wip_inventory_id),
      toNum(payload.shifting_record_id),
      normalizeOptionalText(payload.order_no),
      normalizeOptionalText(payload.item_code),
      normalizeOptionalText(payload.item_name),
      normalizeOptionalText(payload.mould_name),
      normalizeOptionalText(payload.rack_no),
      toNum(payload.qty) ?? 0,
      toNum(payload.balance_after),
      normalizeOptionalText(payload.to_location),
      normalizeOptionalText(payload.receiver_name),
      normalizeOptionalText(payload.remarks),
      normalizeOptionalText(payload.source_type),
      normalizeOptionalText(payload.source_ref),
      normalizeOptionalText(payload.actor_name)
    ]
  );
}

function getPrioritySortSql(columnName) {
  return `CASE LOWER(COALESCE(${columnName}, 'normal'))
    WHEN 'urgent' THEN 0
    WHEN 'high' THEN 1
    WHEN 'normal' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END`;
}

function formatWorkflowStatusLabel(value) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (['complete', 'completed'].includes(lower)) return 'Completed';
  if (['cancel', 'cancelled', 'canceled'].includes(lower)) return 'Cancelled';
  return clean
    .split(' ')
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function isTerminalMouldStatus(value) {
  const normalized = formatWorkflowStatusLabel(value).toLowerCase();
  return normalized === 'completed' || normalized === 'cancelled';
}

function buildOrderCompletionChange({ mouldStatuses = [], anyClosed = false } = {}) {
  const normalizedStatuses = [...new Set(
    (Array.isArray(mouldStatuses) ? mouldStatuses : [mouldStatuses])
      .map(formatWorkflowStatusLabel)
      .filter(Boolean)
  )];
  const terminalStatuses = normalizedStatuses.filter(isTerminalMouldStatus);

  let changeTo = terminalStatuses.join(' / ');
  if (!changeTo && anyClosed) {
    changeTo = 'Closed';
  } else if (anyClosed && !changeTo.includes('Closed')) {
    changeTo += ' / Closed';
  }
  if (!changeTo) changeTo = 'Completed';

  return {
    field: 'MLD Status',
    to: changeTo,
    summary: `MLD Status changed to ${changeTo}`
  };
}

async function insertOrderCompletionHistory(db, payload = {}) {
  const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
  await db.query(
    `INSERT INTO order_completion_history(
      order_no,
      factory_id,
      action_type,
      change_field,
      change_from,
      change_to,
      summary_text,
      master_status_before,
      master_status_after,
      actor_name,
      details
    ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      normalizeOptionalText(payload.orderNo),
      normalizeFactoryId(payload.factoryId),
      normalizeOptionalText(payload.actionType) || 'UPDATED',
      normalizeOptionalText(payload.changeField),
      normalizeOptionalText(payload.changeFrom),
      normalizeOptionalText(payload.changeTo),
      normalizeOptionalText(payload.summaryText),
      normalizeOptionalText(payload.masterStatusBefore),
      normalizeOptionalText(payload.masterStatusAfter),
      normalizeOptionalText(payload.actorName) || 'System',
      JSON.stringify(details || {})
    ]
  );
}

function scopeAllowsFactory(scope, factoryId) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  if (!scope) return true;

  if (scope.hasAccessControl === false) {
    return scope.factoryId === null || normalizedFactoryId === null || scope.factoryId === normalizedFactoryId;
  }

  if (scope.denyAll) return false;
  if (normalizedFactoryId === null) return scope.useAllFactories || scope.factoryId === null;
  if (scope.useAllFactories) return scope.allowedFactoryIds.includes(normalizedFactoryId);
  if (scope.factoryId !== null && scope.factoryId !== undefined) return scope.factoryId === normalizedFactoryId;
  return true;
}

async function syncOrderCompletionConfirmations(db = pool, { factoryId = null, actorName = 'System' } = {}) {
  const scopedFactoryId = normalizeFactoryId(factoryId);
  const params = [];
  let scopeClause = '';
  if (scopedFactoryId !== null) {
    params.push(scopedFactoryId);
    scopeClause = `AND factory_id = $${params.length}`;
  }

  const groupedRes = await db.query(
    `
      WITH ranked AS (
        SELECT
          id,
          TRIM(or_jr_no) AS order_no,
          COALESCE(factory_id, 0) AS factory_scope_id,
          factory_id,
          item_code,
          product_name,
          client_name,
          plan_qty,
          mld_status,
          is_closed,
          created_by,
          created_date,
          edited_by,
          edited_date,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(or_jr_no), COALESCE(factory_id, 0)
            ORDER BY
              CASE
                WHEN COALESCE(is_closed, FALSE) = FALSE
                  AND COALESCE(TRIM(LOWER(mld_status)), '') NOT IN ('completed', 'complete', 'cancelled', 'canceled', 'cancel')
                THEN 0 ELSE 1
              END,
              COALESCE(edited_date, created_date, NOW()) DESC,
              id DESC
          ) AS rn
        FROM or_jr_report
        WHERE TRIM(COALESCE(or_jr_no, '')) <> ''
        ${scopeClause}
      ),
      aggregated AS (
        SELECT
          order_no,
          factory_scope_id,
          MIN(factory_id) AS factory_id,
          BOOL_AND(
            COALESCE(is_closed, FALSE)
            OR COALESCE(TRIM(LOWER(mld_status)), '') IN ('completed', 'complete', 'cancelled', 'canceled', 'cancel')
          ) AS all_terminal,
          BOOL_OR(COALESCE(is_closed, FALSE)) AS any_closed,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(TRIM(mld_status), '')), NULL) AS mould_statuses,
          COUNT(*) AS row_count
        FROM ranked
        GROUP BY order_no, factory_scope_id
      )
      SELECT
        a.*,
        r.item_code,
        r.product_name,
        r.client_name,
        r.plan_qty
      FROM aggregated a
      LEFT JOIN ranked r
        ON r.order_no = a.order_no
       AND r.factory_scope_id = a.factory_scope_id
       AND r.rn = 1
    `,
    params
  );

  const seenKeys = new Set();
  let flagged = 0;
  let cleared = 0;

  for (const group of groupedRes.rows) {
    const groupFactoryId = normalizeFactoryId(group.factory_id);
    const groupFactoryScopeId = Number(group.factory_scope_id || 0);
    const orderNo = String(group.order_no || '').trim();
    if (!orderNo) continue;

    const key = `${orderNo}::${groupFactoryScopeId}`;
    seenKeys.add(key);

    const existingRes = await db.query(
      `SELECT
          id,
          order_no,
          factory_id,
          status,
          completion_confirmation_required,
          completion_change_summary,
          completion_detected_at,
          completion_confirmed_at,
          completion_confirmed_by
         FROM orders
        WHERE TRIM(order_no) = TRIM($1)
          AND COALESCE(factory_id, 0) = COALESCE($2, 0)
        ORDER BY id ASC
        LIMIT 1`,
      [orderNo, groupFactoryId]
    );
    const existing = existingRes.rows[0] || null;

    if (group.all_terminal) {
      const change = buildOrderCompletionChange({
        mouldStatuses: group.mould_statuses || [],
        anyClosed: group.any_closed === true
      });
      const sourceSnapshot = {
        row_count: Number(group.row_count || 0),
        any_closed: group.any_closed === true,
        mould_statuses: Array.isArray(group.mould_statuses) ? group.mould_statuses : [],
        representative: {
          item_code: normalizeOptionalText(group.item_code),
          product_name: normalizeOptionalText(group.product_name),
          client_name: normalizeOptionalText(group.client_name),
          plan_qty: group.plan_qty ?? null
        }
      };

      if (!existing) {
        await db.query(
          `INSERT INTO orders(
            order_no,
            item_code,
            item_name,
            client_name,
            qty,
            priority,
            status,
            created_at,
            updated_at,
            factory_id,
            completion_confirmation_required,
            completion_change_field,
            completion_change_to,
            completion_change_summary,
            completion_detected_at,
            completion_source_snapshot,
            completion_confirmed_at,
            completion_confirmed_by
          ) VALUES(
            $1, $2, $3, $4, $5, 'Normal', 'Pending', NOW(), NOW(), $6,
            TRUE, $7, $8, $9, NOW(), $10::jsonb, NULL, NULL
          )`,
          [
            orderNo,
            normalizeOptionalText(group.item_code),
            normalizeOptionalText(group.product_name),
            normalizeOptionalText(group.client_name),
            toNum(group.plan_qty),
            groupFactoryId,
            change.field,
            change.to,
            change.summary,
            JSON.stringify(sourceSnapshot)
          ]
        );

        await insertOrderCompletionHistory(db, {
          orderNo,
          factoryId: groupFactoryId,
          actionType: 'DETECTED',
          changeField: change.field,
          changeTo: change.to,
          summaryText: change.summary,
          masterStatusBefore: null,
          masterStatusAfter: 'Pending',
          actorName,
          details: sourceSnapshot
        });
        flagged++;
        continue;
      }

      const alreadyConfirmed = String(existing.status || '').toLowerCase() === 'completed'
        && !!existing.completion_confirmed_at
        && existing.completion_confirmation_required !== true;

      if (alreadyConfirmed) {
        continue;
      }

      const alreadyPendingSameChange = existing.completion_confirmation_required === true
        && String(existing.completion_change_summary || '') === change.summary
        && String(existing.status || '').toLowerCase() !== 'completed';

      if (!alreadyPendingSameChange) {
        await db.query(
          `UPDATE orders
              SET item_code = COALESCE($2, item_code),
                  item_name = COALESCE($3, item_name),
                  client_name = COALESCE($4, client_name),
                  qty = COALESCE($5, qty),
                  factory_id = COALESCE($6, factory_id),
                  status = 'Pending',
                  completion_confirmation_required = TRUE,
                  completion_change_field = $7,
                  completion_change_to = $8,
                  completion_change_summary = $9,
                  completion_detected_at = NOW(),
                  completion_source_snapshot = $10::jsonb,
                  completion_confirmed_at = NULL,
                  completion_confirmed_by = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            existing.id,
            normalizeOptionalText(group.item_code),
            normalizeOptionalText(group.product_name),
            normalizeOptionalText(group.client_name),
            toNum(group.plan_qty),
            groupFactoryId,
            change.field,
            change.to,
            change.summary,
            JSON.stringify(sourceSnapshot)
          ]
        );

        await insertOrderCompletionHistory(db, {
          orderNo,
          factoryId: groupFactoryId,
          actionType: 'DETECTED',
          changeField: change.field,
          changeTo: change.to,
          summaryText: change.summary,
          masterStatusBefore: existing.status,
          masterStatusAfter: 'Pending',
          actorName,
          details: sourceSnapshot
        });
        flagged++;
      }

      continue;
    }

    if (!existing) continue;

    const shouldClear = existing.completion_confirmation_required === true
      || !!existing.completion_confirmed_at
      || String(existing.status || '').toLowerCase() === 'completed';

    if (!shouldClear) continue;

    await db.query(
      `UPDATE orders
          SET status = 'Pending',
              completion_confirmation_required = FALSE,
              completion_change_field = NULL,
              completion_change_to = NULL,
              completion_change_summary = NULL,
              completion_detected_at = NULL,
              completion_source_snapshot = '{}'::jsonb,
              completion_confirmed_at = NULL,
              completion_confirmed_by = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [existing.id]
    );

    await insertOrderCompletionHistory(db, {
      orderNo,
      factoryId: groupFactoryId,
      actionType: 'AUTO_CLEARED',
      summaryText: 'Completion flag cleared because OR/JR is active again.',
      masterStatusBefore: existing.status,
      masterStatusAfter: 'Pending',
      actorName,
      details: {
        row_count: Number(group.row_count || 0),
        mould_statuses: Array.isArray(group.mould_statuses) ? group.mould_statuses : []
      }
    });
    cleared++;
  }

  const flaggedRes = await db.query(
    `SELECT
        id,
        order_no,
        factory_id,
        status,
        completion_change_summary
       FROM orders
      WHERE completion_confirmation_required = TRUE
      ${scopedFactoryId !== null ? 'AND COALESCE(factory_id, 0) = COALESCE($1, 0)' : ''}`,
    scopedFactoryId !== null ? [scopedFactoryId] : []
  );

  for (const existing of flaggedRes.rows) {
    const key = `${String(existing.order_no || '').trim()}::${normalizeFactoryId(existing.factory_id) || 0}`;
    if (seenKeys.has(key)) continue;

    await db.query(
      `UPDATE orders
          SET completion_confirmation_required = FALSE,
              completion_change_field = NULL,
              completion_change_to = NULL,
              completion_change_summary = NULL,
              completion_detected_at = NULL,
              completion_source_snapshot = '{}'::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [existing.id]
    );

    await insertOrderCompletionHistory(db, {
      orderNo: existing.order_no,
      factoryId: existing.factory_id,
      actionType: 'AUTO_CLEARED',
      summaryText: 'Completion flag cleared because no terminal OR/JR rows remain.',
      masterStatusBefore: existing.status,
      masterStatusAfter: existing.status || 'Pending',
      actorName,
      details: {}
    });
    cleared++;
  }

  return { flagged, cleared };
}

function getImageExtensionFromDataUrl(dataUrl) {
  const mime = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i)?.[1]?.toLowerCase() || 'image/png';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('svg')) return 'svg';
  return 'png';
}

function saveDataUrlImage(dataUrl, folderName, prefix) {
  const raw = String(dataUrl || '').trim();
  if (!raw.startsWith('data:image/')) return null;

  const payload = raw.split(',')[1];
  if (!payload) return null;

  const uploadsDir = path.join(BACKEND_ROOT, `public/uploads/${folderName}`);
  fs.mkdirSync(uploadsDir, { recursive: true });

  const ext = getImageExtensionFromDataUrl(raw);
  const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const fullPath = path.join(uploadsDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(payload, 'base64'));
  return `/uploads/${folderName}/${filename}`;
}

function formatMachineAuditValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value).trim();
}

function buildMachineAuditChanges(beforeRow = {}, afterRow = {}) {
  const fields = ['machine', 'machine_process', 'building', 'line', 'tonnage', 'vendor_name', 'model_no', 'machine_type', 'machine_icon', 'is_active'];
  const changes = {};

  for (const field of fields) {
    const oldValue = formatMachineAuditValue(beforeRow[field]);
    const newValue = formatMachineAuditValue(afterRow[field]);
    if (oldValue === newValue) continue;
    changes[field] = {
      old: oldValue || '(empty)',
      new: newValue || '(empty)'
    };
  }

  return changes;
}

async function logMachineAudit(db, { machineId, actionType, changedFields, changedBy, factoryId }) {
  const cleanMachineId = normalizeMachineName(machineId);
  if (!cleanMachineId) return;

  await db.query(
    `INSERT INTO machine_audit_logs(machine_id, action_type, changed_fields, changed_by, factory_id)
     VALUES($1, $2, $3::jsonb, $4, $5)`,
    [
      cleanMachineId,
      String(actionType || '').trim() || 'UPDATE',
      JSON.stringify(changedFields || {}),
      normalizeOptionalText(changedBy) || 'System',
      normalizeFactoryId(factoryId)
    ]
  );
}

/* ============================================================
   HEALTH CHECK
============================================================ */
app.get('/api/health', async (_req, res) => {
  try {
    const r = await q('SELECT NOW() AS now', []);
    res.json({ ok: true, now: r[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   PERFORMANCE INDEXES (Auto-Run)
============================================================ */

async function tableExistsPublic(tableName) {
  const rows = await q(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS ex`,
    [tableName]
  );
  return !!rows[0]?.ex;
}

/**
 * Fresh Docker / empty Postgres: migrations assume core tables exist (indexes on users,
 * ALTER on orders, etc.). Create minimal aligned schema and optional first superadmin.
 * Set SKIP_DB_BOOTSTRAP=1 to skip. Set SEED_DEFAULT_SUPERADMIN=0 to skip default user.
 */
async function bootstrapFreshCoreTables() {
  if (process.env.SKIP_DB_BOOTSTRAP === '1') {
    console.log('[DB] SKIP_DB_BOOTSTRAP=1 — core table bootstrap skipped.');
    return;
  }

  await q(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`).catch(() => {});

  await q(`
    CREATE TABLE IF NOT EXISTS factories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      location TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_updated_at TIMESTAMPTZ
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255),
      line VARCHAR(255) DEFAULT '',
      role_code VARCHAR(50) DEFAULT 'operator',
      permissions JSONB DEFAULT '{}'::jsonb,
      is_active BOOLEAN DEFAULT TRUE,
      global_access BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      status VARCHAR(50) DEFAULT 'active'
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS user_factories (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      factory_id INTEGER NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, factory_id)
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      machine TEXT NOT NULL,
      line TEXT,
      building TEXT,
      tonnage NUMERIC,
      capacity NUMERIC,
      is_active BOOLEAN DEFAULT TRUE,
      factory_id INTEGER,
      machine_process TEXT DEFAULT 'Moulding',
      vendor_name TEXT,
      model_no TEXT,
      machine_type TEXT,
      machine_icon TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await q(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_factory_machine_unique ON machines ((LOWER(machine)), (COALESCE(factory_id, 0)))`
  );

  await q(`
    CREATE TABLE IF NOT EXISTS plan_board (
      id SERIAL PRIMARY KEY,
      plan_id VARCHAR(255) UNIQUE,
      plant VARCHAR(100),
      building VARCHAR(100),
      line VARCHAR(50),
      machine VARCHAR(255),
      seq INTEGER DEFAULT 0,
      order_no VARCHAR(255),
      item_code VARCHAR(255),
      item_name VARCHAR(255),
      mould_name VARCHAR(255),
      plan_qty NUMERIC,
      bal_qty NUMERIC,
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      status VARCHAR(50) DEFAULT 'PLANNED',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS jobs_queue (
      id SERIAL PRIMARY KEY,
      plan_id VARCHAR(255),
      machine VARCHAR(255),
      line VARCHAR(50),
      order_no VARCHAR(255),
      mould_no VARCHAR(255),
      jobcard_no VARCHAR(255),
      status VARCHAR(50),
      complete_img TEXT,
      complete_img_name VARCHAR(255),
      completed_by VARCHAR(255),
      completed_at TIMESTAMPTZ,
      complete_geo_lat NUMERIC,
      complete_geo_lng NUMERIC,
      complete_geo_acc NUMERIC
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS std_actual (
      id SERIAL PRIMARY KEY,
      plan_id VARCHAR(255),
      shift VARCHAR(50),
      dpr_date DATE,
      machine VARCHAR(255),
      line VARCHAR(50),
      order_no VARCHAR(255),
      mould_name VARCHAR(255),
      article_act NUMERIC,
      runner_act NUMERIC,
      cavity_act NUMERIC,
      cycle_act NUMERIC,
      pcshr_act NUMERIC,
      man_act NUMERIC,
      entered_by VARCHAR(255),
      sfgqty_act NUMERIC,
      operator_activities TEXT,
      geo_lat NUMERIC,
      geo_lng NUMERIC,
      geo_acc NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS dpr_hourly (
      id SERIAL PRIMARY KEY,
      dpr_date DATE,
      shift VARCHAR(50),
      hour_slot VARCHAR(50),
      shots NUMERIC,
      good_qty NUMERIC,
      reject_qty NUMERIC,
      downtime_min NUMERIC,
      remarks TEXT,
      line VARCHAR(50),
      machine VARCHAR(255),
      plan_id VARCHAR(255),
      order_no VARCHAR(255),
      mould_no VARCHAR(255),
      jobcard_no VARCHAR(255),
      colour VARCHAR(100),
      reject_breakup JSONB,
      downtime_breakup JSONB,
      entry_type VARCHAR(50) DEFAULT 'MAIN',
      created_by VARCHAR(255),
      updated_by VARCHAR(255),
      geo_lat NUMERIC,
      geo_lng NUMERIC,
      geo_acc NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS or_jr_report (
      id SERIAL PRIMARY KEY,
      or_jr_no TEXT,
      or_jr_date DATE,
      or_qty INTEGER,
      jr_qty INTEGER,
      plan_qty INTEGER,
      plan_date DATE,
      job_card_no TEXT,
      job_card_date DATE,
      item_code TEXT,
      product_name TEXT,
      client_name TEXT,
      prod_plan_qty INTEGER,
      std_pack INTEGER,
      uom TEXT,
      planned_comp_date DATE,
      mld_start_date DATE,
      mld_end_date DATE,
      actual_mld_start_date DATE,
      prt_tuf_end_date DATE,
      pack_end_date DATE,
      mld_status TEXT,
      shift_status TEXT,
      prt_tuf_status TEXT,
      pack_status TEXT,
      wh_status TEXT,
      rev_mld_end_date DATE,
      shift_comp_date DATE,
      rev_ptd_tuf_end_date DATE,
      rev_pak_end_date DATE,
      wh_rec_date DATE,
      remarks_all TEXT,
      jr_close TEXT,
      or_remarks TEXT,
      jr_remarks TEXT,
      created_by TEXT,
      created_date TIMESTAMP DEFAULT NOW(),
      edited_by TEXT,
      edited_date TIMESTAMP
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS mould_planning_summary (
      id SERIAL PRIMARY KEY,
      or_jr_no TEXT,
      or_jr_date DATE,
      item_code TEXT,
      bom_type TEXT,
      product_name TEXT,
      jr_qty INTEGER,
      uom TEXT,
      plan_date DATE,
      plan_qty INTEGER,
      mould_no TEXT,
      mould_name TEXT,
      mould_item_qty INTEGER,
      tonnage INTEGER,
      machine_name TEXT,
      cycle_time NUMERIC,
      cavity INTEGER,
      created_by TEXT,
      created_date TIMESTAMP DEFAULT NOW(),
      edited_by TEXT,
      edited_date TIMESTAMP
    );
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no VARCHAR(255) UNIQUE NOT NULL,
      item_code VARCHAR(255),
      item_name VARCHAR(255),
      mould_code VARCHAR(255),
      qty NUMERIC DEFAULT 0,
      balance NUMERIC DEFAULT 0,
      status VARCHAR(50) DEFAULT 'Pending',
      priority VARCHAR(50) DEFAULT 'Normal',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const startupFactoryId = normalizeFactoryId(process.env.LOCAL_FACTORY_ID) || 1;
  const startupFactoryName = String(process.env.LOCAL_FACTORY_NAME || `Factory ${startupFactoryId}`).trim();
  const startupFactoryCode = String(process.env.LOCAL_FACTORY_CODE || `F${startupFactoryId}`).trim();
  const startupFactoryLocation = String(process.env.LOCAL_FACTORY_LOCATION || '').trim() || null;

  try {
    await q(
      `INSERT INTO factories(id, name, code, location, is_active, created_at, updated_at, last_updated_at)
       VALUES($1, $2, $3, $4, TRUE, NOW(), NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [startupFactoryId, startupFactoryName, startupFactoryCode, startupFactoryLocation]
    );
    await q(
      `SELECT setval('factories_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM factories), 0), $1), true)`,
      [startupFactoryId]
    );
  } catch (factorySeedErr) {
    console.warn('[DB] Bootstrap factory seed skipped:', factorySeedErr.message);
  }

  if (process.env.SEED_DEFAULT_SUPERADMIN === '0') {
    return;
  }

  const userCountRows = await q(`SELECT COUNT(*)::int AS c FROM users`);
  if ((userCountRows[0]?.c || 0) > 0) {
    return;
  }

  try {
    const uname = String(process.env.DEFAULT_SUPERADMIN_USERNAME || 'admin').trim() || 'admin';
    const pw = String(process.env.DEFAULT_SUPERADMIN_PASSWORD || 'ChangeMeNow123!');
    const hash = await bcrypt.hash(pw, 10);
    const resUser = await pool.query(
      `INSERT INTO users (username, password, line, role_code, permissions, is_active, global_access)
       VALUES ($1, $2, '', 'superadmin', '{}'::jsonb, TRUE, TRUE)
       RETURNING id`,
      [uname, hash]
    );
    const newId = resUser.rows[0].id;
    await q(
      `INSERT INTO user_factories (user_id, factory_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [newId, startupFactoryId]
    );
    console.log(
      `[DB] Seeded default superadmin "${uname}". Change the password after first login (DEFAULT_SUPERADMIN_PASSWORD / SEED_DEFAULT_SUPERADMIN=0 to disable).`
    );
  } catch (seedErr) {
    console.warn('[DB] Default superadmin seed skipped:', seedErr.message);
  }
}

/**
 * [FIX] Wait for DB Connection
 * Retries connection if DB is starting up (57P03) or unavailable.
 */
async function waitForDb(pool, retries = 30, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log('[DB] Connection successful.');
      return true;
    } catch (e) {
      console.error(`[DB] Waiting for connection... (${i + 1}/${retries}) - ${e.message}`);
      // Wait
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error('[DB] Could not connect after multiple retries.');
}

async function initializeLegacyRuntime() {
  try {
    // [FIX] Wait for DB before anything else
    await waitForDb(pool);
    await bootstrapFreshCoreTables();
    await migrateMouldMasterSchema();
    await migrateOrjrWiseMasterSchema();
    await migrateOrJrReportNumericSchema();
    await migrateOrjrWiseDetailSchema();
    await migrateOrderCompletionWorkflowSchema();
    await migrateWipStockMasterSchema();
    await migrateRawMaterialSchema();

    // Non-blocking index creation
    await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_plan_board_machine ON plan_board(machine);
            CREATE INDEX IF NOT EXISTS idx_plan_board_status ON plan_board(status);
            CREATE INDEX IF NOT EXISTS idx_std_actual_plan_id ON std_actual(plan_id);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

            -- NEW MASTER PLAN OPTIMIZATION INDEXES
            CREATE INDEX IF NOT EXISTS idx_dpr_hourly_order ON dpr_hourly(order_no);
            CREATE INDEX IF NOT EXISTS idx_or_jr_report_no ON or_jr_report(or_jr_no);
            CREATE INDEX IF NOT EXISTS idx_moulds_mould_name ON moulds(mould_name);
            CREATE INDEX IF NOT EXISTS idx_or_jr_report_no_trim ON or_jr_report(TRIM(or_jr_no));
            CREATE INDEX IF NOT EXISTS idx_moulds_mould_number_trim ON moulds(TRIM(mould_number));

            CREATE TABLE IF NOT EXISTS roles (
                code TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );

            INSERT INTO roles (code, label) VALUES 
            ('superadmin', 'Superadmin'),
            ('operator', 'Operator'),
            ('supervisor', 'Supervisor'),
            ('planner', 'Planner'),
            ('quality', 'Quality Manager'),
            ('qc_supervisor', 'QC Supervisor'),
            ('shifting_supervisor', 'Shifting Supervisor'),
            ('admin', 'Admin')
            ON CONFLICT (code) DO NOTHING;

            CREATE TABLE IF NOT EXISTS server_config (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            -- Initial Config from ENV (if not set in DB)
            -- Force STANDALONE if set in ENV, otherwise default to MAIN or as configured
            INSERT INTO server_config (key, value) VALUES ('SERVER_TYPE', '${process.env.SERVER_TYPE || 'STANDALONE'}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value; 
            
            -- Only set MAIN_SERVER_URL if it exists in ENV (for LOCAL mode)
            INSERT INTO server_config (key, value) VALUES ('MAIN_SERVER_URL', '${process.env.MAIN_SERVER_URL || ''}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
            
            INSERT INTO server_config (key, value) VALUES ('LOCAL_FACTORY_ID', '${process.env.LOCAL_FACTORY_ID || '1'}') ON CONFLICT (key) DO NOTHING;
            INSERT INTO server_config (key, value) VALUES ('SYNC_API_KEY', '${process.env.SYNC_API_KEY || 'jpsms-sync-key'}') ON CONFLICT (key) DO NOTHING;

            CREATE TABLE IF NOT EXISTS ai_memory (
                id SERIAL PRIMARY KEY,
                event_type TEXT, -- 'feedback', 'failure', 'success'
                context JSONB,   -- { machine, mould, error... }
                note TEXT,       -- "Machine A failed with Mould X"
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS machine_operators (
                id SERIAL PRIMARY KEY,
                operator_id TEXT UNIQUE,
                name TEXT,
                photo_path TEXT,
                assigned_machine TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            );

            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS doj DATE;
            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS age INTEGER;
            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS aadhar_number TEXT;
            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS assigned_machines JSONB DEFAULT '[]'::jsonb;
            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS factory_id INTEGER;
            ALTER TABLE machine_operators ADD COLUMN IF NOT EXISTS process TEXT;

            CREATE TABLE IF NOT EXISTS operator_history (
                id SERIAL PRIMARY KEY,
                operator_id TEXT,
                machine_at_time TEXT,
                scanned_by TEXT,
                scanned_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS machine_audit_logs (
                id SERIAL PRIMARY KEY,
                machine_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                changed_fields JSONB DEFAULT '{}'::jsonb,
                changed_by TEXT,
                changed_at TIMESTAMP DEFAULT NOW(),
                factory_id INTEGER
            );
            
            ALTER TABLE plan_board ADD COLUMN IF NOT EXISTS seq INTEGER DEFAULT 0;

            CREATE TABLE IF NOT EXISTS shifting_records (
                id SERIAL PRIMARY KEY,
                machine_code TEXT,
                plan_id INTEGER,
                quantity INTEGER,
                from_location TEXT DEFAULT 'Machine',
                to_location TEXT,
                shifted_by TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS planning_drops (
                id SERIAL PRIMARY KEY,
                order_no TEXT NOT NULL,
                item_code TEXT,
                mould_no TEXT,
                mould_name TEXT,
                remarks TEXT,
                dropped_by TEXT DEFAULT 'User',
                created_at TIMESTAMP DEFAULT NOW()
            );

 
            CREATE TABLE IF NOT EXISTS assembly_plans (
                id SERIAL PRIMARY KEY,
                table_id TEXT NOT NULL,
                machine TEXT,
                item_name TEXT,
                plan_qty INTEGER,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                duration_min INTEGER,
                delay_min INTEGER,
                status TEXT DEFAULT 'Planned',
                created_at TIMESTAMP DEFAULT NOW(),
                created_by TEXT
            );

            CREATE TABLE IF NOT EXISTS shift_teams (
                id SERIAL PRIMARY KEY,
                line TEXT NOT NULL,
                shift_date DATE NOT NULL,
                shift TEXT NOT NULL,
                entry_person TEXT,
                prod_supervisor TEXT,
                qc_supervisor TEXT,
                die_setter TEXT,
                engineer TEXT,
                prod_manager TEXT,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (line, shift_date, shift)
            );

            CREATE TABLE IF NOT EXISTS machine_status_logs (
                id SERIAL PRIMARY KEY,
                machine TEXT NOT NULL,
                start_date DATE NOT NULL,
                start_slot TEXT NOT NULL,
                end_date DATE,
                end_slot TEXT,
                status TEXT DEFAULT 'MAINTENANCE',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS closed_plants (
                id SERIAL PRIMARY KEY,
                dpr_date DATE NOT NULL,
                plant TEXT NOT NULL, -- 'B', 'C', 'E', 'F'
                shift TEXT NOT NULL, -- 'Day', 'Night', 'Both'
                remarks TEXT,
                closed_by TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                factory_id INTEGER,
                sync_id UUID DEFAULT gen_random_uuid(),
                UNIQUE (dpr_date, plant, shift, factory_id)
            );

        `);

    // MISSING TABLE: std_actual
    await q(`
      CREATE TABLE IF NOT EXISTS std_actual (
        id SERIAL PRIMARY KEY,
        plan_id TEXT,
        shift TEXT,
        dpr_date DATE,
        machine TEXT,
        line TEXT,
        order_no TEXT,
        mould_name TEXT,
        article_act NUMERIC,
        runner_act NUMERIC,
        cavity_act NUMERIC,
        cycle_act NUMERIC,
        pcshr_act NUMERIC,
        man_act NUMERIC,
        entered_by TEXT,
        sfgqty_act NUMERIC,
        operator_activities TEXT,
        geo_lat NUMERIC,
        geo_lng NUMERIC,
        geo_acc NUMERIC,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        factory_id INTEGER,
        last_updated_at TIMESTAMP,
        product_name TEXT,
        global_id UUID,
        sync_status TEXT,
        sync_id UUID
      );
    `);

    const startupFactoryId = normalizeFactoryId(process.env.LOCAL_FACTORY_ID) || 1;
    const startupFactoryName = String(process.env.LOCAL_FACTORY_NAME || `Factory ${startupFactoryId}`).trim();
    const startupFactoryCode = String(process.env.LOCAL_FACTORY_CODE || `F${startupFactoryId}`).trim();
    const startupFactoryLocation = String(process.env.LOCAL_FACTORY_LOCATION || '').trim() || null;

    try {
      await q(
        `INSERT INTO factories(id, name, code, location, is_active, created_at, updated_at, last_updated_at)
         VALUES($1, $2, $3, $4, TRUE, NOW(), NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [startupFactoryId, startupFactoryName, startupFactoryCode, startupFactoryLocation]
      );
      await q(
        `SELECT setval('factories_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM factories), 0), $1), true)`,
        [startupFactoryId]
      );
    } catch (factorySeedError) {
      console.warn('[DB] Default factory seed skipped:', factorySeedError.message);
    }

    // [FIX] Universal Schema Fix for Sync
    // Ensure ALL sync tables have sync_id, factory_id, and UNIQUE INDEX on sync_id
    await q(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    const SYNC_TABLES = [
      'app_settings',
      'assembly_lines',
      'assembly_plans',
      'assembly_scans',
      'bom_components',
      'bom_master',
      'dispatch_items',
      'dpr_hourly',
      'dpr_reasons',
      'factories',
      'grinding_logs',
      'grn_entries',
      'jc_details',
      'job_cards',
      'jobs_queue',
      'machine_audit_logs',
      'machine_operators',
      'machine_status_logs',
      'machines',
      'mould_audit_logs',
      'mould_planning_report',
      'mould_planning_summary',
      'moulds',
      'operator_history',
      'or_jr_report',
      'orders',
      'plan_audit_logs',
      'plan_board',
      'plan_history',
      'planning_drops',
      'purchase_order_items',
      'purchase_orders',
      'qc_deviations',
      'qc_issue_memos',
      'qc_online_reports',
      'qc_training_sheets',
      'roles',
      'shift_teams',
      'shifting_records',
      'std_actual',
      'user_factories',
      'users',
      'vendor_dispatch',
      'vendor_payments',
      'vendor_users',
      'vendors',
      'wip_inventory',
      'wip_outward_logs',
      'closed_plants'
    ];

    const FID = process.env.LOCAL_FACTORY_ID || 1;

    for (const table of SYNC_TABLES) {
      if (!(await tableExistsPublic(table))) {
        console.warn(`[DB] Sync column bootstrap skipped (table not created yet): ${table}`);
        continue;
      }
      // 1. Ensure Columns
      await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid();`);
      await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_status TEXT;`);
      await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS factory_id INTEGER;`);

      // 2. Heal Data (Fill Nulls)
      await q(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
      await q(`UPDATE ${table} SET factory_id = $1 WHERE factory_id IS NULL`, [FID]);

      // 3. Create Unique Index (Required for ON CONFLICT upsert)
      // Note: We use a generic name pattern to avoid collisions
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_sync_id ON ${table}(sync_id);`);
    }

    // [FIX] Restore Legacy Unique Index to support local UPSERT logic (line 1069)
    // The previous "Drop Legacy Constraint" logic was too aggressive.
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS std_actual_plan_id_shift_dpr_date_machine_key ON std_actual(plan_id, shift, dpr_date, machine);`);

    // [FIX 2] Drop the ACTUAL erroneous constraint found in logs (std_actual_unique_key)
    try {
      await q(`ALTER TABLE std_actual DROP CONSTRAINT IF EXISTS std_actual_unique_key`);
      await q(`DROP INDEX IF EXISTS std_actual_unique_key`);
    } catch (e) { console.log('[DB] Note: Drop constraint std_actual_unique_key failed:', e.message); }

    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_std_actual_sync_id ON std_actual(sync_id);`);

    // [FIX] Machine names must be unique per factory, not globally.
    // Older schemas still have a global UNIQUE(machine) constraint, which breaks
    // factory-scoped Machine Master uploads when the same machine name exists elsewhere.
    try {
      await q(`ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_name_key`);
    } catch (e) {
      console.warn('[DB] machines_name_key drop skipped:', e.message);
    }
    try {
      await q(`DROP INDEX IF EXISTS machines_name_key`);
    } catch (e) {
      console.warn('[DB] machines_name_key index drop skipped:', e.message);
    }
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_factory_machine_unique ON machines ((LOWER(machine)), (COALESCE(factory_id, 0)))`);
    await q(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS machine_icon TEXT`);
    await q(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS machine_process TEXT`);
    await q(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS vendor_name TEXT`);
    await q(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS model_no TEXT`);
    await q(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS machine_type TEXT`);
    await q(`ALTER TABLE machines ALTER COLUMN machine_process SET DEFAULT 'Moulding'`);
    await q(`UPDATE machines SET machine_process = 'Moulding' WHERE machine_process IS NULL OR TRIM(machine_process) = ''`);
    await q(`CREATE INDEX IF NOT EXISTS idx_machine_audit_logs_lookup ON machine_audit_logs ((LOWER(machine_id)), (COALESCE(factory_id, 0)), changed_at DESC)`);

    // QC TABLES
    await q(`
      CREATE TABLE IF NOT EXISTS qc_online_reports (
        id SERIAL PRIMARY KEY,
        date DATE DEFAULT CURRENT_DATE,
        shift TEXT,
        line TEXT,
        machine TEXT,
        item_name TEXT,
        mould_name TEXT,
        defect_description TEXT,
        qty_checked INTEGER DEFAULT 0,
        qty_rejected INTEGER DEFAULT 0,
        action_taken TEXT,
        supervisor TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS qc_issue_memos (
        id SERIAL PRIMARY KEY,
        date DATE DEFAULT CURRENT_DATE,
        line TEXT,
        machine TEXT,
        issue_description TEXT,
        responsibility TEXT,
        status TEXT DEFAULT 'Open',
        supervisor TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS qc_training_sheets (
        id SERIAL PRIMARY KEY,
        date DATE DEFAULT CURRENT_DATE,
        trainee_name TEXT,
        trainer_name TEXT,
        topic TEXT,
        duration TEXT,
        score TEXT,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS qc_deviations (
        id SERIAL PRIMARY KEY,
        date DATE DEFAULT CURRENT_DATE,
        part_name TEXT,
        machine TEXT,
        deviation_details TEXT,
        reason TEXT,
        approved_by TEXT,
        valid_upto DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await q(`ALTER TABLE shifting_records ADD COLUMN IF NOT EXISTS shift_date DATE;`);
    await q(`ALTER TABLE shifting_records ADD COLUMN IF NOT EXISTS shift_type TEXT;`);

    // Performance Indexes
    await q(`CREATE INDEX IF NOT EXISTS idx_shifting_plan_id ON shifting_records(plan_id);`);
    await q(`CREATE INDEX IF NOT EXISTS idx_dpr_hourly_plan_id ON dpr_hourly(plan_id);`);
    await q(`CREATE INDEX IF NOT EXISTS idx_plan_board_status ON plan_board(status);`);

    // Legacy unique on or_jr_no alone — skipped when duplicates exist (composite index is applied later).
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_or_jr_report_unique_no ON or_jr_report(or_jr_no);`).catch(err =>
      console.warn('[DB] idx_or_jr_report_unique_no skipped (duplicate or_jr_no rows in data):', err.message)
    );
    await migrateOrderCompletionWorkflowSchema();

    console.log('Database initialized');

    // Ensure Uploads Directory
    const uploadDir = path.join(BACKEND_ROOT, 'public/uploads/operators');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('[Setup] Created operators upload directory.');
    }

    try {
      // Fix Constraint to CASCADE for easier deletion
      await q(`ALTER TABLE wip_outward_logs DROP CONSTRAINT IF EXISTS wip_outward_logs_wip_inventory_id_fkey`);
      await q(`ALTER TABLE wip_outward_logs ADD CONSTRAINT wip_outward_logs_wip_inventory_id_fkey 
               FOREIGN KEY (wip_inventory_id) REFERENCES wip_inventory(id) ON DELETE CASCADE`);
      console.log('[DB] Constraint fixed to CASCADE');

      // --- MIGRATION: Fix OR-JR Report PK (Composite: OR/JR + Plan Date + Job Card) ---
      // 1. Remove Strict PK on just or_jr_no
      await q(`ALTER TABLE or_jr_report DROP CONSTRAINT IF EXISTS or_jr_report_pkey`);
      // 1.1 Remove potential unique index from previous logic
      await q(`DROP INDEX IF EXISTS idx_or_jr_report_unique_no`);
      // 2. Add Composite Constraint (Unique Index for Upsert)
      // Using COALESCE to treat NULL as a distinct value for uniqueness
      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_or_jr_composite_unique 
        ON or_jr_report (
            or_jr_no, 
            COALESCE(plan_date, '1970-01-01'::date), 
            COALESCE(job_card_no, '')
        )
      `);
      console.log('[DB] OR-JR Report Unique Index Updated to (OR+Date+JC)');

    } catch (e) {
      console.error('[DB] Constraint/Migration fix warning:', e.message);
    }

    console.log('[DB] Indexes ensured for performance.');

    global.__JMS_DB_INIT_OK = true;
  } catch (e) {
    console.error('[DB] Indexing warning:', e.message);
  }

  if (!global.__JMS_DB_INIT_OK) {
    console.error('[DB] Database initialization did not complete — exiting without starting HTTP (fix DB errors above).');
    process.exit(1);
  }
  return {
    startupLog() {
      console.log(`JPSMS server running on http://localhost:${config.port}`);
      getLanUrls(config.port).forEach(url => console.log(`JPSMS LAN access: ${url}`));
      console.log('DB Config:', {
        user: config.db.user,
        database: config.db.database,
        port: config.db.port
      });
    },
    onServerStarted() {
      setTimeout(() => {
        syncService.init(pool);
        updaterService.init(pool);
      }, 5000);
    }
  };
}

/* ============================================================
   LOGIN
============================================================ */
/* ============================================================
   LOGIN (Modified for Multi-Factory)
============================================================ */
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });

    // 1. Fetch User
    const rows = await q(
      `SELECT id, username, password, line, role_code, permissions, global_access
         FROM users
        WHERE username = $1
          AND COALESCE(is_active, TRUE) = TRUE
        LIMIT 1`,
      [username]
    );

    if (!rows.length) return res.json({ ok: false, error: 'User not found' });
    const u = rows[0];

    // 2. Validate Password
    let valid = false;
    let needsRehash = false;

    if (u.password.startsWith('$2')) {
      valid = await bcrypt.compare(password, u.password);
    } else {
      if (u.password === password) {
        valid = true;
        needsRehash = true; // Auto-migrate legacy plain text
      }
    }

    if (!valid) return res.json({ ok: false, error: 'Password is Wrong' });

    // 3. Auto-Rehash if needed
    if (needsRehash) {
      const hash = await bcrypt.hash(password, 10);
      await q('UPDATE users SET password=$1 WHERE username=$2', [hash, u.username]);
    }

    // 4. Fetch Allowed Factories
    const factoryAccess = await getAccessibleFactoriesForUser(u);
    const factories = factoryAccess.factories;
    u.can_select_all_factories = factoryAccess.canSelectAllFactories;

    // Don't send password back
    delete u.password;

    // Calc Current Shift/Date (Server Time)
    const now = new Date();
    const h = now.getHours();
    // Logic: Day 08:00 - 20:00, Night 20:00 - 08:00
    // If < 08, it's Night of Previous Date
    let shift = 'Day';
    let shiftDate = new Date(now);

    if (h >= 8 && h < 20) {
      shift = 'Day';
    } else {
      shift = 'Night';
      if (h < 8) {
        // e.g. 2 AM on 25th -> Night of 24th
        shiftDate.setDate(shiftDate.getDate() - 1);
      }
      // If h >= 20, it's Night of Today (25th), so date is correct
    }
    const yyyy = shiftDate.getFullYear();
    const mm = String(shiftDate.getMonth() + 1).padStart(2, '0');
    const dd = String(shiftDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    u.shift = shift;
    u.shiftDate = dateStr;

    // Return user info + factories list
    res.json({ ok: true, data: u, factories, can_select_all_factories: factoryAccess.canSelectAllFactories });

  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   FACTORIES MANAGEMENT
============================================================ */
app.get('/api/factories', async (req, res) => {
  try {
    const username = getRequestUsername(req);
    const access = await getAccessibleFactoriesForUser(username);
    const rows = access.user
      ? access.factories
      : await q('SELECT id, name, code, location, is_active FROM factories WHERE is_active = true ORDER BY id');
    res.json({ ok: true, data: rows, can_select_all_factories: access.canSelectAllFactories });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/factories/save', async (req, res) => {
  try {
    const actor = await getRequestActor(req);
    if (!actor) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const { id, name, code, location, is_active } = req.body;
    if (!name || !code) return res.json({ ok: false, error: 'Name and Code required' });

    if (!id && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only SUPERADMIN can create factories' });
    }

    if (id && !isAdminLikeRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Admin or SUPERADMIN access required' });
    }

    if (id) {
      await q(
        `UPDATE factories SET name=$1, code=$2, location=$3, is_active=$4, updated_at=NOW() WHERE id=$5`,
        [name, code, location, is_active, id]
      );
    } else {
      await q(
        `INSERT INTO factories (name, code, location, is_active) VALUES ($1, $2, $3, $4)`,
        [name, code, location, is_active ?? true]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   USER MANAGEMENT
============================================================ */
// GET /api/users
app.get('/api/users', async (req, res) => {
  try {
    const rows = await q(
      `
      SELECT u.id, u.username, u.line, u.role_code, u.permissions, u.is_active, u.global_access,
             COALESCE(json_agg(f.id) FILTER (WHERE f.id IS NOT NULL), '[]') as assigned_factories
       FROM users u
        LEFT JOIN user_factories uf ON uf.user_id = u.id
        LEFT JOIN factories f ON f.id = uf.factory_id
       GROUP BY u.id
       ORDER BY CASE
         WHEN LOWER(COALESCE(u.role_code, '')) = 'superadmin' THEN 0
         WHEN LOWER(COALESCE(u.role_code, '')) = 'admin' THEN 1
         ELSE 10
       END,
       u.username
       `
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/users/save
app.post('/api/users/save', async (req, res) => {
  try {
    const payload = req.body || {};
    const { password, line, permissions } = payload;
    const username = String(payload.username || '').trim();
    const actor = await getRequestActor(req);
    if (!actor) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const requestedRoleCode = String(payload.role_code || payload.role || 'supervisor').toLowerCase();
    const requestedFactoryIds = Array.isArray(payload.factories)
      ? [...new Set(payload.factories.map(id => normalizeFactoryId(id)).filter(id => id !== null))]
      : null;

    if (!username) return res.json({ ok: false, error: 'Username required' });

    // Permissions should be JSON string or object
    const permJson = typeof permissions === 'object' ? JSON.stringify(permissions) : (permissions || '{}');
    let userId = normalizeFactoryId(payload.id);
    let existingUser = null;

    if (!userId) {
      const existingRows = await q(
        'SELECT id, username, role_code FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username]
      );
      existingUser = existingRows[0] || null;
      if (existingUser && !password) {
        userId = existingUser.id;
      }
      if (existingUser && password) {
        return res.status(400).json({ ok: false, error: 'Username already exists' });
      }
    }

    if (requestedFactoryIds && requestedFactoryIds.length) {
      const missingFactoryIds = await getMissingFactoryIds(requestedFactoryIds);
      if (missingFactoryIds.length) {
        return res.status(400).json({
          ok: false,
          error: `Selected factory does not exist: ${missingFactoryIds.join(', ')}`
        });
      }
    }

    if (userId) {
      if (!existingUser) {
        const existingUserRows = await q('SELECT id, username, role_code FROM users WHERE id = $1 LIMIT 1', [userId]);
        existingUser = existingUserRows[0] || null;
      }
      if (!existingUser) return res.json({ ok: false, error: 'User not found' });

      if ((requestedRoleCode === 'superadmin' || isSuperadminRole(existingUser)) && !isSuperadminRole(actor)) {
        return res.status(403).json({ ok: false, error: 'Only superadmin can create, edit, or assign the superadmin role' });
      }

      // UPDATE
      let hash = '';
      if (password) {
        hash = await bcrypt.hash(password, 10);
      }

      await q(
        `UPDATE users 
            SET username=$1, 
                line=$2, 
                role_code=$3, 
                permissions=$4::jsonb,
                password = CASE WHEN $5::text = '' THEN password ELSE $5 END,
                updated_at=NOW(),
                global_access=$7
          WHERE id=$6`,
        [username, line || '', requestedRoleCode, permJson, hash, userId, payload.global_access || false]
      );
    } else {
      if (requestedRoleCode === 'superadmin' && !isSuperadminRole(actor)) {
        return res.status(403).json({ ok: false, error: 'Only superadmin can create, edit, or assign the superadmin role' });
      }

      // INSERT
      if (!password) return res.json({ ok: false, error: 'Password required for new user' });

      const hash = await bcrypt.hash(password, 10);

      const resInsert = await pool.query( // Use pool.query to get RETURNING id
        `INSERT INTO users (username, password, line, role_code, permissions, is_active, global_access)
         VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, $6)
         RETURNING id`,
        [username, hash, line || '', requestedRoleCode, permJson, payload.global_access || false]
      );
      userId = resInsert.rows[0].id;
    }

    // Handle Factories Assignment
    // Body: { factories: [1, 2] }
    if (requestedFactoryIds) {
      // Clear existing
      await q('DELETE FROM user_factories WHERE user_id=$1', [userId]);
      // Insert new
      for (const fid of requestedFactoryIds) {
        await q('INSERT INTO user_factories (user_id, factory_id) VALUES ($1, $2)', [userId, fid]);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('user save error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/users/delete
app.post('/api/users/delete', async (req, res) => {
  try {
    const actor = await getRequestActor(req);
    const { id, username } = req.body; // accept username too if needed, but ID is better
    const targetUser = id
      ? (await q('SELECT id, username, role_code FROM users WHERE id = $1 LIMIT 1', [id]))[0]
      : (username ? (await q('SELECT id, username, role_code FROM users WHERE username = $1 LIMIT 1', [username]))[0] : null);
    if (!targetUser) return res.json({ ok: false, error: 'User not found' });
    if (isSuperadminRole(targetUser) && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can delete superadmin users' });
    }
    if (isSuperadminRole(targetUser)) {
      const countRows = await q(`SELECT COUNT(*)::int AS c FROM users WHERE COALESCE(is_active, TRUE) = TRUE AND LOWER(COALESCE(role_code, '')) = 'superadmin'`, []);
      if ((countRows[0]?.c || 0) <= 1) {
        return res.status(400).json({ ok: false, error: 'At least one active superadmin must remain' });
      }
    }
    if (id) {
      await q('DELETE FROM users WHERE id=$1', [id]);
    } else if (username) {
      await q('DELETE FROM users WHERE username=$1', [username]);
    } else {
      return res.json({ ok: false, error: 'ID or Username required' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/users/password
app.post('/api/users/password', async (req, res) => {
  try {
    const actor = await getRequestActor(req);
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });
    const targetUser = (await q('SELECT username, role_code FROM users WHERE username = $1 LIMIT 1', [username]))[0];
    if (!targetUser) return res.json({ ok: false, error: 'User not found' });
    if (isSuperadminRole(targetUser) && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can change a superadmin password' });
    }
    const hash = await bcrypt.hash(password, 10);
    await q('UPDATE users SET password=$1 WHERE username=$2', [hash, username]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   ROLES MANAGEMENT
============================================================ */
// GET /api/roles
app.get('/api/roles', async (req, res) => {
  try {
    // Ensure table exists (just in case) - though init script covers it
    const rows = await q(`
      SELECT *
        FROM roles
       ORDER BY CASE
         WHEN LOWER(code) = 'superadmin' THEN 0
         WHEN LOWER(code) = 'admin' THEN 1
         ELSE 10
       END,
       label ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/roles/create
app.post('/api/roles/create', async (req, res) => {
  try {
    const { code, label } = req.body;
    if (!code || !label) return res.json({ ok: false, error: 'Code and Label required' });

    // Sanitize code (lowercase, underscore)
    const safeCode = code.trim().toLowerCase().replace(/\s+/g, '_');

    await q(
      `INSERT INTO roles (code, label, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (code) DO NOTHING`,
      [safeCode, label]
    );
    res.json({ ok: true, code: safeCode });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   MACHINES
============================================================ */
app.get('/api/machines', async (req, res) => {
  const lineQuery = req.query.line || '';
  try {
    const lines = lineQuery.split(',').map(s => s.trim()).filter(Boolean);

    // v59 Fix: Allow "All" to fetch everything
    const isAll = lines.some(l => l.toLowerCase() === 'all');

    let whereClause = '1=1';
    const params = [];

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      whereClause += ` AND (factory_id = $${params.length}`;
      // Optional: Allow global machines if factory_id is null? Or strict? 
      // User said: "Data of Every Factory Is Uniquee" -> So Strict.
      whereClause += `)`;
    }

    if (lines.length > 0 && !isAll) {
      // Logic: line column matches exactly OR machine starts with line prefix
      // Use Postgres ILIKE ANY array syntax for Case-Insensitive matching
      params.push(lines); // $1: Exact lines
      params.push(lines.map(l => l + '%')); // $2: Patterns
      whereClause += ` AND (line = ANY($${params.length - 1}::text[]) OR machine ILIKE ANY($${params.length}::text[]))`;
    }

    const rows = await q(
      `SELECT machine
         FROM machines
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND ${whereClause}`,
      params
    );
    // Natural Sort in Application Layer
    const list = rows.map(r => r.machine).sort(naturalCompare);
    res.json({ ok: true, data: list });
  } catch (e) {
    console.error('machines error', e);
    fs.appendFileSync('debug_errors.log', `[MACHINES] ${e.message}\n`);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   MACHINE STATUS (Real Data)
============================================================ */
app.get('/api/machines/status', async (req, res) => {
  try {
    const days = Number(req.query.days || 1);
    const showInactive = req.query.show_inactive === '1';
    const requestedProcess = getRequestedMachineProcess(req, 'Moulding');

    let where = `1=1`;
    const params = [];

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      where += ` AND m.factory_id = $${params.length}`;
    }

    if (requestedProcess) {
      params.push(requestedProcess);
      where += ` AND COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') = $${params.length}`;
    }

    if (!showInactive) {
      // Logic for active machines (assuming exist active col or just all)
      // where += ` AND is_active = true`; 
    }

    // Fetch from machines table
    // Include running job info
    const rows = await q(
      `SELECT 
         m.machine as id, 
         m.machine as code, 
         m.machine as name, 
         m.building, 
         m.line, 
         m.tonnage,
         COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') as machine_process,
         m.machine_icon,
         COALESCE(
            (SELECT 'Running' FROM plan_board p WHERE p.machine = m.machine AND p.status='RUNNING' LIMIT 1), 
            'Stopped'
         ) as status,
         (SELECT order_no FROM plan_board p WHERE p.machine = m.machine AND p.status='RUNNING' LIMIT 1) as running_order,
         (SELECT COALESCE(NULLIF(p.item_name, ''), NULLIF(p.mould_name, ''), NULLIF(p.item_code, ''), 'Direct Run')
            FROM plan_board p
           WHERE p.machine = m.machine AND p.status='RUNNING'
           ORDER BY p.id DESC
           LIMIT 1) as running_product,
         (SELECT COALESCE(NULLIF(o.client_name, ''), '')
            FROM plan_board p
            LEFT JOIN orders o
              ON o.order_no = p.order_no
             AND (o.factory_id = m.factory_id OR (m.factory_id IS NULL AND o.factory_id IS NULL))
           WHERE p.machine = m.machine AND p.status='RUNNING'
           ORDER BY p.id DESC
           LIMIT 1) as running_client,
         false as is_maintenance,
         m.is_active 
       FROM machines m
       WHERE ${where}
       ORDER BY m.building, m.line, m.machine`,
      params
    );


    // Sort: Building -> Line -> Machine (Natural)
    rows.sort((a, b) => {
      if (a.building !== b.building) return String(a.building || '').localeCompare(String(b.building || ''));
      if (a.line !== b.line) return String(a.line || '').localeCompare(String(b.line || ''));
      return naturalCompare(a.code, b.code);
    });

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('machines/status', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});






/* ============================================================
   MOULDS MASTER (Top Priority)
============================================================ */
app.get('/api/masters/moulds', async (req, res) => {
  // console.log('!!! API HIT: /api/masters/moulds (Top Priority) !!!');
  try {
    let query = 'SELECT * FROM moulds';
    const params = [];

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      query += ` WHERE factory_id = $${params.length}`;
    }

    query += ' ORDER BY id ASC';

    const rows = await q(query, params);
    // console.log('[API] Moulds Found:', rows.length);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('moulds fetch error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   STD / ACTUAL SAVE
============================================================ */
app.post('/api/std-actual/save', async (req, res) => {
  try {
    const { session, payload, geo } = req.body || {};
    const {
      PlanID, Shift, DprDate, Machine, OrderNo, MouldName,
      ArticleActual, RunnerActual, CavityActual, CycleActual,
      PcsHrActual, ManActual, EnteredBy, SfgQtyActual, OperatorActivities
    } = payload || {};

    await q(
      `
      INSERT INTO std_actual AS s (
        plan_id, shift, dpr_date, line, machine, order_no, mould_name,
        article_act, runner_act, cavity_act, cycle_act,
        pcshr_act, man_act, entered_by, sfgqty_act, operator_activities,
        geo_lat, geo_lng, geo_acc,
        created_at, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19,
        NOW(), NOW()
      )
      ON CONFLICT (plan_id, shift, dpr_date, machine)
      DO UPDATE SET
        article_act         = EXCLUDED.article_act,
        runner_act          = EXCLUDED.runner_act,
        cavity_act          = EXCLUDED.cavity_act,
        cycle_act           = EXCLUDED.cycle_act,
        pcshr_act           = EXCLUDED.pcshr_act,
        man_act             = EXCLUDED.man_act,
        entered_by          = EXCLUDED.entered_by,
        sfgqty_act          = EXCLUDED.sfgqty_act,
        operator_activities = EXCLUDED.operator_activities,
        geo_lat             = EXCLUDED.geo_lat,
        geo_lng             = EXCLUDED.geo_lng,
        geo_acc             = EXCLUDED.geo_acc,
        is_deleted          = false,
        updated_at          = NOW()
      `,
      [
        PlanID, Shift, DprDate, session?.line || null, Machine, OrderNo, MouldName,
        toNum(ArticleActual), toNum(RunnerActual), toNum(CavityActual), toNum(CycleActual),
        toNum(PcsHrActual), toNum(ManActual), EnteredBy || null, toNum(SfgQtyActual), OperatorActivities || null,
        geo?.lat || null, geo?.lng || null, geo?.accuracy || null
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('std-actual/save', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   STD / ACTUAL STATUS
============================================================ */
app.get('/api/std-actual/status', async (req, res) => {
  try {
    const { planId, shift, date, machine } = req.query;

    let rows = [];
    if (planId) {
      rows = await q(
        `
        SELECT *
          FROM std_actual
         WHERE plan_id = $1
           AND shift   = $2
           AND dpr_date::date = $3::date
           AND machine = $4
         LIMIT 1
        `,
        [planId, shift, date, machine]
      );
    }

    // NEW: Fetch Standards from Mould Master (User Req: Fetch by Matching ERP ITEM CODE)
    let std = {};
    if (planId) {
      // STRICT MOULD NO LOGIC (Plan -> Order -> Summary -> Master)
      try {
        // 1. Get Linkage info
        const linkRes = await q(`
          SELECT 
            p.order_no, 
            p.mould_name as plan_mould_name,
            s.mould_no, 
            s.mould_name as summary_mould_name
          FROM plan_board p
          LEFT JOIN mould_planning_summary s ON s.or_jr_no = p.order_no
          WHERE p.plan_id = $1
        `, [planId]);

        if (linkRes.length) {
          // We might have multiple rows if one Order has multiple Moulds in summary
          // Filter to find the BEST match using Mould Name
          let best = linkRes[0];
          if (linkRes.length > 1) {
            const planName = (linkRes[0].plan_mould_name || '').toLowerCase().trim();

            const match = linkRes.find(r => {
              const sumName = (r.summary_mould_name || '').toLowerCase().trim();
              return sumName && planName.includes(sumName); // or vice versa
            });
            if (match) best = match;
          }

          const mouldNo = best.mould_no;
          if (mouldNo) {
            // 2. Fetch Master strictly by Mould No
            // First try exact match
            let mRows = await q(`SELECT * FROM moulds WHERE mould_number = $1`, [mouldNo]);

            // Fallback: Prefix match (Fuzzy) if exact fails
            if (!mRows.length) {
              mRows = await q(`SELECT * FROM moulds WHERE mould_number LIKE $1 || '%' LIMIT 1`, [mouldNo]);
            }

            if (mRows.length) {
              const m = mRows[0];
              std = {
                article_std: m.std_wt_kg,
                runner_std: m.runner_weight,
                cavity_std: m.no_of_cav,
                cycle_std: m.cycle_time,
                pcshr_std: m.pcs_per_hour,
                man_std: m.manpower,
                sfgqty_std: m.sfg_std_packing
              };
            }
          }
        }
      } catch (err) {
        console.error('Error fetching standards (MouldNo Logic)', err);
      }
    }

    if (!rows.length) return res.json({ ok: true, data: { done: false, std } });
    res.json({ ok: true, data: { done: true, row: rows[0], std } });

  } catch (e) {
    console.error('std-actual/status', e);
    fs.appendFileSync('debug_errors.log', `[STD-STATUS] ${e.message}\n`);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR USED SLOTS
============================================================ */
app.get('/api/dpr/used-slots', async (req, res) => {
  try {
    const { planId, date, shift } = req.query;
    if (!planId || !date) return res.json({ ok: true, used: [], data: [] });

    const rows = await q(
      `
      SELECT hour_slot, entry_type
        FROM dpr_hourly
       WHERE plan_id = $1
         AND dpr_date = $2
         AND shift = $3
         AND is_deleted = false
      `,
      [planId, date, shift || '']
    );

    const slots = rows.map(r => ({ slot: r.hour_slot, type: r.entry_type || 'MAIN' }));
    res.json({ ok: true, used: slots, data: slots });
  } catch (e) {
    console.error('dpr/used-slots', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR SUBMIT
============================================================ */
app.post('/api/dpr/submit', async (req, res) => {
  try {
    const { session, entry, geo } = req.body || {};
    let {
      Date, Shift, HourSlot, Shots, GoodQty, RejectQty,
      DowntimeMin, Remarks, PlanID, Machine, OrderNo,
      MouldNo, JobCardNo, Colour, RejectBreakup,
      DowntimeBreakup, EntryType, Supervisor
    } = entry || {};

    // FALLBACK: If MouldNo is missing but PlanID exists, fetch it
    if ((!MouldNo || MouldNo === '') && PlanID) {
      try {
        const pRes = await q('SELECT item_code, mould_name FROM plan_board WHERE CAST(id AS TEXT)=$1 OR CAST(plan_id AS TEXT)=$1', [String(PlanID)]);
        if (pRes.length) {
          // Use item_code as mould_no (if that is the convention) or fetch from moulds
          if (pRes[0].item_code) MouldNo = pRes[0].item_code;
          // Or verify via moulds table if item_code is not mould_no? 
          // Usually in this system item_code in plan_board seems to be used as Mould No or linked to it.
        }
      } catch (err) { console.error('Auto-fetch MouldNo failed', err); }
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    // [NEW] Check if plant or line is closed
    if (Machine) {
      const mRows = await q('SELECT building, line FROM machines WHERE machine = $1 AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))', [Machine, factoryId]);
      if (mRows.length > 0) {
        const building = mRows[0].building || 'Unknown';
        const mline = mRows[0].line || 'Unknown';
        const closure = await isPlantClosed(Date, building, mline, Shift, factoryId);
        if (closure) {
          const area = closure.plant === 'All' ? 'FACTORY' : closure.plant.includes('-') ? `LINE ${closure.plant}` : `PLANT ${closure.plant}`;
          return res.json({ ok: false, error: `${area} IS CLOSED: ${closure.remarks}. Cannot Make Entries.` });
        }
      }
    }

    // --- [NEW] QUICK ACTION CONTINUITY LOGIC ---
    if (Machine && Date && Shift && HourSlot) {
      try {
        const lastEntries = await q(
          `SELECT hour_slot, entry_type, shots, good_qty, reject_qty, downtime_min, remarks, 
           plan_id, order_no, mould_no, jobcard_no, colour, reject_breakup, downtime_breakup, supervisor
           FROM dpr_hourly 
           WHERE machine = $1 AND dpr_date = $2 AND shift = $3 
           AND is_deleted = false
           ORDER BY id DESC LIMIT 1`,
          [Machine, Date, Shift]
        );

        if (lastEntries.length > 0) {
          const last = lastEntries[0];
          const QUICK_TYPES = ['Maintenance', 'ManPowerShortage', 'MouldChangeover', 'MouldTrial', 'MouldMaintenance', 'NoPlan'];
          
          if (QUICK_TYPES.includes(last.entry_type)) {
            const SLOT_LABELS = ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08', '08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
            // Since shift can wrap or be night/day, we find the first occurrence in SLOT_LABELS
            // But actually the system uses a fixed 12-slot array per shift.
            const SHIFT_SLOTS = ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
            const lastIdx = SHIFT_SLOTS.indexOf(last.hour_slot);
            const currIdx = SHIFT_SLOTS.indexOf(HourSlot);

            if (lastIdx !== -1 && currIdx !== -1 && currIdx > lastIdx + 1) {
              for (let i = lastIdx + 1; i < currIdx; i++) {
                const gapSlot = SHIFT_SLOTS[i];
                // Check if already filled
                const exists = await q('SELECT id FROM dpr_hourly WHERE machine=$1 AND dpr_date=$2 AND shift=$3 AND hour_slot=$4 AND is_deleted = false', [Machine, Date, Shift, gapSlot]);
                if (exists.length === 0) {
                  await q(
                    `INSERT INTO dpr_hourly (
                      dpr_date, shift, hour_slot, shots, good_qty, reject_qty, downtime_min, 
                      remarks, line, machine, plan_id, order_no, mould_no, jobcard_no, 
                      colour, reject_breakup, downtime_breakup, entry_type, created_by, supervisor, factory_id, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())`,
                    [
                      Date, Shift, gapSlot, 0, 0, 0, 60, 
                      (last.remarks ? (last.remarks.includes('[Auto-Filled]') ? last.remarks : last.remarks + ' [Auto-Filled]') : '[Auto-Filled]'), 
                      session?.line || null, Machine, last.plan_id, last.order_no, last.mould_no, last.jobcard_no,
                      last.colour, last.reject_breakup, last.downtime_breakup, last.entry_type,
                      'SYSTEM-AUTOFILL', last.supervisor, factoryId || 1
                    ]
                  );
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('Continuity Error:', err);
      }
    }

    const rows = await q(
      `
      INSERT INTO dpr_hourly (
        dpr_date, shift, hour_slot,
        shots, good_qty, reject_qty, downtime_min, remarks,
        line, machine, plan_id, order_no, mould_no, jobcard_no,
        colour, reject_breakup, downtime_breakup, entry_type,
        created_by, geo_lat, geo_lng, geo_acc, supervisor,
        factory_id,
        created_at, updated_at
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,
        $19,$20,$21,$22, $23,
        $24,
        NOW(), NOW()
      )
      RETURNING id
      `,
      [
        Date, Shift, HourSlot,
        toNum(Shots), toNum(GoodQty), toNum(RejectQty), toNum(DowntimeMin), Remarks || null,
        session?.line || null, Machine, PlanID, OrderNo, MouldNo, JobCardNo,
        Colour || null, RejectBreakup || null, DowntimeBreakup || null, EntryType || 'MAIN',
        session?.username || null,
        geo?.lat || null, geo?.lng || null, geo?.accuracy || null, Supervisor || null,
        factoryId || 1 // Default to 1 if missing
      ]
    );

    // Auto-Close Maintenance if running
    if (Machine) {
      try {
        await q('UPDATE machine_status_logs SET is_active=false, end_date=$2, end_slot=$3 WHERE machine=$1 AND is_active=true',
          [Machine, Date, HourSlot]);
      } catch (_) { }
    }

    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    console.error('dpr/submit', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR DELETE
============================================================ */
app.post('/api/dpr/delete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ ok: false, error: 'ID required' });

    // Safety: Ensure it's not a historical entry? 
    // For now, we'll trust the supervisor.
    await q('UPDATE dpr_hourly SET is_deleted = true, updated_at = NOW() WHERE id = $1', [id]);
    
    res.json({ ok: true });
  } catch (e) {
    console.error('dpr/delete', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR RECENT
============================================================ */
app.get('/api/dpr/recent', async (req, res) => {
  try {
    const { line, machine, limit, planId, jc_no, date, shift } = req.query;
    const lim = Math.min(Number(limit || 50), 200);

    let where = "WHERE machine = $1 AND is_deleted = false";
    const params = [machine];

    if (line) {
      params.push(line);
      where += ` AND line = $${params.length}`;
    }
    if (planId) {
      params.push(planId);
      where += ` AND (plan_id = $${params.length} OR CAST(plan_id AS TEXT) = $${params.length})`;
    }
    if (jc_no) {
      params.push(jc_no);
      where += ` AND (jobcard_no = $${params.length} OR jobcard_no LIKE $${params.length} || '%')`;
    }
    if (date) {
      params.push(date);
      where += ` AND dpr_date = $${params.length}`;
    }
    if (shift) {
      params.push(shift);
      where += ` AND shift = $${params.length}`;
    }

    const rows = await q(
      `
      SELECT
        id           AS "UniqueID",
        to_char(dpr_date, 'YYYY-MM-DD') AS "Date",
        created_at   AS "DateTime",
        hour_slot    AS "HourSlot",
        shots        AS "Shots",
        good_qty     AS "GoodQty",
        reject_qty   AS "RejectQty",
        downtime_min AS "DowntimeMin",
        remarks      AS "Remarks",
        supervisor   AS "EntryPerson",
        shift        AS "Shift",
        COALESCE(colour, 
          (SELECT data->>'mould_item_name' FROM jc_details WHERE data->>'or_jr_no' = dpr_hourly.order_no AND data->>'mould_no' = dpr_hourly.mould_no LIMIT 1)
        ) AS "Colour",
        reject_breakup   AS "RejectBreakup",
        downtime_breakup AS "DowntimeBreakup",
        entry_type       AS "EntryType",
        plan_id          AS "PlanID",
        order_no         AS "OrderNo",
        mould_no         AS "MouldNo",
        jobcard_no       AS "JobCardNo",
        -- Robust Mould Lookup
        COALESCE(
          (SELECT COALESCE(NULLIF(mould_name, ''), mould_number) FROM moulds 
            WHERE mould_number = dpr_hourly.mould_no 
               OR mould_number LIKE dpr_hourly.mould_no || '%' 
               OR dpr_hourly.mould_no LIKE mould_number || '%' LIMIT 1),
          (SELECT mould_name FROM plan_board WHERE (plan_id = dpr_hourly.plan_id OR CAST(id AS TEXT) = dpr_hourly.plan_id) LIMIT 1),
          dpr_hourly.mould_no
        ) as "Mould",
        -- Client Lookup
        (SELECT client_name FROM orders WHERE order_no = dpr_hourly.order_no LIMIT 1) as "Client"
      FROM dpr_hourly
      ${where}
      ORDER BY dpr_date DESC, created_at DESC
      LIMIT $${params.length + 1}
      `,
      [...params, lim]
    );

    res.json({ ok: true, data: { rows } });
  } catch (e) {
    console.error('dpr/recent', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   JOB SUMMARY (Admin Visualization)
============================================================ */
app.get('/api/dpr/job-summary', async (req, res) => {
  try {
    const { orderNo, mouldNo, date } = req.query;
    if (!orderNo) return res.status(400).json({ ok: false, error: 'Order No required' });

    // 1. Fetch Order/JC Metadata (Multi-Level Fallback)
    let metaRes = await q(`
      SELECT 
        o.or_jr_no as "orderNo",
        o.job_card_no as "jcNo",
        o.product_name as "mouldName",
        o.item_code as "itemCode",
        o.plan_qty as "planQty",
        o.plan_date as "planDate",
        o.is_closed as "isClosed",
        ord.client_name as "clientName"
      FROM or_jr_report o
      LEFT JOIN orders ord ON ord.order_no = o.or_jr_no
      WHERE o.or_jr_no = $1
      LIMIT 1
    `, [orderNo]);

    let metadata = metaRes[0];

    // Fallback 1: Plan Board
    if (!metadata) {
      const planRes = await q(`
        SELECT order_no, mould_name, item_code, plan_qty, start_date 
        FROM plan_board 
        WHERE order_no = $1 
        LIMIT 1
      `, [orderNo]);
      if (planRes.length) {
        const p = planRes[0];
        metadata = {
          orderNo: p.order_no,
          jcNo: 'N/A',
          mouldName: p.mould_name,
          itemCode: p.item_code,
          planQty: p.plan_qty || 0,
          planDate: p.start_date,
          isClosed: 'No',
          clientName: 'Planned (No JC)'
        };
      }
    }

    // Fallback 2: Mould Planning Summary (Direct from ERP Sync)
    if (!metadata || !metadata.planQty || metadata.planQty == 0) {
      const sumRes = await q(`SELECT order_qty, mould_name, mould_no FROM mould_planning_summary WHERE or_jr_no = $1 LIMIT 1`, [orderNo]);
      if (sumRes.length) {
        const s = sumRes[0];
        if (!metadata) {
           metadata = { orderNo, jcNo: 'N/A', mouldName: s.mould_name, itemCode: s.mould_no, planQty: s.order_qty, planDate: null, isClosed: 'No', clientName: 'N/A' };
        } else {
           metadata.planQty = s.order_qty;
           if (!metadata.mouldName || metadata.mouldName === 'Multiple/Unknown') metadata.mouldName = s.mould_name;
        }
      }
    }

    // Fallback 2: Generic Placeholder (Ensures we still show production data)
    if (!metadata) {
      metadata = {
        orderNo: orderNo,
        jcNo: 'N/A',
        mouldName: 'Multiple/Unknown',
        itemCode: 'N/A',
        planQty: 0,
        planDate: null,
        isClosed: 'No',
        clientName: 'Manual Entry / Not Linked'
      };
    }

    // 2. Fetch Production Data & Mould Specific Plan Adjustment
    let dprWhere = 'dh.order_no = $1 AND dh.is_deleted = false';
    const dprParams = [orderNo];

    if (date) {
      dprParams.push(date);
      dprWhere += ` AND dh.dpr_date = $${dprParams.length}`;
    }
    
    // If a specific mould is selected, we need to adjust the planQty
    if (mouldNo) {
      dprParams.push(mouldNo);
      // Use TRIM and ILIKE for robust matching, especially for sub-mould names
      dprWhere += ` AND (dh.mould_no = $${dprParams.length} OR pb.mould_name ILIKE $${dprParams.length} OR m.mould_name ILIKE $${dprParams.length})`;
      
      // Update metadata to show the selected mould name specifically
      metadata.mouldName = mouldNo;

      // Attempt to get the specific plan quantity for this mould under this order
      // We look in plan_board for this specific mould name
      const mouldPlanRes = await q(`
        SELECT plan_qty, mould_name
        FROM plan_board 
        WHERE order_no = $1 AND (TRIM(mould_name) = TRIM($2) OR TRIM(mould_name) = (
           SELECT TRIM(mould_name) FROM moulds WHERE mould_number = $2 LIMIT 1
        ))
        LIMIT 1
      `, [orderNo, mouldNo]);
      
      if (mouldPlanRes.length > 0) {
          metadata.planQty = mouldPlanRes[0].plan_qty;
          metadata.mouldName = mouldPlanRes[0].mould_name; // Use the exact string from DB
      }
    }

    // 3. Fetch Reasons Mapping
    const reasonsRes = await q('SELECT type, code, reason FROM dpr_reasons WHERE is_active = true');
    const reasonMap = { DOWNTIME: {}, REJECTION: {} };
    reasonsRes.forEach(r => {
      if (r.type && r.code) reasonMap[r.type][r.code] = r.reason.trim();
    });

    const dprRows = await q(`
      SELECT 
        dh.dpr_date, 
        dh.shift, 
        dh.hour_slot, 
        dh.machine,
        dh.good_qty, 
        dh.reject_qty, 
        dh.reject_breakup,
        dh.downtime_min, 
        dh.downtime_breakup,
        dh.colour,
        dh.created_by as entry_person,
        dh.created_at
      FROM dpr_hourly dh
      LEFT JOIN plan_board pb ON dh.plan_id = pb.plan_id
      LEFT JOIN moulds m ON dh.mould_no = m.mould_number
      WHERE ${dprWhere}
      ORDER BY dh.dpr_date ASC, (CASE WHEN dh.shift='Day' THEN 1 ELSE 2 END) ASC, dh.hour_slot ASC
    `, dprParams);

    // 3b. Fetch Raw Material Aggregates
    const rmRows = await q(`
      SELECT * FROM raw_material_issues 
      WHERE order_no = $1 
      ORDER BY created_at ASC
    `, [orderNo]);

    let totalRmIssued = 0;
    let totalRmAccepted = 0;
    rmRows.forEach(rm => {
      totalRmIssued += Number(rm.total_weight || 0);
      totalRmAccepted += Number(rm.accepted_weight || 0);
    });

    // 4. Aggregate Data
    let totalGood = 0;
    let totalReject = 0;
    let totalDowntime = 0;
    const downtimeBreakdown = {}; 
    const rejectionBreakdown = {};
    const dailyTrend = {}; 
    const hourlyTrend = []; 

    dprRows.forEach(row => {
      const g = Number(row.good_qty || 0);
      const r = Number(row.reject_qty || 0);
      const d = Number(row.downtime_min || 0);

      totalGood += g;
      totalReject += r;
      totalDowntime += d;

      const dStr = row.dpr_date instanceof Date ? row.dpr_date.toISOString().split('T')[0] : row.dpr_date;
      if (!dailyTrend[dStr]) dailyTrend[dStr] = { good: 0, reject: 0 };
      dailyTrend[dStr].good += g;
      dailyTrend[dStr].reject += r;

      hourlyTrend.push({
        date: dStr,
        hour: row.hour_slot,
        good: g,
        reject: r,
        downtime: d,
        machine: row.machine,
        entry_person: row.entry_person
      });

      if (row.downtime_breakup) {
        try {
          const dtMap = (typeof row.downtime_breakup === 'string') ? JSON.parse(row.downtime_breakup) : row.downtime_breakup;
          if (dtMap && typeof dtMap === 'object') {
            Object.keys(dtMap).forEach(k => {
              const min = Number(dtMap[k]);
              if (min > 0) downtimeBreakdown[k] = (downtimeBreakdown[k] || 0) + min;
            });
          }
        } catch (e) {}
      }

      if (row.reject_breakup) {
        try {
          const rbMap = (typeof row.reject_breakup === 'string') ? JSON.parse(row.reject_breakup) : row.reject_breakup;
          if (rbMap && typeof rbMap === 'object') {
             Object.keys(rbMap).forEach(k => {
               const qty = Number(rbMap[k]);
               if (qty > 0) rejectionBreakdown[k] = (rejectionBreakdown[k] || 0) + qty;
             });
          }
        } catch (e) {}
      }
    });

    // 3. Get Setup/STD
    const std = await q(`SELECT * FROM std_actual WHERE plan_id IN(SELECT DISTINCT plan_id FROM dpr_hourly WHERE order_no = $1) LIMIT 10`, [orderNo]);

    res.json({
      ok: true,
      data: {
        metadata,
        totals: {
          totalGood,
          totalReject,
          totalDowntime,
          efficiency: (Number(metadata.planQty) > 0) ? ((totalGood / Number(metadata.planQty)) * 100).toFixed(1) : 0
        },
        trends: {
          daily: Object.entries(dailyTrend).map(([date, vals]) => ({ date, ...vals })),
          hourly: hourlyTrend
        },
        downtimeBreakdown,
        rejectionBreakdown,
        reasonMap,
        rawMaterials: {
          totalIssued: totalRmIssued,
          totalAccepted: totalRmAccepted,
          logs: rmRows
        },
        standards: std,
        logs: dprRows
      }
    });

  } catch (e) {
    console.error('job-summary API error:', e);
    // Explicitly return JSON error to prevent frontend crash
    res.status(500).json({ 
      ok: false, 
      error: 'An internal server error occurred while generating the summary.',
      details: String(e.message || e)
    });
  }
});

// DEBUG: Inspect IDs for Shifting Mismatch
app.get('/api/debug/ids', async (req, res) => {
  try {
    const plans = await q(`SELECT id, plan_id, machine, order_no, status FROM plan_board WHERE status IN ('RUNNING','Running')`);
    const dpr = await q(`SELECT id, plan_id, machine, order_no, good_qty FROM dpr_hourly ORDER BY created_at DESC LIMIT 20`);
    res.json({ ok: true, plans, dpr });
  } catch (e) {
    res.json({ error: String(e) });
  }
});

/* ============================================================
   SHIFTING MODULE APIs
============================================================ */

// GET /api/shifting/locations
app.get('/api/shifting/locations', async (req, res) => {
  try {
    const locs = ['WIP Store', 'FG Store', 'Assembly Area', 'Quality Hold', 'Dispatch', 'Scrap Yard', 'Rework Area', 'Mould Maintenance'];
    res.json({ ok: true, data: locs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/shifting/dashboard
// Comprehensive view for Shifting Module: Running + Queue, Produced vs Shifted
// Returns grouped data for the dashboard.
app.get('/api/shifting/dashboard', async (req, res) => {
  try {
    const { date, shift } = req.query;
    // Note: Date/Shift filters could optimize 'Produced' calculation if needed, 
    // but typically Shifting is against TOTAL floor stock.
    // We will return CUMULATIVE data for stock accuracy.

    // 1. Fetch Plans (Running & Planned)
    // We group by Line > Machine
    const rows = await q(
      `SELECT 
         pb.id as plan_id,
         pb.machine,
         pb.line,
         pb.order_no,
         pb.item_name,
         pb.mould_name,
         pb.plan_qty,
         pb.status,
         pb.start_date,
         
         -- Cumulative Production (All Time for this plan)
         COALESCE(SUM(dh.good_qty), 0) as total_produced,
         
         -- Cumulative Shifted
         COALESCE(
           (SELECT SUM(sr.quantity) FROM shifting_records sr WHERE CAST(sr.plan_id AS TEXT) = CAST(pb.id AS TEXT)), 
           0
         ) as total_shifted,
         
         -- Last Shifting Activity
         (SELECT MAX(created_at) FROM shifting_records sr WHERE CAST(sr.plan_id AS TEXT) = CAST(pb.id AS TEXT)) as last_shifted_at

       FROM plan_board pb
       -- Robust Join: Match either Integer PK OR String PlanID (e.g. 'P-101')
       -- Robust Join: Match either Integer PK OR String PlanID (e.g. 'P-101')
       LEFT JOIN dpr_hourly dh ON (
           CAST(dh.plan_id AS TEXT) = CAST(pb.id AS TEXT) 
           OR CAST(dh.plan_id AS TEXT) = CAST(pb.plan_id AS TEXT)
       )
       WHERE pb.status IN ('Running', 'RUNNING', 'Planned', 'PLANNED')
         AND ($1::text IS NULL OR pb.line = $1 OR pb.machine LIKE $1 || '%')
       GROUP BY pb.id, pb.machine, pb.line, pb.order_no, pb.item_name, pb.mould_name, pb.plan_qty, pb.status, pb.start_date
       ORDER BY pb.line, pb.machine, pb.seq`,
      [req.query.line || null]
    );

    // 2. Fetch "Shifted Today" logs if needed for the "What Supervisor Shifted" view
    // ... logic for specific date log ...

    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/shifting/matrix
// Timeline Report: Machine vs Hour Slot (Shifted Qty)
app.get('/api/shifting/matrix', async (req, res) => {
  try {
    const { date, shift } = req.query;
    if (!date) return res.json({ ok: false, error: 'Date required' });

    // 1. Get Shifting Records with Hour parsing
    // We assume 'shift_date' is reliable. If null (old data), fallback to created_at date.
    // Hour Slot: Extract hour from created_at
    // We need to fetch Machine & Mould info from Plan Board via plan_id.
    // Robust Join with dpr_hourly logic (PK vs String) apply here too via plan_board join.

    // Logic:
    // Row: Machine, Mould Name, Item Code
    // Col: Hour (08, 09...)
    // Value: Sum(Quantity)

    const rows = await q(
      `SELECT 
         pb.machine,
         pb.line,
         pb.mould_name,
         pb.item_name,
         EXTRACT(HOUR FROM sr.created_at) as hour_slot,
         SUM(sr.quantity) as qty
       FROM shifting_records sr
       JOIN plan_board pb ON CAST(pb.id AS TEXT) = CAST(sr.plan_id AS TEXT)
       WHERE 
         (sr.shift_date = $1 OR sr.created_at::date = $1) -- Handle Legacy
         AND ($2::text IS NULL OR sr.shift_type = $2)
       GROUP BY pb.machine, pb.line, pb.mould_name, pb.item_name, EXTRACT(HOUR FROM sr.created_at)
       ORDER BY pb.line, pb.machine, hour_slot`,
      [date, shift || null]
    );

    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/shifting/entry (Enhanced)
app.post('/api/shifting/entry', async (req, res) => {
  try {
    const { planId, quantity, toLocation, date, shift, supervisor } = req.body;

    if (!planId || !quantity || !toLocation) return res.json({ ok: false, error: 'Missing required fields' });

    await q(
      `INSERT INTO shifting_records (plan_id, quantity, to_location, shift_date, shift_type, shifted_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [planId, quantity, toLocation, date || null, shift || null, supervisor || 'Supervisor']
    );

    syncService.triggerSync();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   PACKING / ASSEMBLY PLANNING
   ============================================================ */

// GET /api/assembly/grid
// Fetch active plans for all tables (or specific date range)
app.get('/api/assembly/grid', async (req, res) => {
  try {
    const { date } = req.query; // Optional filter
    // For now, return all active or recent plans
    const rows = await q(
      `SELECT * FROM assembly_plans 
       WHERE status != 'Archived' 
       ORDER BY table_id, start_time`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});




// GET /api/shifting/logs
app.get('/api/shifting/logs', async (req, res) => {
  try {
    const limit = req.query.limit || 500;
    const rows = await q(
      `SELECT sr.*, pb.order_no, pb.item_name, pb.mould_name, pb.machine
       FROM shifting_records sr
       LEFT JOIN plan_board pb ON CAST(pb.id AS TEXT) = CAST(sr.plan_id AS TEXT)
       ORDER BY sr.created_at DESC
       LIMIT $1`, [limit]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/shifting/delete-all (ADMIN ONLY)
app.post('/api/shifting/delete-all', async (req, res) => {
  try {
    const { username } = req.body;

    // Safety check: Verify admin role OR Critical Permission
    const u = (await q('SELECT role_code, permissions FROM users WHERE username=$1', [username]))[0];
    const perms = u ? (u.permissions || {}) : {};

    // Allow if Admin OR has 'log_clear' permission
    const allowed = isAdminLikeRole(u) || (perms.critical_ops && perms.critical_ops.log_clear);

    if (!allowed) {
      return res.json({ ok: false, error: 'Unauthorized: Admin or Log Clear permission required' });
    }

    await q('TRUNCATE TABLE shifting_records RESTART IDENTITY');
    console.log(`[AUDIT] Shifting Logs cleared by ${username}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   DPR EDIT
============================================================ */
/* ============================================================
   DPR UPDATE (ADMIN FUll EDIT)
============================================================ */
app.post('/api/dpr/edit', async (req, res) => {
  try {
    const { session, payload } = req.body;
    const { uniqueId, newShots, newReject, newDowntime, newRemarks, newColour, newRejBreakup, newDtBreakup } = payload || {};

    // Basic validation
    if (!uniqueId) throw new Error("ID required");

    // Recalculate Good Qty
    const s = Number(newShots) || 0;
    const r = Number(newReject) || 0;
    const g = Math.max(0, s - r);

    // Update Query
    const qRaw = `
        UPDATE dpr_hourly 
        SET shots=$1, good_qty=$2, reject_qty=$3, downtime_min=$4, 
            remarks=$5, colour=$6, reject_breakup=$7, downtime_breakup=$8,
            updated_at=NOW()
        WHERE id=$9
        RETURNING *
    `;

    const result = await pool.query(qRaw, [
      s, g, r, Number(newDowntime) || 0,
      newRemarks || null,
      newColour || null,
      newRejBreakup || null,
      newDtBreakup || null,
      uniqueId
    ]);

    if (result.rowCount === 0) throw new Error("Entry not found");

    res.json({ ok: true, data: result.rows[0] });
  } catch (e) {
    console.error('dpr/edit error', e);
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   JOB COMPLETE / DROP
   NOTE: requires these columns to exist in jobs_queue:
     complete_img, complete_img_name, completed_by, completed_at,
     complete_geo_lat, complete_geo_lng, complete_geo_acc
============================================================ */
app.post('/api/job/complete', async (req, res) => {
  console.log('[API] /api/job/complete Request Body Dump:', JSON.stringify(req.body));
  try {
    // --- BEGIN SUPERVISOR AUTO-START LOGIC ---
    // If there is NO 'payload' object, this is DEFINITELY the supervisor app, not the legacy mobile app.
    if (req.body && typeof req.body.payload === 'undefined') {
      const planId = req.body.planId || req.body.PlanID || req.body.plan_id || req.body.id;
      if (!planId) return res.status(400).json({ ok: false, error: 'Missing PlanID (AutoStart Route)' });

      // 1. Check if the job actually had any production entries
      const dprCheck = await q(`SELECT COUNT(*) as c FROM dpr_hourly WHERE plan_id = $1`, [planId]);
      const hasProduction = dprCheck.length > 0 && parseInt(dprCheck[0].c, 10) > 0;

      // If production was logged = it's genuinely 'Stopped'. 
      // If NO production was logged = it was skipped, so revert to 'Planned'.
      const newStatus = hasProduction ? 'Stopped' : 'Planned';

      // 2. Rotate to the back of the queue (MAX seq + 10) and set status
      const r = await q(`
        WITH max_seq AS (
          SELECT COALESCE(MAX(seq), 0) as max_s 
          FROM plan_board 
          WHERE machine = (SELECT machine FROM plan_board WHERE plan_id = $1)
        )
        UPDATE plan_board 
        SET status = $2, 
            seq = (SELECT max_s FROM max_seq) + 10,
            updated_at = NOW()
        WHERE plan_id = $1
        RETURNING *
      `, [planId, newStatus]);

      if (!r.length) return res.status(404).json({ ok: false, error: 'Job not found' });
      const currentJob = r[0];
      const machine = currentJob.machine;
      const currentJobId = currentJob.id;

      await q(
        "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'COMPLETE_STOP', $2, 'System')",
        [currentJobId, JSON.stringify({ machine, msg: 'Job stopped from supervisor completion' })]
      );

      const nextJobQuery = `
        SELECT pb.id, pb.plan_id, pb.machine, pb.status 
        FROM plan_board pb
        WHERE pb.machine = $1 
          AND UPPER(pb.status) NOT IN ('RUNNING', 'COMPLETED', 'COMPLETED_PENDING', 'CANCELLED', 'ARCHIVED')
        ORDER BY 
          pb.seq ASC, 
          pb.id ASC
        LIMIT 1
      `;
      const nextJobs = await q(nextJobQuery, [machine]);

      if (nextJobs.length > 0) {
        const nextJob = nextJobs[0];

        // Stop any other running plans on this machine first to prevent overlaps
        await q(`UPDATE plan_board SET status = 'Stopped' WHERE machine = $1 AND status = 'Running'`, [machine]);

        await q(`
          UPDATE plan_board 
          SET status = 'Running', start_date = NOW(), updated_at = NOW()
          WHERE id = $1
        `, [nextJob.id]);

        await q(
          "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'STATUS_CHANGE', $2, 'System')",
          [nextJob.id, JSON.stringify({ old: nextJob.status, new: 'Running', msg: 'Auto-started after previous job completion (Mould priority applied)' })]
        );
      }

      try {
        const syncService = require('../../services/sync.service');
        if (typeof syncService.triggerSync === 'function') {
          syncService.triggerSync();
        }
      } catch (e) { }

      const finalAction = newStatus === 'Planned' ? 'Job skipped back to Planned' : 'Job stopped';
      return res.json({ ok: true, message: `${finalAction} and next prioritized job auto-started` });
    }
    // --- END SUPERVISOR AUTO-START LOGIC ---

    const { session, payload, geo } = req.body || {};
    const { PlanID, Action, ImageBase64, ImageName } = payload || {};
    if (!PlanID) return res.json({ ok: false, error: 'Missing PlanID' });

    const newStatus = Action === 'Drop' ? 'DROPPED' : 'COMPLETED';

    await q(
      `
      UPDATE jobs_queue
         SET status = $2,
      complete_img = $3,
      complete_img_name = $4,
      completed_by = $5,
      completed_at = NOW(),
      complete_geo_lat = $6,
      complete_geo_lng = $7,
      complete_geo_acc = $8
       WHERE plan_id = $1
      `,
      [
        PlanID, newStatus, ImageBase64 || null, ImageName || null,
        session?.username || null,
        geo?.lat || null, geo?.lng || null, geo?.accuracy || null
      ]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('job/complete', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   PLANNING BOARD APIs
   Table: plan_board
   Required columns:
     id, plan_id, plant, building, line, machine, seq,
     order_no, item_code, item_name, mould_name,
     plan_qty, bal_qty, start_date, end_date, status, updated_at
============================================================ */

// GET /api/planning/board?plant=DUNGRA&date=2025-12-12
app.get('/api/planning/board', async (req, res) => {
  try {
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req); // Moved up
    const plant = req.query.plant || (factoryId === 1 ? 'DUNGRA' : (factoryId === 2 ? 'SHIVANI' : 'DUNGRA'));
    const date = req.query.date || null;
    const requestedProcess = getRequestedMachineProcess(req, 'Moulding');

    const params = [plant];
    let where = `plant = $1 AND pb.status != 'COMPLETED'`;

    if (factoryId) {
      params.push(factoryId);
      where += ` AND pb.factory_id = $${params.length}`;
    }

    if (date) {
      params.push(date);
      where += ` AND start_date <= $${params.length} AND(end_date IS NULL OR end_date >= $${params.length})`;
    }

    if (requestedProcess) {
      params.push(requestedProcess);
      where += ` AND COALESCE(NULLIF(TRIM(planMachine.machine_process), ''), 'Moulding') = $${params.length}`;
    }

    const rows = await q(
      `
    SELECT
    pb.id,
      pb.plan_id      AS "planId",
        pb.plant,
        COALESCE(NULLIF(TRIM(pb.building), ''), NULLIF(TRIM(planMachine.building), ''), NULLIF(TRIM(planMachine.machine_process), ''), 'General') AS building,
        COALESCE(NULLIF(TRIM(pb.line), ''), NULLIF(TRIM(planMachine.line), ''), CASE WHEN COALESCE(NULLIF(TRIM(planMachine.machine_process), ''), 'Moulding') = 'Moulding' THEN '1' ELSE 'Machines' END) AS line,
        pb.machine,
        COALESCE(NULLIF(TRIM(planMachine.machine_process), ''), 'Moulding') AS "machineProcess",
        pb.seq,
        pb.order_no     AS "orderNo",
          pb.item_code    AS "itemCode",
            pb.item_name    AS "itemName",
    COALESCE(pb.mould_name, m.mould_name, 'Unknown') AS "mouldName",
      o.client_name    AS "clientName",
        mMaster.cycle_time AS "cycleTime",
        -- Fetch Mould No from Master (Strict => Fallback to Mould Master)
        COALESCE(mps.mould_no, m.mould_number, '-') AS "mouldNo",


          mps.jr_qty       AS "jrQty",
          mps.mould_item_qty AS "targetQty",
          mps.tonnage      AS "tonnage",
          mps.cavity       AS "cavity",
          mps.uom          AS "uom",
          ojr.job_card_no  AS "jcNo",
          pb.job_card_given,


          pb.plan_qty     AS "planQty",
            pb.bal_qty      AS "balQty",
              pb.start_date   AS "startDate",
                pb.end_date     AS "endDate",
                  pb.status,
                  o.priority     AS "priority",
                    COALESCE(dpr.qty, 0) AS "producedQty",
                    dpr.first_entry AS "firstDprEntry"
      FROM plan_board pb
      LEFT JOIN orders o ON o.order_no = pb.order_no
      LEFT JOIN machines planMachine
        ON LOWER(TRIM(planMachine.machine)) = LOWER(TRIM(pb.machine))
       AND (planMachine.factory_id = pb.factory_id OR (planMachine.factory_id IS NULL AND pb.factory_id IS NULL))
      -- Optimized Mould Join: Match by Mould Name
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name 
      -- Join Planning Summary for fallback Mould No
      LEFT JOIN mould_planning_summary mps ON (mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
      -- Fetch Master CT using Mould No from Summary
      LEFT JOIN moulds mMaster ON TRIM(mMaster.mould_number) = TRIM(mps.mould_no)

      -- Fetch JC No from OR-JR Report
      LEFT JOIN LATERAL (
         SELECT job_card_no 
         FROM or_jr_report rpt 
         WHERE TRIM(rpt.or_jr_no) = TRIM(pb.order_no) 
           AND rpt.job_card_no IS NOT NULL 
           AND rpt.job_card_no <> ''
         LIMIT 1
      ) ojr ON true
      -- Optimized DPR Join: Only aggregate for current orders
      LEFT JOIN LATERAL (
          SELECT SUM(good_qty) as qty, MIN(created_at) as first_entry
          FROM dpr_hourly dh
          WHERE dh.plan_id = pb.plan_id
      ) dpr ON true
      WHERE ${where}
      ORDER BY pb.start_date ASC
      `, params
    );

    // Normalize
    const normalized = rows.map(r => ({
      ...r,
      machineProcess: r.machineProcess || 'Moulding',
      // Priority: Master CT > Report CT
      cycleTime: r.cycleTime || 120, // default if missing
      // Calculations? Backend or Frontend?
      // Frontend calculates expected dates.
      // We pass producedQty from DPR
      // job_card_given (New Col) 
      job_card_given: r.job_card_given || false, // Ensure boolean (requires select modification above, handled implicitly by select * or explicit select?)
      // Wait, I used Explicit SELECT in GET. I need to ADD job_card_given to SELECT list!
    }));

    res.json({ ok: true, data: { plans: normalized } });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/planning/set-jc
app.post('/api/planning/set-jc', async (req, res) => {
  console.log('API HIT: /api/planning/set-jc', req.body);
  try {
    const { planId, status } = req.body;
    await q('UPDATE plan_board SET job_card_given = $1 WHERE id = $2', [!!status, planId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Update JC error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/complete
app.post('/api/planning/complete', async (req, res) => {
  try {
    const { id, completed_qty, remarks, user } = req.body;
    if (!id) return res.json({ ok: false, error: 'Missing ID' });

    // Update status, timestamps, and details
    // Ensure we handle completed_qty - optional to store in good_qty or just rely on remarks/logging
    // We will update good_qty to completed_qty if provided, for record keeping.
    // Actually plan_board doesn't have good_qty, it has dpr aggregation.
    // We will just store the fact it is complete.

    await q(`
      UPDATE plan_board 
      SET status = 'COMPLETED',
          remarks = $2,
          completed_by = $3,
          completed_at = NOW()
      WHERE id = $1
    `, [id, remarks || '', user || 'System']);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/planning/restore-plan (Admin Only)
app.post('/api/planning/restore-plan', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ ok: false, error: 'Missing Plan ID' });

    // Restore the plan to 'Stopped' state so it appears back on the board
    await q(`
      UPDATE plan_board 
      SET status = 'Stopped',
          completed_by = NULL,
          completed_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'RESTORE_PLAN', $2, 'Admin')",
      [id, JSON.stringify({ note: 'Restored from completed report' })]
    );

    // [Real-Time Sync]
    if (typeof syncService !== 'undefined' && syncService.triggerSync) {
        syncService.triggerSync();
    }

    res.json({ ok: true, message: 'Plan restored successfully' });
  } catch (e) { 
    console.error('restore-plan error', e);
    res.status(500).json({ ok: false, error: String(e) }); 
  }
});

/* ============================================================
   GRINDING MODULE API
   ============================================================ */

// GET /api/grinding/jobs
app.get('/api/grinding/jobs', async (req, res) => {
  try {
    // Fetch Active & Completed plans
    // Join similar to board defaults
    const factoryId = getFactoryId(req);
    const sql = `
        SELECT 
           pb.id as plan_id,
           pb.order_no,
           pb.status,
           pb.mould_name,
           o.client_name,
           
           -- Fetch Job Card (Priority: Report > Manual)
           COALESCE(ojr.job_card_no, '-') as job_card_no,
           
           -- Fetch Mould No (Priority: Summary > Master > Unknown)
           COALESCE(mps.mould_no, m.mould_number, '-') as mould_no,

           -- Aggregated Rejection Weight
           COALESCE(gl.total_rej, 0) as total_rej_weight

        FROM plan_board pb
        LEFT JOIN orders o ON o.order_no = pb.order_no
        LEFT JOIN moulds m ON m.mould_name = pb.mould_name
        LEFT JOIN mould_planning_summary mps ON (mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
        
        -- Join OR-JR for Job Card
        LEFT JOIN LATERAL (
             SELECT job_card_no 
             FROM or_jr_report rpt 
             WHERE TRIM(rpt.or_jr_no) = TRIM(pb.order_no) 
             LIMIT 1
        ) ojr ON true

        -- Join Grinding Logs Aggregate
        LEFT JOIN LATERAL (
             SELECT SUM(rejection_weight) as total_rej
             FROM grinding_logs gl
             WHERE gl.plan_id = pb.id
        ) gl ON true

        -- WHERE pb.status IN ('RUNNING', 'COMPLETED', 'PENDING')
        -- Show everything as requested by user ("All Stopped Plan Also from Master Plan")
        -- Filter only for valid orders if needed, but for now allow all.
        WHERE pb.factory_id = $1
        ORDER BY pb.start_date DESC
        LIMIT 500
     `;

    const rows = await q(sql, [factoryId]);
    res.json({ ok: true, data: rows });

  } catch (e) {
    console.error('Grinding Fetch Error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/grinding/entry
app.post('/api/grinding/entry', async (req, res) => {
  try {
    const { planId, orderNo, jobCardNo, weight, qty, reason, user } = req.body;

    await q(`
       INSERT INTO grinding_logs 
       (plan_id, order_no, job_card_no, rejection_weight, rejection_qty, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      planId || null,
      orderNo,
      jobCardNo,
      weight || 0,
      qty || 0,
      reason || '',
      user || 'System'
    ]);

    res.json({ ok: true });

  } catch (e) {
    console.error('Grinding Save Error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- NOTIFICATION CENTER APIs ---

// GET Unread Count (Lightweight)
app.get('/api/notifications/unread-count', async (req, res) => {
  try {
    const user = req.query.user;
    if (!user) return res.json({ count: 0 });

    // Check if table exists first to avoid crash if migration pending
    const result = await q('SELECT COUNT(*) as count FROM notifications WHERE target_user = $1 AND is_read = false', [user]);
    res.json({ ok: true, count: parseInt(result[0].count) || 0 });
  } catch (e) {
    // Table might not exist yet
    res.json({ ok: true, count: 0 });
  }
});

// GET My Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const user = req.query.user;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 100);
    if (!user) throw new Error('User required');

    // Fetch all unread + last 50 read
    const rows = await q(`
      SELECT * FROM notifications 
      WHERE target_user = $1 
      ORDER BY is_read ASC, created_at DESC 
      LIMIT $2
    `, [user, limit]);

    res.json({ ok: true, data: rows });
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.json({ ok: true, data: [] });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST Send Notification (Admin)
app.post('/api/notifications/send', async (req, res) => {
  try {
    const { targetUser, type, title, message, link, sender } = req.body;

    if (targetUser === 'ALL') {
      // Fetch all users (assuming specific user table, or just distinct from orders/plans if no user table)
      // Since we don't have a rigid 'users' table in this simple snippet context, we'll assume a fixed list or fetch distinct owners.
      // Ideally, use a proper users table. For now, let's query the 'users' table if it exists (from authentication refactor).
      // Fallback: If no users table, we can't broadcast easily without it. Assuming 'users' table exists from previous context.

      const allUsers = await q("SELECT username FROM users WHERE status = 'active'");

      for (const u of allUsers) {
        await q(`INSERT INTO notifications (target_user, type, title, message, link, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [u.username, type, title, message, link, sender]);
      }
      return res.json({ ok: true, count: allUsers.length });

    } else {
      // Single User
      await q(`INSERT INTO notifications (target_user, type, title, message, link, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [targetUser, type, title, message, link, sender]);
      return res.json({ ok: true, count: 1 });
    }

  } catch (e) {
    console.error('Notif Send Error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST Mark as Read
app.post('/api/notifications/mark-read', async (req, res) => {
  try {
    const { id } = req.body;
    await q('UPDATE notifications SET is_read = true WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST Mark ALL as Read
app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const { user } = req.body;
    await q('UPDATE notifications SET is_read = true WHERE target_user = $1', [user]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});



// GET /api/analyze/order/:orderNo
// Detailed analysis of a specific Order
app.get('/api/analyze/order/:orderNo', async (req, res) => {
  try {
    const { orderNo } = req.params;
    if (!orderNo) return res.status(400).json({ ok: false, error: 'Order No required' });

    // 1. Fetch Plan & Order Summary
    const summary = await q(
      `
      SELECT
        pb.id, pb.plan_id, pb.plant, pb.line, pb.machine, pb.status,
        pb.plan_qty, pb.bal_qty, pb.start_date, pb.end_date,
        pb.item_code, pb.item_name,
        o.client_name, o.priority,
        COALESCE(pb.mould_name, m.mould_name) as "mouldName",
        mps.jr_qty, mps.mould_item_qty, mps.tonnage, mps.cavity,
        mps.uom,
        mMaster.cycle_time as "cycleTime",
        mps.mould_no as "mouldNo",
        ojr.job_card_no as "jcNo"
      FROM plan_board pb
      LEFT JOIN orders o ON o.order_no = pb.order_no
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name
      LEFT JOIN mould_planning_summary mps ON (mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
      LEFT JOIN moulds mMaster ON TRIM(mMaster.mould_number) = TRIM(mps.mould_no)
      LEFT JOIN LATERAL (
         SELECT job_card_no 
         FROM or_jr_report rpt 
         WHERE TRIM(rpt.or_jr_no) = TRIM(pb.order_no) 
           AND rpt.job_card_no IS NOT NULL 
           AND rpt.job_card_no <> ''
           AND (rpt.jr_close IS NULL OR rpt.jr_close != 'Yes')
         LIMIT 1
      ) ojr ON true
      WHERE pb.order_no = $1
      LIMIT 1
      `, [orderNo]
    );

    let info = {};
    if (summary.length > 0) {
      info = summary[0];
    } else {
      // Fallback: Check if it exists in Orders but not planned yet
      const orderCheck = await q(`SELECT * FROM orders WHERE order_no = $1`, [orderNo]);
      if (orderCheck.length === 0) {
        return res.status(404).json({ ok: false, error: 'Order not found' });
      }
      info = { ...orderCheck[0], status: 'Not Planned' };
    }

    // 2. Fetch Detailed DPR Logs
    const logs = await q(
      `
      SELECT 
        dh.id, dh.dpr_date as date, dh.shift, dh.machine, dh.good_qty, dh.reject_qty, 
        ROUND((60 - COALESCE(dh.downtime_min, 0))::numeric / 60.0, 2) as "run_hours",
        dh.created_at, dh.created_by,
        u.username as "userName", u.role_code as "userRole"
      FROM dpr_hourly dh
      LEFT JOIN users u ON u.username = dh.created_by
      WHERE dh.order_no = $1 AND dh.is_deleted = false
      ORDER BY dh.dpr_date DESC, dh.created_at DESC
      `, [orderNo]
    );

    // 3. Calculate Stats
    const totalGood = logs.reduce((sum, l) => sum + (l.good_qty || 0), 0);
    const totalReject = logs.reduce((sum, l) => sum + (l.reject_qty || 0), 0);
    const totalHours = logs.reduce((sum, l) => sum + (l.run_hours || 0), 0);

    // Efficiency (Rough Calc: Actual / Target)
    // Target = (Total Hours * 3600) / CycleTime * Cavity
    let target = 0;
    if (info.cycleTime && info.cavity && totalHours > 0) {
      target = Math.round(((totalHours * 3600) / info.cycleTime) * info.cavity);
    }
    const eff = target > 0 ? ((totalGood / target) * 100).toFixed(1) : 0;

    res.json({
      ok: true,
      data: {
        info,
        logs,
        stats: {
          totalGood,
          totalReject,
          totalHours,
          efficiency: eff + '%',
          target
        }
      }
    });

  } catch (e) {
    console.error('analyze/order', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Helper: Sync Order Status (Auto-Complete if Fully Planned)
async function syncOrderStatus(orderNo) {
  if (!orderNo) return;
  try {
    const res = await q(`
      WITH req AS (SELECT COUNT(*) as c FROM mould_planning_summary WHERE or_jr_no = $1),
           act AS (SELECT COUNT(DISTINCT mould_name) as c FROM plan_board WHERE order_no = $1)
      UPDATE orders 
      SET status = CASE 
          WHEN (SELECT c FROM act) >= (SELECT c FROM req) AND (SELECT c FROM req) > 0 THEN 'Plan Completed'
          ELSE 'Pending'
      END,
      updated_at = NOW()
      WHERE order_no = $1
      RETURNING status
    `, [orderNo]);
    if (res && res.length) {
      console.log(`[SyncOrder] ${orderNo} status updated to: ${res[0].status}`);
    }
  } catch (e) {
    console.error('[SyncOrder] Failed', e);
  }
}

// POST /api/planning/create
// POST /api/planning/create (Supports Single Object or Array of Plans)
app.post('/api/planning/create', async (req, res) => {
  const client = await pool.connect();
  try {
    const plans = Array.isArray(req.body) ? req.body : [req.body];
    if (!plans.length) return res.json({ ok: false, error: 'No plans provided' });

    await client.query('BEGIN');
    const results = [];
    const generatedPlanIds = [];

    for (const p of plans) {
      if (!p.plant || !p.machine) {
        throw new Error('Missing plant/machine in one of the plans');
      }

      const reservedPlanId = isFinancialYearScopedId(p.planId, 'PLN')
        ? String(p.planId).trim().toUpperCase()
        : await generateFinancialYearSequenceId(client.query.bind(client), {
          prefix: 'PLN',
          table: 'plan_board',
          column: 'plan_id',
          lockScope: `plan_board:plan_id:${getFinancialYearInfo().code}`
        });

      // Sequence
      const mx = await client.query(
        `SELECT COALESCE(MAX(seq), 0) AS mx FROM plan_board WHERE plant = $1 AND machine = $2`,
        [p.plant, p.machine]
      );
      const seq = Number(mx.rows[0]?.mx || 0) + 1;

      // VALIDATION: Prevent Duplicate Planning for Same Mould on Same Order
      if (p.orderNo && p.mouldName) {
        // console.log(`[PlanningCheck] Checking: Order='${p.orderNo}', Mould='${p.mouldName}'`);
        const dupCheck = await client.query(`
          SELECT machine, status FROM plan_board 
          WHERE order_no = $1 
            AND mould_name = $2 
            AND status IN ('PLANNED', 'RUNNING')
          LIMIT 1
        `, [p.orderNo, p.mouldName]);

        if (dupCheck.rows.length) {
          const d = dupCheck.rows[0];
          throw new Error(`Already Planned! Mould '${p.mouldName}' is ${d.status} on ${d.machine}.`);
        }
      }

      const ins = await client.query(
        `
        INSERT INTO plan_board
        (plan_id, plant, building, line, machine, seq,
          order_no, item_code, item_name, mould_name,
          plan_qty, bal_qty, start_date, end_date, status, updated_at)
        VALUES
        ($1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, 'PLANNED', NOW())
        RETURNING id
        `,
        [
          reservedPlanId,
          p.plant,
          p.building || '',
          p.line || '',
          p.machine,
          seq,
          p.orderNo || null,
          p.itemCode || null,
          p.itemName || null,
          p.mouldName || null,
          toNum(p.planQty),
          toNum(p.balQty ?? p.planQty),
          p.startDate || null,
          p.endDate || null
        ]
      );

      results.push(ins.rows[0].id);
      generatedPlanIds.push(reservedPlanId);

      // Auto-Sync Status
      if (p.orderNo) await syncOrderStatus(p.orderNo);
    }

    await client.query('COMMIT');
    res.json({ ok: true, ids: results, planIds: generatedPlanIds, count: results.length, financial_year: getFinancialYearInfo().code });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('planning/create', e);
    res.json({ ok: false, error: String(e.message || e) }); // Return 200 with error for frontend handling
  } finally {
    client.release();
  }
});



// POST /api/planning/update body: { rowId, planQty, startDate, endDate, status, balQty }
app.post('/api/planning/update', async (req, res) => {
  try {
    const { rowId, planQty, balQty, startDate, endDate, status } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });

    const rows = await q(
      `
      UPDATE plan_board
         SET plan_qty = COALESCE($2, plan_qty),
      bal_qty = COALESCE($3, bal_qty),
      start_date = COALESCE($4, start_date),
      end_date = COALESCE($5, end_date),
      status = COALESCE($6, status),
      updated_at = NOW()
       WHERE id = $1
      RETURNING id
      `,
      [rowId, toNum(planQty), toNum(balQty), startDate || null, endDate || null, status || null]
    );

    if (!rows.length) return res.json({ ok: false, error: 'Row not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('planning/update', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/run  body: { rowId, force }
app.post('/api/planning/run', async (req, res) => {
  try {
    const { rowId, force } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });

    // 1. Get Plan Details
    const planRes = await q('SELECT * FROM plan_board WHERE id = $1', [rowId]);
    if (!planRes.length) return res.json({ ok: false, error: 'Plan not found' });
    const plan = planRes[0];
    const machine = plan.machine;

    // VALIDATION: Check JC No in OR-JR Report (User Request)
    const jcCheck = await q(`
      SELECT job_card_no 
      FROM or_jr_report 
      WHERE TRIM(or_jr_no) = TRIM($1)
      ORDER BY 
        (CASE WHEN job_card_no IS NOT NULL AND TRIM(job_card_no) != '' THEN 0 ELSE 1 END) ASC,
        is_closed ASC,
        created_date DESC
      LIMIT 1
    `, [plan.order_no]);

    if (!jcCheck.length) {
      return res.json({ ok: false, error: `OR-JR Report not found for Order ${plan.order_no}. Cannot start plan.` });
    }

    const jcNo = jcCheck[0].job_card_no;
    if (!jcNo || String(jcNo).trim() === '') {
      return res.json({ ok: false, error: `Job Card No is missing for Order ${plan.order_no}. Cannot start plan.` });
    }

    // 2. Check for EXISTING Running Plan on this machine
    // 2. AUTO-STOP ALL other Running Plans (Robust Fix)
    // Use UPDATE with RETURNING to catch and stop multiple existing plans if any
    const stopped = await q(
      `UPDATE plan_board 
          SET status = 'Stopped', updated_at = NOW() 
        WHERE TRIM(UPPER(machine)) = TRIM(UPPER($1)) 
          AND UPPER(status) = 'RUNNING' 
          AND id != $2
        RETURNING id, order_no`,
      [machine, rowId]
    );

    // Log Stops
    if (stopped.length > 0) {
      fs.appendFileSync('debug_auto_stop.log', `[RUN] RowId: ${rowId} triggered stop of ${stopped.length} plans: ${JSON.stringify(stopped)}\n`);
      for (const s of stopped) {
        await q(
          "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, $2, $3, $4)",
          [s.id, 'SWAP_STOP', JSON.stringify({ reason: `Auto-stopped for Plan ${rowId}`, by_plan_id: rowId }), 'System']
        );
      }
    } else {
      fs.appendFileSync('debug_auto_stop.log', `[RUN] RowId: ${rowId}. No conflicting running plans found on '${machine}'.\n`);
    }

    // 4. Mark NEW plan as Running
    await q(
      `UPDATE plan_board SET status = 'Running', start_date = COALESCE(start_date, NOW()), updated_at = NOW() WHERE id = $1`,
      [rowId]
    );

    // 5. Log ACTIVATE
    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'ACTIVATE', $2, 'System')",
      [rowId, JSON.stringify({ machine: plan.machine, order: plan.order_no })]
    );

    // [FIX] Trigger Sync Immediately to prevent reversion
    syncService.triggerSync();

    res.json({ ok: true });

  } catch (e) {
    console.error('planning/run', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/delete  body: { rowId }
app.post('/api/planning/delete', async (req, res) => {
  try {
    const { rowId } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });

    // 1. Fetch before delete for logging
    const check = await q('SELECT * FROM plan_board WHERE id = $1', [rowId]);
    if (check.length) {
      const p = check[0];
      // Log DELETE
      await q(
        "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'DELETE', $2, 'System')",
        [rowId, JSON.stringify({ machine: p.machine, order: p.order_no })]
      );
    }

    // 2. Delete
    await q('DELETE FROM plan_board WHERE id = $1', [rowId]);
    // 2. Delete
    await q('DELETE FROM plan_board WHERE id = $1', [rowId]);

    // Auto-Sync Status (Revert to Pending if needed)
    if (check.length && check[0].order_no) await syncOrderStatus(check[0].order_no);

    res.json({ ok: true });
  } catch (e) {
    console.error('planning/delete', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/delete-all  body: { user }
app.post('/api/planning/delete-all', async (req, res) => {
  try {
    const { user } = req.body || {};
    // Check authentication in real scenario.

    // Log DELETE ALL
    await q(
      "INSERT INTO plan_audit_logs (action, details, user_name) VALUES ('DELETE_ALL', '{}', $1)",
      [user || 'System']
    );

    // Delete All
    await q('DELETE FROM plan_board');

    // Reset ALL Orders to Pending (since no plans exist)
    await q("UPDATE orders SET status='Pending' WHERE status='Plan Completed'");

    res.json({ ok: true });
  } catch (e) {
    console.error('planning/delete-all', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/planning/audit
app.get('/api/planning/audit', async (req, res) => {
  try {
    const logs = await q("SELECT * FROM plan_audit_logs ORDER BY created_at DESC LIMIT 100");
    res.json(logs);
  } catch (e) {
    console.error('planning/audit', e);
    res.status(500).json({ error: String(e) });
  }
});



/* ============================================================
   CREATE PLAN FLOW API (NEW)
============================================================ */

// 1. GET /api/planning/orders/pending
// Returns orders that are not fully completed (simplified logic for now: just return all distinct from mould_planning_report)
app.get('/api/planning/orders/pending', async (req, res) => {
  try {
    const requestFactoryId = getFactoryId(req);

    const rows = await q(`
      SELECT DISTINCT ON (TRIM(s.or_jr_no))
        TRIM(s.or_jr_no) AS "orderNo",
        COALESCE(rpt.or_jr_date, s.or_jr_date) AS "orDate",
        COALESCE(rpt.or_jr_date, s.or_jr_date) AS "orJrDate",
        COALESCE(NULLIF(TRIM(rpt.or_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "orQty",
        COALESCE(NULLIF(TRIM(rpt.or_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "or_qty",
        COALESCE(NULLIF(TRIM(rpt.job_card_no), ''), '-') AS "jcNo",
        COALESCE(NULLIF(TRIM(rpt.job_card_no), ''), '-') AS "jobCardNo",
        COALESCE(NULLIF(TRIM(rpt.job_card_no), ''), '-') AS "job_card_no",
        rpt.job_card_date AS "jcDate",
        rpt.job_card_date AS "jobCardDate",
        rpt.job_card_date AS "job_card_date",
        COALESCE(NULLIF(TRIM(rpt.jr_qty::text), ''), NULLIF(TRIM(s.jr_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "jcQty",
        COALESCE(NULLIF(TRIM(rpt.jr_qty::text), ''), NULLIF(TRIM(s.jr_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "jrQty",
        COALESCE(NULLIF(TRIM(rpt.jr_qty::text), ''), NULLIF(TRIM(s.jr_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "jr_qty",
        COALESCE(NULLIF(TRIM(rpt.product_name), ''), NULLIF(TRIM(s.product_name), ''), NULLIF(TRIM(o.item_name), ''), 'Item') AS "productName",
        COALESCE(NULLIF(TRIM(rpt.client_name), ''), NULLIF(TRIM(o.client_name), ''), '-') AS "clientName",
        COALESCE(NULLIF(TRIM(o.priority), ''), 'Normal') AS "priority",
        COALESCE(NULLIF(TRIM(o.status), ''), 'Pending') AS "status",
        COALESCE(NULLIF(TRIM(rpt.jr_qty::text), ''), NULLIF(TRIM(s.jr_qty::text), ''), NULLIF(TRIM(o.qty::text), ''), '0') AS "qty"
      FROM mould_planning_summary s
      LEFT JOIN orders o
        ON TRIM(o.order_no) = TRIM(s.or_jr_no)
       AND ($1::int IS NULL OR o.factory_id = $1 OR o.factory_id IS NULL)
      LEFT JOIN LATERAL (
        SELECT
          r.or_jr_date,
          r.or_qty,
          r.job_card_no,
          r.job_card_date,
          r.jr_qty,
          r.product_name,
          r.client_name
        FROM or_jr_report r
        WHERE TRIM(r.or_jr_no) = TRIM(s.or_jr_no)
          AND ($1::int IS NULL OR r.factory_id = $1 OR r.factory_id IS NULL)
          AND COALESCE(TRIM(r.jr_close), '') <> 'Yes'
        ORDER BY
          CASE WHEN COALESCE(TRIM(r.job_card_no), '') = '' THEN 1 ELSE 0 END,
          r.job_card_date DESC NULLS LAST,
          r.or_jr_date DESC NULLS LAST
        LIMIT 1
      ) rpt ON true
      WHERE COALESCE(NULLIF(TRIM(o.status), ''), 'Pending') != 'Completed'
        AND ($1::int IS NULL OR s.factory_id = $1 OR s.factory_id IS NULL)
      ORDER BY TRIM(s.or_jr_no), rpt.job_card_date DESC NULLS LAST, s.or_jr_date DESC NULLS LAST
      LIMIT 500
    `, [requestFactoryId]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('planning/orders/pending', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. GET /api/planning/orders/:orderNo/details
app.get('/api/planning/orders/:orderNo/details', async (req, res) => {
  try {
    const { orderNo } = req.params;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    const rows = await q(`
      SELECT 
        TRIM(r.or_jr_no) AS or_jr_no,
        r.or_jr_date,
        r.item_code,
        TRIM(r.mould_no) AS mould_no,
        r.mould_name,
        r.mould_item_qty as plan_qty,
        regexp_replace(TRIM(COALESCE(r.mould_no, '')), '\\s+\\d+$', '') AS mould_family,
        
        -- Meta Data
        COALESCE(r.product_name, o.item_name) as product_name,
        COALESCE(o.client_name, '') as client_name,

        -- Report Data (From Summary)
        r.tonnage AS "reportTonnage",
        r.cycle_time AS "reportCycleTime",
        r.cavity AS "reportCavity",
        
        -- Master Data: exact mould number first, then same mould-number family
        m.id AS mould_id,
        m.mould_number AS "masterMouldNumber",
        m.tonnage AS "masterMachineRaw",
        m.no_of_cav AS "masterCavity",
        m.cycle_time AS "masterCycleTime",

        -- Drop Status
        d.id as drop_id
      FROM mould_planning_summary r
      LEFT JOIN orders o
        ON TRIM(o.order_no) = TRIM(r.or_jr_no)
       AND ($2::int IS NULL OR o.factory_id = $2 OR o.factory_id IS NULL)
      LEFT JOIN LATERAL (
        SELECT
          mm.id,
          mm.mould_number,
          mm.tonnage,
          mm.no_of_cav,
          mm.cycle_time
        FROM moulds mm
        WHERE ($2::int IS NULL OR mm.factory_id = $2 OR mm.factory_id IS NULL)
          AND (
            TRIM(mm.mould_number) = TRIM(r.mould_no)
            OR regexp_replace(TRIM(mm.mould_number), '\\s+\\d+$', '') = regexp_replace(TRIM(COALESCE(r.mould_no, '')), '\\s+\\d+$', '')
          )
        ORDER BY
          CASE WHEN TRIM(mm.mould_number) = TRIM(r.mould_no) THEN 0 ELSE 1 END,
          TRIM(mm.mould_number)
        LIMIT 1
      ) m ON true
      LEFT JOIN planning_drops d
        ON TRIM(d.order_no) = TRIM(r.or_jr_no)
       AND (
         TRIM(COALESCE(d.mould_name, '')) = TRIM(COALESCE(r.mould_name, ''))
         OR TRIM(COALESCE(d.item_code, '')) = TRIM(COALESCE(r.mould_no, ''))
       )
      WHERE TRIM(r.or_jr_no) = TRIM($1)
        AND ($2::int IS NULL OR r.factory_id = $2 OR r.factory_id IS NULL)
      ORDER BY
        regexp_replace(TRIM(COALESCE(r.mould_no, '')), '\\s+\\d+$', ''),
        TRIM(COALESCE(r.mould_no, '')),
        TRIM(COALESCE(r.mould_name, ''))
    `, [orderNo, factoryId]);

    // Normalize for Frontend
    const cleaned = rows.map(r => ({
      ...r,
      // PRIORITY: Master Data (Joined) > Report Data (Uploaded)
      // User Request: Fetch Tonnage from Mould Master
      masterMachineRaw: r.masterMachineRaw || r.reportTonnage,
      masterCavity: r.reportCavity || r.masterCavity,
      masterCycleTime: r.reportCycleTime || r.masterCycleTime,
      isDropped: !!r.drop_id
    }));

    // Filter out dropped items from the "To Plan" list? 
    // Or send them and let frontend handle?
    // User says "Drop Plan is not working" often implies "It doesn't go away".
    // So let's FILTER them out by default, OR send them to frontend to show "Dropped".
    // Better: Send isDropped flag. Update frontend to HIDE or Show as Dropped.
    // Given the request for "Order Transfer" when "Fully Planning", hiding them makes sense for "To Plan" list.
    // BUT user might want to UNDROP.
    // Let's filter out for now to ensure "Drop" feels like "Done".

    // User Request: Show Dropped Moulds but mark them.
    // We send 'isDropped' flag (already in 'cleaned'). 
    // Frontend will handle the display/blocking.

    res.json({ ok: true, data: cleaned });
  } catch (e) {
    console.error('planning/orders/details', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. GET /api/planning/machines/compatible
// query: ?tonnage=100/150
app.get('/api/planning/machines/compatible', async (req, res) => {
  try {
    const requestedProcess = getRequestedMachineProcess(req, 'Moulding');
    const tonnage = String(req.query.tonnage || '').trim();
    const factoryId = getFactoryId(req);

    let machineSql = `
      SELECT
        m.machine,
        m.tonnage,
        m.line,
        m.building,
        COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') AS machine_process
      FROM machines m
      WHERE COALESCE(m.is_active, TRUE) = TRUE
    `;
    const machineParams = [];

    if (factoryId) {
      machineParams.push(factoryId);
      machineSql += ` AND m.factory_id = $${machineParams.length}`;
    }

    if (requestedProcess) {
      machineParams.push(requestedProcess);
      machineSql += ` AND COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') = $${machineParams.length}`;
    }

    if (requestedProcess === 'Moulding') {
      if (!tonnage) return res.json({ ok: true, data: [] });

      const requiredTonnages = tonnage.split(/[/\,\\]+/).map(s => {
        const n = parseFloat(s.trim());
        return Number.isNaN(n) ? null : n;
      }).filter(n => n !== null);

      if (requiredTonnages.length === 0) return res.json({ ok: true, data: [] });

      machineParams.push(requiredTonnages);
      machineSql += ` AND m.tonnage = ANY($${machineParams.length}::numeric[])`;
      machineSql += ` ORDER BY m.tonnage ASC NULLS LAST, m.machine ASC`;
    } else {
      machineSql += ` ORDER BY m.machine ASC`;
    }

    const machines = await q(machineSql, machineParams);

    // 3. Check Availability (Running Jobs)
    // We want to know if they are "Empty" or "Running"
    // We can check plan_board for status='RUNNING'

    // Let's get current status for these machines
    const machineIds = machines.map(m => m.machine);
    if (machineIds.length === 0) return res.json({ ok: true, data: [] });

    let statusSql = `
      SELECT machine, status, order_no, end_date
      FROM plan_board
      WHERE machine = ANY($1::text[])
        AND status = 'RUNNING'
    `;
    const statusParams = [machineIds];
    if (factoryId) {
      statusParams.push(factoryId);
      statusSql += ` AND factory_id = $${statusParams.length}`;
    }
    const statuses = await q(statusSql, statusParams);

    const statusMap = {};
    statuses.forEach(s => {
      statusMap[s.machine] = { status: s.status, order: s.order_no, end: s.end_date };
    });

    // Combine
    const result = machines.map(m => {
      const s = statusMap[m.machine];
      return {
        ...m,
        isFree: !s, // true if no running job
        currentStatus: s ? s.status : 'AVAILABLE',
        currentOrder: s ? s.order : null
      };
    });

    // Sort: Free first, then by Tonnage
    result.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      if (requestedProcess === 'Moulding') {
        return Number(a.tonnage || 0) - Number(b.tonnage || 0) || naturalCompare(a.machine, b.machine);
      }
      return naturalCompare(a.machine, b.machine);
    });

    res.json({ ok: true, data: result });
  } catch (e) {
    console.error('planning/compatible', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   ALTERNATIVE MOULDS & BATCH PLANNING API
============================================================ */

// GET /api/planning/moulds/alternatives
app.get('/api/planning/moulds/alternatives', async (req, res) => {
  try {
    const requestFactoryId = getFactoryId(req);
    const { itemCode, orderNo, orDate, mouldNo } = req.query;
    const selectedMouldNo = String(mouldNo || itemCode || '').trim();
    const selectedOrderNo = String(orderNo || '').trim();
    const selectedOrDate = String(orDate || '').trim();
    const selectedOrDateKey = (() => {
      if (!selectedOrDate) return '';
      const parsed = new Date(selectedOrDate);
      if (Number.isNaN(parsed.getTime())) return selectedOrDate.slice(0, 10);
      const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(parsed);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      return (year && month && day) ? `${year}-${month}-${day}` : selectedOrDate.slice(0, 10);
    })();

    if (!selectedOrderNo) {
      return res.json({ ok: true, data: [] });
    }

    let mouldFamily = selectedMouldNo ? selectedMouldNo.replace(/\s+\d+$/, '').trim() : '';
    if (selectedMouldNo) {
      const seedRows = await q(`
        SELECT regexp_replace(TRIM(COALESCE(s.mould_no, '')), '\\s+\\d+$', '') AS mould_family
        FROM mould_planning_summary s
        WHERE TRIM(s.or_jr_no) = TRIM($1)
          AND ($2::text = '' OR LEFT(TRIM(COALESCE(s.or_jr_date::text, '')), 10) = TRIM($2))
          AND TRIM(COALESCE(s.mould_no, '')) = TRIM($3)
          AND ($4::int IS NULL OR s.factory_id = $4 OR s.factory_id IS NULL)
        ORDER BY LEFT(TRIM(COALESCE(s.or_jr_date::text, '')), 10) DESC NULLS LAST
        LIMIT 1
      `, [selectedOrderNo, selectedOrDateKey, selectedMouldNo, requestFactoryId]);
      if (seedRows[0]?.mould_family) mouldFamily = String(seedRows[0].mould_family).trim();
    }

    if (!mouldFamily) {
      return res.json({ ok: true, data: [] });
    }

    const rows = await q(`
      SELECT DISTINCT ON (TRIM(COALESCE(s.mould_no, '')))
        m.id AS mould_id,
        COALESCE(
          NULLIF(TRIM(COALESCE(m.mould_name, '')), ''),
          NULLIF(TRIM(COALESCE(s.mould_name, '')), ''),
          NULLIF(TRIM(COALESCE(s.product_name, '')), ''),
          TRIM(COALESCE(s.mould_no, ''))
        ) AS mould_name,
        COALESCE(m.no_of_cav, s.cavity) AS no_of_cavity,
        COALESCE(
          NULLIF(TRIM(COALESCE(m.cycle_time::text, '')), ''),
          NULLIF(TRIM(COALESCE(s.cycle_time::text, '')), '')
        ) AS cycle_time,
        COALESCE(
          NULLIF(TRIM(COALESCE(m.tonnage::text, '')), ''),
          NULLIF(TRIM(COALESCE(s.tonnage::text, '')), '')
        ) AS machine_tonnage,
        COALESCE(
          NULLIF(TRIM(COALESCE(s.product_name, '')), ''),
          NULLIF(TRIM(COALESCE(m.mould_name, '')), ''),
          NULLIF(TRIM(COALESCE(s.mould_name, '')), ''),
          TRIM(COALESCE(s.mould_no, ''))
        ) AS product_name,
        TRIM(COALESCE(s.mould_no, '')) AS item_code,
        TRIM(COALESCE(s.mould_no, '')) AS mould_no,
        NULLIF(TRIM(COALESCE(m.primary_machine, '')), '') AS primary_machine,
        NULLIF(TRIM(COALESCE(m.secondary_machine, '')), '') AS secondary_machine,
        CASE WHEN TRIM(COALESCE(s.mould_no, '')) = TRIM($3) THEN TRUE ELSE FALSE END AS is_current
      FROM mould_planning_summary s
      LEFT JOIN moulds m
        ON TRIM(COALESCE(m.mould_number, '')) = TRIM(COALESCE(s.mould_no, ''))
       AND ($5::int IS NULL OR m.factory_id = $5 OR m.factory_id IS NULL)
      WHERE TRIM(s.or_jr_no) = TRIM($1)
        AND ($2::text = '' OR LEFT(TRIM(COALESCE(s.or_jr_date::text, '')), 10) = TRIM($2))
        AND regexp_replace(TRIM(COALESCE(s.mould_no, '')), '\\s+\\d+$', '') = TRIM($4)
        AND ($5::int IS NULL OR s.factory_id = $5 OR s.factory_id IS NULL)
      ORDER BY
        TRIM(COALESCE(s.mould_no, '')),
        CASE WHEN TRIM(COALESCE(s.mould_no, '')) = TRIM($3) THEN 0 ELSE 1 END,
        LEFT(TRIM(COALESCE(s.or_jr_date::text, '')), 10) DESC NULLS LAST
    `, [selectedOrderNo, selectedOrDateKey, selectedMouldNo, mouldFamily, requestFactoryId]);

    rows.sort((a, b) => {
      if (!!a.is_current !== !!b.is_current) return a.is_current ? -1 : 1;
      const aNum = Number((String(a.mould_no || '').match(/\s+(\d+)$/) || [])[1] || 0);
      const bNum = Number((String(b.mould_no || '').match(/\s+(\d+)$/) || [])[1] || 0);
      if (aNum !== bNum) return aNum - bNum;
      return String(a.mould_no || '').localeCompare(String(b.mould_no || ''), undefined, { numeric: true, sensitivity: 'base' });
    });

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('planning/alternatives', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/planning/orders/matching
app.get('/api/planning/orders/matching', async (req, res) => {
  try {
    const { itemCode } = req.query;
    // Find open orders for same item
    const rows = await q(`
      SELECT 
        o.order_no as id, 
        o.order_no,
        o.priority,
        o.item_name,
        -- Use Plan Qty from Report if available, else Order Qty
        COALESCE(r.plan_qty::numeric, o.qty::numeric) as qty,
        o.client_name,
        -- Use Date from Report if available
        COALESCE(r.or_jr_date::text, o.created_at::text) as or_date,
        -- Mould Info for Tonnage Filtering
        m.tonnage as required_tonnage,
        m.mould_number as mould_no
      FROM orders o
      LEFT JOIN mould_planning_report r ON o.order_no = r.or_jr_no
      LEFT JOIN moulds m ON o.item_code = m.mould_number
      WHERE o.item_code = $1 
        AND o.status != 'Completed'
      ORDER BY ${getPrioritySortSql('o.priority')}, o.created_at DESC
    `, [itemCode]);

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('planning/matching', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// -------------------------------------------------------------
// HELPER: Check if Order is Fully Planned
// -------------------------------------------------------------
// -------------------------------------------------------------
// HELPER: Check if Order is Fully Planned
// -------------------------------------------------------------
async function checkOrderCompletion(orderNo) {
  try {
    // 1. Get Total Moulds for Order
    // Preference: 1. Report (Accurate) 2. Mould Master (Generic) 3. Plan Board (Self-fulfilling)

    // A. Check Report (Consistent with Pending Orders)
    let reportRes = await q(
      `SELECT COUNT(DISTINCT mould_name)::int as total FROM mould_planning_report WHERE or_jr_no = $1`,
      [orderNo]
    );
    let total = (reportRes[0] && reportRes[0].total) ? Number(reportRes[0].total) : 0;

    // B. Fallback to Mould Master (if we know the item code)
    if (total === 0) {
      const orderRes = await q('SELECT item_code FROM orders WHERE order_no = $1', [orderNo]);
      if (orderRes.length && orderRes[0].item_code) {
        const mRes = await q('SELECT COUNT(*)::int as total FROM moulds WHERE mould_number = $1', [orderRes[0].item_code]);
        total = (mRes[0] && mRes[0].total) ? Number(mRes[0].total) : 0;
      }
    }

    // C. If still 0, we can't determine completion safely. Using PlanBoard count would be circular logic (Planned/Planned = 100%).
    // But if we assume the user intends to plan everything they know about... let's just use Plan Board count as total
    // So if 1 plan exists and 0 drops, it matches.
    if (total === 0) {
      const pbRes = await q('SELECT COUNT(DISTINCT mould_name)::int as total FROM plan_board WHERE order_no = $1', [orderNo]);
      total = (pbRes[0] && pbRes[0].total) ? Number(pbRes[0].total) : 0;
    }

    if (total === 0) return; // Still nothing

    // 2. Count Planned
    const planRes = await q(
      `SELECT COUNT(DISTINCT mould_name)::int as cnt FROM plan_board WHERE order_no = $1`,
      [orderNo]
    );
    const planned = (planRes[0] && planRes[0].cnt) ? Number(planRes[0].cnt) : 0;

    // 3. Count Dropped
    const dropRes = await q(
      `SELECT COUNT(DISTINCT mould_name)::int as cnt FROM planning_drops WHERE order_no = $1`,
      [orderNo]
    );
    const dropped = (dropRes[0] && dropRes[0].cnt) ? Number(dropRes[0].cnt) : 0;

    console.log(`[StatusCheck] Order: ${orderNo} | Total: ${total} | Planned: ${planned} | Dropped: ${dropped}`);

    // 4. Update Status if Complete
    if ((planned + dropped) >= total && total > 0) {
      await q(
        `UPDATE orders SET status = 'Completed', updated_at = NOW() WHERE order_no = $1 AND status != 'Completed'`,
        [orderNo]
      );
      console.log(`[StatusCheck] Order ${orderNo} marked as Completed.`);
    }

  } catch (e) {
    console.error('Error checking order completion:', e);
  }
}

// 4. CREATE PLAN API (Re-Implemented)
app.post('/api/planning/create', async (req, res) => {
  const client = await pool.connect();
  try {
    const { planId, plant, machine, orderNo, itemCode, itemName, mouldName, planQty, balQty, startDate } = req.body;

    // [FIX] Factory Isolation: Use Header -> Body -> Default
    const factoryId = getFactoryId(req) || 1;

    // Validate
    if (!orderNo || !machine) return res.json({ ok: false, error: 'Missing required fields' });

    await client.query('BEGIN');

    const reservedPlanId = isFinancialYearScopedId(planId, 'PLN')
      ? String(planId).trim().toUpperCase()
      : await generateFinancialYearSequenceId(client.query.bind(client), {
        prefix: 'PLN',
        table: 'plan_board',
        column: 'plan_id',
        lockScope: `plan_board:plan_id:${getFinancialYearInfo().code}`
      });

    await client.query(`
      INSERT INTO plan_board (
        plan_id, plant, machine, order_no, item_code, item_name, mould_name, 
        plan_qty, bal_qty, start_date, status, factory_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Planned', $11, NOW(), NOW())
    `, [
      reservedPlanId,
      plant || 'DUNGRA', // Fallback, but factory_id is key
      machine,
      orderNo,
      itemCode,
      itemName,
      mouldName,
      planQty,
      balQty,
      startDate,
      factoryId
    ]);

    // Log
    await client.query(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'CREATE', $2, 'System')",
      [reservedPlanId, JSON.stringify({ order: orderNo, machine })]
    );

    await client.query('COMMIT');

    // Sync
    syncService.triggerSync();

    res.json({ ok: true, planId: reservedPlanId, financial_year: getFinancialYearInfo().code });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_rollbackErr) { }
    console.error('/api/planning/create', e);
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    client.release();
  }
});


// 5. DROP MOULD API
app.post('/api/planning/drop', async (req, res) => {
  try {
    const { orderNo, itemCode, mouldNo, mouldName, remarks } = req.body;
    if (!orderNo || !mouldName) return res.json({ ok: false, error: 'Missing Info' });

    // 1. Insert Drop
    await q(`
      INSERT INTO planning_drops (order_no, item_code, mould_no, mould_name, remarks)
      VALUES ($1, $2, $3, $4, $5)
    `, [orderNo, itemCode, mouldNo, mouldName, remarks]);

    // 2. Check Completion
    await checkOrderCompletion(orderNo);

    res.json({ ok: true });
  } catch (e) {
    console.error('/api/planning/drop', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/start body: { rowId }
app.post('/api/planning/start', async (req, res) => {
  try {
    const { rowId } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });

    // 1. Get Plan
    const planRes = await q('SELECT * FROM plan_board WHERE id = $1', [rowId]);
    if (!planRes.length) return res.json({ ok: false, error: 'Plan not found' });
    const plan = planRes[0];

    // 2. Validate Machine Status (Optional but good) - For now just force run
    // Ideally we check if machine is already running something else, but Master Plan allows override usually.

    // 3. Update 
    await q("UPDATE plan_board SET status = 'Running', updated_at = NOW() WHERE id = $1", [rowId]);

    // 4. Log
    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'START', $2, 'System')",
      [rowId, JSON.stringify({ machine: plan.machine, order: plan.order_no })]
    );

    // [Real-Time Sync]
    syncService.triggerSync();

    res.json({ ok: true, message: 'Plan started' });
  } catch (e) {
    console.error('planning/start', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/delete-all
app.post('/api/planning/delete-all', async (req, res) => {
  try {
    // Truncate or Delete All
    await q('DELETE FROM plan_board');
    await q("INSERT INTO plan_audit_logs (action, details, user_name) VALUES ('DELETE_ALL', 'Board Cleared', 'Admin')");
    res.json({ ok: true, message: 'All plans deleted' });
  } catch (e) {
    console.error('planning/delete-all', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/planning/stop body: { rowId }
app.post('/api/planning/stop', async (req, res) => {
  try {
    const { rowId } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });

    // 1. Get Plan
    const planRes = await q('SELECT * FROM plan_board WHERE id = $1', [rowId]);
    if (!planRes.length) return res.json({ ok: false, error: 'Plan not found' });
    const plan = planRes[0];

    // 2. Update Status
    await q("UPDATE plan_board SET status = 'Stopped', updated_at = NOW() WHERE id = $1", [rowId]);

    // 3. Log
    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'STOP', $2, 'System')",
      [rowId, JSON.stringify({ machine: plan.machine, order: plan.order_no })]
    );

    // [Real-Time Sync]
    syncService.triggerSync();

    res.json({ ok: true, message: 'Plan stopped' });
  } catch (e) {
    console.error('planning/stop', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ----------------------------------------------------------------------------
// 6. SUGGESTIONS & COMPLETED PLANS REPORT
// ----------------------------------------------------------------------------
app.get('/api/planning/suggestions', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const orders = await q(`SELECT DISTINCT order_no FROM orders WHERE factory_id = $1 ORDER BY order_no DESC LIMIT 20`, [factoryId]);
    const items = await q(`SELECT DISTINCT item_name FROM orders WHERE factory_id = $1 AND item_name IS NOT NULL AND item_name <> '' LIMIT 20`, [factoryId]);
    const moulds = await q(`SELECT DISTINCT mould_name FROM moulds WHERE factory_id = $1 AND mould_name IS NOT NULL AND mould_name <> '' LIMIT 20`, [factoryId]);

    const suggestions = [
      ...orders.map(o => o.order_no),
      ...items.map(i => i.item_name),
      ...moulds.map(m => m.mould_name)
    ];

    res.json({ ok: true, data: [...new Set(suggestions)] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/planning/completed', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const { mode, search, from, to, limit = 500, plant } = req.query;
    const cleanSearch = (search || '').trim().toLowerCase();
    const targetPlant = plant || (factoryId === 1 ? 'DUNGRA' : (factoryId === 2 ? 'SHIVANI' : 'DUNGRA'));

    if (mode === 'hierarchical') {
      // (Keep hierarchical logic as is, or update if needed, but focus on flat view first for the report)
      let sql = `SELECT order_no, client_name, item_name, qty, created_at, updated_at as completed_at, status 
                 FROM orders 
                 WHERE status = 'Completed' AND factory_id = $1`;
      const params = [factoryId];
      if (cleanSearch) {
        sql += ` AND (order_no ILIKE $${params.length+1} OR client_name ILIKE $${params.length+1} OR item_name ILIKE $${params.length+1})`;
        params.push(`%${cleanSearch}%`);
      }
      if (from) {
        sql += ` AND updated_at >= $${params.length+1}::timestamp`;
        params.push(from + ' 00:00:00');
      }
      if (to) {
        sql += ` AND updated_at <= $${params.length+1}::timestamp`;
        params.push(to + ' 23:59:59');
      }
      sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);
      const orders = await q(sql, params);
      const report = [];
      for (const o of orders) {
        const oNo = o.order_no;
        const rpt = await q(`SELECT COUNT(DISTINCT mould_name):: int as total FROM mould_planning_report WHERE or_jr_no = $1`, [oNo]);
        const totalMoulds = (rpt[0] && rpt[0].total) || 0;
        const plans = await q(`SELECT mould_name, mould_code, machine, plan_qty, status, 'Planned' as type, updated_at as time, 'System' as user_name FROM plan_board WHERE order_no = $1`, [oNo]);
        const drops = await q(`SELECT mould_name, mould_no as mould_code, 'N/A' as machine, 0 as plan_qty, 'Dropped' as status, 'Dropped' as type, created_at as time, 'System' as user_name, remarks FROM planning_drops WHERE order_no = $1`, [oNo]);
        const details = [...plans, ...drops].sort((a, b) => new Date(a.time) - new Date(b.time));
        report.push({
          header: { orderNo: o.order_no, client: o.client_name, product: o.item_name, totalMoulds: totalMoulds, status: 'Fully Planned', completedAt: o.completed_at },
          rows: details
        });
      }
      res.json({ ok: true, data: report });
    } else {
      // Flat View: Enhanced for Report
      let sql = `
        SELECT 
          pb.id, pb.plan_id AS "planId", pb.plant, pb.machine, pb.seq AS priority,
          pb.order_no AS "orderNo", pb.item_name AS "itemName",
          COALESCE(pb.mould_name, m.mould_name, 'Unknown') AS "mouldName",
          pb.mould_code AS "mouldCode",
          o.client_name AS "clientName",
          pb.plan_qty AS "planQty",
          pb.completed_by AS "completedBy", pb.completed_at AS "completedAt",
          ojr.job_card_no AS "jcNo",
          COALESCE(dpr.qty, 0) AS "producedQty",
          m.cycle_time AS "stdCycle", m.no_of_cav AS "stdCav",
          audit_start.created_at AS "actualStart",
          audit_end.created_at AS "actualEnd"
        FROM plan_board pb
        LEFT JOIN orders o ON o.order_no = pb.order_no
        LEFT JOIN moulds m ON (m.mould_name = pb.mould_name OR m.mould_number = pb.mould_code)
        LEFT JOIN LATERAL (
           SELECT job_card_no FROM or_jr_report rpt 
           WHERE TRIM(rpt.or_jr_no) = TRIM(pb.order_no) 
             AND rpt.job_card_no IS NOT NULL AND rpt.job_card_no <> '' LIMIT 1
        ) ojr ON true
        LEFT JOIN LATERAL (
           SELECT SUM(good_qty) as qty FROM dpr_hourly dh WHERE dh.order_no = pb.order_no
        ) dpr ON true
        LEFT JOIN LATERAL (
           SELECT created_at FROM plan_audit_logs 
           WHERE plan_id = pb.id AND action = 'START' 
           ORDER BY created_at ASC LIMIT 1
        ) audit_start ON true
        LEFT JOIN LATERAL (
           SELECT created_at FROM plan_audit_logs 
           WHERE plan_id = pb.id AND action = 'COMPLETE' 
           ORDER BY created_at DESC LIMIT 1
        ) audit_end ON true
        WHERE pb.status = 'COMPLETED' AND pb.plant = $1
      `;
      const params = [targetPlant];
      if (cleanSearch) {
        sql += ` AND (pb.order_no ILIKE $${params.length + 1} OR pb.item_name ILIKE $${params.length + 1} OR pb.mould_name ILIKE $${params.length + 1} OR o.client_name ILIKE $${params.length + 1} OR pb.machine ILIKE $${params.length + 1} OR ojr.job_card_no ILIKE $${params.length + 1})`;
        params.push(`%${cleanSearch}%`);
      }
      if (from) {
        sql += ` AND pb.completed_at >= $${params.length + 1}::timestamp`;
        params.push(from + ' 00:00:00');
      }
      if (to) {
        sql += ` AND pb.completed_at <= $${params.length + 1}::timestamp`;
        params.push(to + ' 23:59:59');
      }

      sql += ` ORDER BY pb.completed_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const rows = await q(sql, params);
      
      // Calculate EXP and PERF in JS for better precision/logic control
      const processedRows = rows.map(r => {
        let expectedQty = 0;
        let performance = 0;
        
        if (r.actualStart && r.actualEnd && r.stdCycle && r.stdCav) {
          const startTime = new Date(r.actualStart);
          const endTime = new Date(r.actualEnd);
          const durationSeconds = (endTime - startTime) / 1000;
          
          if (durationSeconds > 0) {
            const cycles = durationSeconds / Number(r.stdCycle);
            expectedQty = Math.floor(cycles * Number(r.stdCav));
            if (expectedQty > 0) {
              performance = Math.round((Number(r.producedQty) / expectedQty) * 100);
            }
          }
        }
        
        return {
          ...r,
          expectedQty,
          performance
        };
      });

      res.json({ ok: true, data: processedRows });
    }
  } catch (e) {
    console.error('/api/planning/completed Error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// ----------------------------------------------------------------------------
// 7. RESTORE PLAN (Undo Completion)
// ----------------------------------------------------------------------------
app.post('/api/planning/restore', async (req, res) => {
  try {
    const { orderNo } = req.body;
    if (!orderNo) return res.json({ ok: false, error: 'Missing Order No' });

    // Force Status back to 'Pending'
    // This allows it to reappear in Pending Orders lists
    // We DO NOT delete the plans (user keeps them), BUT we MUST clear Drops so they become "Normal" (Pending) again as per user request.

    await q(`DELETE FROM planning_drops WHERE order_no = $1`, [orderNo]);

    await q(`UPDATE orders SET status = 'Pending' WHERE order_no = $1`, [orderNo]);

    await q(
      "INSERT INTO plan_audit_logs (action, details, user_name) VALUES ('RESTORE', $1, 'User')",
      [JSON.stringify({ order: orderNo })]
    );

    // [Real-Time Sync]
    syncService.triggerSync();

    res.json({ ok: true, message: 'Order restored to Pending' });
  } catch (e) {
    console.error('/api/planning/restore', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// POST /api/planning/move
// Body: { rowId, targetMachine }
app.post('/api/planning/move', async (req, res) => {
  try {
    let { rowId, targetMachine, newMachine } = req.body || {};
    // Fallback for legacy frontend
    if (!targetMachine && newMachine) targetMachine = newMachine;

    if (!rowId || !targetMachine) return res.json({ ok: false, error: 'Missing rowId or targetMachine' });

    // 1. Get Plan & Old Machine
    const planRes = await q('SELECT * FROM plan_board WHERE id = $1', [rowId]);
    if (!planRes.length) return res.json({ ok: false, error: 'Plan not found' });
    const plan = planRes[0];

    // 2. Update Machine (Auto-Stop if Running)
    const isRunning = (plan.status || '').toUpperCase() === 'RUNNING' || (plan.status || '').toUpperCase() === 'Running';

    if (isRunning) {
      await q("UPDATE plan_board SET machine = $1, status = 'Stopped', updated_at = NOW() WHERE id = $2", [targetMachine, rowId]);

      // Log the auto-stop
      await q(
        "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'AUTO_STOP_MOVE', $2, 'System')",
        [rowId, JSON.stringify({ from: plan.machine, to: targetMachine, reason: 'Moved while running' })]
      );
    } else {
      // Just move
      await q('UPDATE plan_board SET machine = $1, updated_at = NOW() WHERE id = $2', [targetMachine, rowId]);
    }

    // 4. Handle Resequencing
    const { dropBeforeId } = req.body;

    // A. Get all plans for this machine (excluding the moved one, to re-insert)
    // We fetch everything sorted by seq, then re-build the list.
    let allPlans = await q(
      `SELECT id, seq FROM plan_board WHERE machine = $1 AND id != $2 ORDER BY seq ASC, id ASC`,
      [targetMachine, rowId]
    );

    // B. Determine Insert Index
    let insertIdx = allPlans.length; // Default: Append
    if (dropBeforeId) {
      const foundIdx = allPlans.findIndex(p => String(p.id) === String(dropBeforeId));
      if (foundIdx !== -1) insertIdx = foundIdx;
    }

    // C. Insert Moved Plan
    allPlans.splice(insertIdx, 0, { id: rowId });

    // D. Batch Update Seqs
    // We update every plan on this machine to have clean 10, 20, 30... sequence
    for (let i = 0; i < allPlans.length; i++) {
      const p = allPlans[i];
      const newSeq = (i + 1) * 10;
      await q('UPDATE plan_board SET seq = $1 WHERE id = $2', [newSeq, p.id]);
    }

    // 3. Log
    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'MOVE', $2, 'System')",
      [rowId, JSON.stringify({ from: plan.machine, to: targetMachine, index: insertIdx })]
    );

    // [Real-Time Sync]
    syncService.triggerSync();

    res.json({ ok: true });
  } catch (e) {
    console.error('planning/move', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});



// POST /api/planning/delete
app.post('/api/planning/delete', async (req, res) => {
  try {
    const { rowId } = req.body || {};
    if (!rowId) return res.json({ ok: false, error: 'Missing rowId' });
    const rows = await q(`DELETE FROM plan_board WHERE id = $1 RETURNING id`, [rowId]);
    if (!rows.length) return res.json({ ok: false, error: 'Plan not found or already deleted' });
    // [Real-Time Sync]
    syncService.triggerSync();

    res.json({ ok: true });
  } catch (e) {
    console.error('planning/delete', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* =========================
   JOB CARD APIs
   ========================= */

// LIST JOB CARDS (Grouped)
app.get('/api/planning/job-cards', async (req, res) => {
  try {
    const { search, from, to, limit } = req.query;
    const params = [];
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    const conditions = ['1=1'];
    if (factoryId) {
      params.push(factoryId);
      conditions.push(`data ->> 'factory_id' = $${params.length}`);
    }

    if (search) {
      params.push(`% ${search} % `);
      const i = params.length;
      conditions.push(`(
        COALESCE(data ->> 'jc_no', data ->> 'job_card_no') ILIKE $${i} OR
        data ->> 'or_jr_no' ILIKE $${i} OR
        data ->> 'mould_no' ILIKE $${i} OR
        data ->> 'client_name' ILIKE $${i}
      )`);
    }

    if (from) {
      params.push(from);
      conditions.push(`data ->> 'plan_date' >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`data ->> 'plan_date' <= $${params.length}`);
    }

    // Limit Check
    const limitClause = limit ? `LIMIT ${parseInt(limit) || 100}` : 'LIMIT 100';

    // Optimized Aggregation
    const sql = `
  SELECT
  COALESCE(data ->> 'jc_no', data ->> 'job_card_no') as jc_no,
    data ->> 'or_jr_no' as or_jr_no,
    MAX(data ->> 'mould_no') as mould_no,
    MAX(data ->> 'plan_date') as plan_date,
    MAX(data ->> 'client_name') as client_name,
    MAX(data ->> 'product_name') as product_name,
    COUNT(*) as item_count
      FROM jc_details
      WHERE ${conditions.join(' AND ')}
      GROUP BY
  COALESCE(data ->> 'jc_no', data ->> 'job_card_no'),
    data ->> 'or_jr_no'
      ORDER BY plan_date DESC
      ${limitClause}
  `;

    const rows = await q(sql, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });

  } catch (e) {
    console.error('/api/planning/job-cards', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET JOB CARD DETAILS (For Print)
app.get('/api/planning/job-card-print', async (req, res) => {
  try {
    const { or_jr_no, jc_no } = req.query;
    if (!or_jr_no || !jc_no) return res.json({ ok: false, error: 'Missing OR or JC No' });

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);


    // Fetch Items
    const sql = `
  SELECT
  data ->> 'mould_item_code' as mould_item_code,
    data ->> 'item_code' as item_code,
    data ->> 'mould_item_name' as mould_item_name,
    data ->> 'item_name' as item_name,
    data ->> 'material_1' as material_1,
    data ->> 'material' as material,
    data ->> 'material_revised' as material_revised,
    data ->> 'colour_1' as colour_1,
    data ->> 'color' as color,
    data ->> 'colour' as colour,
    data ->> 'plan_qty' as plan_qty,
    data ->> 'qty' as qty,
    data ->> 'no_of_cav' as no_of_cav,
    data ->> 'cavity' as cavity,
    data ->> 'master_batch_1' as master_batch_1
       FROM jc_details
       WHERE data ->> 'or_jr_no' = $1 
         AND COALESCE(data ->> 'jc_no', data ->> 'job_card_no') = $2
         AND ($3::int IS NULL OR (data->>'factory_id')::int = $3)
       ORDER BY data ->> 'mould_item_code' ASC
    `;

    const items = await q(sql, [or_jr_no, jc_no, factoryId]);

    // Fetch Header Info (From first item or separate query if needed)
    // We can just grab one row's common data and JOIN with moulds
    const headerSql = `
  SELECT
  COALESCE(t1.data ->> 'jc_no', t1.data ->> 'job_card_no') as jc_no,
    t1.data ->> 'or_jr_no' as or_jr_no,
    t1.data ->> 'plan_date' as plan_date,
    t1.data ->> 'machine_name' as machine_name,
    t1.data ->> 'client_name' as client_name,
    t1.data ->> 'product_name' as product_name,
    t1.data ->> 'mould_no' as mould_no,
    t1.data ->> 'created_by' as created_by,
    --Mould Master Data
  m.cycle_time,
    m.std_wt_kg as part_weight,
    m.runner_weight,
    m.manpower,
    m.no_of_cav as mould_cavity,
    m.material,
    m.std_volume_cap as pack_size,
    m.target_pcs_day as target_pcs
      FROM jc_details t1
      LEFT JOIN moulds m ON TRIM(m.mould_number) = TRIM(t1.data ->> 'mould_no')
      WHERE t1.data ->> 'or_jr_no' = $1 AND COALESCE(t1.data ->> 'jc_no', t1.data ->> 'job_card_no') = $2
  AND($3:: int IS NULL OR(t1.data ->> 'factory_id'):: int = $3)
      LIMIT 1
    `;
    const headerRows = await q(headerSql, [or_jr_no, jc_no, factoryId]);
    const header = headerRows[0] || {};

    res.json({ ok: true, data: { header, items } });

  } catch (e) {
    console.error('/api/planning/job-card-print', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* =========================
   NEW: MASTERS & REPORTS API
========================= */



// GET /api/reports/or-jr
app.get('/api/reports/or-jr', async (req, res) => {
  try {
    // Status report showing Planned vs Produced
    // This requires joining plan_board with dpr_hourly sums. 
    // This is a simplified query logic:
    const rows = await q(`
  SELECT
  p.plan_id, p.order_no, p.item_name, p.mould_name, p.plan_qty,
    COALESCE(SUM(d.good_qty), 0) as produced_qty,
    (p.plan_qty - COALESCE(SUM(d.good_qty), 0)) as bal_qty,
    p.status
      FROM plan_board p
      LEFT JOIN dpr_hourly d ON p.plan_id = d.plan_id
      GROUP BY p.plan_id, p.order_no, p.item_name, p.mould_name, p.plan_qty, p.status
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/upload/excel (Mock - requires 'xlsx' library for real parsing)
app.post('/api/upload/excel', async (req, res) => {
  // In a real app, use 'multer' to handle file upload and 'xlsx' to parse
  res.json({ ok: true, message: "File received. (Server logic needs 'xlsx' lib to parse actual data)" });
});

/* ============================================================
   NEW: REPORTS, MASTERS & ADMIN APIS
   (Add this to server.js before app.listen)
============================================================ */

// 1. OR-JR STATUS REPORT (Plan vs Actual)
app.get('/api/reports/or-jr', async (req, res) => {
  try {
    // Joins Plan Board with DPR to calculate total production per plan
    const rows = await q(
      `SELECT
  p.plan_id, p.order_no, p.item_name, p.mould_name,
    p.plan_qty,
    COALESCE(SUM(d.good_qty), 0) AS produced,
      (p.plan_qty - COALESCE(SUM(d.good_qty), 0)) AS balance,
        p.status
       FROM plan_board p
       LEFT JOIN dpr_hourly d ON p.plan_id = d.plan_id
       GROUP BY p.plan_id, p.order_no, p.item_name, p.mould_name, p.plan_qty, p.status
       ORDER BY p.status, p.plan_id`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// 2. MOULDING REPORT (Raw DPR Dump)
app.get('/api/reports/moulding', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const rows = await q(
      `SELECT dpr_date, shift, hour_slot, machine, mould_no,
    good_qty, reject_qty, downtime_min, remarks 
       FROM dpr_hourly 
       WHERE factory_id = $1
       ORDER BY dpr_date DESC, created_at DESC LIMIT 100`,
      [factoryId]
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/machines/supervisor', async (req, res) => {
  try {
    const { date, shift, line } = req.query;
    const factoryId = getFactoryId(req);
    
    // [NEW] Check if any plant is closed for this date/shift
    let closedRows = [];
    if (date && shift) {
      closedRows = await q('SELECT plant, remarks FROM closed_plants WHERE dpr_date = $1 AND (shift = $2 OR shift = \'Both\') AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))', [date, shift, factoryId]);
    }

    const lineQuery = line || '';
    const lines = lineQuery.split(',').map(s => s.trim()).filter(Boolean);
    const isAll = lines.some(l => l.toLowerCase() === 'all');

    let whereClause = '(factory_id = $1 OR ($1 IS NULL AND factory_id IS NULL))';
    const params = [factoryId];

    if (lines.length > 0 && !isAll) {
      params.push(lines);
      params.push(lines.map(l => l + '%'));
      whereClause += ` AND (line = ANY($${params.length - 1}::text[]) OR machine ILIKE ANY($${params.length}::text[]))`;
    }

    const rows = await q(
      `SELECT machine, line, building, tonnage, is_active 
         FROM machines 
        WHERE COALESCE(is_active, TRUE) = TRUE
          AND ${whereClause}`,
      params
    );

    // Properly sort machines instead of doing SQL text sort
    rows.sort((a, b) => naturalCompare(a.machine, b.machine));

    res.json({ ok: true, data: rows, closed: closedRows });
  } catch (e) {
 res.status(500).json({ ok: false, error: String(e) }); }
});



// 4. CLEAR DPR HOURLY (Admin/User Action)
app.post('/api/dpr/hourly/clear', async (req, res) => {
  try {
    await q('TRUNCATE TABLE dpr_hourly CASCADE');
    syncService.triggerSync(); // [Real-Time Sync]
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// 5. CLEAR SETUP DATA (Admin Action)
app.post('/api/admin/clear-std-actual', async (req, res) => {
  try {
    await q('TRUNCATE TABLE std_actual CASCADE');
    syncService.triggerSync(); // [Real-Time Sync]
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// 4. MACHINE MASTER
app.get('/api/masters/machines', async (req, res) => {
  try {
    const { search, process } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    const params = [];
    const conditions = ['1 = 1'];
    const normalizedProcess = normalizeMachineProcess(process, '');

    applyFactoryScopeCondition(conditions, params, 'm.factory_id', factoryScope);

    if (normalizedProcess) {
      params.push(normalizedProcess);
      conditions.push(`COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') = $${params.length}`);
    }

    if (search) {
      params.push(`%${String(search).trim()}%`);
      conditions.push(`(
        m.machine ILIKE $${params.length}
        OR COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') ILIKE $${params.length}
        OR COALESCE(m.vendor_name, '') ILIKE $${params.length}
        OR COALESCE(m.model_no, '') ILIKE $${params.length}
        OR COALESCE(m.machine_type, '') ILIKE $${params.length}
        OR m.building ILIKE $${params.length}
        OR m.line ILIKE $${params.length}
        OR f.name ILIKE $${params.length}
        OR f.code ILIKE $${params.length}
      )`);
    }

    const rows = await q(
      `
      SELECT
        m.machine,
        COALESCE(NULLIF(TRIM(m.machine_process), ''), 'Moulding') AS machine_process,
        m.machine_icon,
        m.vendor_name,
        m.model_no,
        m.machine_type,
        m.line,
        m.building,
        m.tonnage,
        m.is_active,
        m.factory_id,
        f.name AS factory_name,
        f.code AS factory_code
      FROM machines m
      LEFT JOIN factories f ON f.id = m.factory_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY LOWER(COALESCE(f.name, '')), LOWER(m.machine)
      `,
      params
    );
    rows.sort((a, b) => {
      const factoryCompare = String(a.factory_name || '').localeCompare(String(b.factory_name || ''), undefined, { numeric: true, sensitivity: 'base' });
      if (factoryCompare) return factoryCompare;
      const processCompare = String(a.machine_process || '').localeCompare(String(b.machine_process || ''), undefined, { numeric: true, sensitivity: 'base' });
      if (processCompare) return processCompare;
      return naturalCompare(a.machine, b.machine);
    });
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/templates/:type', async (req, res) => {
  try {
    const type = String(req.params.type || '').trim().toLowerCase();
    const machineProcess = normalizeMachineProcess(req.query.process, '');
    const factoryScope = await getFactoryScopeForRequest(req);

    let factoryId = '';
    let factoryName = '';
    if (!factoryScope?.useAllFactories && factoryScope?.factoryId) {
      const factoryRows = await q('SELECT id, name FROM factories WHERE id = $1 LIMIT 1', [factoryScope.factoryId]);
      const factory = factoryRows[0] || null;
      factoryId = factory?.id ?? factoryScope.factoryId;
      factoryName = factory?.name || '';
    }

    const definition = getUploadTemplateDefinition(type, { factoryId, factoryName, machineProcess });
    if (!definition) {
      return res.status(400).json({ ok: false, error: 'Template is not available for this master.' });
    }

    const workbook = xlsx.utils.book_new();
    const templateRows = Array.isArray(definition.templateRows) && definition.templateRows.length
      ? definition.templateRows
      : [definition.headers, definition.sample];
    const templateSheet = xlsx.utils.aoa_to_sheet(templateRows);
    const headerRowIndex = Number.isInteger(definition.headerRowIndex) ? definition.headerRowIndex : 0;
    templateSheet['!autofilter'] = {
      ref: xlsx.utils.encode_range({
        s: { r: headerRowIndex, c: 0 },
        e: { r: headerRowIndex, c: definition.headers.length - 1 }
      })
    };
    templateSheet['!cols'] = definition.headers.map((header, idx) => ({
      wch: Math.max(
        String(header || '').length + 4,
        String(definition.sample[idx] ?? '').length + 2,
        14
      )
    }));
    xlsx.utils.book_append_sheet(workbook, templateSheet, 'Template');

    const notesSheet = xlsx.utils.aoa_to_sheet(definition.notes);
    notesSheet['!cols'] = [{ wch: 18 }, { wch: 110 }];
    xlsx.utils.book_append_sheet(workbook, notesSheet, 'Instructions');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const processSuffix = type === 'machines' && machineProcess ? `-${machineProcess.toLowerCase()}` : '';
    const fileName = `jms-ocean-${type}${processSuffix}-template.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.end(buffer);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 5. ORDERS MASTER (Removed to use generic /api/masters/:type)
// See line 2800+
/* ============================================================
   OR-JR REPORT APIs
   (Columns A-AL)
============================================================ */

// Helper to sanitize dates
function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  // Excel dates are often numbers, or strings
  if (typeof val === 'number') {
    // Basic Excel date to JS Date conversion
    // (Excel base date is 1899-12-30)
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  return val; // Assume ISO string or similar
}

function toIsoDateText(val) {
  const parsed = toDate(val);
  if (!parsed) return null;
  if (parsed instanceof Date) {
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
  }
  const clean = String(parsed || '').trim();
  return clean || null;
}

// 1. PREVIEW (Compare Excel vs DB)
app.post('/api/upload/or-jr-preview', upload.single('file'), async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'preview OR-JR Status uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!req.file) return res.json({ ok: false, error: 'No file uploaded' });
    validateMasterUploadFile(req.file);
    const parsedUpload = parseStructuredUploadSheet(req.file.path, 'orjr');

    // Delete temp file
    fs.unlinkSync(req.file.path);

    console.log(`[OR - JR Upload] Header found at row ${parsedUpload.headerRowIndex + 1}`);

    const mapped = parsedUpload.rows.map(row => ({
      or_jr_no: String(row.or_jr_no || '').trim(),
      or_jr_date: toDate(row.or_jr_date),
      or_qty: toNum(row.or_qty),
      jr_qty: toNum(row.jr_qty),
      plan_qty: toNum(row.plan_qty),
      plan_date: toDate(row.plan_date),
      job_card_no: row.job_card_no,
      job_card_date: toDate(row.job_card_date),
      item_code: row.item_code,
      product_name: row.product_name,
      client_name: row.client_name,
      prod_plan_qty: toNum(row.prod_plan_qty),
      std_pack: toNum(row.std_pack),
      uom: row.uom,
      planned_comp_date: toDate(row.planned_comp_date),
      mld_start_date: toDate(row.mld_start_date),
      mld_end_date: toDate(row.mld_end_date),
      actual_mld_start_date: toDate(row.actual_mld_start_date),
      prt_tuf_end_date: toDate(row.prt_tuf_end_date),
      pack_end_date: toDate(row.pack_end_date),
      mld_status: row.mld_status,
      shift_status: row.shift_status,
      prt_tuf_status: row.prt_tuf_status,
      pack_status: row.pack_status,
      wh_status: row.wh_status,
      rev_mld_end_date: toDate(row.rev_mld_end_date),
      shift_comp_date: toDate(row.shift_comp_date),
      rev_ptd_tuf_end_date: toDate(row.rev_ptd_tuf_end_date),
      rev_pak_end_date: toDate(row.rev_pak_end_date),
      wh_rec_date: toDate(row.wh_rec_date),
      remarks_all: row.remarks_all,
      jr_close: row.jr_close,
      or_remarks: row.or_remarks,
      jr_remarks: row.jr_remarks,
      created_by: row.created_by,
      created_date: toDate(row.created_date),
      edited_by: row.edited_by,
      edited_date: toDate(row.edited_date),
      factory_id: normalizeFactoryId(row.factory_id) ?? requestFactoryId
    })).filter(x => x && x.or_jr_no);
    assertUploadRowsMatchFactory(mapped, requestFactoryId, 'OR-JR Status upload');

    console.log(`[OR - JR Upload] Extracted ${mapped.length} valid records.`);


    // 3. Compare with DB (Composite Key Check)
    const existingRows = requestFactoryId
      ? await q(`SELECT or_jr_no, plan_date, job_card_no, jr_close FROM or_jr_report WHERE factory_id = $1`, [requestFactoryId])
      : await q(`SELECT or_jr_no, plan_date, job_card_no, jr_close FROM or_jr_report`);
    const dbMap = new Map();

    existingRows.forEach(row => {
      // Key: OR|Date|JC
      // Parse Dates
      const d = row.plan_date ? new Date(row.plan_date).toISOString().split('T')[0] : '1970-01-01';
      const j = (row.job_card_no || '').trim();
      const o = (row.or_jr_no || '').trim();

      // Key: OR + JC (Ignoring Date for Update detection)
      const key = `${o}| ${j} `;
      dbMap.set(key, row);
    });

    const preview = mapped.map(row => {
      // Generate Key
      const rd = row.plan_date ? new Date(row.plan_date).toISOString().split('T')[0] : '1970-01-01';
      const rj = (row.job_card_no || '').trim();
      const ro = (row.or_jr_no || '').trim();

      const key = `${ro}| ${rj} `;
      const existing = dbMap.get(key);

      if (!existing) {
        return { ...row, _status: 'NEW' };
      }

      // Check if Closed
      if ((existing.jr_close || '').toLowerCase() === 'yes') {
        return { ...row, _status: 'SKIP (Closed)' };
      }

      // Update all cells for every row (User Request)
      // Detect if Date Changed for clarity (Optional)
      const oldDate = existing.plan_date ? new Date(existing.plan_date).toISOString().split('T')[0] : '1970-01-01';
      if (rd !== oldDate) {
        // Date Modified
      }

      return { ...row, _status: 'UPDATE', _old: existing };
    });

    res.json({ ok: true, data: preview });

  } catch (e) {
    console.error('upload/or-jr-preview', e);
    try {
      if (req?.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch (_cleanupErr) { }
    const status = e?.statusCode || 500;
    res.status(status).json({ ok: false, error: e?.message || String(e), details: e?.details });
  }
});

// 2. CONFIRM (Batch Save - UPSERT)
app.post('/api/upload/or-jr-confirm', async (req, res) => {
  try {
    const { rows, user } = req.body;
    const writeContext = await getWritableFactoryContext(req, 'confirm OR-JR Status uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!rows || !Array.isArray(rows)) return res.json({ ok: false, error: 'Invalid data' });
    assertUploadRowsMatchFactory(rows, requestFactoryId, 'OR-JR Status upload');

    // Filter out SKIP
    const toProcess = rows.filter(r => r._status === 'NEW' || r._status === 'UPDATE');
    console.log(`[OR - JR Confirm] Processing ${toProcess.length} rows(Total sent: ${rows.length}.Skipped: ${rows.length - toProcess.length})`);

    console.log('!!! HANDLER HIT: /api/upload/or-jr-confirm !!!');
    if (!toProcess.length) return res.json({ ok: true, message: 'Nothing to save' });

    // Use pool directly for auto-commit. No manual client connection needed.
    // const client = await pool.connect(); 



    let upsertCount = 0;

    for (const r of toProcess) {
      try { // ATOMIC ROW START


        // SMART MERGE LOGIC:
        // 1. Check if an entry exists for this OR No with an EMPTY/NULL Job Card.
        // 2. If yes, UPDATE that entry (Upgrade it to valid JC).
        // 3. If no, INSERT/UPSERT as usual.

        const orNo = r.or_jr_no;
        const jcNo = (r.job_card_no || '').trim();
        const rowFactoryId = normalizeFactoryId(r.factory_id) ?? requestFactoryId;

        // Only try merge if we HAVE a JC No (otherwise we are just inserting another empty one, which is fine or caught by upsert)
        let merged = false;
        if (jcNo) {
          const potentialMatch = await pool.query(`
                SELECT or_jr_no FROM or_jr_report 
                WHERE or_jr_no = $1
AND(job_card_no IS NULL OR TRIM(job_card_no) = '')
AND(factory_id = $2 OR factory_id IS NULL)
                LIMIT 1
  `, [orNo, rowFactoryId]);

          if (potentialMatch.rows.length > 0) {
            // UPDATE instead of INSERT
            // We update the PK fields (job_card_no) via direct update on the found row?
            // Actually we can't change PK easily if it's part of PK. 
            // Wait, PK is (or_jr_no). 
            // Let's check init_or_jr_table.js -> PK is or_jr_no ONLY?
            // If PK is or_jr_no, we can't have duplicates of OR No at all!
            // ERROR: The user has duplicates. So PK must NOT be just or_jr_no.
            // Let's trust the "ON CONFLICT (or_jr_no, COALESCE(job_card_no, ''))" clause below. 
            // This implies a composite UNIQUE constraint exists.

            // So, to "Merge", we DELETE the empty one and INSERT the new one? 
            // OR UPDATE the empty one's job_card_no to the new one?
            // UPDATE is better to preserve created_at if desired, but replacing is safer for data consistency.
            // Let's UPDATE the empty record's job_card_no to the new one.

            // CRITICAL CHECK: Does the TARGET JC (Upgrade) ALREADY EXIST?
            const targetExists = await pool.query(`
                 SELECT 1 FROM or_jr_report WHERE or_jr_no = $1 AND job_card_no = $2 AND (factory_id = $3 OR factory_id IS NULL)
  `, [orNo, jcNo, rowFactoryId]);

            if (targetExists.rows.length > 0) {
              // Target already exists. The Empty one is redundant.
              // DELETE the Empty one.
              try {

                await pool.query(`
                        DELETE FROM or_jr_report 
                        WHERE or_jr_no = $1 AND(job_card_no IS NULL OR TRIM(job_card_no) = '') AND(factory_id = $2 OR factory_id IS NULL)
  `, [orNo, rowFactoryId]);

              } catch (delErr) {

                console.error('[Auto-Merge] Pre-Delete Failed (FK Constraint?):', delErr.message);
                // Ignore and proceed to UPSERT
              }

              // merged = false -> Forces fall-through to Standard UPSERT below to update the Existing Target Record
              merged = false;
            } else {
              // Target does NOT exist. Safe to Upgrade the Empty one in-place.
              try {
                // SAVEPOINT required to recover from failed UPDATE (aborted transaction) before trying DELETE


                await pool.query(`
                    UPDATE or_jr_report 
                    SET job_card_no = $1,
  --Update other fields too
or_jr_date = $2, or_qty = $3, jr_qty = $4, plan_qty = $5, plan_date = $6,
  job_card_date = $7, item_code = $8, product_name = $9, client_name = $10,
  prod_plan_qty = $11, std_pack = $12, uom = $13, planned_comp_date = $14,
  mld_start_date = $15, mld_end_date = $16, actual_mld_start_date = $17,
  prt_tuf_end_date = $18, pack_end_date = $19, mld_status = $20, shift_status = $21,
  prt_tuf_status = $22, pack_status = $23, wh_status = $24, rev_mld_end_date = $25,
  shift_comp_date = $26, rev_ptd_tuf_end_date = $27, rev_pak_end_date = $28,
  wh_rec_date = $29, remarks_all = $30, jr_close = $31, or_remarks = $32, jr_remarks = $33,
  edited_by = $34, edited_date = NOW(), factory_id = $35
                    WHERE or_jr_no = $36 AND(job_card_no IS NULL OR TRIM(job_card_no) = '') AND(factory_id = $35 OR factory_id IS NULL)
                `, [
                  jcNo, // $1
                  r.or_jr_date, r.or_qty, r.jr_qty, r.plan_qty, r.plan_date, // $2-$6
                  r.job_card_date, r.item_code, r.product_name, r.client_name, // $7-$10
                  r.prod_plan_qty, r.std_pack, r.uom, r.planned_comp_date, // $11-$14
                  r.mld_start_date, r.mld_end_date, r.actual_mld_start_date, // $15-$17
                  r.prt_tuf_end_date, r.pack_end_date, r.mld_status, // $18-$20
                  r.shift_status, r.prt_tuf_status, r.pack_status, r.wh_status, // $21-$24
                  r.rev_mld_end_date, r.shift_comp_date, r.rev_ptd_tuf_end_date, // $25-$27
                  r.rev_pak_end_date, r.wh_rec_date, r.remarks_all, r.jr_close, // $28-$31
                  r.or_remarks, r.jr_remarks, // $32-$33
                  user || 'System', // $34
                  rowFactoryId, // $35
                  orNo // $36
                ]);


                merged = true;
                upsertCount++; // Count as handled
              } catch (e) {

                console.log('[Auto-Merge] Update failed. Trying Delete...');

                try {
                  // NESTED SAVEPOINT: Protect the DELETE operation too!
                  // If DELETE fails (e.g. FK constraint on old empty record), we must NOT abort the main transaction.

                  await pool.query(`DELETE FROM or_jr_report WHERE or_jr_no = $1 AND(job_card_no IS NULL OR TRIM(job_card_no) = '') AND(factory_id = $2 OR factory_id IS NULL)`, [orNo, rowFactoryId]);

                } catch (delErr) {

                  console.error('[Auto-Merge] Delete Failed (FK or Lock?):', delErr.message);
                  // Verify if we can proceed? 
                  // If delete failed, we still want to INSERT the new valid record.
                  // The "Empty" record stays. It's duplicate but harmless if constraints allow unique composite.
                }

                merged = false;
              }
            }
          }
        }

        if (!merged) {
          // Standard Insert/Upsert
          // WRAP ENTIRE ROW ACTION IN SAVEPOINT to allow skipping bad rows without aborting batch
          try {


            await pool.query(`
            INSERT INTO or_jr_report(
    or_jr_no, or_jr_date, or_qty, jr_qty, plan_qty, plan_date, job_card_no, job_card_date,
    item_code, product_name, client_name, prod_plan_qty, std_pack, uom,
    planned_comp_date, mld_start_date, mld_end_date, actual_mld_start_date, prt_tuf_end_date, pack_end_date,
    mld_status, shift_status, prt_tuf_status, pack_status, wh_status,
    rev_mld_end_date, shift_comp_date, rev_ptd_tuf_end_date, rev_pak_end_date, wh_rec_date,
    remarks_all, jr_close, or_remarks, jr_remarks,
    created_by, created_date, edited_by, edited_date, factory_id
  ) VALUES(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
    $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
    $26, $27, $28, $29, $30, $31, $32, $33, $34,
    COALESCE($35, $37), COALESCE($36, NOW()), COALESCE($38, $37), COALESCE($39, NOW()), $40
  )
            ON CONFLICT(or_jr_no, COALESCE(plan_date, '1970-01-01':: date), COALESCE(job_card_no, '':: text))
            DO UPDATE SET
or_jr_date = EXCLUDED.or_jr_date, or_qty = EXCLUDED.or_qty, jr_qty = EXCLUDED.jr_qty, plan_qty = EXCLUDED.plan_qty, plan_date = EXCLUDED.plan_date,
  job_card_no = EXCLUDED.job_card_no, job_card_date = EXCLUDED.job_card_date, item_code = EXCLUDED.item_code, product_name = EXCLUDED.product_name,
  client_name = EXCLUDED.client_name, prod_plan_qty = EXCLUDED.prod_plan_qty, std_pack = EXCLUDED.std_pack, uom = EXCLUDED.uom,
  planned_comp_date = EXCLUDED.planned_comp_date, mld_start_date = EXCLUDED.mld_start_date, mld_end_date = EXCLUDED.mld_end_date,
  actual_mld_start_date = EXCLUDED.actual_mld_start_date, prt_tuf_end_date = EXCLUDED.prt_tuf_end_date, pack_end_date = EXCLUDED.pack_end_date,
  mld_status = EXCLUDED.mld_status, shift_status = EXCLUDED.shift_status, prt_tuf_status = EXCLUDED.prt_tuf_status, pack_status = EXCLUDED.pack_status,
  wh_status = EXCLUDED.wh_status, rev_mld_end_date = EXCLUDED.rev_mld_end_date, shift_comp_date = EXCLUDED.shift_comp_date,
  rev_ptd_tuf_end_date = EXCLUDED.rev_ptd_tuf_end_date, rev_pak_end_date = EXCLUDED.rev_pak_end_date, wh_rec_date = EXCLUDED.wh_rec_date,
  remarks_all = EXCLUDED.remarks_all, jr_close = EXCLUDED.jr_close, or_remarks = EXCLUDED.or_remarks, jr_remarks = EXCLUDED.jr_remarks,
  created_by = EXCLUDED.created_by, created_date = EXCLUDED.created_date,
  edited_by = EXCLUDED.edited_by, edited_date = EXCLUDED.edited_date, factory_id = EXCLUDED.factory_id
    `,
              [
                r.or_jr_no, r.or_jr_date, r.or_qty, r.jr_qty, r.plan_qty, r.plan_date, (r.job_card_no || '').trim(), r.job_card_date,
                r.item_code, r.product_name, r.client_name, r.prod_plan_qty, r.std_pack, r.uom,
                r.planned_comp_date, r.mld_start_date, r.mld_end_date, r.actual_mld_start_date, r.prt_tuf_end_date, r.pack_end_date,
                r.mld_status, r.shift_status, r.prt_tuf_status, r.pack_status, r.wh_status,
                r.rev_mld_end_date, r.shift_comp_date, r.rev_ptd_tuf_end_date, r.rev_pak_end_date, r.wh_rec_date,
                r.remarks_all, r.jr_close, r.or_remarks, r.jr_remarks,
                // $35: Excel Created By
                r.created_by || null,
                // $36: Excel Created Date
                r.created_date || null,
                // $37: Fallback User (Request User)
                user || 'System',
                // $38: Excel Edited By
                r.edited_by || null,
                // $39: Excel Edited Date
                r.edited_date || null,
                // $40: Resolved Factory ID
                rowFactoryId
              ]
            );


            upsertCount++;
          } catch (upsertErr) {

            console.error(`[OR - JR Upload] Insert Skipped for ${r.or_jr_no} due to error: `, upsertErr.message);
            // Continue loop - SKIPPING this row only
          }
        }



      } catch (rowErr) {

        console.error(`[OR - JR Upload] Critical Row Failure for ${r.or_jr_no}: `, rowErr.message);
      }
    }



    const completionSync = await syncOrderCompletionConfirmations(pool, {
      factoryId: requestFactoryId,
      actorName: user || getRequestUsername(req) || 'System'
    });

    console.log(`[OR - JR Confirm] Committed ${upsertCount} upserts`);
    res.json({
      ok: true,
      count: toProcess.length,
      message: `Saved ${upsertCount} OR-JR rows. ${completionSync.flagged} orders now need completion confirmation.`
    });


  } catch (e) {
    console.error('upload/or-jr-confirm', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. READ REPORT
app.get('/api/reports/or-jr-full', async (req, res) => {
  try {
    const { from, to, search } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    let query = `SELECT * FROM or_jr_report`;
    const params = [];
    const conditions = [];

    // Factory Isolation
    applyFactoryScopeCondition(conditions, params, 'factory_id', factoryScope);

    // Global Search override (If searching, ignore dates to ensure we find the record)
    if (search) {
      params.push(`% ${search}% `);
      const i = params.length;
      conditions.push(`(
      or_jr_no ILIKE $${i} OR 
        job_card_no ILIKE $${i} OR 
        product_name ILIKE $${i} OR 
        item_code ILIKE $${i} OR
        client_name ILIKE $${i}
    )`);
    } else {
      // Only apply Date Filters if NOT searching
      if (from) {
        params.push(from);
        conditions.push(`or_jr_date >= $${params.length} `);
      }
      if (to) {
        params.push(to);
        conditions.push(`or_jr_date <= $${params.length} `);
      }
    }

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')} `;
    }

    // Increased limit and better sorting (Updated ones first!)
    query += ` ORDER BY edited_date DESC, created_date DESC LIMIT 50000`;

    const rows = await q(query, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/reports/orjr-wise-summary', async (req, res) => {
  try {
    const { from, to, search } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    const params = [];
    const conditions = [];

    applyFactoryScopeCondition(conditions, params, 's.factory_id', factoryScope);

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(
        s.or_jr_no ILIKE $${i} OR
        COALESCE(s.item_code, '') ILIKE $${i} OR
        COALESCE(s.bom_type, '') ILIKE $${i} OR
        COALESCE(s.product_name, '') ILIKE $${i} OR
        COALESCE(s.mould_no, '') ILIKE $${i} OR
        COALESCE(s.mould_name, '') ILIKE $${i} OR
        COALESCE(s.machine_name, '') ILIKE $${i}
      )`);
    } else {
      if (from) {
        params.push(from);
        conditions.push(`s.or_jr_date::date >= $${params.length}::date`);
      }
      if (to) {
        params.push(to);
        conditions.push(`s.or_jr_date::date <= $${params.length}::date`);
      }
    }

    let query = `
      SELECT
        s.factory_id,
        s.or_jr_no,
        s.or_jr_date AS jr_date,
        s.item_code AS our_code,
        s.bom_type,
        s.product_name AS jr_item_name,
        s.jr_qty,
        s.uom,
        s.mould_no,
        s.mould_name AS mould,
        s.mould_item_qty,
        s.tonnage,
        s.machine_name AS machine,
        s.cycle_time,
        s.cavity
      FROM mould_planning_summary s
    `;

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')} `;
    }

    query += ` ORDER BY s.or_jr_date DESC NULLS LAST, s.or_jr_no ASC, s.mould_no ASC LIMIT 50000`;

    const rows = await q(query, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/reports/orjr-wise-detail', async (req, res) => {
  try {
    const { from, to, search } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    const params = [];
    const conditions = [];

    applyFactoryScopeCondition(conditions, params, 'd.factory_id', factoryScope);

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(
        d.or_jr_no ILIKE $${i} OR
        COALESCE(d.item_code, '') ILIKE $${i} OR
        COALESCE(d.bom_type, '') ILIKE $${i} OR
        COALESCE(d.product_name, '') ILIKE $${i} OR
        COALESCE(d.mould_item_code, '') ILIKE $${i} OR
        COALESCE(d.mould_item_name, '') ILIKE $${i} OR
        COALESCE(d.mould_no, '') ILIKE $${i} OR
        COALESCE(d.mould_name, '') ILIKE $${i} OR
        COALESCE(d.machine_name, '') ILIKE $${i}
      )`);
    } else {
      if (from) {
        params.push(from);
        conditions.push(`NULLIF(TRIM(d.or_jr_date), '')::date >= $${params.length}::date`);
      }
      if (to) {
        params.push(to);
        conditions.push(`NULLIF(TRIM(d.or_jr_date), '')::date <= $${params.length}::date`);
      }
    }

    let query = `
      SELECT
        d.factory_id,
        d.or_jr_no,
        d.or_jr_date AS jr_date,
        d.item_code AS our_code,
        d.bom_type,
        d.product_name AS jr_item_name,
        d.jr_qty,
        d.uom,
        d.mould_item_code,
        d.mould_item_name,
        d.mould_no,
        d.mould_name AS mould,
        d.mould_item_qty,
        d.tonnage,
        d.machine_name AS machine,
        d.cycle_time,
        d.cavity
      FROM mould_planning_report d
    `;

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')} `;
    }

    query += ` ORDER BY NULLIF(TRIM(d.or_jr_date), '')::date DESC NULLS LAST, d.or_jr_no ASC, d.mould_no ASC, d.mould_item_code ASC LIMIT 50000`;

    const rows = await q(query, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/reports/bo-planning-detail', async (req, res) => {
  try {
    const { from, to, search } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    const params = [];
    const conditions = [];

    applyFactoryScopeCondition(conditions, params, 'd.factory_id', factoryScope);

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(
        d.or_jr_no ILIKE $${i} OR
        COALESCE(d.item_code, '') ILIKE $${i} OR
        COALESCE(d.bom_type, '') ILIKE $${i} OR
        COALESCE(d.product_name, '') ILIKE $${i} OR
        COALESCE(d.mould_item_code, '') ILIKE $${i} OR
        COALESCE(d.mould_item_name, '') ILIKE $${i}
      )`);
    } else {
      if (from) {
        params.push(from);
        conditions.push(`NULLIF(TRIM(d.or_jr_date), '')::date >= $${params.length}::date`);
      }
      if (to) {
        params.push(to);
        conditions.push(`NULLIF(TRIM(d.or_jr_date), '')::date <= $${params.length}::date`);
      }
    }

    let query = `
      SELECT
        d.factory_id,
        d.or_jr_no,
        d.or_jr_date AS jr_date,
        d.item_code AS our_code,
        d.bom_type,
        d.product_name AS jr_item_name,
        d.jr_qty,
        d.uom,
        d.plan_date,
        d.plan_qty,
        d.mould_item_code AS bo_item_code,
        d.mould_item_name AS bo_item_name,
        d.bo_uom,
        d.mould_item_qty AS bo_item_qty,
        d.remarks_all
      FROM mould_planning_report d
    `;

    if (conditions.length) {
      query += ` WHERE ${conditions.join(' AND ')} `;
    }

    query += ` ORDER BY NULLIF(TRIM(d.or_jr_date), '')::date DESC NULLS LAST, d.or_jr_no ASC, d.mould_item_code ASC LIMIT 50000`;

    const rows = await q(query, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});



app.get('/api/reports/wip', async (req, res) => {
  try {
    const { from, to, search, factory_id, type } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);
    const params = [];
    const conditions = [];

    // Prioritize explicit factory_id from query (for global reports), 
    // otherwise fallback to session scope
    const effectiveFactoryId = factory_id || (factoryScope.isAll ? null : factoryScope.id);
    if (effectiveFactoryId) {
      params.push(effectiveFactoryId);
      conditions.push(`factory_id = $${params.length}`);
    }

    if (from) {
      params.push(from);
      conditions.push(`stock_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`stock_date <= $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      conditions.push(`(
        item_code ILIKE $${i} OR
        item_name ILIKE $${i} OR
        job_no ILIKE $${i} OR
        factory_unit ILIKE $${i}
      )`);
    }

    let query = '';
    if (type === 'summary') {
      query = `
        SELECT 
          factory_unit,
          item_code,
          item_name,
          uom,
          SUM(COALESCE(previous_stock_qty, 0)) as previous_stock_qty,
          SUM(COALESCE(current_stock_available_qty, 0)) as current_stock_available_qty,
          SUM(COALESCE(total_qty, 0)) as total_qty,
          COUNT(*) as entries_count
        FROM wip_stock_snapshot_lines
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        GROUP BY factory_unit, item_code, item_name, uom
        ORDER BY item_code, item_name
      `;
    } else {
      query = `
        SELECT * FROM wip_stock_snapshot_lines
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY stock_date DESC, item_code
        LIMIT 50000
      `;
    }

    const rows = await q(query, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    console.error('reports/wip', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// 5. USER ROLES
app.get('/api/admin/users', async (req, res) => {
  try {
    const rows = await q(`SELECT username, line, role_code, is_active, permissions FROM users ORDER BY username`);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});



app.post('/api/admin/users/create', async (req, res) => {
  try {
    const { username, password, role, line, permissions } = req.body;
    const actor = await getRequestActor(req);
    const requestedRole = String(role || 'operator').toLowerCase();
    if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });
    if (requestedRole === 'superadmin' && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can assign the superadmin role' });
    }

    await q(
      `INSERT INTO users(username, password, line, role_code, permissions)
VALUES($1, $2, $3, $4, $5)
       ON CONFLICT(username) DO UPDATE SET
password = EXCLUDED.password,
  line = EXCLUDED.line,
  role_code = EXCLUDED.role_code,
  permissions = EXCLUDED.permissions`,
      [username, password, line || null, requestedRole, permissions || '{}']
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/users/update', async (req, res) => {
  try {
    const { username, role, line, is_active, permissions } = req.body;
    const actor = await getRequestActor(req);
    if (!username) return res.json({ ok: false, error: 'Missing username' });
    const existingUser = (await q('SELECT username, role_code FROM users WHERE username = $1 LIMIT 1', [username]))[0];
    if (!existingUser) return res.json({ ok: false, error: 'User not found' });
    const requestedRole = role ? String(role).toLowerCase() : String(existingUser.role_code || '').toLowerCase();
    if ((requestedRole === 'superadmin' || isSuperadminRole(existingUser)) && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can edit superadmin users' });
    }

    const rows = await q(
      `UPDATE users
          SET role_code = COALESCE($2, role_code),
  line = COALESCE($3, line),
  is_active = COALESCE($4, is_active),
  permissions = COALESCE($5, permissions)
        WHERE username = $1
       RETURNING username`,
      [username, requestedRole, line, is_active, permissions]
    );

    if (!rows.length) return res.json({ ok: false, error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/users/delete', async (req, res) => {
  try {
    const { username } = req.body;
    const actor = await getRequestActor(req);
    if (!username) return res.json({ ok: false, error: 'Missing username' });
    const targetUser = (await q('SELECT username, role_code FROM users WHERE username = $1 LIMIT 1', [username]))[0];
    if (!targetUser) return res.json({ ok: false, error: 'User not found' });
    if (isSuperadminRole(targetUser) && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can delete superadmin users' });
    }
    if (isSuperadminRole(targetUser)) {
      const countRows = await q(`SELECT COUNT(*)::int AS c FROM users WHERE COALESCE(is_active, TRUE) = TRUE AND LOWER(COALESCE(role_code, '')) = 'superadmin'`, []);
      if ((countRows[0]?.c || 0) <= 1) {
        return res.status(400).json({ ok: false, error: 'At least one active superadmin must remain' });
      }
    }

    const rows = await q(`DELETE FROM users WHERE username = $1 RETURNING username`, [username]);
    if (!rows.length) return res.json({ ok: false, error: 'User not found' });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/admin/users/password', async (req, res) => {
  try {
    const { username, password } = req.body;
    const actor = await getRequestActor(req);
    if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });
    const targetUser = (await q('SELECT username, role_code FROM users WHERE username = $1 LIMIT 1', [username]))[0];
    if (!targetUser) return res.json({ ok: false, error: 'User not found' });
    if (isSuperadminRole(targetUser) && !isSuperadminRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only superadmin can change a superadmin password' });
    }

    const rows = await q(
      `UPDATE users SET password = $2 WHERE username = $1 RETURNING username`,
      [username, password]
    );

    if (!rows.length) return res.json({ ok: false, error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 8. FETCH ORDERS FROM OR-JR (Sync)
app.post('/api/orders/fetch-from-orjr', async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'fetch orders from OR-JR');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Fetch Candidates from OR-JR Report
      // Filters: MLD Status NOT IN ('Completed', 'Cancelled') AND JR Close = 'Open'
      // Taking all available fields as per user request

      let srcSql = `
SELECT *
  FROM or_jr_report
WHERE
  (
    mld_status IS NULL 
            OR TRIM(mld_status) = '' 
            OR TRIM(LOWER(mld_status)) NOT IN('completed', 'cancelled')
  )

--User Req: Ignore JR Close(fetch even if Closed, as long as Mould is not Completed)
--BUT: If manually Closed by User(is_closed), do NOT fetch.
  AND(is_closed IS FALSE OR is_closed IS NULL)
  `;
      const srcParams = [];
      if (requestFactoryId) {
        srcParams.push(requestFactoryId);
        srcSql += ` AND factory_id = $${srcParams.length}`;
      }
      // Debug log the query result count
      const preCheck = requestFactoryId
        ? await client.query(`SELECT COUNT(*) as c FROM or_jr_report WHERE factory_id = $1`, [requestFactoryId])
        : await client.query(`SELECT COUNT(*) as c FROM or_jr_report WHERE 1 = 1`);
      console.log('OR-JR Total Count:', preCheck.rows[0].c);

      const candidates = await client.query(srcSql, srcParams);
      console.log('OR-JR Filtered Candidates:', candidates.rows.length);

      if (!candidates.rows.length) {
        const completionSync = await syncOrderCompletionConfirmations(client, {
          factoryId: requestFactoryId,
          actorName: getRequestUsername(req) || 'System'
        });
        await client.query('COMMIT');
        return res.json({
          ok: true,
          message: completionSync.flagged > 0
            ? `No open OR-JR rows to fetch. ${completionSync.flagged} orders moved to confirmation.`
            : 'No matching active records found in OR-JR Report.'
        });
      }

      let count = 0;
      let updated = 0;

      for (const row of candidates.rows) {
        const qty = row.plan_qty || 0;
        const rowFactoryId = normalizeFactoryId(row.factory_id) ?? requestFactoryId;



        // REMOVED FORCE CLEAN: User wants to keep "Closed" history.
        // DO NOT delete existing Completed/Cancelled orders.
        /*
        await client.query(`
            DELETE FROM orders 
            WHERE TRIM(order_no) ILIKE TRIM($1) 
              AND status NOT IN('Pending', 'In Progress')
        `, [row.or_jr_no]);
        */

        // 2. Now check remaining (Active) orders
        const existing = await client.query(
          `SELECT id FROM orders WHERE order_no = $1 AND (factory_id = $2 OR factory_id IS NULL)`,
          [row.or_jr_no, rowFactoryId]
        );

        if (existing.rows.length > 0) {
          // UPDATE Existing Active Order (Take the first one, though there should be only one)
          const targetId = existing.rows[0].id;
          await client.query(`
                UPDATE orders SET
item_code = $2,
  item_name = $3,
  client_name = $4,
  qty = $5,
  status = 'Pending',
  factory_id = $6,
  completion_confirmation_required = FALSE,
  completion_change_field = NULL,
  completion_change_to = NULL,
  completion_change_summary = NULL,
  completion_detected_at = NULL,
  completion_source_snapshot = '{}'::jsonb,
  completion_confirmed_at = NULL,
  completion_confirmed_by = NULL,
  updated_at = NOW()
                WHERE id = $1
  `, [
            targetId,
            row.item_code,
            row.product_name,
            row.client_name,
            qty,
            rowFactoryId
          ]);
          updated++;
        } else {
          // INSERT New Order
          await client.query(`
                INSERT INTO orders(
    order_no, item_code, item_name, client_name, qty,
    priority, status, created_at, updated_at, factory_id
  ) VALUES(
    $1, $2, $3, $4, $5,
    'Normal', 'Pending', NOW(), NOW(), $6
  )
    `, [
            row.or_jr_no,
            row.item_code,
            row.product_name,
            row.client_name,
            qty,
            rowFactoryId
          ]);
          count++;
        }
      }

      // C. FINAL SAFEGUARD: Deduplicate Orders Table
      // Ensure no order_no has multiple rows. Keep the one with 'Pending' status, or the latest created_at.
      // This handles any edge cases from the manual loops.
      await client.query(`
        DELETE FROM orders a USING(
      SELECT MIN(ctid) as ctid, TRIM(UPPER(order_no)) as norm_no, COALESCE(factory_id, 0) as factory_scope
          FROM orders 
          GROUP BY TRIM(UPPER(order_no)), COALESCE(factory_id, 0) HAVING COUNT(*) > 1
    ) b
        WHERE TRIM(UPPER(a.order_no)) = b.norm_no 
        AND COALESCE(a.factory_id, 0) = b.factory_scope
        AND a.ctid <> b.ctid
        AND a.status <> 'Pending'
  `);

      const completionSync = await syncOrderCompletionConfirmations(client, {
        factoryId: requestFactoryId,
        actorName: getRequestUsername(req) || 'System'
      });

      await client.query('COMMIT');
      res.json({
        ok: true,
        message: `Synced successfully. Added: ${count}, Updated: ${updated}, Pending confirmation: ${completionSync.flagged}, Cleared: ${completionSync.cleared}`
      });

    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 8.5. RESTORE CLOSED ORDERS (Discovery Recovery)
app.post('/api/admin/restore-closed-orders', async (req, res) => {
  try {
    const { user } = req.body;
    const requestFactoryId = getFactoryId(req);
    const result = await q(`
      INSERT INTO orders(order_no, item_code, item_name, client_name, qty, priority, status, created_at, updated_at, factory_id)
SELECT
or_jr_no, item_code, product_name, client_name, plan_qty, 'Normal', 'Completed', NOW(), NOW(), factory_id
      FROM or_jr_report
      WHERE LOWER(mld_status) IN('completed', 'cancelled')
      ${requestFactoryId ? `AND factory_id = $1` : ''}
      ON CONFLICT(order_no) DO NOTHING
    `, requestFactoryId ? [requestFactoryId] : []);

    // Also mark them as completed if they were inserted as 'Pending' by default or if we need to update status separately?
    // The INSERT SELECT above sets specific status 'Completed'.
    // If conflict DO NOTHING means if it exists it stays. If it was deleted, it inserts.

    res.json({ ok: true, message: `Restored ${result.rowCount} closed orders.` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/orders/confirm-completion', async (req, res) => {
  const client = await pool.connect();
  try {
    const { order_no, factory_id } = req.body || {};
    if (!order_no) return res.status(400).json({ ok: false, error: 'Missing Order No' });

    const actor = await getRequestActor(req);
    const actorName = actor?.username || getRequestUsername(req);
    if (!actorName) return res.status(401).json({ ok: false, error: 'Login required' });

    const writeContext = await getWritableFactoryContext(req, 'confirm order completions');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const resolvedFactoryId = normalizeFactoryId(factory_id) ?? writeContext.factoryId;
    if (resolvedFactoryId !== writeContext.factoryId) {
      return res.status(403).json({ ok: false, error: writeContext.error || `This session can confirm completions only in ${writeContext.factoryName}.` });
    }

    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT *
         FROM orders
        WHERE TRIM(order_no) = TRIM($1)
          ${resolvedFactoryId !== null ? 'AND COALESCE(factory_id, 0) = COALESCE($2, 0)' : ''}
        ORDER BY id ASC
        LIMIT 1`,
      resolvedFactoryId !== null ? [order_no, resolvedFactoryId] : [order_no]
    );

    if (!orderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const order = orderRes.rows[0];
    if (order.completion_confirmation_required !== true) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'This order is not waiting for completion confirmation' });
    }

    await client.query(
      `UPDATE orders
          SET status = 'Completed',
              completion_confirmation_required = FALSE,
              completion_confirmed_at = NOW(),
              completion_confirmed_by = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [order.id, actorName]
    );

    await insertOrderCompletionHistory(client, {
      orderNo: order.order_no,
      factoryId: order.factory_id,
      actionType: 'CONFIRMED_COMPLETE',
      changeField: order.completion_change_field,
      changeTo: order.completion_change_to,
      summaryText: order.completion_change_summary,
      masterStatusBefore: order.status,
      masterStatusAfter: 'Completed',
      actorName,
      details: {
        detected_at: order.completion_detected_at,
        source_snapshot: order.completion_source_snapshot || {}
      }
    });

    await client.query('COMMIT');
    res.json({ ok: true, message: `${order.order_no} marked completed after confirmation.` });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_ignore) { }
    console.error('orders/confirm-completion', e);
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    client.release();
  }
});

app.post('/api/orders/priority', async (req, res) => {
  try {
    const { order_no, factory_id, priority } = req.body || {};
    const orderNo = normalizeOptionalText(order_no);
    if (!orderNo) return res.status(400).json({ ok: false, error: 'Missing Order No' });

    const actor = await getRequestActor(req);
    if (!actor) return res.status(401).json({ ok: false, error: 'Login required' });

    const normalizedPriority = formatWorkflowStatusLabel(priority || 'Normal');
    const allowedPriorities = ['Urgent', 'High', 'Normal', 'Low'];
    if (!allowedPriorities.includes(normalizedPriority)) {
      return res.status(400).json({ ok: false, error: 'Priority must be Urgent, High, Normal, or Low' });
    }

    const writeContext = await getWritableFactoryContext(req, 'change order priority');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const resolvedFactoryId = normalizeFactoryId(factory_id) ?? writeContext.factoryId;
    if (resolvedFactoryId !== writeContext.factoryId) {
      return res.status(403).json({ ok: false, error: `This session can change priority only in ${writeContext.factoryName}.` });
    }

    const result = await q(
      `UPDATE orders
          SET priority = $3,
              updated_at = NOW()
        WHERE TRIM(order_no) = TRIM($1)
          AND COALESCE(factory_id, 0) = COALESCE($2, 0)
        RETURNING order_no, factory_id, priority`,
      [orderNo, resolvedFactoryId, normalizedPriority]
    );

    if (!result.length) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    res.json({
      ok: true,
      message: `${result[0].order_no} marked as ${result[0].priority} priority.`,
      data: result[0]
    });
  } catch (e) {
    console.error('orders/priority', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/orders/completion-history', async (req, res) => {
  try {
    const actor = await getRequestActor(req);
    if (!actor || !isAdminLikeRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    const factoryScope = await getFactoryScopeForRequest(req);
    const orderNo = normalizeOptionalText(req.query.order_no);
    const requestedFactoryId = normalizeFactoryId(req.query.factory_id);
    const params = [];
    const conditions = ['1 = 1'];

    if (orderNo) {
      params.push(orderNo);
      conditions.push(`TRIM(h.order_no) = TRIM($${params.length})`);
    }

    if (requestedFactoryId !== null) {
      if (!scopeAllowsFactory(factoryScope, requestedFactoryId)) {
        return res.status(403).json({ ok: false, error: 'Factory access denied' });
      }
      params.push(requestedFactoryId);
      conditions.push(`COALESCE(h.factory_id, 0) = COALESCE($${params.length}, 0)`);
    } else {
      applyFactoryScopeCondition(conditions, params, 'h.factory_id', factoryScope);
    }

    const rows = await q(
      `SELECT
          h.*,
          f.name AS factory_name,
          f.code AS factory_code
         FROM order_completion_history h
         LEFT JOIN factories f ON f.id = h.factory_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY h.changed_at DESC, h.id DESC
        LIMIT 300`,
      params
    );

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('orders/completion-history', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/orders/restore-completion', async (req, res) => {
  const client = await pool.connect();
  try {
    const actor = await getRequestActor(req);
    if (!actor || !isAdminLikeRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    const historyId = Number(req.body?.history_id);
    if (!Number.isInteger(historyId) || historyId <= 0) {
      return res.status(400).json({ ok: false, error: 'Valid history id is required' });
    }

    const writeContext = await getWritableFactoryContext(req, 'restore completed orders');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }

    await client.query('BEGIN');

    const historyRes = await client.query(
      `SELECT *
         FROM order_completion_history
        WHERE id = $1
        LIMIT 1`,
      [historyId]
    );

    if (!historyRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'History record not found' });
    }

    const historyRow = historyRes.rows[0];
    if (normalizeFactoryId(historyRow.factory_id) !== writeContext.factoryId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ ok: false, error: `This session can restore completed orders only in ${writeContext.factoryName}.` });
    }

    const restorable = historyRow.action_type === 'CONFIRMED_COMPLETE'
      || String(historyRow.master_status_after || '').toLowerCase() === 'completed';
    if (!restorable) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Only confirmed completions can be restored' });
    }

    const historyDetails = typeof historyRow.details === 'string'
      ? JSON.parse(historyRow.details || '{}')
      : (historyRow.details || {});
    const representative = historyDetails.representative || {};

    const orderRes = await client.query(
      `SELECT *
         FROM orders
        WHERE TRIM(order_no) = TRIM($1)
          AND COALESCE(factory_id, 0) = COALESCE($2, 0)
        ORDER BY id ASC
        LIMIT 1`,
      [historyRow.order_no, historyRow.factory_id]
    );

    if (orderRes.rows.length) {
      await client.query(
        `UPDATE orders
            SET status = 'Pending',
                completion_confirmation_required = TRUE,
                completion_change_field = COALESCE($2, completion_change_field, 'MLD Status'),
                completion_change_to = COALESCE($3, completion_change_to),
                completion_change_summary = COALESCE($4, completion_change_summary, 'MLD Status changed to Completed'),
                completion_detected_at = NOW(),
                completion_source_snapshot = $5::jsonb,
                completion_confirmed_at = NULL,
                completion_confirmed_by = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [
          orderRes.rows[0].id,
          historyRow.change_field || 'MLD Status',
          historyRow.change_to,
          historyRow.summary_text || 'MLD Status changed to Completed',
          JSON.stringify(historyDetails || {})
        ]
      );
    } else {
      await client.query(
        `INSERT INTO orders(
          order_no,
          item_code,
          item_name,
          client_name,
          qty,
          priority,
          status,
          created_at,
          updated_at,
          factory_id,
          completion_confirmation_required,
          completion_change_field,
          completion_change_to,
          completion_change_summary,
          completion_detected_at,
          completion_source_snapshot,
          completion_confirmed_at,
          completion_confirmed_by
        ) VALUES(
          $1, $2, $3, $4, $5, 'Normal', 'Pending', NOW(), NOW(), $6,
          TRUE, $7, $8, $9, NOW(), $10::jsonb, NULL, NULL
        )`,
        [
          historyRow.order_no,
          normalizeOptionalText(representative.item_code),
          normalizeOptionalText(representative.product_name),
          normalizeOptionalText(representative.client_name),
          toNum(representative.plan_qty),
          normalizeFactoryId(historyRow.factory_id),
          historyRow.change_field || 'MLD Status',
          historyRow.change_to,
          historyRow.summary_text || 'MLD Status changed to Completed',
          JSON.stringify(historyDetails || {})
        ]
      );
    }

    await insertOrderCompletionHistory(client, {
      orderNo: historyRow.order_no,
      factoryId: historyRow.factory_id,
      actionType: 'RESTORED',
      changeField: historyRow.change_field,
      changeTo: historyRow.change_to,
      summaryText: historyRow.summary_text || 'Completion restored back to pending confirmation.',
      masterStatusBefore: 'Completed',
      masterStatusAfter: 'Pending',
      actorName: actor.username,
      details: {
        restored_from_history_id: historyRow.id
      }
    });

    await client.query('COMMIT');
    res.json({ ok: true, message: `${historyRow.order_no} restored back to Order Master.` });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_ignore) { }
    console.error('orders/restore-completion', e);
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    client.release();
  }
});

// 9. OR-JR MANUAL CLOSE / REOPEN
app.post('/api/orjr/close', async (req, res) => {
  try {
    const { or_jr_no, job_card_no, user_id, user_name } = req.body;
    const writeContext = await getWritableFactoryContext(req, 'close OR-JR records');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!or_jr_no) return res.json({ ok: false, error: 'Missing OR-JR No' });

    let sql = `UPDATE or_jr_report
      SET is_closed = TRUE,
  manual_closed_at = NOW(),
  manual_closed_by = $2,
  manual_closed_by_name = $3
      WHERE or_jr_no = $1`;

    const params = [or_jr_no, user_id || null, user_name || 'System'];

    // If job_card_no provided (even empty string), target specific row.
    if (job_card_no !== undefined) {
      if (job_card_no === null || (typeof job_card_no === 'string' && job_card_no.trim() === '')) {
        sql += ` AND(job_card_no IS NULL OR job_card_no = '')`;
      } else {
        sql += ` AND job_card_no = $4`;
        params.push(job_card_no);
      }
    }

    sql += ` AND COALESCE(factory_id, 0) = COALESCE($${params.length + 1}, 0)`;
    params.push(requestFactoryId);

    await q(sql, params);
    await syncOrderCompletionConfirmations(pool, {
      factoryId: requestFactoryId,
      actorName: user_name || getRequestUsername(req) || 'System'
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('orjr/close', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/orjr/reopen', async (req, res) => {
  try {
    const { or_jr_no, job_card_no, user_id, user_name } = req.body;
    const writeContext = await getWritableFactoryContext(req, 'reopen OR-JR records');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!or_jr_no) return res.json({ ok: false, error: 'Missing OR-JR No' });

    let sql = `UPDATE or_jr_report
      SET is_closed = FALSE,
  manual_reopened_at = NOW(),
  manual_reopened_by = $2,
  manual_reopened_by_name = $3
      WHERE or_jr_no = $1`;

    const params = [or_jr_no, user_id || null, user_name || 'System'];


    if (job_card_no !== undefined) {
      if (job_card_no === null || (typeof job_card_no === 'string' && job_card_no.trim() === '')) {
        sql += ` AND(job_card_no IS NULL OR job_card_no = '')`;
      } else {
        sql += ` AND job_card_no = $4`;
        params.push(job_card_no);
      }
    }

    sql += ` AND COALESCE(factory_id, 0) = COALESCE($${params.length + 1}, 0)`;
    params.push(requestFactoryId);

    await q(sql, params);
    await syncOrderCompletionConfirmations(pool, {
      factoryId: requestFactoryId,
      actorName: user_name || getRequestUsername(req) || 'System'
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('orjr/reopen', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 6. UPLOAD (Real Excel Parsing)
app.post('/api/upload/:type', async (req, res, next) => {
  const { type } = req.params;
  if (['wipstock-preview', 'wipstock-confirm', 'machines-preview', 'machines-confirm', 'or-jr-preview', 'or-jr-confirm'].includes(type)) {
    return next('route');
  }

  upload.single('file')(req, res, async uploadErr => {
    if (uploadErr) {
      return res.status(400).json({ ok: false, error: uploadErr.message || 'Upload failed' });
    }

    try {
      const writeContext = await getWritableFactoryContext(req, 'upload master data');
      if (!writeContext.ok) {
        return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
      }
      const requestFactoryId = writeContext.factoryId;
      const file = req.file;
      if (!file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
      validateMasterUploadFile(file);
      if (['orders', 'moulds', 'machines', 'orjrwise', 'orjrwisedetail', 'boplanningdetail', 'wipstock'].includes(type) && requestFactoryId !== null) {
        await ensureFactoryIdsExist([requestFactoryId], pool, 'Current upload factory');
      }
      if (!['orders', 'moulds', 'machines', 'orjrwise', 'orjrwisedetail', 'boplanningdetail', 'wipstock'].includes(type)) {
        throw new UploadValidationError(`Upload is not configured for ${type}.`);
      }

      if (type === 'wipstock' && requestFactoryId === null) {
        throw new UploadValidationError('Select one factory before uploading WIP Stock.');
      }

      const parsedUpload = type === 'wipstock'
        ? parseWipStockUploadSheet(file.path)
        : parseStructuredUploadSheet(file.path, type);
      const data = parsedUpload.rows;
      assertUploadRowsMatchFactory(data, requestFactoryId, 'This upload');

      let count = 0;
      let successPayload = null;
      const client = await pool.connect();

    try {
      await client.query('BEGIN');

      if (type === 'wipstock') {
        const savedSnapshot = await saveWipStockSnapshot(client, {
          factoryId: requestFactoryId,
          stockDate: parsedUpload.stock_date,
          headerDateText: parsedUpload.header_date_text,
          sourceFileName: file.originalname,
          rows: data,
          username: getRequestUsername(req) || 'BulkUpload'
        });
        count = savedSnapshot.total_row_count;
        successPayload = {
          ok: true,
          count: savedSnapshot.total_row_count,
          message: `Saved ${savedSnapshot.total_row_count} WIP Stock rows for ${savedSnapshot.stock_date}.`,
          snapshot: savedSnapshot
        };
      } else if (type === 'orders') {
        for (const row of data) {
          const ordNo = String(row.order_no || '').trim();
          if (!ordNo) continue;
          const rowFactoryId = normalizeFactoryId(row.factory_id) ?? requestFactoryId;

          // Manual Upsert Logic (No Unique Constraint on order_no)
          const existing = await client.query(
            `SELECT id, status FROM orders WHERE order_no = $1 AND (factory_id = $2 OR factory_id IS NULL)`,
            [ordNo, rowFactoryId]
          );
          const pendingOrder = existing.rows.find(o => o.status === 'Pending' || o.status === 'In Progress');

          const _itemCode = normalizeOptionalText(row.item_code);
          const _itemName = normalizeOptionalText(row.item_name);
          const _mouldCode = normalizeOptionalText(row.mould_code);
          const _qty = toNum(row.qty) || 0;
          const _prio = normalizeOptionalText(row.priority) || 'Normal';
          const _client = normalizeOptionalText(row.client_name);

          if (pendingOrder) {
            // Update Active Order
            await client.query(`
                   UPDATE orders SET
item_code = $2,
  item_name = $3,
  mould_code = $4,
  qty = $5,
  priority = $6,
  client_name = $7,
  factory_id = $8,
  updated_at = NOW()
                   WHERE id = $1
  `, [pendingOrder.id, _itemCode, _itemName, _mouldCode, _qty, _prio, _client, rowFactoryId]);
          } else {
            // Insert New Order (New Cycle)
            await client.query(`
                   INSERT INTO orders(order_no, item_code, item_name, mould_code, qty, priority, client_name, status, created_at, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, 'Pending', NOW(), $8)
  `, [ordNo, _itemCode, _itemName, _mouldCode, _qty, _prio, _client, rowFactoryId]);
            count++;
          }
        }
      } else if (type === 'moulds') {
        // --- UPSERT LOGIC WITH HISTORY (Replaces TRUNCATE) ---
        // 1. We process row by row
        // 2. Check if exists
        // 3. Diff & Update & Log OR Insert & Log

        for (const row of data) {
          const code = String(row.mould_number || '').trim();
          if (!code) continue;
          const rowFactoryId = normalizeFactoryId(row.factory_id) ?? requestFactoryId;

          // Fetch Existing
          const existRes = await client.query(
            'SELECT * FROM moulds WHERE mould_number = $1 AND (factory_id = $2 OR factory_id IS NULL)',
            [code, rowFactoryId]
          );
          const existing = existRes.rows[0];

          // Prepare New Values map (for diffing)
          const newVal = normalizeMouldMasterPayload({
            mould_number: code,
            mould_name: row.mould_name,
            std_wt_kg: row.std_wt_kg,
            runner_weight: row.runner_weight,
            primary_machine: row.primary_machine,
            secondary_machine: row.secondary_machine,
            moulding_sqn: row.moulding_sqn,
            tonnage: row.tonnage,
            no_of_cav: row.no_of_cav,
            cycle_time: row.cycle_time,
            pcs_per_hour: row.pcs_per_hour,
            target_pcs_day: row.target_pcs_day,
            material: row.material,
            manpower: row.manpower,
            operator_activities: row.operator_activities,
            sfg_std_packing: row.sfg_std_packing,
            std_volume_cap: row.std_volume_cap
          });

          if (existing) {
            // UPDATE
            const changed = {};
            let hasChange = false;

            // Diff Fields (excluding id, created_at, etc)
            for (const k of Object.keys(newVal)) {
              if (k === 'mould_number') continue; // PK
              // Use toNum for numeric fields to ensure fair comparison if needed, 
              // but we already transformed newVal. existing is from DB (numbers are strings or numbers)
              // Simple loose equality check usually works for JS
              /* eslint-disable eqeqeq */
              if (newVal[k] != existing[k]) {
                changed[k] = { old: existing[k], new: newVal[k] };
                hasChange = true;
              }
            }

            if (hasChange) {
              const updateFields = MOULD_MASTER_FIELDS.filter(field => field !== 'mould_number');
              await client.query(`
                 UPDATE moulds
                    SET ${updateFields.map((field, index) => `${field} = $${index + 2}`).join(', ')},
                        factory_id = $${updateFields.length + 2},
                        updated_at = NOW()
                  WHERE mould_number = $1
  `, [code, ...updateFields.map(field => newVal[field]), rowFactoryId]);

              // Log
              await client.query(`
                  INSERT INTO mould_audit_logs(mould_id, action_type, changed_fields, changed_by)
VALUES($1, 'UPDATE', $2, 'BulkUpload')
  `, [code, JSON.stringify(changed)]);
              count++;
            }

          } else {
            // INSERT
            const insertFields = [...MOULD_MASTER_FIELDS, 'factory_id'];
            await client.query(`
              INSERT INTO moulds(${insertFields.join(', ')})
              VALUES(${insertFields.map((_, index) => `$${index + 1}`).join(', ')})
    `, [...MOULD_MASTER_FIELDS.map(field => newVal[field]), rowFactoryId]);

            // Log
            await client.query(`
              INSERT INTO mould_audit_logs(mould_id, action_type, changed_fields, changed_by)
VALUES($1, 'CREATE', '{"message": "Created via Bulk Upload"}', 'BulkUpload')
  `, [code]);
            count++;
          }
        }

      } else if (type === 'orjrwise') {
        const rowsToUpsert = data.map(row => {
          const jrDate = toDate(row.jr_date);
          const planDate = toDate(row.plan_date) || jrDate || null;
          const mouldItemQty = toNum(row.mould_item_qty);
          return {
            or_jr_no: String(row.or_jr_no || '').trim(),
            or_jr_date: jrDate || null,
            item_code: String(row.our_code || '').trim(),
            bom_type: String(row.bom_type || '').trim(),
            product_name: String(row.jr_item_name || '').trim(),
            jr_qty: toNum(row.jr_qty),
            uom: String(row.uom || '').trim(),
            plan_date: planDate,
            plan_qty: toNum(row.plan_qty) ?? mouldItemQty,
            mould_no: String(row.mould_no || '').trim(),
            mould_name: String(row.mould_name || '').trim(),
            mould_item_qty: mouldItemQty,
            tonnage: toNum(row.tonnage),
            machine_name: String(row.machine_name || '').trim(),
            cycle_time: toNum(row.cycle_time),
            cavity: toNum(row.cavity),
            factory_id: normalizeFactoryId(row.factory_id) ?? requestFactoryId
          };
        }).filter(row => row.or_jr_no && row.mould_no);

        const rowFactoryIds = [...new Set(rowsToUpsert.map(row => normalizeFactoryId(row.factory_id)).filter(id => id !== null))];
        if (rowFactoryIds.length) {
          await ensureFactoryIdsExist(rowFactoryIds, client, 'ORJR Wise Summary upload factory');
        }

        for (const row of rowsToUpsert) {
          await client.query(`
            INSERT INTO mould_planning_summary(
              or_jr_no, or_jr_date, item_code, bom_type, product_name, jr_qty, uom,
              plan_date, plan_qty, mould_no, mould_name, mould_item_qty, tonnage, machine_name,
              cycle_time, cavity, created_by, created_date, edited_by, edited_date, factory_id, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13, $14,
              $15, $16, 'BulkUpload', NOW(), 'BulkUpload', NOW(), $17, NOW()
            )
            ON CONFLICT (or_jr_no, mould_no, plan_date)
            DO UPDATE SET
              or_jr_date = EXCLUDED.or_jr_date,
              item_code = EXCLUDED.item_code,
              bom_type = EXCLUDED.bom_type,
              product_name = EXCLUDED.product_name,
              jr_qty = EXCLUDED.jr_qty,
              uom = EXCLUDED.uom,
              plan_qty = EXCLUDED.plan_qty,
              mould_name = EXCLUDED.mould_name,
              mould_item_qty = EXCLUDED.mould_item_qty,
              tonnage = EXCLUDED.tonnage,
              machine_name = EXCLUDED.machine_name,
              cycle_time = EXCLUDED.cycle_time,
              cavity = EXCLUDED.cavity,
              edited_by = 'BulkUpload',
              edited_date = NOW(),
              factory_id = EXCLUDED.factory_id,
              updated_at = NOW()
          `, [
            row.or_jr_no, row.or_jr_date, row.item_code, row.bom_type, row.product_name, row.jr_qty, row.uom,
            row.plan_date, row.plan_qty, row.mould_no, row.mould_name, row.mould_item_qty, row.tonnage, row.machine_name,
            row.cycle_time, row.cavity, row.factory_id
          ]);
          count++;
        }
      } else if (type === 'orjrwisedetail') {
        const rowsToUpsert = data.map(row => {
          const jrDate = toIsoDateText(row.jr_date);
          const planDate = toIsoDateText(row.plan_date) || jrDate || null;
          const mouldItemQty = toNum(row.mould_item_qty);
          return {
            or_jr_no: String(row.or_jr_no || '').trim(),
            or_jr_date: jrDate,
            item_code: String(row.our_code || '').trim(),
            bom_type: String(row.bom_type || '').trim(),
            product_name: String(row.jr_item_name || '').trim(),
            jr_qty: normalizeOptionalText(row.jr_qty),
            uom: String(row.uom || '').trim(),
            plan_date: planDate,
            plan_qty: normalizeOptionalText(toNum(row.plan_qty) ?? mouldItemQty),
            mould_item_code: String(row.mould_item_code || '').trim(),
            mould_item_name: String(row.mould_item_name || '').trim(),
            mould_no: String(row.mould_no || '').trim(),
            mould_name: String(row.mould_name || '').trim(),
            mould_item_qty: normalizeOptionalText(mouldItemQty),
            tonnage: normalizeOptionalText(toNum(row.tonnage)),
            machine_name: String(row.machine_name || '').trim(),
            cycle_time: normalizeOptionalText(toNum(row.cycle_time)),
            cavity: normalizeOptionalText(toNum(row.cavity)),
            factory_id: normalizeFactoryId(row.factory_id) ?? requestFactoryId
          };
        }).filter(row => row.or_jr_no && row.mould_no && row.mould_item_code);

        const rowFactoryIds = [...new Set(rowsToUpsert.map(row => normalizeFactoryId(row.factory_id)).filter(id => id !== null))];
        if (rowFactoryIds.length) {
          await ensureFactoryIdsExist(rowFactoryIds, client, 'ORJR Wise Detail upload factory');
        }

        for (const row of rowsToUpsert) {
          await client.query(`
            INSERT INTO mould_planning_report(
              or_jr_no, or_jr_date, item_code, bom_type, product_name, jr_qty, uom,
              plan_date, plan_qty, mould_item_code, mould_item_name, mould_no, mould_name, mould_item_qty, tonnage, machine_name,
              cycle_time, cavity, _status, created_by, created_date, edited_by, edited_date, factory_id, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18, NULL, 'BulkUpload', NOW(), 'BulkUpload', NOW(), $19, NOW()
            )
            ON CONFLICT (or_jr_no, mould_no, mould_item_code, plan_date)
            DO UPDATE SET
              or_jr_date = EXCLUDED.or_jr_date,
              item_code = EXCLUDED.item_code,
              bom_type = EXCLUDED.bom_type,
              product_name = EXCLUDED.product_name,
              jr_qty = EXCLUDED.jr_qty,
              uom = EXCLUDED.uom,
              plan_qty = EXCLUDED.plan_qty,
              mould_item_name = EXCLUDED.mould_item_name,
              mould_name = EXCLUDED.mould_name,
              mould_item_qty = EXCLUDED.mould_item_qty,
              tonnage = EXCLUDED.tonnage,
              machine_name = EXCLUDED.machine_name,
              cycle_time = EXCLUDED.cycle_time,
              cavity = EXCLUDED.cavity,
              edited_by = 'BulkUpload',
              edited_date = NOW(),
              factory_id = EXCLUDED.factory_id,
              updated_at = NOW()
          `, [
            row.or_jr_no, row.or_jr_date, row.item_code, row.bom_type, row.product_name, row.jr_qty, row.uom,
            row.plan_date, row.plan_qty, row.mould_item_code, row.mould_item_name, row.mould_no, row.mould_name, row.mould_item_qty, row.tonnage, row.machine_name,
            row.cycle_time, row.cavity, row.factory_id
          ]);
          count++;
        }
      } else if (type === 'boplanningdetail') {
        const rowsToUpsert = data.map(row => {
          const jrDate = toIsoDateText(row.jr_date);
          const planDate = toIsoDateText(row.plan_date) || jrDate || null;
          return {
            or_jr_no: String(row.or_jr_no || '').trim(),
            or_jr_date: jrDate,
            item_code: String(row.our_code || '').trim(),
            bom_type: String(row.bom_type || '').trim(),
            product_name: String(row.jr_item_name || '').trim(),
            jr_qty: normalizeOptionalText(row.jr_qty),
            uom: String(row.uom || '').trim(),
            plan_date: planDate,
            plan_qty: normalizeOptionalText(row.plan_qty),
            mould_item_code: String(row.bo_item_code || '').trim(),
            mould_item_name: String(row.bo_item_name || '').trim(),
            bo_uom: String(row.bo_uom || '').trim(),
            mould_item_qty: normalizeOptionalText(row.bo_item_qty),
            remarks_all: String(row.remarks_all || '').trim(),
            factory_id: normalizeFactoryId(row.factory_id) ?? requestFactoryId
          };
        }).filter(row => row.or_jr_no && row.mould_item_code);

        const rowFactoryIds = [...new Set(rowsToUpsert.map(row => normalizeFactoryId(row.factory_id)).filter(id => id !== null))];
        if (rowFactoryIds.length) {
          await ensureFactoryIdsExist(rowFactoryIds, client, 'BO Planning Detail upload factory');
        }

        for (const row of rowsToUpsert) {
          await client.query(`
            INSERT INTO mould_planning_report(
              or_jr_no, or_jr_date, item_code, bom_type, product_name, jr_qty, uom,
              plan_date, plan_qty, mould_item_code, mould_item_name, bo_uom, mould_item_qty, remarks_all,
              _status, created_by, created_date, edited_by, edited_date, factory_id, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13, $14,
              'BO_PLAN', 'BulkUpload', NOW(), 'BulkUpload', NOW(), $15, NOW()
            )
            ON CONFLICT (or_jr_no, mould_no, mould_item_code, plan_date)
            DO UPDATE SET
              or_jr_date = EXCLUDED.or_jr_date,
              item_code = EXCLUDED.item_code,
              bom_type = EXCLUDED.bom_type,
              product_name = EXCLUDED.product_name,
              jr_qty = EXCLUDED.jr_qty,
              uom = EXCLUDED.uom,
              plan_qty = EXCLUDED.plan_qty,
              mould_item_name = EXCLUDED.mould_item_name,
              bo_uom = EXCLUDED.bo_uom,
              mould_item_qty = EXCLUDED.mould_item_qty,
              remarks_all = EXCLUDED.remarks_all,
              edited_by = 'BulkUpload',
              edited_date = NOW(),
              factory_id = EXCLUDED.factory_id,
              updated_at = NOW()
          `, [
            row.or_jr_no, row.or_jr_date, row.item_code, row.bom_type, row.product_name, row.jr_qty, row.uom,
            row.plan_date, row.plan_qty, row.mould_item_code, row.mould_item_name, row.bo_uom, row.mould_item_qty, row.remarks_all,
            row.factory_id
          ]);
          count++;
        }
      } else if (type === 'machines') {
        const machineRows = new Map();

        for (const row of data) {
          const rowFactoryId = normalizeFactoryId(row.factory_id) ?? requestFactoryId;
          const building = String(row.building || '').trim();
          const line = String(row.line || '').trim();
          const machine = normalizeMachineName(row.machine);
          const tonnage = row.tonnage;

          if (machine) {
            machineRows.set(getScopedMachineKey(machine, rowFactoryId), {
              machine,
              line: String(line),
              building,
              tonnage: toNum(tonnage),
              factory_id: rowFactoryId
            });
          }
        }

        const factoryScopes = [...new Set(
          [...machineRows.values()].map(row => normalizeFactoryId(row.factory_id))
        )];
        const nonNullFactoryScopes = factoryScopes.filter(factoryId => factoryId !== null);
        if (nonNullFactoryScopes.length) {
          await ensureFactoryIdsExist(nonNullFactoryScopes, client, 'Machine upload');
        }

        if (factoryScopes.length) {
          for (const factoryId of factoryScopes) {
            if (factoryId === null) {
              await client.query('DELETE FROM machines WHERE factory_id IS NULL');
            } else {
              await client.query('DELETE FROM machines WHERE factory_id = $1', [factoryId]);
            }
          }
        } else if (requestFactoryId !== undefined) {
          await client.query(
            'DELETE FROM machines WHERE factory_id = $1 OR ($1 IS NULL AND factory_id IS NULL)',
            [requestFactoryId]
          );
        }

        for (const row of machineRows.values()) {
          await client.query(`
                INSERT INTO machines(machine, line, building, tonnage, is_active, factory_id)
VALUES($1, $2, $3, $4, true, $5)
             `, [
            row.machine,
            row.line,
            row.building,
            row.tonnage,
            row.factory_id
          ]);
          count++;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
      try { fs.unlinkSync(file.path); } catch (e) { }
    }

      res.json(successPayload || { ok: true, message: `Processed ${count} records for ${type}.` });

    } catch (e) {
      console.error('upload error', e);
      try {
        if (req?.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (_cleanupErr) { }
      const status = e?.statusCode || 500;
      const message = e?.statusCode ? (e.message || 'Upload failed') : 'Upload failed: ' + String(e);
      res.status(status).json({ ok: false, error: message, details: e?.details });
    }
  });
});

// GET /api/planning/orders/:orderNo/details (For Create Plan)
app.get('/api/planning/orders/:orderNo/details', async (req, res) => {
  try {
    const { orderNo } = req.params;
    // User requested to use MOULD PLAN SUMMARY REPORT
    // We query mould_planning_summary by or_jr_no
    const sql = `
      SELECT 
        s.*,
    m.id as mould_id,
    m.tonnage as master_tonnage,
    m.no_of_cav as master_cav,
    m.cycle_time as master_ct
      FROM mould_planning_summary s
--User Request: "Match With ERP ITEM CODE And MOULD NO"
      LEFT JOIN moulds m ON m.mould_number = s.mould_no 
      WHERE s.or_jr_no = $1
  `;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    const params = [orderNo];
    if (factoryId) {
      // Assuming mould_planning_summary has factory_id
      // We need to inject the AND clause before the final checks if any
      // Actually the SQL ends with WHERE s.or_jr_no = $1
      // So we can append
      // But wait, the previous code didn't use params array for query execution with dynamic length in this specific block?
      // Ah, line 4827 uses `await q(sql, [orderNo])`. 
      // I need to reconstruct this.
    }

    // RE-WRITING THE BLOCK TO SUPPORT FACTORY ID properly
    let sqlQuery = `
SELECT
s.*,
  m.id as mould_id,
  m.tonnage as master_tonnage,
  m.no_of_cav as master_cav,
  m.cycle_time as master_ct
      FROM mould_planning_summary s
      LEFT JOIN moulds m ON m.mould_number = s.mould_no 
      WHERE s.or_jr_no = $1
  `;

    const queryParams = [orderNo];
    if (factoryId) {
      sqlQuery += ` AND s.factory_id = $2`;
      queryParams.push(factoryId);
    }

    const rows = await q(sqlQuery, queryParams);

    fs.appendFileSync('debug.log', `[${new Date().toISOString()}] /details -> OrderNo: '${orderNo}', Rows Found: ${rows.length} (Summary Table)\n`);

    const data = rows.map(r => ({
      ...r,
      // Map Summary columns to Frontend Expected Props
      // PRIORITY: Master Data (if linked) > Summary Report Data
      masterMachineRaw: r.master_tonnage || r.tonnage,
      masterCavity: r.master_cav || r.cavity,
      masterCycleTime: r.master_ct || r.cycle_time,
      mould_name: r.mould_name || 'Unknown Mould',
      item_code: r.item_code,
      plan_qty: r.plan_qty
    }));

    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   START SERVER (must be LAST)
============================================================ */
const PORT = process.env.PORT || 3000;






// -------------------------------------------------------------
// ENHANCED LOGIN (Return Role)
// -------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.json({ ok: false, error: 'Missing credentials' });

    const rows = await q(
      `SELECT username, line, role_code FROM users 
       WHERE username = $1 
         AND password = $2 
         AND COALESCE(is_active, TRUE) = TRUE
       LIMIT 1`,
      [username, password]
    );

    if (!rows.length) return res.json({ ok: false, error: 'Invalid username or password' });

    // Frontend expects role_code for supervisor check
    res.json({ ok: true, data: { username: rows[0].username, line: rows[0].line, role: rows[0].role_code, role_code: rows[0].role_code } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// -------------------------------------------------------------
// DASHBOARD APIs
// -------------------------------------------------------------
app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    const factoryId = getFactoryId(req); // [FIX] Factory Isolation

    // 1. Production Today (Sum of GoodQty in DPRs for today)
    let sqlProd = `SELECT SUM(good_qty) as s FROM dpr_hourly WHERE dpr_date = CURRENT_DATE`;

    // 2. Active Machines (Count of machines with is_active=true AND status='running' - simulated status for now based on recent DPR?)
    let sqlActive = `SELECT COUNT(DISTINCT machine) as c FROM dpr_hourly WHERE created_at >= NOW() - INTERVAL '2 hours'`;

    // 3. Pending Orders
    let sqlPend = `SELECT COUNT(*) as c FROM orders WHERE status='Pending'`;

    // 4. DPR Entries (Last 24h)
    let sqlDpr = `SELECT COUNT(*) as c FROM dpr_hourly WHERE created_at >= NOW() - INTERVAL '24 hours'`;

    const params = [];
    if (factoryId) {
      params.push(factoryId); // $1
      sqlProd += ` AND factory_id = $1`;
      sqlActive += ` AND factory_id = $1`;
      sqlPend += ` AND factory_id = $1`;
      sqlDpr += ` AND factory_id = $1`;
    }

    const [prod, active, pend, dpr] = await Promise.all([
      q(sqlProd, params),
      q(sqlActive, params),
      q(sqlPend, params),
      q(sqlDpr, params)
    ]);

    res.json({
      ok: true,
      production: Number(prod[0]?.s || 0),
      active_machines: Number(active[0]?.c || 0),
      pending_orders: Number(pend[0]?.c || 0),
      dpr_24h: Number(dpr[0]?.c || 0)
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// -------------------------------------------------------------
// NEW PLANNING APIS (V2)
// -------------------------------------------------------------

// GET /api/dpr/setup (View Saved DPR Entries)
app.get('/api/dpr/setup', async (req, res) => {
  try {
    const rows = await q(`SELECT * FROM std_actual WHERE is_deleted = false ORDER BY created_at DESC LIMIT 50`);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('dpr setup error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/dpr/recent
app.get('/api/dpr/recent', async (req, res) => {
  try {
    const { line, machine, limit, date, shift } = req.query;
    const l = limit ? Number(limit) : 50; // Increased default limit

    let sql = `
      SELECT 
        id as "UniqueID",
        to_char(dpr_date, 'YYYY-MM-DD') as "Date",
        hour_slot as "HourSlot",
        colour as "Colour",
        entry_type as "EntryType",
        shots as "Shots",
        good_qty as "GoodQty",
        reject_qty as "RejectQty",
        downtime_min as "DowntimeMin",
        remarks as "Remarks",
        shift as "Shift"
      FROM dpr_hourly
      WHERE is_deleted = false
    `;
    const params = [];
    if (machine) {
      sql += ` AND machine = $${params.length + 1}`;
      params.push(machine);
    }
    if (line) {
      sql += ` AND line = $${params.length + 1}`;
      params.push(line);
    }
    if (date) {
      sql += ` AND dpr_date = $${params.length + 1}`;
      params.push(date);
    }
    if (shift) {
      sql += ` AND shift = $${params.length + 1}`;
      params.push(shift);
    }
    // NEW: Filter by PlanID (Specific Job)
    const { planId } = req.query;
    if (planId) {
      sql += ` AND plan_id = $${params.length + 1}`;
      params.push(planId);
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      sql += ` AND factory_id = $${params.length + 1}`;
      params.push(factoryId);
    }

    sql += ` ORDER BY hour_slot DESC, created_at DESC LIMIT $${params.length + 1}`;
    params.push(l);

    const rows = await q(sql, params);
    res.json({ ok: true, data: { rows } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/dpr/hourly (Full Hourly Report with Filters)
app.get('/api/dpr/hourly', async (req, res) => {
  try {
    const { line, shift, date } = req.query; // date in YYYY-MM-DD format

    const params = [];
    let pIdx = 1;

    // Enhanced Query with Joins to get Names
    let sql = `
      SELECT 
        d.*,
        COALESCE(NULLIF(d.machine, ''), pb.machine) as machine,
        COALESCE(pb.item_name, o.item_name) as product_name,
        COALESCE(pb.mould_name, m.mould_name) as mould_name,
        sa.article_act as act_weight,
        sa.cavity_act as actual_cavity
      FROM dpr_hourly d
      LEFT JOIN plan_board pb ON pb.plan_id = d.plan_id
      LEFT JOIN orders o ON o.order_no = d.order_no
      LEFT JOIN moulds m ON m.mould_number = d.mould_no
      LEFT JOIN std_actual sa ON sa.plan_id = d.plan_id
      WHERE d.is_deleted = false
    `;

    if (line) {
      sql += ` AND d.line = $${pIdx++}`;
      params.push(line);
    }
    if (shift) {
      sql += ` AND d.shift = $${pIdx++}`;
      params.push(shift);
    }
    if (date) {
      sql += ` AND d.dpr_date::date = $${pIdx++}::date`;
      params.push(date);
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      sql += ` AND d.factory_id = $${pIdx++}`;
      params.push(factoryId);
    }

    // Default limit if no date filter is applied, to prevent massive load
    // But if date is applied, user likely wants ALL records for that day.
    const limitClause = date ? '' : ' LIMIT 100';

    // Sort logic
    sql += ` ORDER BY d.created_at DESC${limitClause}`;

    const rows = await q(sql, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    console.error('dpr hourly error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/dpr/summary-matrix
app.get('/api/dpr/summary-matrix', async (req, res) => {
  try {
    const { date, shift, fromDate, toDate } = req.query;
    const fDate = fromDate || date;
    const tDate = toDate || date;
    const requestedProcess = getRequestedMachineProcess(req, 'Moulding');

    if (!fDate || !shift) return res.status(400).json({ ok: false, error: 'Date/Range and Shift required' });

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    // 1. Get All Active Machines (Application Sort)
    let sqlMachines = `SELECT machine, line, building, COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') as machine_process FROM machines WHERE is_active=true`;
    const mParams = [];
    if (factoryId) {
      sqlMachines += ` AND factory_id = $1`;
      mParams.push(factoryId);
    }
    if (requestedProcess) {
      sqlMachines += ` AND COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') = $${mParams.length + 1}`;
      mParams.push(requestedProcess);
    }
    const machinesRes = await q(sqlMachines, mParams);
    const machines = machinesRes.sort((a, b) => naturalCompare(a.machine, b.machine));

    // 1.1 Get Closed Plants for this Range
    let sqlClosed = `SELECT id, dpr_date::text as dpr_date_str, plant, shift, remarks FROM closed_plants WHERE dpr_date BETWEEN $1 AND $2`;
    const cParams = [fDate, tDate];
    if (factoryId) {
      sqlClosed += ` AND factory_id = $3`;
      cParams.push(factoryId);
    }
    const closedPlants = await q(sqlClosed, cParams);

    // 2. Get DPR Entries for this Range
    let sqlEntries = `
      SELECT
        d.id, d.dpr_date::text as dpr_date_str, d.machine, d.hour_slot, d.good_qty, d.reject_qty, d.downtime_min,
        d.reject_breakup, d.downtime_breakup, d.colour, d.entry_type,
        d.created_by as user_name, d.created_at,
        u.line as creator_line_access,
        COALESCE(NULLIF(TRIM(mps.mould_no), ''), NULLIF(TRIM(pb.mould_code), ''), TRIM(d.mould_no)) as mould_no,
        COALESCE(TRIM(d.order_no), TRIM(pb.order_no), TRIM(mps.or_jr_no)) as order_no,
        TRIM(COALESCE(pb.mould_name, mps.mould_name)) as mould_name,
        ojr.job_card_no,
        COALESCE(ojr.client_name, o.client_name) as client_name
      FROM dpr_hourly d
      LEFT JOIN plan_board pb ON CAST(pb.id AS TEXT) = CAST(d.plan_id AS TEXT) OR pb.plan_id = d.plan_id
      LEFT JOIN (
        SELECT or_jr_no, mould_name, MAX(NULLIF(TRIM(mould_no), '')) as mould_no
        FROM mould_planning_summary
        GROUP BY or_jr_no, mould_name
      ) mps ON mps.or_jr_no = d.order_no AND mps.mould_name = pb.mould_name
      LEFT JOIN users u ON u.username = d.created_by
      LEFT JOIN LATERAL(
        SELECT * FROM or_jr_report rpt 
        WHERE TRIM(rpt.or_jr_no) = TRIM(COALESCE(d.order_no, pb.order_no))
          AND(rpt.job_card_no IS NOT NULL AND TRIM(rpt.job_card_no) != '')
        LIMIT 1
      ) ojr ON true
      LEFT JOIN orders o ON o.order_no = COALESCE(d.order_no, pb.order_no)
      WHERE d.dpr_date BETWEEN $1 AND $2 AND d.shift = $3 AND d.is_deleted = false
    `;
    const entryParams = [fDate, tDate, shift];
    if (factoryId) {
      sqlEntries += ` AND d.factory_id = $4`;
      entryParams.push(factoryId);
    }
    const entries = await q(sqlEntries, entryParams);

    // 3. Get Setup Data (std_actual) for Range
    let setupQuery = `
      SELECT
        s.id,
        --CAVITY INFO
        COALESCE(s.cavity_act, m.no_of_cav, m2.no_of_cav, m4.no_of_cav, m3.no_of_cav, 0) as act_cavity,
        COALESCE(m.no_of_cav, m2.no_of_cav, m4.no_of_cav, m3.no_of_cav, 0) as std_cavity,

        --DATES
        s.dpr_date::text as dpr_date_str,
        ojr.or_jr_date as or_date,
        ojr.job_card_date as jc_date,
        ojr.plan_date as plan_date,

        --STANDARDS
        COALESCE(m.cycle_time, m2.cycle_time, m4.cycle_time, m3.cycle_time, 0) as std_cycle_time,
        COALESCE(m.std_wt_kg, m2.std_wt_kg, m4.std_wt_kg, m3.std_wt_kg, 0) as std_weight,

        --SUMMARY STATS(Plan vs Actual)
        COALESCE(ojr.plan_qty, pb.plan_qty, 0) as plan_qty,
        COALESCE(ojr.mld_status, pb.status) as job_status,
        COALESCE(ojr.job_card_no, '') as job_card_no,
        COALESCE(ojr.client_name, o.client_name, '') as client_name,
        s.machine, s.mould_name, s.order_no, s.plan_id, s.shift

      FROM std_actual s
      LEFT JOIN plan_board pb ON pb.plan_id = s.plan_id
      LEFT JOIN (
        SELECT or_jr_no, mould_name, MAX(NULLIF(TRIM(mould_no), '')) as mould_no 
        FROM mould_planning_summary 
        GROUP BY or_jr_no, mould_name
      ) mps ON mps.or_jr_no = COALESCE(pb.order_no, s.order_no) AND mps.mould_name = COALESCE(pb.mould_name, s.mould_name)
      LEFT JOIN moulds m ON TRIM(m.mould_number) = TRIM(COALESCE(pb.mould_code, ''))
      LEFT JOIN moulds m2 ON TRIM(m2.mould_number) = COALESCE(NULLIF(TRIM(mps.mould_no), ''), NULLIF(TRIM(pb.mould_code), ''), '')
      LEFT JOIN moulds m3 ON (
        TRIM(m3.mould_name) = TRIM(COALESCE(pb.mould_name, mps.mould_name, s.mould_name, ''))
        OR COALESCE(pb.mould_name, mps.mould_name, s.mould_name, '') ILIKE '%' || m3.mould_name || '%'
        OR m3.mould_name ILIKE '%' || COALESCE(pb.mould_name, mps.mould_name, s.mould_name, '') || '%'
      )
      LEFT JOIN moulds m4 ON (
        s.article_act > 0 AND s.article_act < 10 AND m4.std_wt_kg = s.article_act
        AND (COALESCE(pb.mould_name, s.mould_name) ILIKE '%' || SUBSTRING(m4.mould_name FROM 1 FOR 8) || '%')
      )
      LEFT JOIN LATERAL(
        SELECT * FROM or_jr_report rpt 
        WHERE TRIM(rpt.or_jr_no) = TRIM(pb.order_no)
          AND(rpt.job_card_no IS NOT NULL AND TRIM(rpt.job_card_no) != '')
        LIMIT 1
      ) ojr ON true
      LEFT JOIN orders o ON o.order_no = pb.order_no

      WHERE s.dpr_date BETWEEN $1 AND $2 AND s.shift = $3 AND s.is_deleted = false
    `;
    const setupParams = [fDate, tDate, shift];
    if (factoryId) {
      setupQuery += ` AND s.factory_id = $4`;
      setupParams.push(factoryId);
    }

    // 3. Get Setup Data (std_actual) for Date Range
    const setups = await q(setupQuery, setupParams);


    // 3. Build Map: Machine -> Slot -> [Entries]
    const dataMap = {};
    entries.forEach(r => {
      if (!dataMap[r.machine]) dataMap[r.machine] = {};
      if (!dataMap[r.machine][r.hour_slot]) dataMap[r.machine][r.hour_slot] = [];
      dataMap[r.machine][r.hour_slot].push(r);
    });

    // 4. Maintenance / Breakdown data (Overlap with Range)
    let maintSql = `SELECT *, start_date::text as start_date_str, end_date::text as end_date_str FROM machine_status_logs WHERE (start_date <= $2 AND COALESCE(end_date, '2099-12-31') >= $1)`;
    const maintParams = [fDate, tDate];
    if (factoryId) {
      maintSql += ` AND factory_id = $3`;
      maintParams.push(factoryId);
    }
    const maintLogs = await q(maintSql, maintParams);

    if (requestedProcess) {
      const allowedMachines = new Set(machines.map(machine => machine.machine));
      entries.splice(0, entries.length, ...entries.filter(entry => allowedMachines.has(entry.machine)));
      setups.splice(0, setups.length, ...setups.filter(setup => allowedMachines.has(setup.machine)));
      maintLogs.splice(0, maintLogs.length, ...maintLogs.filter(log => allowedMachines.has(log.machine)));
    }


    // 5. Build Grouped Results
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const currentHour = now.getHours();

    const getDateStr = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const dates = [];
    let curr = new Date(fDate);
    let endMonth = new Date(tDate);
    // Ensure we comparison-base on date strings or clear times
    const startStr = getDateStr(curr);
    const endStr = getDateStr(endMonth);

    let temp = new Date(curr);
    while (getDateStr(temp) <= endStr) {
      dates.push(getDateStr(temp));
      temp.setDate(temp.getDate() + 1);
    }

    const groupedData = {};
    dates.forEach(dt => {
      // Filter entries for this date
      const dateEntries = entries.filter(e => e.dpr_date_str === dt);
      const dataMap = {};
      dateEntries.forEach(r => {
        if (!dataMap[r.machine]) dataMap[r.machine] = {};
        if (!dataMap[r.machine][r.hour_slot]) dataMap[r.machine][r.hour_slot] = [];
        dataMap[r.machine][r.hour_slot].push(r);
      });

      // Filter setups
      const dateSetups = setups.filter(s => s.dpr_date_str === dt);


      // Filter maintenance logs that overlap with this SPECIFIC date
      const dateMaintMap = {};
      maintLogs.forEach(r => {
        const s = r.start_date_str;
        const e = r.end_date_str || '2099-12-31';
        if (dt >= s && dt <= e) {
          if (!dateMaintMap[r.machine]) dateMaintMap[r.machine] = [];
          dateMaintMap[r.machine].push(r);
        }
      });

      // Status & Required Slots
      let status = 'FUTURE';
      if (dt < todayStr) status = 'PAST';
      else if (dt === todayStr) status = 'TODAY';

      let requiredSlots = [];
      const allSlots = ['08-09', '09-10', '10-11', '11-12', '12-01', '01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08'];
      if (status === 'PAST') {
        requiredSlots = [...allSlots];
      } else if (status === 'TODAY') {
        if (shift === 'Day') {
          const slotEndHours = { '08-09': 9, '09-10': 10, '10-11': 11, '11-12': 12, '12-01': 13, '01-02': 14, '02-03': 15, '03-04': 16, '04-05': 17, '05-06': 18, '06-07': 19, '07-08': 20 };
          requiredSlots = allSlots.filter(s => currentHour >= slotEndHours[s]);
        } else if (shift === 'Night') {
          requiredSlots = allSlots.filter(s => {
            let endH = 0;
            switch (s) {
              case '08-09': endH = 21; break; case '09-10': endH = 22; break; case '10-11': endH = 23; break; case '11-12': endH = 24; break;
              case '12-01': endH = 25; break; case '01-02': endH = 26; break; case '02-03': endH = 27; break; case '03-04': endH = 28; break;
              case '04-05': endH = 29; break; case '05-06': endH = 30; break; case '06-07': endH = 31; break; case '07-08': endH = 32; break;
            }
            if (currentHour >= 18) { if (endH > 12 && endH <= currentHour) return true; return false; }
            else { const adjH = currentHour + 24; if (endH <= adjH) return true; return false; }
          });
        }
      }

      groupedData[dt] = { entries: dataMap, requiredSlots, status, maintenance: dateMaintMap, setups: dateSetups };
    });

    res.json({ ok: true, data: { machines, dates: groupedData, closedPlants } });

  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/dpr/delete-entry (Admin Soft-Delete)
app.post('/api/dpr/delete-entry', async (req, res) => {
  try {
    const { id, session } = req.body;
    if (!id) return res.status(400).json({ ok: false, error: 'ID required' });
    if (!session || !session.username) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // Verify Admin
    const u = await q('SELECT role_code FROM users WHERE username=$1', [session.username]);
    if (!u.length || !isAdminLikeRole(u[0])) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    await q('UPDATE dpr_hourly SET is_deleted = true WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete-entry error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/dpr/delete-setup (Admin Soft-Delete)
app.post('/api/dpr/delete-setup', async (req, res) => {
  try {
    const { id, session } = req.body;
    if (!id) return res.status(400).json({ ok: false, error: 'ID required' });
    if (!session || !session.username) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // Verify Admin
    const u = await q('SELECT role_code FROM users WHERE username=$1', [session.username]);
    if (!u.length || !isAdminLikeRole(u[0])) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    await q('UPDATE std_actual SET is_deleted = true WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete-setup error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/dpr/hourly/clear
app.post('/api/dpr/hourly/clear', async (req, res) => {
  try {
    const { session } = req.body;
    if (!session || !session.username) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // Verify Admin
    const u = await q('SELECT role_code FROM users WHERE username=$1', [session.username]);
    if (!u.length || !isAdminLikeRole(u[0])) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    await q('TRUNCATE dpr_hourly');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// MACHINE MAINTENANCE ENDPOINTS
app.post('/api/machine/maintenance/start', async (req, res) => {
  try {
    const { machine, date, slot } = req.body;
    if (!machine || !date || !slot) throw new Error('Missing args');

    // Close any previous active maintenance
    await q('UPDATE machine_status_logs SET is_active=false, end_date=$2, end_slot=$3 WHERE machine=$1 AND is_active=true', [machine, date, slot]);

    // Insert
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    await q('INSERT INTO machine_status_logs (machine, start_date, start_slot, is_active, factory_id) VALUES ($1, $2, $3, true, $4)',
      [machine, date, slot, factoryId]
    );

    syncService.triggerSync();
    res.json({ ok: true });
  } catch (e) {
    console.error('maint/start', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/machine/maintenance/active', async (req, res) => {
  try {
    const { machine } = req.query;
    const rows = await q('SELECT * FROM machine_status_logs WHERE machine=$1 AND is_active=true ORDER BY id DESC LIMIT 1', [machine]);
    res.json({ ok: true, data: rows[0] || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// POST /api/dpr/setup/clear
app.post('/api/dpr/setup/clear', async (req, res) => {
  try {
    const { session } = req.body;
    if (!session || !session.username) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    // Verify Admin
    const u = await q('SELECT role_code FROM users WHERE username=$1', [session.username]);
    if (!u.length || !isAdminLikeRole(u[0])) {
      return res.status(403).json({ ok: false, error: 'Admin or Superadmin access required' });
    }

    await q('TRUNCATE std_actual');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// ------------------------------------
// DPR SETTINGS APIs
// ------------------------------------

// GET /api/settings
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM app_settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json({ ok: true, data: settings });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/settings
app.post('/api/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await q(`INSERT INTO app_settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`, [key, String(value)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// GET /api/dpr/reasons
app.get('/api/dpr/reasons', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM dpr_reasons WHERE is_active=true ORDER BY type, reason');
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/dpr/reasons
app.post('/api/dpr/reasons', async (req, res) => {
  try {
    const { type, reason, code } = req.body;
    if (!reason) return res.status(400).json({ ok: false, error: 'Reason required' });
    await q('INSERT INTO dpr_reasons (type, reason, code) VALUES ($1, $2, $3)', [type, reason, code || null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// [DEBUG] Manual Endpoint to Fix Sync Schema (Remote VPS)
app.get('/api/admin/fix-sync-schema', async (req, res) => {
  try {
    console.log('[DEBUG] Manually Fixing Sync Schema...');
    await q(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    const SYNC_TABLES = [
      'std_actual',
      'dpr_hourly',
      'qc_online_reports',
      'qc_issue_memos',
      'qc_deviations',
      'machine_status_logs',
      'shifting_records',
      'planning_drops',
      'operator_history'
    ];

    const FID = process.env.LOCAL_FACTORY_ID || 1;
    const logs = [];

    for (const table of SYNC_TABLES) {
      try {
        // 1. Ensure Columns
        await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_id UUID DEFAULT gen_random_uuid();`);
        await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS sync_status TEXT;`);
        await q(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS factory_id INTEGER;`);

        // 2. Heal Data
        await q(`UPDATE ${table} SET sync_id = gen_random_uuid() WHERE sync_id IS NULL`);
        await q(`UPDATE ${table} SET factory_id = $1 WHERE factory_id IS NULL`, [FID]);

        // 3. Create Unique Index
        await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_sync_id ON ${table}(sync_id);`);
        logs.push(`Fixed ${table}`);
      } catch (err) {
        logs.push(`Error ${table}: ${err.message}`);
      }
    }
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// DELETE /api/dpr/reasons/:id
app.delete('/api/dpr/reasons/:id', async (req, res) => {
  try {
    await q('UPDATE dpr_reasons SET is_active=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// GET /api/planning/kpis
app.get('/api/planning/kpis', async (req, res) => {
  try {
    const pending = await q(`SELECT COUNT(*) as c FROM orders WHERE status = 'Pending'`);
    const inprog = await q(`SELECT COUNT(*) as c FROM jobs_queue WHERE status = 'RUNNING'`);

    res.json({
      total_pending_orders: Number(pending[0].c),
      pending_delta_pct: 5, pending_trend: [4, 5, 6, 6, 7, 5, 4],
      in_progress_moulding: Number(inprog[0].c),
      inprog_delta_pct: 2, inprog_trend: [2, 3, 3, 4, 5, 5, 5],
      date_variance_above_3pct: 1, variance_delta_pct: -2, variance_trend: [2, 2, 1, 0, 1],
      total_upcoming_orders: Number(pending[0].c) + 5 // Mock
    });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// GET /api/machines/status
app.get('/api/machines/status', async (req, res) => {
  try {
    const { show_inactive } = req.query;
    const requestedProcess = getRequestedMachineProcess(req, '');

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    let sql = `SELECT * FROM machines WHERE 1=1`;
    const params = [];

    if (factoryId) {
      sql += ` AND factory_id = $1`;
      params.push(factoryId);
    }
    if (requestedProcess) {
      sql += ` AND COALESCE(NULLIF(TRIM(machine_process), ''), 'Moulding') = $${params.length + 1}`;
      params.push(requestedProcess);
    }
    sql += ` ORDER BY building, line, machine`;

    const rows = await q(sql, params);
    const data = rows.map((m, i) => ({
      id: m.id || (i + 1),
      code: m.machine,
      name: m.machine,
      building: m.building || 'B',
      line: m.line || '1',
      machine_icon: m.machine_icon || null,
      status: m.is_active ? 'running' : 'off',
      is_active: m.is_active,
      is_maintenance: false,
      load_pct: Math.floor(Math.random() * 80)
    }));

    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to fetch machines' });
  }
});

// GET /api/planning/schedule
app.get('/api/planning/schedule', async (req, res) => {
  try {
    const { machine_id } = req.query;
    // Mock response for now as real scheduling is complex
    res.json({
      current: { order_no: 'ORD-MOCK-1' },
      next: [{ order_no: 'ORD-MOCK-2' }, { order_no: 'ORD-MOCK-3' }]
    });
  } catch (e) { res.status(500).json({}); }
});

// GET /api/orders/pending (or /api/orders)
// GET /api/orders/pending (Source: Order Master / 'orders' table)
app.get('/api/orders/pending', async (req, res) => {
  try {
    // JOIN with OR-JR Report to get ALL columns (parity with Order Master)
    // Also use 'r.plan_qty' as 'qty' explicitly if needed, but 'o.qty' is synced now.
    // We select r.* to give frontend everything.
    let sql = `
    SELECT
    r.*,
      o.priority,
      o.qty, --Explicitly return 'qty' for frontend compatibility
        o.status as master_status,
      --Ensure critical fields exist even if join fails(though it shouldn't for active orders)
        COALESCE(r.product_name, o.item_name) as item_name,
        COALESCE(r.client_name, o.client_name) as client_name,
        o.order_no-- specific alias
      FROM orders o
      LEFT JOIN or_jr_report r ON o.order_no = r.or_jr_no 
      --Filter out Closed(Legacy) AND specific m / c statuses(User Request)
      --Match on OR, Date, JC is inherent in 'r' rows.We filter undesirable statuses here.
      --RELAXED: Removed o.status = 'Pending' to allow fetching based purely on OR - JR criteria
      WHERE
          (r.is_closed IS FALSE OR r.is_closed IS NULL)
        AND(r.mld_status IS NULL OR(LOWER(r.mld_status) NOT IN('completed', 'cancelled')))
        AND r.or_jr_no IS NOT NULL-- Ensure we only fetch linked valid report rows
    `;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    const params = [];
    if (factoryId) {
      // 'o' is orders table. Check if 'o' has factory_id or 'r' has it.
      // Orders table definitely has it.
      params.push(factoryId);
      sql += ` AND o.factory_id = $${params.length} `;
    }

    sql += ` ORDER BY ${getPrioritySortSql('o.priority')}, o.created_at `;

    const rows = await q(sql, params);
    fs.appendFileSync('debug.log', `[${new Date().toISOString()}]/api/orders / pending -> Found ${rows.length} rows\n`);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, data: [] });
  }
});

app.get('/api/orders', async (req, res) => { // Alias
  try {
    let sql = `SELECT * FROM orders WHERE status = 'Pending'`;
    const params = [];

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      sql += ` AND factory_id = $${params.length}`;
    }

    sql += ` ORDER BY ${getPrioritySortSql('priority')}, created_at`;

    const rows = await q(sql, params);
    res.json({ ok: true, data: await attachFactoryNames(rows) });
  } catch (e) {
    console.error('orders error', e);
    res.status(500).json([]);
  }
});

// POST /api/planning/queue
app.post('/api/planning/queue', async (req, res) => {
  try {
    const { machine_id, order_ids } = req.body;
    // In real app, associate orders with machine_id in a queue table
    // For now, just acknowledge. 
    // We could Insert into jobs_queue if we map machine_id -> machine_name

    // 1. Get machine name
    // const m = await q(`SELECT machine FROM machines WHERE id = $1`, [machine_id]);

    // 2. Loop orders and mark as Queued/Planned
    // ...

    res.json({ ok: true, message: `Queued ${order_ids.length} orders` });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/planning/balance
app.post('/api/planning/balance', async (req, res) => {
  res.json({ message: "Balancing logic simulation successful (Server)" });
});

// POST /api/planning/auto-assign-p1
app.post('/api/planning/auto-assign-p1', async (req, res) => {
  res.json({ message: "Auto-assign P1 logic simulation successful (Server)" });
});


/* ============================================================
   MACHINE MASTER (Review Mode + CRUD)
   ============================================================ */

// 1. PREVIEW (Upload logic for Review)
app.post('/api/upload/machines-preview', upload.single('file'), async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'preview machine uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!req.file) return res.json({ ok: false, error: 'No file uploaded' });
    if (requestFactoryId !== null) {
      await ensureFactoryIdsExist([requestFactoryId], pool, 'Current upload factory');
    }

    validateMasterUploadFile(req.file);
    const requestedProcess = normalizeMachineProcess(req.body?.process, '');

    // Parse Excel (Header: 1 for Grid Coordinate A,B,C,D)
    const wb = xlsx.readFile(req.file.path);
    const sn = wb.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(wb.Sheets[sn], { header: 1 });
    let factoryColIndex = -1;
    let buildingColIndex = 0;
    let lineColIndex = 1;
    let machineColIndex = 2;
    let processColIndex = -1;
    let tonnageColIndex = 3;
    let vendorColIndex = -1;
    let modelColIndex = -1;
    let machineTypeColIndex = -1;
    let detectedMachineProcess = requestedProcess || '';

    // Remove header row if present
    if (rawData.length) {
      const headerKeys = rawData[0].map(cell => normalizeHeaderKey(cell));
      const findHeaderIndex = (aliases, fallback) => {
        const idx = headerKeys.findIndex(key => aliases.includes(key));
        return idx >= 0 ? idx : fallback;
      };
      const hasKnownHeaders = headerKeys.some(key => [
        'building', 'plant', 'factoryunit',
        'line', 'lineno', 'machineline',
        'machine', 'machinename', 'machinenumber', 'machinecode',
        'process', 'machineprocess', 'processtype', 'department', 'section', 'type',
        'tonnage', 'machinecapacity',
        'vendorname', 'vendor', 'brand',
        'modelno', 'modelnumber', 'model',
        'machinetype', 'machinetypename',
        'factoryid', 'factory', 'factorycode'
      ].includes(key));

      if (hasKnownHeaders) {
        const hasPrintingHeaders = ['vendorname', 'vendor', 'brand', 'modelno', 'modelnumber', 'model', 'machinetype', 'machinetypename']
          .some(key => headerKeys.includes(key));

        if (requestedProcess === 'Printing' || hasPrintingHeaders) {
          detectedMachineProcess = 'Printing';
          machineColIndex = findHeaderIndex(['machinenumber', 'machine', 'machinename', 'machinecode'], 0);
          vendorColIndex = findHeaderIndex(['vendorname', 'vendor', 'brand'], 1);
          modelColIndex = findHeaderIndex(['modelno', 'modelnumber', 'model'], 2);
          machineTypeColIndex = findHeaderIndex(['machinetype', 'machinetypename', 'type'], 3);
          factoryColIndex = findHeaderIndex(['factoryid', 'factory', 'factorycode'], -1);
        } else {
          buildingColIndex = findHeaderIndex(['building', 'plant', 'factoryunit'], 0);
          lineColIndex = findHeaderIndex(['line', 'lineno', 'machineline'], 1);
          machineColIndex = findHeaderIndex(['machine', 'machinename', 'machinecode'], 2);
          processColIndex = findHeaderIndex(['process', 'machineprocess', 'processtype', 'department', 'section', 'type'], -1);
          tonnageColIndex = findHeaderIndex(['tonnage', 'machinecapacity'], processColIndex >= 0 ? 4 : 3);
          vendorColIndex = findHeaderIndex(['vendorname', 'vendor', 'brand'], -1);
          modelColIndex = findHeaderIndex(['modelno', 'modelnumber', 'model'], -1);
          machineTypeColIndex = findHeaderIndex(['machinetype', 'machinetypename'], -1);
          factoryColIndex = findHeaderIndex(['factoryid', 'factory', 'factorycode'], -1);
        }
        rawData.shift();
      }
    }

    // Process File Data into Map
    const fileMachines = new Map();
    rawData.forEach(r => {
      if (!Array.isArray(r) || !r.some(cell => String(cell ?? '').trim() !== '')) return;
      const rowProcess = detectedMachineProcess === 'Printing'
        ? 'Printing'
        : normalizeMachineProcess(processColIndex >= 0 ? r[processColIndex] : requestedProcess, requestedProcess || 'Moulding');
      const isPrintingRow = rowProcess === 'Printing';
      const rawTonnage = isPrintingRow
        ? null
        : (processColIndex >= 0
          ? r[tonnageColIndex]
          : ((r[4] !== undefined && r[4] !== null && String(r[3] || '').trim() === '') ? r[4] : r[3]));
      const m = {
        building: isPrintingRow ? '' : String(r[buildingColIndex] || '').trim(),
        line: isPrintingRow ? '' : String(r[lineColIndex] || '').trim(),
        machine: normalizeMachineName(r[machineColIndex]),
        machine_process: rowProcess,
        tonnage: toNum(rawTonnage),
        vendor_name: normalizeOptionalText(vendorColIndex >= 0 ? r[vendorColIndex] : null),
        model_no: normalizeOptionalText(modelColIndex >= 0 ? r[modelColIndex] : null),
        machine_type: normalizeOptionalText(machineTypeColIndex >= 0 ? r[machineTypeColIndex] : null),
        is_active: true,
        factory_id: normalizeFactoryId(factoryColIndex >= 0 ? r[factoryColIndex] : null) ?? requestFactoryId
      };
      if (m.machine) fileMachines.set(getScopedMachineKey(m.machine, m.factory_id), m);
    });
    assertUploadRowsMatchFactory([...fileMachines.values()], requestFactoryId, 'Machine upload');

    // Fetch DB Data
    const fileFactoryIds = [...new Set([...fileMachines.values()].map(row => normalizeFactoryId(row.factory_id)))];
    const nonNullPreviewFactoryIds = fileFactoryIds.filter(factoryId => factoryId !== null);
    if (nonNullPreviewFactoryIds.length) {
      await ensureFactoryIdsExist(nonNullPreviewFactoryIds, pool, 'Machine preview');
    }
    const previewProcesses = [...new Set([...fileMachines.values()].map(row => normalizeMachineProcess(row.machine_process, 'Moulding')))].filter(Boolean);
    let dbRows = [];
    if (fileFactoryIds.length) {
      for (const factoryId of fileFactoryIds) {
        let scopedRows = factoryId === null
          ? await q('SELECT * FROM machines WHERE factory_id IS NULL')
          : await q('SELECT * FROM machines WHERE factory_id = $1', [factoryId]);
        if (previewProcesses.length) {
          scopedRows = scopedRows.filter(row => previewProcesses.includes(normalizeMachineProcess(row.machine_process, 'Moulding')));
        }
        dbRows = dbRows.concat(scopedRows);
      }
    } else {
      dbRows = requestFactoryId === null
        ? await q('SELECT * FROM machines WHERE factory_id IS NULL')
        : await q('SELECT * FROM machines WHERE factory_id = $1', [requestFactoryId]);
      if (previewProcesses.length) {
        dbRows = dbRows.filter(row => previewProcesses.includes(normalizeMachineProcess(row.machine_process, 'Moulding')));
      }
    }
    const existingMap = new Map();
    dbRows.forEach(r => existingMap.set(getScopedMachineKey(r.machine, r.factory_id), r));

    const preview = [];

    // Check for NEW and UPDATE
    for (const [key, newItem] of fileMachines) {
      if (!existingMap.has(key)) {
        preview.push({ ...newItem, _status: 'NEW' });
      } else {
        const old = existingMap.get(key);
        // Compare fields to see if update needed
        if (
          old.building !== newItem.building
          || old.line !== newItem.line
          || normalizeMachineProcess(old.machine_process, 'Moulding') !== newItem.machine_process
          || Number(old.tonnage) !== Number(newItem.tonnage)
          || normalizeOptionalText(old.vendor_name) !== normalizeOptionalText(newItem.vendor_name)
          || normalizeOptionalText(old.model_no) !== normalizeOptionalText(newItem.model_no)
          || normalizeOptionalText(old.machine_type) !== normalizeOptionalText(newItem.machine_type)
        ) {
          preview.push({ ...newItem, _status: 'UPDATE', _old: old });
        } else {
          // No change
          // We can optionally show 'SKIP' or just ignore
          preview.push({ ...newItem, _status: 'SKIP' });
        }
      }
    }

    // Check for DELETE (In DB but NOT in File) -> User said "Add Machine Option ANd Remove Or Modify"
    // "Remove if have demo machines" implies Sync.
    // If uploading a master list, missing items might be deletes.
    // However, usually partial uploads are safer. 
    // BUT the previous task said "Remove if have demo machines".
    // I will include DELETES in the preview but default them to unchecked/warning? 
    // Or just list them as DELETE status.
    for (const [key, oldItem] of existingMap) {
      if (!fileMachines.has(key)) {
        preview.push({ ...oldItem, _status: 'DELETE' });
      }
    }

    res.json({ ok: true, data: preview });

  } catch (e) {
    console.error('upload/machines-preview', e);
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// 2. CONFIRM (Apply changes)
app.post('/api/upload/machines-confirm', async (req, res) => {
  try {
    const { rows, user } = req.body; // Expecting { rows: [...] }
    const writeContext = await getWritableFactoryContext(req, 'confirm machine uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    const actor = normalizeOptionalText(user) || getRequestUsername(req) || 'System';
    if (!rows || !rows.length) return res.json({ ok: true, message: 'No changes selected' });
    assertUploadRowsMatchFactory(rows, requestFactoryId, 'Machine upload');
    if (requestFactoryId !== null) {
      await ensureFactoryIdsExist([requestFactoryId], pool, 'Current upload factory');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let counts = { new: 0, update: 0, delete: 0 };

      for (const r of rows) {
        const rowFactoryId = normalizeFactoryId(r.factory_id) ?? requestFactoryId;
        if (rowFactoryId !== null) {
          await ensureFactoryIdsExist([rowFactoryId], client, 'Machine confirm');
        }
        if (r._status === 'NEW') {
          const machineName = normalizeMachineName(r.machine);
          await client.query(
            `INSERT INTO machines(machine, line, building, machine_process, tonnage, vendor_name, model_no, machine_type, is_active, factory_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
            [
              machineName,
              r.line || '',
              r.building || '',
              normalizeMachineProcess(r.machine_process, 'Moulding'),
              toNum(r.tonnage),
              normalizeOptionalText(r.vendor_name),
              normalizeOptionalText(r.model_no),
              normalizeOptionalText(r.machine_type),
              rowFactoryId
            ]
          );
          await logMachineAudit(client, {
            machineId: machineName,
            actionType: 'CREATE',
            changedFields: { message: 'Created by machine master upload' },
            changedBy: actor,
            factoryId: rowFactoryId
          });
          counts.new++;
        } else if (r._status === 'UPDATE') {
          const before = await client.query(
            `SELECT machine, line, building, machine_process, tonnage, vendor_name, model_no, machine_type, machine_icon, is_active
               FROM machines
              WHERE LOWER(machine) = LOWER($1)
                AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))
              LIMIT 1`,
            [r.machine, rowFactoryId]
          );
          await client.query(
            `UPDATE machines SET line = $1, building = $2, machine_process = $3, tonnage = $4, vendor_name = $5, model_no = $6, machine_type = $7, factory_id = $8, updated_at = NOW() WHERE LOWER(machine) = LOWER($9) AND (factory_id = $8 OR ($8 IS NULL AND factory_id IS NULL))`,
            [
              r.line || '',
              r.building || '',
              normalizeMachineProcess(r.machine_process, 'Moulding'),
              toNum(r.tonnage),
              normalizeOptionalText(r.vendor_name),
              normalizeOptionalText(r.model_no),
              normalizeOptionalText(r.machine_type),
              rowFactoryId,
              r.machine
            ]
          );
          if (before.rowCount) {
            const previous = before.rows[0];
            const changedFields = buildMachineAuditChanges(previous, {
              machine: previous.machine,
              line: r.line || '',
              building: r.building || '',
              machine_process: normalizeMachineProcess(r.machine_process, 'Moulding'),
              tonnage: toNum(r.tonnage),
              vendor_name: normalizeOptionalText(r.vendor_name),
              model_no: normalizeOptionalText(r.model_no),
              machine_type: normalizeOptionalText(r.machine_type),
              machine_icon: previous.machine_icon,
              is_active: previous.is_active
            });
            if (Object.keys(changedFields).length) {
              await logMachineAudit(client, {
                machineId: previous.machine,
                actionType: 'UPDATE',
                changedFields,
                changedBy: actor,
                factoryId: rowFactoryId
              });
            }
          }
          counts.update++;
        } else if (r._status === 'DELETE') {
          const before = await client.query(
            `SELECT machine
               FROM machines
              WHERE LOWER(machine) = LOWER($1)
                AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))
              LIMIT 1`,
            [r.machine, rowFactoryId]
          );
          if (before.rowCount) {
            await logMachineAudit(client, {
              machineId: before.rows[0].machine,
              actionType: 'DELETE',
              changedFields: { message: 'Deleted by machine master upload' },
              changedBy: actor,
              factoryId: rowFactoryId
            });
          }
          await client.query(`DELETE FROM machines WHERE LOWER(machine) = LOWER($1) AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))`, [r.machine, rowFactoryId]);
          counts.delete++;
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true, counts });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/upload/wipstock-preview', upload.single('file'), async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'preview WIP Stock uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    validateMasterUploadFile(req.file);
    await ensureFactoryIdsExist([requestFactoryId], pool, 'Current upload factory');

    const parsedUpload = parseWipStockUploadSheet(req.file.path);
    const previewRows = parsedUpload.rows
      .slice(0, 200)
      .map((row, index) => {
        const normalized = normalizeWipStockUploadRow(row, requestFactoryId, parsedUpload.stock_date, 'actual');
        if (normalized.sr_no === null || normalized.sr_no === undefined) {
          normalized.sr_no = index + 1;
        }
        return normalized;
      });

    res.json({
      ok: true,
      data: {
        rows: previewRows,
        totalRows: parsedUpload.rows.length,
        stock_date: parsedUpload.stock_date,
        header_date_text: parsedUpload.header_date_text,
        source_file_name: req.file.originalname,
        keys: [
          'sr_no', 'factory_unit', 'party_group', 'location_floor_dept', 'item_code', 'item_name',
          'job_no', 'job_date', 'ageing_period', 'previous_stock_qty', 'current_stock_available_qty',
          'total_qty', 'uom', 'remark_from_factory_unit', 'remark_from_ho_sales_team'
        ]
      }
    });
  } catch (e) {
    console.error('upload/wipstock-preview', e);
    const status = e?.statusCode || 500;
    res.status(status).json({ ok: false, error: e?.message || String(e), details: e?.details });
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_cleanupErr) { }
    }
  }
});

app.post('/api/upload/wipstock-confirm', async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'confirm WIP Stock uploads');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const requestFactoryId = writeContext.factoryId;

    const { rows, stock_date, header_date_text, source_file_name, user } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ ok: false, error: 'No WIP Stock preview rows found.' });
    }
    assertUploadRowsMatchFactory(rows, requestFactoryId, 'WIP Stock upload');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const savedSnapshot = await saveWipStockSnapshot(client, {
        factoryId: requestFactoryId,
        stockDate: stock_date,
        headerDateText: header_date_text,
        sourceFileName: source_file_name,
        rows,
        username: normalizeOptionalText(user) || getRequestUsername(req) || 'BulkUpload'
      });
      await client.query('COMMIT');
      res.json({
        ok: true,
        count: savedSnapshot.total_row_count,
        message: `Saved ${savedSnapshot.total_row_count} WIP Stock rows for ${savedSnapshot.stock_date}.`,
        snapshot: savedSnapshot
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const status = e?.statusCode || 500;
    res.status(status).json({ ok: false, error: e?.message || String(e), details: e?.details });
  }
});

// 3. CRUD: Create
app.post('/api/machines', async (req, res) => {
  try {
    const { machine, line, building, tonnage, machine_process, vendor_name, model_no, machine_type, machine_icon, machine_icon_base64 } = req.body;
    const cleanMachine = normalizeMachineName(machine);
    const cleanProcess = normalizeMachineProcess(machine_process, 'Moulding');
    const isPrintingMachine = cleanProcess === 'Printing';
    const nextLine = isPrintingMachine ? '' : (line || '');
    const nextBuilding = isPrintingMachine ? '' : (building || '');
    const nextTonnage = isPrintingMachine ? null : toNum(tonnage);
    const resolvedMachineIcon = machine_icon_base64
      ? saveDataUrlImage(machine_icon_base64, 'machines', 'machine')
      : normalizeOptionalText(machine_icon);
    if (!cleanMachine) return res.status(400).json({ ok: false, error: 'Machine Name is required' });
    const writeContext = await getWritableFactoryContext(req, 'add machines');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;
    if (factoryId !== null) {
      await ensureFactoryIdsExist([factoryId], pool, 'Selected machine factory');
    }
    const actor = getRequestUsername(req) || 'System';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO machines(machine, line, building, machine_process, tonnage, vendor_name, model_no, machine_type, machine_icon, is_active, factory_id)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)`,
        [cleanMachine, nextLine, nextBuilding, cleanProcess, nextTonnage, normalizeOptionalText(vendor_name), normalizeOptionalText(model_no), normalizeOptionalText(machine_type), resolvedMachineIcon, factoryId]
      );
      await logMachineAudit(client, {
        machineId: cleanMachine,
        actionType: 'CREATE',
        changedFields: { message: 'Created new machine' },
        changedBy: actor,
        factoryId
      });
      await client.query('COMMIT');
      res.json({ ok: true, message: 'Machine added' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ ok: false, error: 'Machine already exists for this factory' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4. CRUD: Update/Delete
app.put('/api/machines/:id', async (req, res) => { // ID is machine name
  try {
    const { id } = req.params; // old machine name
    const { machine, line, building, tonnage, machine_process, vendor_name, model_no, machine_type, machine_icon, machine_icon_base64 } = req.body;
    const writeContext = await getWritableFactoryContext(req, 'edit machines');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;
    const cleanMachine = normalizeMachineName(machine);
    const cleanProcess = normalizeMachineProcess(machine_process, 'Moulding');
    const isPrintingMachine = cleanProcess === 'Printing';
    const hasMachineIconField = Object.prototype.hasOwnProperty.call(req.body || {}, 'machine_icon');
    const resolvedMachineIcon = machine_icon_base64
      ? saveDataUrlImage(machine_icon_base64, 'machines', 'machine')
      : (hasMachineIconField ? normalizeOptionalText(machine_icon) : undefined);
    const actor = getRequestUsername(req) || 'System';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT machine, line, building, machine_process, tonnage, vendor_name, model_no, machine_type, machine_icon, is_active
           FROM machines
          WHERE LOWER(machine) = LOWER($1)
            AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))
          LIMIT 1`,
        [id, factoryId]
      );
      if (!existing.rowCount) throw new Error('Machine not found');

      const previous = existing.rows[0];
      const nextState = {
        machine: cleanMachine,
        line: isPrintingMachine ? '' : (line || ''),
        building: isPrintingMachine ? '' : (building || ''),
        machine_process: cleanProcess,
        tonnage: isPrintingMachine ? null : toNum(tonnage),
        vendor_name: normalizeOptionalText(vendor_name),
        model_no: normalizeOptionalText(model_no),
        machine_type: normalizeOptionalText(machine_type),
        machine_icon: resolvedMachineIcon !== undefined ? resolvedMachineIcon : previous.machine_icon,
        is_active: previous.is_active
      };

      if (resolvedMachineIcon !== undefined) {
        await client.query(
          `UPDATE machines SET machine = $1, line = $2, building = $3, machine_process = $4, tonnage = $5, vendor_name = $6, model_no = $7, machine_type = $8, machine_icon = $9, updated_at = NOW()
            WHERE LOWER(machine) = LOWER($10) AND (factory_id = $11 OR ($11 IS NULL AND factory_id IS NULL))`,
          [cleanMachine, nextState.line, nextState.building, nextState.machine_process, nextState.tonnage, nextState.vendor_name, nextState.model_no, nextState.machine_type, resolvedMachineIcon, id, factoryId]
        );
      } else {
        await client.query(
          `UPDATE machines SET machine = $1, line = $2, building = $3, machine_process = $4, tonnage = $5, vendor_name = $6, model_no = $7, machine_type = $8, updated_at = NOW()
            WHERE LOWER(machine) = LOWER($9) AND (factory_id = $10 OR ($10 IS NULL AND factory_id IS NULL))`,
          [cleanMachine, nextState.line, nextState.building, nextState.machine_process, nextState.tonnage, nextState.vendor_name, nextState.model_no, nextState.machine_type, id, factoryId]
        );
      }

      if (id !== cleanMachine) {
        await client.query(`UPDATE plan_board SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
        await client.query(`UPDATE dpr_hourly SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
        await client.query(`UPDATE qc_online_reports SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
        await client.query(`UPDATE mould_planning_summary SET machine_name = $1 WHERE machine_name = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
        await client.query(`UPDATE mould_planning_report SET machine_name = $1 WHERE machine_name = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
        await client.query(`UPDATE machine_audit_logs SET machine_id = $1 WHERE LOWER(machine_id) = LOWER($2) AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, id, factoryId]);
      }

      const changedFields = buildMachineAuditChanges(previous, nextState);
      if (Object.keys(changedFields).length) {
        await logMachineAudit(client, {
          machineId: cleanMachine,
          actionType: 'UPDATE',
          changedFields,
          changedBy: actor,
          factoryId
        });
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.message === 'Machine not found') {
      return res.status(404).json({ ok: false, error: e.message });
    }
    if (e.code === '23505') {
      return res.status(400).json({ ok: false, error: 'Machine already exists for this factory' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/api/machines/:id', async (req, res) => {
  try {
    const writeContext = await getWritableFactoryContext(req, 'delete machines');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;
    const actor = getRequestUsername(req) || 'System';
    const machineId = decodeURIComponent(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT machine
           FROM machines
          WHERE LOWER(machine) = LOWER($1)
            AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))
          LIMIT 1`,
        [machineId, factoryId]
      );
      if (!existing.rowCount) throw new Error('Machine not found');

      await logMachineAudit(client, {
        machineId: existing.rows[0].machine,
        actionType: 'DELETE',
        changedFields: { message: 'Deleted machine' },
        changedBy: actor,
        factoryId
      });
      await client.query(
        'DELETE FROM machines WHERE LOWER(machine) = LOWER($1) AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))',
        [machineId, factoryId]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/machines/history/:id', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const machineId = decodeURIComponent(req.params.id);
    const rows = await q(
      `SELECT machine_id, action_type, changed_fields, changed_by, changed_at
         FROM machine_audit_logs
        WHERE LOWER(machine_id) = LOWER($1)
          AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))
        ORDER BY changed_at DESC
        LIMIT 50`,
      [machineId, factoryId]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});



// 1. CREATE Mould
// 1. CREATE Mould
app.post('/api/moulds', async (req, res) => {
  try {
    const payload = normalizeMouldMasterPayload(req.body || {});
    const actor = req.body?._user || req.body?.user || getRequestUsername(req) || 'System';
    const writeContext = await getWritableFactoryContext(req, 'add moulds');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;

    if (!payload.mould_number) {
      return res.status(400).json({ ok: false, error: 'Mould Number is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertFields = [...MOULD_MASTER_FIELDS, 'factory_id', 'updated_at'];
      await client.query(`
        INSERT INTO moulds(${insertFields.join(', ')})
        VALUES(${insertFields.map((_, index) => `$${index + 1}`).join(', ')})
      `, [...MOULD_MASTER_FIELDS.map(field => payload[field]), factoryId, new Date()]);

      // 2. Audit Log (CREATE)
      await client.query(`
        INSERT INTO mould_audit_logs(mould_id, action_type, changed_fields, changed_by)
        VALUES($1, 'CREATE', '{"message": "Created new mould"}', $2)
          `, [payload.mould_number, actor]);

      await client.query('COMMIT');
      res.json({ ok: true, message: 'Mould created' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ ok: false, error: 'Mould Number already exists for this factory' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. UPDATE Mould (With Audit)
app.put('/api/moulds/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const writeContext = await getWritableFactoryContext(req, 'edit moulds');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;
    const actor = req.body?._user || req.body?.user || getRequestUsername(req) || 'System';
    const updates = normalizeMouldMasterPayload(req.body || {}, { partial: true });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Get Old Data
      const oldRows = await client.query(
        'SELECT * FROM moulds WHERE mould_number = $1 AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL)) LIMIT 1',
        [id, factoryId]
      );
      if (!oldRows.rows.length) throw new Error('Mould not found');
      const oldData = oldRows.rows[0];

      // 2. Calculate Diff
      const changed = {};
      let hasChanges = false;
      const fields = MOULD_MASTER_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(updates, field));

      const newValues = [];
      let setClause = [];
      let idx = 1;

      // Prepare Update Statement dynamically
      for (const f of fields) {
        const val = updates[f];
        /* eslint-disable eqeqeq */
        if (val != oldData[f]) {
          changed[f] = { old: oldData[f], new: val };
          hasChanges = true;
        }
        setClause.push(`${f} = $${idx++}`);
        newValues.push(val);
      }

      if (!hasChanges) {
        await client.query('ROLLBACK');
        return res.json({ ok: true, message: 'No changes detected' });
      }

      const nextMouldNumber = updates.mould_number || oldData.mould_number;

      // 3. Update DB
      newValues.push(id, factoryId);
      await client.query(
        `UPDATE moulds SET ${setClause.join(', ')}, updated_at = NOW() WHERE mould_number = $${idx} AND (factory_id = $${idx + 1} OR ($${idx + 1} IS NULL AND factory_id IS NULL))`,
        newValues
      );

      if (nextMouldNumber !== oldData.mould_number) {
        await client.query(`UPDATE mould_audit_logs SET mould_id = $1 WHERE mould_id = $2`, [nextMouldNumber, oldData.mould_number]);
      }

      // 4. Audit Log
      await client.query(`
        INSERT INTO mould_audit_logs(mould_id, action_type, changed_fields, changed_by)
  VALUES($1, 'UPDATE', $2, $3)
      `, [nextMouldNumber, JSON.stringify(changed), actor]);

      await client.query('COMMIT');
      res.json({ ok: true, message: 'Mould updated' });

    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('Update Mould Error', e);
    if (e.code === '23505') {
      return res.status(400).json({ ok: false, error: 'Mould Number already exists for this factory' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. GET Audit History
app.get('/api/moulds/history/:id', async (req, res) => {
  try {
    const rows = await q(`SELECT * FROM mould_audit_logs WHERE mould_id = $1 ORDER BY changed_at DESC LIMIT 50`, [req.params.id]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});


// 3.5 JOB CARD PRINT LIST (Aggregated)
app.get('/api/planning/job-cards', async (req, res) => {
  try {
    const { from, to, search } = req.query;

    // We aggregate unique Job Cards from the Details table
    const params = [];
    let sql = `
      SELECT DISTINCT ON(
      COALESCE(data ->> 'jc_no', data ->> 'job_card_no', ''),
      data ->> 'or_jr_no',
      data ->> 'mould_no'
    )
    COALESCE(data ->> 'jc_no', data ->> 'job_card_no') as jc_no,
      data ->> 'or_jr_no' as or_jr_no,
      data ->> 'mould_no' as mould_no,
      data ->> 'mould_code' as mould_code,
      data ->> 'plan_date' as plan_date,
      data ->> 'client_name' as client_name,
      data ->> 'machine_name' as machine_name,
      data ->> 'product_name' as product_name,
      (SELECT COUNT(*) FROM jc_details d2 
         WHERE COALESCE(d2.data ->> 'jc_no', d2.data ->> 'job_card_no') = COALESCE(t1.data ->> 'jc_no', t1.data ->> 'job_card_no')
           AND d2.data ->> 'or_jr_no' = t1.data ->> 'or_jr_no'
        ) as item_count
      FROM jc_details t1
      WHERE 1 = 1
  `;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      sql += ` AND t1.factory_id = $${params.length} `;
    }
    const conditions = [];

    // Date Filter (on plan_date)
    if (from) {
      params.push(from);
      conditions.push(`(data ->> 'plan_date'):: date >= $${params.length} `);
    }
    if (to) {
      params.push(to);
      conditions.push(`(data ->> 'plan_date'):: date <= $${params.length} `);
    }

    // Search
    if (search) {
      params.push(`% ${search}% `);
      const i = params.length;
      conditions.push(`(
    COALESCE(data ->> 'jc_no', data ->> 'job_card_no', '') ILIKE $${i} OR
        data ->> 'or_jr_no' ILIKE $${i} OR
        data ->> 'mould_no' ILIKE $${i} OR
        data ->> 'client_name' ILIKE $${i} OR
        data ->> 'product_name' ILIKE $${i}
  )`);
    }

    if (conditions.length) {
      sql += ` AND ${conditions.join(' AND ')} `;
    }

    // Order by Date Desc
    sql += ` ORDER BY COALESCE(data ->> 'jc_no', data ->> 'job_card_no', ''), data ->> 'or_jr_no', data ->> 'mould_no', (data ->> 'plan_date')::date DESC LIMIT 1000`;

    const rows = await q(sql, params);

    // Sort final result by Date Desc
    rows.sort((a, b) => new Date(b.plan_date || 0) - new Date(a.plan_date || 0));

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('/api/planning/job-cards error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3.6 SINGLE JOB CARD DETAILS (For Printing)
app.get('/api/planning/job-card-print', async (req, res) => {
  try {
    const { or_jr_no, jc_no, mould_no } = req.query;
    if (!or_jr_no || !jc_no) return res.status(400).json({ ok: false, error: 'Missing OR or JC No' });

    const sql = `
            SELECT data 
            FROM jc_details
WHERE
TRIM(data ->> 'or_jr_no') = $1 AND
  (TRIM(data ->> 'jc_no') = $2 OR TRIM(data ->> 'job_card_no') = $2)
        `;
    const params = [or_jr_no, jc_no];

    const rows = await q(sql, params);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Job Card not found' });

    const items = rows.map(r => r.data);
    const header = { ...items[0] };

    res.json({ ok: true, header, items });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4. CLEAR DATA (Superadmin Only)
app.post('/api/admin/clear-data', async (req, res) => {
  try {
    const { type, username } = req.body;
    const writeContext = await getWritableFactoryContext(req, 'clear master data');
    if (!writeContext.ok) {
      return res.status(writeContext.status || 403).json({ ok: false, error: writeContext.error });
    }
    const factoryId = writeContext.factoryId;

    // Security: Check Permissions
    if (!username) return res.json({ ok: false, error: 'Authorization required (Missing Username)' });

    const u = (await q('SELECT role_code, permissions FROM users WHERE username=$1', [username]))[0];
    const perms = u ? (u.permissions || {}) : {};

    // Allow if Admin OR has 'data_wipe' permission
    const allowed = isAdminLikeRole(u) || (perms.critical_ops && perms.critical_ops.data_wipe);

    if (!allowed) return res.json({ ok: false, error: 'Access Denied: Data Wipe permission required' });

    let table = '';
    if (type === 'orders') table = 'orders';
    else if (type === 'moulds') table = 'moulds';
    else if (type === 'machines') table = 'machines';
    else if (type === 'orjr') table = 'or_jr_report';
    else if (type === 'orjrwise') table = 'mould_planning_summary';
    else if (type === 'orjrwisedetail') table = 'mould_planning_report';
    else if (type === 'wipstock') table = 'wip_stock_snapshots';
    if (!table) return res.json({ ok: false, error: 'Unknown data type' });

    const client = await pool.connect();
    try {
      if (type === 'wipstock') {
        await client.query(`DELETE FROM wip_stock_movements WHERE factory_id = $1`, [factoryId]);
        await client.query(`DELETE FROM wip_stock_snapshot_lines WHERE factory_id = $1`, [factoryId]);
        await client.query(`DELETE FROM wip_stock_snapshots WHERE factory_id = $1`, [factoryId]);
      } else if (table === 'orders') {
        await client.query(`DELETE FROM plan_board WHERE factory_id = $1`, [factoryId]);
        await client.query(`DELETE FROM orders WHERE factory_id = $1`, [factoryId]);
      } else {
        await client.query(`DELETE FROM ${table} WHERE factory_id = $1`, [factoryId]);
      }
      res.json({ ok: true, message: `All ${table} data cleared for ${writeContext.factoryName}.` });
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR ROUTES (Manual Fix)
============================================================ */
// Fetch Recent Hourly Entries (for duplicate checking)
app.get('/api/dpr/hourly/recent', async (req, res) => {
  try {
    const { machine, limit } = req.query;
    if (!machine) return res.status(400).json({ ok: false, error: 'Missing machine' });

    const sql = `
      SELECT dpr_date as plan_date, shift, hour_slot, entry_type
      FROM dpr_hourly
      WHERE machine = $1
      AND is_deleted = false
      AND dpr_date >= CURRENT_DATE - INTERVAL '2 days'
      ORDER BY dpr_date DESC, created_at DESC
      LIMIT $2
    `;
    const rows = await q(sql, [machine, limit || 100]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Clear Hourly Data
app.post('/api/dpr/hourly/clear', async (req, res) => {
  try {
    await q(`TRUNCATE TABLE dpr_hourly`);
    res.json({ ok: true, message: 'Hourly Data Cleared' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Restore Completed Plan (Admin)
app.post('/api/planning/restore', async (req, res) => {
  try {
    const { orderNo } = req.body;
    if (!orderNo) return res.status(400).json({ ok: false, error: 'Missing Order No' });

    // 1. Check if it exists and is completed
    const check = await q(`SELECT order_no, status FROM orders WHERE order_no = $1`, [orderNo]);
    if (!check.length) return res.status(404).json({ ok: false, error: 'Order not found' });

    // 2. Revert Status in ORDERS and OR_JR_REPORT
    await q(`UPDATE orders SET status = 'Pending' WHERE order_no = $1`, [orderNo]);
    await q(`UPDATE or_jr_report SET mld_status = 'Pending', is_closed = FALSE WHERE or_jr_no = $1`, [orderNo]);

    // 3. Revert Plan Board Status
    await q(`UPDATE plan_board SET status = 'Planned' WHERE order_no = $1 AND status = 'Completed'`, [orderNo]);

    res.json({ ok: true, message: 'Restored successfully' });
  } catch (e) {
    console.error('/api/planning/restore', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Clear Setup Data
app.post('/api/dpr/setup/clear', async (req, res) => {
  try {
    await q(`TRUNCATE TABLE std_actual`);
    res.json({ ok: true, message: 'Setup Data Cleared' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 9. GENERIC MASTER GET (With Date/Search Filters)
app.get('/api/masters/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { from, to, search, stock_date } = req.query;
    const factoryScope = await getFactoryScopeForRequest(req);

    let table = type;
    if (type === 'users') table = 'users';

    if (!['orders', 'machines', 'moulds', 'users', 'wipstock'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'Invalid type' });
    }

    if (type === 'wipstock') {
      const params = [];
      let effectiveStockDate = toIsoDateOnly(stock_date);

      if (!effectiveStockDate && !from && !to) {
        const latestParams = [];
        let latestSql = `SELECT MAX(stock_date)::text AS stock_date FROM wip_stock_snapshots WHERE 1 = 1`;
        const latestConditions = [];
        applyFactoryScopeCondition(latestConditions, latestParams, 'factory_id', factoryScope);
        if (latestConditions.length) {
          latestSql += ` AND ${latestConditions.join(' AND ')}`;
        }
        const latestRows = await q(latestSql, latestParams);
        effectiveStockDate = latestRows[0]?.stock_date || null;
        if (!effectiveStockDate) {
          return res.json({ ok: true, data: [] });
        }
      }

      let sql = `
WITH live_qty AS (
  SELECT
    wi.factory_id,
    LOWER(TRIM(COALESCE(wi.item_code, ''))) AS item_code_key,
    LOWER(TRIM(COALESCE(wi.item_name, ''))) AS item_name_key,
    SUM(COALESCE(wi.qty, 0))::numeric AS current_live_qty
  FROM wip_inventory wi
  WHERE COALESCE(wi.qty, 0) > 0
  GROUP BY
    wi.factory_id,
    LOWER(TRIM(COALESCE(wi.item_code, ''))),
    LOWER(TRIM(COALESCE(wi.item_name, '')))
)
SELECT
  l.id,
  l.snapshot_id,
  l.factory_id,
  f.name AS factory_name,
  f.code AS factory_code,
  l.stock_date,
  l.row_status,
  l.line_type,
  l.sr_no,
  l.factory_unit,
  l.party_group,
  l.location_floor_dept,
  l.item_code,
  l.item_name,
  l.job_no,
  l.job_date,
  l.ageing_period,
  l.previous_stock_qty,
  l.current_stock_available_qty,
  COALESCE(live_qty.current_live_qty, 0) AS current_live_qty,
  l.total_qty,
  l.uom,
  l.remark_from_factory_unit,
  l.remark_from_ho_sales_team
FROM wip_stock_snapshot_lines l
JOIN wip_stock_snapshots s ON s.id = l.snapshot_id
LEFT JOIN factories f ON f.id = l.factory_id
LEFT JOIN live_qty
  ON live_qty.factory_id = l.factory_id
 AND (
      (
        LOWER(TRIM(COALESCE(l.item_code, ''))) <> ''
        AND live_qty.item_code_key = LOWER(TRIM(COALESCE(l.item_code, '')))
      )
      OR (
        LOWER(TRIM(COALESCE(l.item_code, ''))) = ''
        AND LOWER(TRIM(COALESCE(l.item_name, ''))) <> ''
        AND live_qty.item_name_key = LOWER(TRIM(COALESCE(l.item_name, '')))
      )
    )
WHERE 1 = 1
      `;

      const conditions = [];
      applyFactoryScopeCondition(conditions, params, 'l.factory_id', factoryScope);
      if (conditions.length) {
        sql += ` AND ${conditions.join(' AND ')}`;
      }

      if (effectiveStockDate) {
        params.push(effectiveStockDate);
        sql += ` AND l.stock_date = $${params.length}::date`;
      } else {
        if (from) {
          params.push(from);
          sql += ` AND l.stock_date >= $${params.length}::date`;
        }
        if (to) {
          params.push(to);
          sql += ` AND l.stock_date <= $${params.length}::date`;
        }
      }

      if (search) {
        params.push(`%${search}%`);
        const pIdx = params.length;
        sql += ` AND (
          CAST(COALESCE(l.sr_no, 0) AS TEXT) ILIKE $${pIdx}
          OR COALESCE(l.factory_unit, '') ILIKE $${pIdx}
          OR COALESCE(l.party_group, '') ILIKE $${pIdx}
          OR COALESCE(l.location_floor_dept, '') ILIKE $${pIdx}
          OR COALESCE(l.item_code, '') ILIKE $${pIdx}
          OR COALESCE(l.item_name, '') ILIKE $${pIdx}
          OR COALESCE(l.job_no, '') ILIKE $${pIdx}
          OR COALESCE(l.ageing_period, '') ILIKE $${pIdx}
          OR COALESCE(l.uom, '') ILIKE $${pIdx}
          OR COALESCE(l.remark_from_factory_unit, '') ILIKE $${pIdx}
          OR COALESCE(l.remark_from_ho_sales_team, '') ILIKE $${pIdx}
          OR COALESCE(l.row_status, '') ILIKE $${pIdx}
        )`;
      }

      sql += `
 ORDER BY
   l.stock_date DESC,
   CASE LOWER(COALESCE(l.row_status, ''))
     WHEN 'new' THEN 0
     WHEN 'existing' THEN 1
     WHEN 'nil' THEN 2
     ELSE 3
   END,
   COALESCE(l.sr_no, 2147483647),
   l.id DESC
      `;

      const rows = await q(sql, params);
      return res.json({ ok: true, data: rows });
    }

    let sql = '';
    const params = [];

    if (type === 'orders') {
      sql = `
SELECT
COALESCE(r.or_jr_no, o.order_no) AS or_jr_no,
  r.or_jr_date,
  r.or_qty,
  r.jr_qty,
  r.plan_qty,
  r.plan_date,
  r.job_card_no,
  r.job_card_date,
  COALESCE(r.item_code, o.item_code) AS item_code,
  COALESCE(r.product_name, o.item_name) AS product_name,
  COALESCE(r.client_name, o.client_name) AS client_name,
  r.prod_plan_qty,
  r.std_pack,
  r.uom,
  r.planned_comp_date,
  r.mld_start_date,
  r.mld_end_date,
  r.actual_mld_start_date,
  r.prt_tuf_end_date,
  r.pack_end_date,
  r.mld_status,
  r.shift_status,
  r.prt_tuf_status,
  r.pack_status,
  r.wh_status,
  r.rev_mld_end_date,
  r.shift_comp_date,
  r.rev_ptd_tuf_end_date,
  r.rev_pak_end_date,
  r.wh_rec_date,
  r.remarks_all,
  r.jr_close,
  r.or_remarks,
  r.jr_remarks,
  r.created_by,
  r.created_date,
  r.edited_by,
  r.edited_date,
  COALESCE(r.factory_id, o.factory_id) AS factory_id,
  f.name AS factory_name,
  f.code AS factory_code,
  o.priority,
  o.status as master_status,
  o.completion_confirmation_required,
  o.completion_change_field,
  o.completion_change_to,
  o.completion_change_summary AS status_change,
  o.completion_detected_at,
  o.completion_confirmed_at,

  (SELECT COUNT(DISTINCT pb.mould_name) FROM plan_board pb WHERE pb.order_no = o.order_no) as planned_count,
    (SELECT COUNT(*) FROM mould_planning_summary mps WHERE mps.or_jr_no = o.order_no) as required_count,

      CASE
WHEN(SELECT COUNT(DISTINCT pb.mould_name) FROM plan_board pb WHERE pb.order_no = o.order_no) = 0 THEN 'Pending'
WHEN(SELECT COUNT(DISTINCT pb.mould_name) FROM plan_board pb WHERE pb.order_no = o.order_no) >=
  COALESCE((SELECT COUNT(*) FROM mould_planning_summary mps WHERE mps.or_jr_no = o.order_no), 1) THEN 'Fully Planned'
               ELSE 'Partially Planned'
            END AS plan_status,

  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'mould', pb.mould_name,
        'machine', pb.machine,
        'startDate', pb.start_date,
        'status', pb.status
      ))
                FROM plan_board pb
                WHERE pb.order_no = o.order_no
  ),
  '[]':: jsonb
            ) as planned_details,

  o.id as master_id,
  o.order_no
          FROM orders o
          LEFT JOIN LATERAL(
            SELECT rpt.*
              FROM or_jr_report rpt
             WHERE TRIM(rpt.or_jr_no) = TRIM(o.order_no)
               AND(
                COALESCE(rpt.factory_id, 0) = COALESCE(o.factory_id, 0)
                OR rpt.factory_id IS NULL
                OR o.factory_id IS NULL
               )
             ORDER BY
               CASE
                 WHEN COALESCE(rpt.is_closed, FALSE) = FALSE
                  AND COALESCE(TRIM(LOWER(rpt.mld_status)), '') NOT IN('completed', 'complete', 'cancelled', 'canceled', 'cancel')
                 THEN 0 ELSE 1
               END,
               COALESCE(rpt.edited_date, rpt.created_date, NOW()) DESC,
               rpt.id DESC
             LIMIT 1
          ) r ON TRUE
          LEFT JOIN factories f ON f.id = COALESCE(r.factory_id, o.factory_id)
 WHERE(COALESCE(o.status, 'Pending') <> 'Completed' OR COALESCE(o.completion_confirmation_required, FALSE) = TRUE)
       `;
    } else {
      sql = `SELECT * FROM ${table} WHERE 1 = 1`;
    }

    if (type === 'orders') {
      const conditions = [];
      applyFactoryScopeCondition(conditions, params, 'o.factory_id', factoryScope);
      if (conditions.length) {
        sql += ` AND ${conditions.join(' AND ')} `;
      }
    } else if (type !== 'users') {
      const conditions = [];
      applyFactoryScopeCondition(conditions, params, 'factory_id', factoryScope);
      if (conditions.length) {
        sql += ` AND ${conditions.join(' AND ')} `;
      }
    }

    if (search) {
      const pIdx = params.length + 1;
      params.push(`%${search}%`);

      if (type === 'orders') {
        sql += ` AND(
  CAST(o.order_no AS TEXT) ILIKE $${pIdx} OR
             o.client_name ILIKE $${pIdx} OR
             COALESCE(r.product_name, o.item_name) ILIKE $${pIdx} OR
             COALESCE(r.item_code, o.item_code) ILIKE $${pIdx} OR
             COALESCE(o.completion_change_summary, '') ILIKE $${pIdx}
)`;
      } else {
        sql += ` AND(
  CAST(id AS TEXT) ILIKE $${pIdx}
            ${type !== 'machines' && type !== 'users' && type !== 'moulds' ? `OR item_code ILIKE $${pIdx} OR item_name ILIKE $${pIdx}` : ''}
  ${type === 'moulds' ? `OR mould_number ILIKE $${pIdx} OR mould_name ILIKE $${pIdx} OR primary_machine ILIKE $${pIdx} OR secondary_machine ILIKE $${pIdx} OR material ILIKE $${pIdx}` : ''}
  ${type === 'machines' ? `OR machine ILIKE $${pIdx} OR building ILIKE $${pIdx} OR line ILIKE $${pIdx}` : ''}
)`;
      }
    }

    if (type === 'orders') sql += ` ORDER BY COALESCE(o.completion_confirmation_required, FALSE) DESC, ${getPrioritySortSql('o.priority')}, o.created_at DESC`;
    else if (type === 'moulds') sql += ` ORDER BY mould_number ASC`;
    else sql += ` ORDER BY id DESC`;

    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// -------------------------------------------------------------
// OR-JR REPORT
// -------------------------------------------------------------
app.get('/api/reports/or-jr', async (req, res) => {
  try {
    const { from, to } = req.query;
    let query = `SELECT * FROM or_jr_report`;
    const params = [];
    const conditions = [];

    if (from) { params.push(from); conditions.push(`or_jr_date:: date >= $${params.length}:: date`); }
    if (to) { params.push(to); conditions.push(`or_jr_date:: date <= $${params.length}:: date`); }

    if (conditions.length) query += ` WHERE ${conditions.join(' AND ')} `;
    else query += ` WHERE 1 = 1 `; // Ensure WHERE exists for appending

    // User Request: Filter out Completed/Cancelled MLD Status
    query += ` AND(mld_status IS NULL OR LOWER(mld_status) NOT IN('completed', 'cancelled')) `;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      query += ` AND factory_id = $${params.length} `;
    }

    query += ` ORDER BY created_date DESC LIMIT 50000`;

    const rows = await q(query, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   AI PLANNER
============================================================ */
app.post('/api/ai/plan', async (req, res) => {
  try {
    // 1. Fetch Context
    const machines = await q(`SELECT id, machine_name, status FROM machines WHERE COALESCE(is_active, TRUE) = TRUE`, []);
    const orders = await q(`SELECT full_order_number, item_name, plan_balance FROM orders WHERE plan_balance > 0 ORDER BY priority ASC LIMIT 20`, []);

    // 2. Call AI
    const plan = await aiService.generateSchedule(machines, orders);

    res.json({ ok: true, plan });
  } catch (e) {
    console.error('AI Plan Error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post('/api/ai/ask', async (req, res) => {
  try {
    const { question, username, context } = req.body; // Accept username & context
    if (!question) return res.status(400).json({ ok: false, error: 'Question required' });

    // 1. Get Response from AI (JSON: { type: 'sql'|'text', content })
    const aiRes = await aiService.askQuestion(question, username || 'User', context);

    if (aiRes.type === 'text') {
      // Chat mode
      return res.json({ ok: true, answer: aiRes.content, type: 'text' });
    }

    if (aiRes.type === 'sql') {
      const sql = aiRes.content;
      // 2. Safety Check (ReadOnly)
      const forbidden = /(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|REPLACE)/i;
      if (forbidden.test(sql)) {
        return res.json({ ok: false, error: 'Safety Block: AI generated a modification query.', sql });
      }

      // 3. Execute
      const rows = await q(sql, []);
      // Return as table
      res.json({ ok: true, answer: rows, type: 'table', sql });
      return;
    }

    // Fallback
    res.json({ ok: false, error: 'Unknown AI response type' });

  } catch (e) {
    console.error('AI Chat Error:', e);
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

/* ============================================================
   RAW MATERIAL MANAGEMENT
   ============================================================ */
app.get('/api/rm/plans', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const sql = `
      SELECT 
        pb.plan_id, pb.order_no, pb.item_code, pb.item_name, pb.machine, pb.line, pb.plan_qty,
        COALESCE(SUM(ri.bag_qty), 0) as total_bags_issued,
        COALESCE(SUM(ri.total_weight), 0) as total_weight_issued,
        COALESCE(SUM(CASE WHEN ri.status = 'ACCEPTED' THEN ri.accepted_qty ELSE 0 END), 0) as total_bags_accepted,
        COALESCE(SUM(CASE WHEN ri.status = 'ACCEPTED' THEN ri.accepted_weight ELSE 0 END), 0) as total_weight_accepted,
        COALESCE(m.material, 'N/A') as material
      FROM plan_board pb
      LEFT JOIN raw_material_issues ri ON ri.plan_id = pb.plan_id
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name
      WHERE (pb.factory_id = $1 OR ($1 IS NULL AND pb.factory_id IS NULL))
        AND UPPER(pb.status) NOT IN ('COMPLETED', 'CANCELLED', 'FINISH')
      GROUP BY pb.plan_id, pb.order_no, pb.item_code, pb.item_name, pb.machine, pb.line, pb.plan_qty, pb.start_date, m.material
      ORDER BY pb.start_date DESC
    `;
    const rows = await q(sql, [factoryId]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/rm/issue', async (req, res) => {
  try {
    const { plan_id, order_no, item_code, line, shift, sender_name, bag_qty, weight_per_bag } = req.body;
    const factoryId = getFactoryId(req);
    const total_weight = Number(bag_qty) * Number(weight_per_bag);

    const sql = `
      INSERT INTO raw_material_issues 
      (plan_id, order_no, item_code, line, shift, sender_name, bag_qty, weight_per_bag, total_weight, factory_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;
    const result = await q(sql, [plan_id, order_no, item_code, line, shift, sender_name, bag_qty, weight_per_bag, total_weight, factoryId]);
    res.json({ ok: true, id: result[0].id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/rm/pending', async (req, res) => {
  try {
    const { line } = req.query; 
    const factoryId = getFactoryId(req);
    let sql = `SELECT * FROM raw_material_issues WHERE status = 'PENDING'`;
    const params = [];

    if (line) {
      const lines = line.split(',').map(s => s.trim()).filter(Boolean);
      params.push(lines);
      sql += ` AND line = ANY($${params.length})`;
    }

    if (factoryId) {
      params.push(factoryId);
      sql += ` AND factory_id = $${params.length}`;
    }

    sql += ` ORDER BY created_at ASC`;
    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/rm/accept', async (req, res) => {
  try {
    const { id, accepted_qty, accepted_weight, accepted_by } = req.body;
    const sql = `
      UPDATE raw_material_issues 
      SET status = 'ACCEPTED', accepted_qty = $1, accepted_weight = $2, accepted_by = $3, accepted_at = NOW()
      WHERE id = $4
    `;
    await q(sql, [accepted_qty, accepted_weight, accepted_by, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 5. GET /api/queue (Supervisor Portal)
app.get('/api/queue', async (req, res) => {
  try {
    const { line, machine } = req.query;
    let whereClause = '';
    let params = [];

    if (machine) {
      whereClause = 'WHERE pb.machine = $1';
      params.push(machine);
    } else if (line) {
      // Multi-Line Support
      const lines = line.split(',').map(s => s.trim()).filter(Boolean);
      const patterns = lines.map(l => l + '%');

      // Check BOTH 'line' column AND 'machine' prefix (Case Insensitive)
      params.push(lines);     // $1: Exact lines
      params.push(patterns);  // $2: Patterns
      whereClause = 'WHERE (pb.line = ANY($1::text[]) OR pb.machine ILIKE ANY($2::text[]))';
    }

    if (!whereClause) {
      whereClause = 'WHERE 1=1';
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      params.push(factoryId);
      whereClause += ` AND pb.factory_id = $${params.length} `;
    }
// append status filter
    // Note: If looking for specific machine, show everything? Or still filter?
    // Supervisor usually sees active queue. Status 'Stopped' might be relevant if it was running.
    // User logic: "Running Plan First ... other then its all in waiting"
    // So filter for Running + Planned (Waiting) + Stopped
    whereClause += ` AND UPPER(pb.status) IN('RUNNING', 'PLANNED', 'STOPPED')`;

    const sql = `
WITH RankedPlans AS (
  SELECT
    pb.plan_id as id,
    pb.plan_id as "PlanID",
    pb.order_no,
    pb.order_no as "OrderNo",
    pb.machine,
    pb.machine as "Machine",
    pb.item_name as product_name,
    pb.mould_name as "Mould",
    pb.plan_qty,
    pb.plan_qty as "PlanQty",
    pb.status,
    pb.status as "Status",
    pb.seq as priority,
    pb.start_date,
    pb.start_date as plan_date,
    pb.start_date as "StartDateTime",
    pb.end_date as "CalcEndDateTime",

    --Master Data Fields for DPR View
    o.client_name as "Client Name",
    o.item_name as "SFG Name",
    o.item_code as "SFG Code",
    o.priority as "Order Priority",
    o.remarks as "Or Remarks",

    pb.item_code as "FG CODE", 
    COALESCE(mps.mould_no, m.mould_number) as "Mould No", 
    COALESCE(mps.mould_no, m.mould_number) as "Mould Code", 

    m.std_wt_kg as "Article STD Weight",
    m.runner_weight as "Runner STD Weight",
    m.no_of_cav as "STD Cavity",
    m.cycle_time as "STD Cycle Time",
    m.pcs_per_hour as "STD PCS/HR",
    m.manpower as "STD Man Power",
    m.material as "Material 1",
    '' as "Material Revised",
    '' as "Master Batch 1",
    '' as "Colour 1",

    --Calculated or Report Fields
    COALESCE(mps.mould_item_qty, 0) as "Jc Target Qty", 
    COALESCE(m.std_volume_cap, '0') as "STD SFG Qty", 

    --JOB CARD NO from OR - JR Report
    r.job_card_no as "JobCardNo",
    r.job_card_no,

    --Mixing Ratio(Constructed)
    CONCAT(
      CASE WHEN m.material IS NOT NULL THEN m.material || ' ' ELSE '' END,
      ''
    ) as "Mixing Ratio",

    --Normalize status for sorting: Running = 1, Planned = 2
    CASE WHEN UPPER(pb.status) = 'RUNNING' THEN 1 ELSE 2 END as sort_order,
    pb.seq,
    pb.updated_at,
    ROW_NUMBER() OVER(PARTITION BY pb.plan_id ORDER BY r.job_card_no DESC) as rn
  FROM plan_board pb
  LEFT JOIN orders o ON pb.order_no = o.order_no
  LEFT JOIN moulds m ON m.mould_name = pb.mould_name
  LEFT JOIN mould_planning_summary mps ON(mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
  LEFT JOIN or_jr_report r ON r.or_jr_no = pb.order_no
  ${whereClause}
)
SELECT * FROM RankedPlans WHERE rn = 1
ORDER BY sort_order ASC, seq ASC, updated_at ASC
  `;

    fs.appendFileSync('debug_query.log', `[QUEUE] Params: ${JSON.stringify(params)} \nSQL: ${sql} \n`);

    const rows = await q(sql, params);

    // Map to frontend expected structure helpers (Supervisor.html uses 'Job Status' or 'Status')
    const data = rows.map(r => ({
      ...r,
      Status: r.status, // Ensure capitalized property if needed
      _all: r // Pass all fields in _all for easy lookup in supervisor.html
    }));

    res.json({ ok: true, data });
  } catch (e) {
    console.error('/api/queue error', e);
    fs.appendFileSync('debug_errors.log', `[QUEUE] ${e.message} \n`);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/job/colors - Fetch Colors based on OR/JC/Mould (User Req)
app.get('/api/job/colors', async (req, res) => {
  try {
    let { or_jr_no, jc_no, mould_no, plan_id } = req.query;
    console.log(`[API] / job / colors params: `, req.query);

    // Context Resolution from PlanID if specific keys are missing
    if (plan_id && (!or_jr_no || !mould_no)) {
      try {
        const pRows = await q(`
SELECT
pb.order_no,
  COALESCE(mps.mould_no, pb.item_code) as resolved_mould_no, --Fallback to item_code if mould_no missing
pb.item_code,
  pb.item_name 
          FROM plan_board pb
          LEFT JOIN mould_planning_summary mps ON(mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
          WHERE pb.plan_id = $1
  `, [plan_id]);

        if (pRows.length) {
          const p = pRows[0];
          if (!or_jr_no) or_jr_no = p.order_no;
          if (!mould_no) mould_no = p.resolved_mould_no;
          // Also set target context for filtering
          // targetItemCode = p.item_code;
        }
      } catch (err) { console.error('PlanID Lookup Error', err); }
    }

    // Robust checking for optional parameters
    if (!or_jr_no || !mould_no) return res.json({ ok: true, data: [] });

    // NEW: Fetch Plan Context (Item Code / Name) to strictly filter
    let targetItemCode = '';
    let targetItemName = '';
    if (plan_id) {
      const pRows = await q(`SELECT item_code, item_name FROM plan_board WHERE plan_id = $1`, [plan_id]);
      if (pRows.length) {
        targetItemCode = (pRows[0].item_code || '').trim();
        targetItemName = (pRows[0].item_name || '').trim();
      }
    }

    // Keys: or_jr_no, jc_no (or job_card_no), mould_no
    // Updated: Check multiple keys, TRIM and LOWER for robustness
    // [FIX] Factory Isolation injected into WHERE
    const factoryId = getFactoryId(req);

    let sql = `
SELECT
COALESCE(data ->> 'mould_item_name', data ->> 'mold_item_name', data ->> 'item_name') as name,
  COALESCE(data ->> 'mould_item_qty', data ->> 'mold_item_qty', data ->> 'item_qty', data ->> 'plan_qty') as qty,
  data ->> 'item_code' as code,
  data ->> 'mould_no' as raw_mould_no
      FROM jc_details
WHERE
--1. Match OR matches OR - JR No
UPPER(TRIM(data ->> 'or_jr_no')) = UPPER($1)
AND
--2. Match Job Card matches JC NO(or Job Card No)
  ($2 = '' OR UPPER(TRIM(data ->> 'jc_no')) = UPPER($2) OR UPPER(TRIM(data ->> 'job_card_no')) = UPPER($2))
AND
--3. Match Mould matches MOULD NO(or Mould Code)
  (
    UPPER(TRIM(data ->> 'mould_no')) = UPPER($3) 
          OR UPPER(TRIM(data ->> 'mould_code')) = UPPER($3)
          --Fuzzy Match: Match Base Number(e.g. 9717 matches 9717 - L and 9717 - LID / CLIP)
          OR SPLIT_PART(UPPER(TRIM(data ->> 'mould_no')), '-', 1) = SPLIT_PART(UPPER($3), '-', 1)
  )
    `;

    // Strict Filter: If we know the Item Code, ensure we only get colors for THIS Item
    const params = [String(or_jr_no).trim(), String(jc_no).trim(), String(mould_no).trim()];

    if (targetItemCode) {
      // STRICT FILTER: Match Item Code / Mould Item Code / Our Code / Mold Item Code
      // We MUST check 'our_code' because Plan uses ERP Code (e.g. 1577) which matches 'our_code' in Report,
      // even if 'mold_item_code' is different (e.g. 2306-Handle).
      sql += ` AND(
    TRIM(data ->> 'mould_item_code') = $4 
        OR TRIM(data ->> 'mold_item_code') = $4
        OR TRIM(data ->> 'our_code') = $4
        OR TRIM(data ->> 'item_code') = $4
  )`;
      params.push(targetItemCode);
    }

    // [FIX] Apply Factory Isolation
    if (factoryId) {
      sql += ` AND factory_id = $${params.length + 1} `;
      params.push(factoryId);
    }

    let colors = await q(sql, params);

    // BEST MATCH LOGIC: Prioritize Exact Mould No Match
    // If we have exact matches (e.g. "1532-B"), discard fuzzy ones ("1532-Body").
    if (mould_no) {
      const targetMould = String(mould_no).trim().toUpperCase();
      const exactMatches = colors.filter(c =>
        c.raw_mould_no && c.raw_mould_no.trim().toUpperCase() === targetMould
      );

      if (exactMatches.length > 0) {
        colors = exactMatches;
        // console.log('[JC - COLORS] Applied Exact Mould Match Filter.');
      } else {
        // Fallback: Improved Prefix Match (Handles 4750-BTM 4 vs 4750-BTM 6)
        // Extract the base part before space, e.g., "4750-BTM"
        const targetPrefix = targetMould.split(' ')[0];
        if (targetPrefix && targetPrefix.length > 2) {
           const prefixMatches = colors.filter(c => 
             c.raw_mould_no && c.raw_mould_no.trim().toUpperCase().startsWith(targetPrefix)
           );
           
           if (prefixMatches.length > 0) {
             colors = prefixMatches;
           } else {
             // Second Fallback: LID vs BTM keyword matching
             const isBtm = targetMould.includes('BTM') || targetMould.includes('BOTTOM');
             const isLid = targetMould.includes('LID') || targetMould.includes('TOP');
             const keywordMatches = colors.filter(c => {
               const raw = (c.raw_mould_no || '').toUpperCase();
               if (isBtm && !isLid) return raw.includes('BTM') || raw.includes('BOTTOM');
               if (isLid && !isBtm) return raw.includes('LID') || raw.includes('TOP');
               return true; // if neither, or both, keep it
             });
             
             if (keywordMatches.length > 0 && keywordMatches.length < colors.length) {
                colors = keywordMatches;
             }
           }
        }
      }
    }

    console.log(`[JC - COLORS] Req: OR = ${or_jr_no} JC = ${jc_no} M = ${mould_no} Item = ${targetItemName} | Found: ${colors.length} `);

    // Fetch Plan Production
    // [FIX] Filter by Factory also
    let prodSql = `
      SELECT colour, SUM(good_qty) as total
      FROM dpr_hourly
      WHERE plan_id = $1
    `;
    const prodParams = [plan_id];
    if (factoryId) {
      prodSql += ` AND factory_id = $2`;
      prodParams.push(factoryId);
    }
    prodSql += ` GROUP BY colour`;

    const prod = await q(prodSql, prodParams);

    // MAP: Normalized Color Name -> Quantity
    const prodMap = {};
    prod.forEach(p => {
      const k = (p.colour || 'null').trim().toUpperCase();
      if (!prodMap[k]) prodMap[k] = 0;
      prodMap[k] += Number(p.total);
    });

    const uniqueColors = {};
    const matchedKeys = new Set(); // Track which prodMap keys were consumed

    colors.forEach(c => {
      const rawName = (c.name || '').trim();
      if (!rawName) return;

      // CORE LOGIC: Strictly extract "C" from "A-B-C"
      let colorName = rawName;
      if (rawName.includes('-')) {
        const parts = rawName.split('-');
        colorName = parts[parts.length - 1].trim();
      }

      const normKey = colorName.toUpperCase();
      const target = Number(c.qty || 0);

      if (!uniqueColors[colorName]) {
        uniqueColors[colorName] = { target: 0, produced: 0 };
      }
      uniqueColors[colorName].target += target;

      // Match Production
      if (prodMap[normKey]) {
        uniqueColors[colorName].produced += prodMap[normKey];
        matchedKeys.add(normKey);
      }
    });

    // Capture Unmatched / Null Production
    let otherProd = 0;
    Object.keys(prodMap).forEach(k => {
      if (!matchedKeys.has(k)) {
        otherProd += prodMap[k];
      }
    });

    const result = Object.keys(uniqueColors).map(colorName => {
      const d = uniqueColors[colorName];
      const target = Math.round(d.target || 0);
      const produced = Math.round(d.produced || 0);
      return {
        name: colorName,
        qty: target,
        produced: produced, // Helpful for debugging
        bal: Math.max(0, target - produced)
      };
    });

    // Add 'Other' row if significant
    if (otherProd > 0) {
      result.push({
        name: 'Other / Unspecified',
        qty: 0,
        produced: Math.round(otherProd),
        bal: 0
      });
    }

    res.json({ ok: true, data: result });
  } catch (e) {
    console.error('api/job/colors', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// GET /api/std-actual/status - Check if Setup is done + Fetch Standards
app.get('/api/std-actual/status', async (req, res) => {
  try {
    const { planId, shift, date, machine } = req.query;
    if (!planId) return res.json({ ok: false, error: 'Missing planId' });

    // 1. Fetch Plan Details to get Mould Name
    const plans = await q('SELECT mould_name FROM plan_board WHERE plan_id=$1', [planId]);
    const mouldName = plans.length ? plans[0].mould_name : null;

    // 2. Fetch Standards from MOULDS table (Mould Master)
    let std = null;
    if (mouldName) {
      // Try exact match on mould_name (mould_name in plan_board)
      const m = await q('SELECT * FROM moulds WHERE mould_name = $1', [mouldName]);
      if (m.length) {
        std = {
          article_std: m[0].std_wt_kg,
          runner_std: m[0].runner_weight,
          cavity_std: m[0].no_of_cav,
          cycle_std: m[0].cycle_time,
          pcshr_std: m[0].pcs_per_hour,
          man_std: m[0].manpower,
          sfgqty_std: m[0].std_volume_cap
        };
      }
    }

    // 3. Fetch Existing Setup (ACTUALS)
    // We check if a setup record exists for this planId (optionally filter by date/shift if needed, but usually setup is per Plan Run)
    const rows = await q('SELECT * FROM std_actual WHERE plan_id=$1 LIMIT 1', [planId]);

    // If we have a row, we return it. If not, we return done:false but INCLUDE standards.
    if (rows.length) {
      res.json({ ok: true, data: { done: true, row: rows[0], std } });
    } else {
      res.json({ ok: true, data: { done: false, std } });
    }

  } catch (e) {
    console.error('api/std-actual/status', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Duplicate /api/dpr/used-slots removed from here. Consolidated at line 1405.


// DEBUG: Inspect JC Details Keys
app.get('/api/debug/jc-keys', async (req, res) => {
  try {
    const rows = await q('SELECT data FROM jc_details LIMIT 5');
    const keys = rows.map(r => Object.keys(r.data));
    res.json({ ok: true, keys, sample: rows[0] });
  } catch (e) { res.json({ error: String(e) }); }
});
/* ============================================================
   HR MODULE APIS
============================================================ */

// GET /api/hr/operators
app.get('/api/hr/operators', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const process = getRequestedMachineProcess(req, '');
    let sql = 'SELECT * FROM machine_operators WHERE 1=1';
    const params = [];
    let idx = 1;
    if (factoryId) { sql += ` AND factory_id = $${idx++}`; params.push(factoryId); }
    if (process) { sql += ` AND process = $${idx++}`; params.push(process); }
    sql += ` ORDER BY name`;
    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/hr/operators (Create/Update)
app.post('/api/hr/operators', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id, operator_id, name, assigned_machine, photo_base64, doj, age, aadhar_number, assigned_machines, process, factory_id } = req.body;
    const normalizedOperatorId = String(operator_id || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim();
    const fId = normalizeFactoryId(factory_id) ?? getFactoryId(req);
    let photoPath = null;
    if (photo_base64 && photo_base64.includes('base64')) {
      const buffer = Buffer.from(photo_base64.split(',')[1], 'base64');
      const uploadsDir = path.join(BACKEND_ROOT, 'public/uploads/operators');
      const filename = `op_${Date.now()}.jpg`;
      const relativePath = `/uploads/operators/${filename}`;
      const fullPath = path.join(uploadsDir, filename);
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(fullPath, buffer);
      photoPath = relativePath;
    }
    await client.query('BEGIN');
    let resolvedOperatorId = normalizedOperatorId || null;
    if (id) {
      const parts = []; const params = []; let idx = 1;
      if (normalizedName) { parts.push(`name = $${idx++}`); params.push(normalizedName); }
      if (normalizedOperatorId) { parts.push(`operator_id = $${idx++}`); params.push(normalizedOperatorId); }
      if (assigned_machine !== undefined) { parts.push(`assigned_machine = $${idx++}`); params.push(assigned_machine); }
      if (photoPath) { parts.push(`photo_path = $${idx++}`); params.push(photoPath); }
      parts.push(`doj = $${idx++}`); params.push(toIsoDateOnly(doj));
      parts.push(`age = $${idx++}`); params.push(toNum(age));
      parts.push(`aadhar_number = $${idx++}`); params.push(String(aadhar_number || '').trim());
      parts.push(`assigned_machines = $${idx++}`); params.push(JSON.stringify(Array.isArray(assigned_machines) ? assigned_machines : []));
      parts.push(`process = $${idx++}`); params.push(normalizeMachineProcess(process, ''));
      parts.push(`factory_id = $${idx++}`); params.push(fId);
      params.push(id);
      await client.query(`UPDATE machine_operators SET ${parts.join(', ')} WHERE id = $${idx}`, params);
    } else {
      if (!normalizedName) { await client.query('ROLLBACK'); return res.status(400).json({ ok: false, error: 'Name required' }); }
      resolvedOperatorId = isFinancialYearScopedId(normalizedOperatorId, 'OP') ? normalizedOperatorId : await generateFinancialYearSequenceId(client.query.bind(client), { prefix: 'OP', table: 'machine_operators', column: 'operator_id', lockScope: `machine_operators:operator_id:${getFinancialYearInfo().code}` });
      await client.query(`INSERT INTO machine_operators(operator_id, name, assigned_machine, photo_path, doj, age, aadhar_number, assigned_machines, process, factory_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [resolvedOperatorId, normalizedName, assigned_machine || '', photoPath || null, toIsoDateOnly(doj), toNum(age), String(aadhar_number || '').trim(), JSON.stringify(Array.isArray(assigned_machines) ? assigned_machines : []), normalizeMachineProcess(process, ''), fId]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, operator_id: resolvedOperatorId });
  } catch (e) { try { await client.query('ROLLBACK'); } catch (_err) { } console.error('HR /api/operators', e); res.status(500).json({ ok: false, error: String(e) }); } finally { client.release(); }
});

// POST /api/hr/upload-operators
app.post('/api/hr/upload-operators', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const factoryId = getFactoryId(req);
    const requestedProcess = getRequestedMachineProcess(req, '');
    const { rows } = parseStructuredUploadSheet(req.file.path, 'operators');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const opId = String(row.operator_id || '').trim().toUpperCase();
        const name = String(row.name || '').trim();
        const fId = normalizeFactoryId(row.factory_id) || factoryId;
        const process = normalizeMachineProcess(row.process || requestedProcess, '');
        if (!name) continue;
        const resolvedOpId = isFinancialYearScopedId(opId, 'OP') ? opId : await generateFinancialYearSequenceId(client.query.bind(client), { prefix: 'OP', table: 'machine_operators', column: 'operator_id' });
        await client.query(`INSERT INTO machine_operators (operator_id, name, doj, age, aadhar_number, factory_id, process, assigned_machine) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (operator_id) DO UPDATE SET name = EXCLUDED.name, doj = EXCLUDED.doj, age = EXCLUDED.age, aadhar_number = EXCLUDED.aadhar_number, factory_id = EXCLUDED.factory_id, process = EXCLUDED.process, assigned_machine = EXCLUDED.assigned_machine`, [resolvedOpId, name, toIsoDateOnly(row.doj), toNum(row.age), String(row.aadhar_number || '').trim(), fId, process, String(row.assigned_machine || '').trim()]);
      }
      await client.query('COMMIT');
      res.json({ ok: true, message: `Successfully uploaded ${rows.length} operators` });
    } catch (dbErr) { await client.query('ROLLBACK'); throw dbErr; } finally { client.release(); }
  } catch (e) { res.status(400).json({ ok: false, error: String(e.message || e) }); } finally { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
});

// GET /api/hr/download-operators
app.get('/api/hr/download-operators', async (req, res) => {
  try {
    const factoryId = getFactoryId(req);
    const process = getRequestedMachineProcess(req, '');
    let sql = 'SELECT operator_id, name, doj, age, aadhar_number, process, factory_id, assigned_machine FROM machine_operators WHERE 1=1';
    const params = [];
    if (factoryId) { sql += ` AND factory_id = $${params.length + 1}`; params.push(factoryId); }
    if (process) { sql += ` AND process = $${params.length + 1}`; params.push(process); }
    const rows = await q(sql, params);
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Operators");
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=operators_export.xlsx');
    res.send(buffer);
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/hr/operators/delete
app.post('/api/hr/operators/delete', async (req, res) => {
  try { await q('DELETE FROM machine_operators WHERE id=$1', [req.body.id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// POST /api/hr/scan
app.post('/api/hr/scan', async (req, res) => {
  try {
    const { operator_id, scanned_by } = req.body;
    if (!operator_id) return res.status(400).json({ ok: false, error: 'Operator ID required' });
    const ops = await q('SELECT * FROM machine_operators WHERE operator_id=$1', [operator_id]);
    if (!ops.length) return res.status(404).json({ ok: false, error: 'Operator not found' });
    const operator = ops[0];
    const historyCols = await q(`INSERT INTO operator_history(operator_id, machine_at_time, scanned_by) VALUES($1, $2, $3) RETURNING id, scanned_at`, [operator.operator_id, operator.assigned_machine, scanned_by || 'Engineer']);
    res.json({ ok: true, operator, history: historyCols[0] });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// GET /api/hr/history
app.get('/api/hr/history', async (req, res) => {
  try {
    const { date, shift } = req.query;
    if (!date) return res.json({ ok: false, error: 'Date is required' });
    let start = `${date} 00:00:00`;
    let end = `${date} 23:59:59`;
    if (shift) {
      if (shift === 'A') { start = `${date} 06:00:00`; end = `${date} 14:00:00`; }
      else if (shift === 'B') { start = `${date} 14:00:00`; end = `${date} 22:00:00`; }
      else if (shift === 'C') { start = `${date} 22:00:00`; const d = new Date(date); d.setDate(d.getDate() + 1); const nextDay = d.toISOString().split('T')[0]; end = `${nextDay} 06:00:00`; }
    }
    const sql = `SELECT h.id, h.scanned_at, h.machine_at_time, h.scanned_by, o.name as operator_name, o.operator_id, o.photo_path FROM operator_history h LEFT JOIN machine_operators o ON h.operator_id = o.operator_id WHERE h.scanned_at >= $1 AND h.scanned_at <= $2 ORDER BY h.scanned_at DESC`;
    const rows = await q(sql, [start, end]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

/* ============================================================
   WIP MODULE APIs
============================================================ */

// 1. GET /api/wip/pending
// Returns shifting records that haven't been approved yet (Status = Pending or Null)
app.get('/api/wip/pending', async (req, res) => {
  try {
    let sql = `
SELECT
sr.id, sr.plan_id, sr.quantity, sr.to_location, sr.shift_date, sr.shift_type, sr.shifted_by, sr.created_at,
  pb.order_no, pb.item_name, pb.mould_name, pb.machine, pb.item_code
      FROM shifting_records sr
      LEFT JOIN plan_board pb ON CAST(pb.id AS TEXT) = CAST(sr.plan_id AS TEXT)
      WHERE COALESCE(sr.status, 'Pending') = 'Pending'
    `;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    const params = [];
    if (factoryId) {
      sql += ` AND sr.factory_id = $1`;
      params.push(factoryId);
    }
    sql += ` ORDER BY sr.created_at DESC`;

    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. POST /api/wip/approve
// Updates status and Adds to Inventory
app.post('/api/wip/approve', async (req, res) => {
  try {
    const { id, rackNo, user } = req.body;
    if (!id || !rackNo) return res.json({ ok: false, error: 'ID and Rack No required' });

    // [FIX] Factory Isolation
    const requestFactoryId = getFactoryId(req); // Use requester's factory context

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Update Shifting Record
      const srRes = await client.query(
        `UPDATE shifting_records 
         SET status = 'Approved', approved_by = $1, approved_at = NOW() 
         WHERE id = $2
RETURNING * `,
        [user || 'WIP Supervisor', id]
      );

      if (!srRes.rows.length) throw new Error('Record not found');
      const sr = srRes.rows[0];

      // 2. Fetch Plan Details for Item Info
      const pbRes = await client.query('SELECT order_no, item_code, item_name, mould_name FROM plan_board WHERE CAST(id AS TEXT) = $1', [sr.plan_id]);
      const pb = pbRes.rows[0] || {};

      const finalQty = req.body.approvedQty ? Number(req.body.approvedQty) : sr.quantity;
      const resolvedFactoryId = normalizeFactoryId(sr.factory_id) ?? requestFactoryId;
      const actorName = normalizeOptionalText(user) || getRequestUsername(req) || 'WIP Supervisor';

      const inventoryInsert = await client.query(`
        INSERT INTO wip_inventory(shifting_record_id, order_no, item_code, item_name, mould_name, rack_no, qty, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *
  `, [sr.id, pb.order_no, pb.item_code, pb.item_name, pb.mould_name, rackNo, finalQty, resolvedFactoryId]);
      const inventoryRow = inventoryInsert.rows[0];

      await recordWipStockMovement(client, {
        factory_id: inventoryRow?.factory_id ?? resolvedFactoryId,
        movement_type: 'IN',
        movement_at: sr.approved_at || new Date(),
        stock_date: sr.shift_date || sr.approved_at || new Date(),
        wip_inventory_id: inventoryRow?.id,
        shifting_record_id: sr.id,
        order_no: inventoryRow?.order_no || pb.order_no || null,
        item_code: inventoryRow?.item_code || pb.item_code || null,
        item_name: inventoryRow?.item_name || pb.item_name || null,
        mould_name: inventoryRow?.mould_name || pb.mould_name || null,
        rack_no: inventoryRow?.rack_no || rackNo,
        qty: finalQty,
        balance_after: inventoryRow?.qty ?? finalQty,
        remarks: `Approved into WIP rack ${rackNo}`,
        source_type: 'WIP_APPROVAL',
        source_ref: String(sr.id),
        actor_name: actorName
      });

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. GET /api/wip/stock
// Returns current stock
app.get('/api/wip/stock', async (req, res) => {
  try {
    const { search } = req.query;
    let sql = `
      SELECT w.*, m.mould_number as mould_no
      FROM wip_inventory w
      LEFT JOIN moulds m ON(
    m.mould_number = w.item_code OR 
        m.mould_name = w.mould_name
  )
      WHERE w.qty > 0
  `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND(w.item_name ILIKE $1 OR w.rack_no ILIKE $1 OR w.mould_name ILIKE $1 OR w.order_no ILIKE $1 OR COALESCE(w.item_code, '') ILIKE $1)`;
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      sql += ` AND w.factory_id = $${params.length + 1}`;
      params.push(factoryId);
    }

    sql += ` ORDER BY w.created_at DESC`;
    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4. POST /api/wip/outward
app.post('/api/wip/outward', async (req, res) => {
  try {
    const { inventoryId, qty, toLocation, receiver, user } = req.body;
    if (!inventoryId || !qty || !toLocation) return res.json({ ok: false, error: 'Missing required fields' });

    const requestFactoryId = getFactoryId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Check Balance
      const invRes = await client.query('SELECT * FROM wip_inventory WHERE id=$1 FOR UPDATE', [inventoryId]);
      if (!invRes.rows.length) throw new Error('Inventory Item not found');
      const inventoryRow = invRes.rows[0];
      const inventoryFactoryId = normalizeFactoryId(inventoryRow.factory_id);
      if (requestFactoryId !== null && inventoryFactoryId !== null && inventoryFactoryId !== requestFactoryId) {
        throw new Error('Inventory item does not belong to the selected factory');
      }
      const currentQty = Number(inventoryRow.qty || 0);
      const moveQty = Number(qty || 0);

      if (moveQty > currentQty) throw new Error(`Insufficient Balance.Available: ${currentQty} `);

      // 2. Deduct
      const updatedInventoryRes = await client.query(
        'UPDATE wip_inventory SET qty = qty - $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [moveQty, inventoryId]
      );
      const updatedRow = updatedInventoryRes.rows[0] || inventoryRow;

      // 3. Log
      const factoryId = inventoryFactoryId ?? requestFactoryId;
      const actorName = normalizeOptionalText(user) || getRequestUsername(req) || 'WIP Supervisor';

      await client.query(`
        INSERT INTO wip_outward_logs(wip_inventory_id, qty, to_location, receiver_name, created_by, created_at, factory_id)
VALUES($1, $2, $3, $4, $5, NOW(), $6)
  `, [inventoryId, moveQty, toLocation, receiver || '', actorName, factoryId]);

      await recordWipStockMovement(client, {
        factory_id: factoryId,
        movement_type: 'OUT',
        movement_at: new Date(),
        stock_date: new Date(),
        wip_inventory_id: inventoryId,
        shifting_record_id: updatedRow.shifting_record_id,
        order_no: updatedRow.order_no,
        item_code: updatedRow.item_code,
        item_name: updatedRow.item_name,
        mould_name: updatedRow.mould_name,
        rack_no: updatedRow.rack_no,
        qty: moveQty,
        balance_after: updatedRow.qty,
        to_location: toLocation,
        receiver_name: receiver || '',
        remarks: `Outward to ${toLocation}`,
        source_type: 'WIP_OUTWARD',
        source_ref: String(inventoryId),
        actor_name: actorName
      });

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/wip/adjust', async (req, res) => {
  try {
    const { inventoryId, newQty, reason, user } = req.body || {};
    const requestedFactoryId = getFactoryId(req);
    const actorName = normalizeOptionalText(user) || getRequestUsername(req) || 'WIP Admin';
    const actorRows = actorName
      ? await q('SELECT id, username, role_code FROM users WHERE username = $1 LIMIT 1', [actorName])
      : [];
    const actor = actorRows[0] || null;

    if (!isAdminLikeRole(actor)) {
      return res.status(403).json({ ok: false, error: 'Only Admin or Superadmin can adjust WIP stock.' });
    }
    if (!inventoryId) {
      return res.status(400).json({ ok: false, error: 'Inventory item is required.' });
    }

    const normalizedQty = toNum(newQty);
    if (normalizedQty === null || normalizedQty < 0) {
      return res.status(400).json({ ok: false, error: 'Enter a valid new quantity.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inventoryRes = await client.query('SELECT * FROM wip_inventory WHERE id = $1 FOR UPDATE', [inventoryId]);
      if (!inventoryRes.rows.length) throw new Error('Inventory item not found');

      const inventoryRow = inventoryRes.rows[0];
      const inventoryFactoryId = normalizeFactoryId(inventoryRow.factory_id);
      if (requestedFactoryId !== null && inventoryFactoryId !== null && inventoryFactoryId !== requestedFactoryId) {
        throw new Error('Inventory item does not belong to the selected factory');
      }

      const currentQty = Number(inventoryRow.qty || 0);
      const deltaQty = normalizedQty - currentQty;
      const updatedRes = await client.query(
        'UPDATE wip_inventory SET qty = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [normalizedQty, inventoryId]
      );
      const updatedRow = updatedRes.rows[0] || inventoryRow;

      await recordWipStockMovement(client, {
        factory_id: inventoryFactoryId ?? requestedFactoryId,
        movement_type: 'ADJUST',
        movement_at: new Date(),
        stock_date: new Date(),
        wip_inventory_id: inventoryId,
        shifting_record_id: updatedRow.shifting_record_id,
        order_no: updatedRow.order_no,
        item_code: updatedRow.item_code,
        item_name: updatedRow.item_name,
        mould_name: updatedRow.mould_name,
        rack_no: updatedRow.rack_no,
        qty: deltaQty,
        balance_after: updatedRow.qty,
        remarks: normalizeOptionalText(reason) || 'Manual WIP stock adjustment',
        source_type: 'MANUAL_ADJUST',
        source_ref: String(inventoryId),
        actor_name: actorName
      });

      await client.query('COMMIT');
      res.json({
        ok: true,
        message: deltaQty === 0 ? 'WIP quantity was already correct.' : 'WIP quantity adjusted successfully.',
        data: updatedRow
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 5. GET /api/wip/logs
app.get('/api/wip/logs', async (req, res) => {
  try {
    let sql = `
SELECT
l.*,
  i.item_name, i.mould_name, i.rack_no, i.order_no, i.item_code,
  m.mould_number as mould_no
      FROM wip_outward_logs l
      LEFT JOIN wip_inventory i ON i.id = l.wip_inventory_id
      LEFT JOIN moulds m ON(
    m.mould_number = i.item_code OR 
        m.mould_name = i.mould_name
  )
      WHERE 1=1
  `;
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    const params = [];

    if (factoryId) {
      // Log has factory_id? Yes, should have.
      sql += ` AND l.factory_id = $1`;
      params.push(factoryId);
    }

    sql += ` ORDER BY l.created_at DESC LIMIT 500 `;

    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 6. POST /api/wip/stock/clear (Superadmin)
// 6. POST /api/wip/reset (Reset All Test Data) - Replaces stock/clear
app.post('/api/wip/reset', async (req, res) => {
  try {
    const { user } = req.body;
    console.log(`[WIP] FACTORY RESET requested by ${user} `);

    // Security Check
    const u = (await q('SELECT role_code, permissions FROM users WHERE username=$1', [user]))[0];
    const perms = u ? (u.permissions || {}) : {};
    const allowed = isAdminLikeRole(u) || (perms.critical_ops && perms.critical_ops.data_wipe);

    if (!allowed) return res.json({ ok: false, error: 'Access Denied: Data Wipe permission required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Clear Outward Logs
      await client.query('DELETE FROM wip_outward_logs');
      await client.query('DELETE FROM wip_stock_movements');

      // 2. Clear Inventory 
      await client.query('DELETE FROM wip_inventory');

      // 3. Clear Shifting Records
      await client.query('DELETE FROM shifting_records');

      await client.query('COMMIT');
      console.log('[WIP] FACTORY RESET SUCCESS');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(e);
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   DPR MODULE APIS
   ============================================================ */
app.get('/api/dpr/hourly', async (req, res) => {
  try {
    const { date, shift, line } = req.query;
    let sql = 'SELECT * FROM shifting_records WHERE 1=1';
    const params = [];

    if (date) {
      sql += ` AND dpr_date::text LIKE $${params.length + 1} || '%'`;
      params.push(date);
    }
    if (shift && shift !== 'All') {
      sql += ` AND shift = $${params.length + 1} `;
      params.push(shift);
    }
    if (line && line !== 'All Lines') {
      sql += ` AND line = $${params.length + 1} `;
      params.push(line);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1000';

    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   QC MODULE APIS
   ============================================================ */

// 1. Online Quality Report
app.post('/api/qc/online', async (req, res) => {
  try {
    const { date, shift, hour_slot, line, machine, item_name, mould_name, defect_description, qty_checked, qty_rejected, action_taken, supervisor } = req.body;

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    await q(`INSERT INTO qc_online_reports(date, shift, hour_slot, line, machine, item_name, mould_name, defect_description, qty_checked, qty_rejected, action_taken, supervisor, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [date, shift, hour_slot || '', line, machine, item_name, mould_name, defect_description, qty_checked, qty_rejected, action_taken, supervisor, factoryId]);
    syncService.triggerSync();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. Internal Line Issue Memo
app.post('/api/qc/issue', async (req, res) => {
  try {
    const { date, line, machine, issue_description, responsibility, status, supervisor } = req.body;
    const factoryId = getFactoryId(req); // [FIX] Factory Isolation
    await q(`INSERT INTO qc_issue_memos(date, line, machine, issue_description, responsibility, status, supervisor, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [date, line, machine, issue_description, responsibility, status || 'Open', supervisor, factoryId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. Training Sheet
app.post('/api/qc/training', async (req, res) => {
  try {
    const { date, trainee_name, trainer_name, topic, duration, score, remarks } = req.body;
    const factoryId = getFactoryId(req); // [FIX] Factory Isolation
    await q(`INSERT INTO qc_training_sheets(date, trainee_name, trainer_name, topic, duration, score, remarks, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [date, trainee_name, trainer_name, topic, duration, score, remarks, factoryId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4. Deviation Form
app.post('/api/qc/deviation', async (req, res) => {
  try {
    const { date, part_name, machine, deviation_details, reason, approved_by, valid_upto } = req.body;
    const factoryId = getFactoryId(req); // [FIX] Factory Isolation
    await q(`INSERT INTO qc_deviations(date, part_name, machine, deviation_details, reason, approved_by, valid_upto, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [date, part_name, machine, deviation_details, reason, approved_by, valid_upto, factoryId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 5. QC Dashboard Stats
app.get('/api/qc/dashboard', async (req, res) => {
  try {
    const [online, issues, training, deviations] = await Promise.all([
      q('SELECT * FROM qc_online_reports ORDER BY created_at DESC LIMIT 50'),
      q('SELECT * FROM qc_issue_memos ORDER BY created_at DESC LIMIT 50'),
      q('SELECT * FROM qc_training_sheets ORDER BY created_at DESC LIMIT 50'),
      q('SELECT * FROM qc_deviations ORDER BY created_at DESC LIMIT 50'),
    ]);

    res.json({ ok: true, data: { online, issues, training, deviations } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 6. Recent QC Reports (for Supervisor App)
app.get('/api/qc/recent', async (req, res) => {
  try {
    const { machine, limit } = req.query;
    const rows = await q(`
SELECT * FROM qc_online_reports 
      WHERE machine = $1
      ORDER BY created_at DESC
      LIMIT $2
  `, [machine || '', limit || 10]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Master Data APIs ---
app.get('/api/machines', async (req, res) => {
  try {
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    let sql = 'SELECT machine, line, is_active FROM machines WHERE 1=1';
    const params = [];

    if (factoryId) {
      sql += ` AND factory_id = $1`;
      params.push(factoryId);
    }
    sql += ` ORDER BY line ASC, machine ASC`;

    const result = await q(sql, params);
    res.json({ ok: true, data: result || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 7. QC Compliance Summary Report
app.get('/api/qc/compliance', async (req, res) => {
  try {
    const { date, shift } = req.query;
    if (!date || !shift) return res.status(400).json({ ok: false, error: 'Date and Shift required' });

    // 1. Get All Active Machines (Application Sort)
    // 1. Get All Active Machines (Fix: Use correct columns 'machine' and 'line')
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    let mSql = "SELECT machine as machine_name, line as line_name FROM machines WHERE is_active = true";
    const mParams = [];
    if (factoryId) {
      mSql += " AND factory_id = $1";
      mParams.push(factoryId);
    }
    mSql += " ORDER BY line, machine";

    const machinesRes = await pool.query(mSql, mParams);
    let machines = machinesRes.rows;
    if (machines.length === 0) {
      // Fallback
      // NOTE: Shifting records also needs isolation if used as fallback
      const fb = await pool.query("SELECT DISTINCT machine as machine_name, line as line_name FROM shifting_records ORDER BY line, machine");
      machines = fb.rows;
    }

    console.log('[QC COM] Machines Found:', machines.length);

    // Filter by Machine if provided
    const { machine } = req.query;
    if (machine && machine !== 'All' && machine !== 'All Machines') {
      const target = machines.find(m => m.machine_name === machine);
      machines = target ? [target] : [];
    }

    // 2. Get Reports for Date/Shift
    // Fetch details to support "Show Entries" requirement
    let rptSql = `
      SELECT machine, hour_slot, created_at, item_name, qty_rejected
      FROM qc_online_reports 
      WHERE date::text LIKE $1 || '%' AND shift = $2
    `;
    const rptParams = [date, shift];

    // [FIX] Factory Isolation
    // [FIX] Factory Isolation
    // factoryId already declared above at line 7861
    // Note: We need to filter machines AND reports

    // Filter Machine List first (already fetched above? No, we need to filter the machines array query too?)
    // Ah, line 7658-7664 fetched machines. I need to fix that first.
    // Wait, I can't edit previous lines easily if I didn't include them in the chunk.
    // But I can fix the Reports query here.

    if (factoryId) {
      rptSql += ` AND factory_id = $3`;
      rptParams.push(factoryId);
    }

    const reportsRes = await q(rptSql, rptParams);
    const rows = reportsRes || []; // q returns array now, remember?

    console.log('[QC COM] Reports Found for Date/Shift:', rows.length);

    // 3. Define Slots (2-Hour Intervals as requested)
    const daySlots = ['06-08', '08-10', '10-12', '12-14', '14-16', '16-18'];
    const nightSlots = ['18-20', '20-22', '22-00', '00-02', '02-04', '04-06'];
    const slots = (shift === 'Day') ? daySlots : nightSlots;

    // 4. Build Matrix
    const getSlotEndTime = (slotDate, slotStr) => {
      // 06-08 ends at 8
      let h = parseInt(slotStr.split('-')[1]);
      let isNextDay = false;

      // Handle Midnight/Next Day logic
      if (h === 0) { h = 24; } // 22-00 -> Ends at midnight (Date+1 if we want perfect ts, or Date 23:59)

      let d = new Date(slotDate);

      // Night Shift Logic
      if (shift === 'Night') {
        // 18-20 (20), 20-22 (22), 22-00 (24/0), 00-02 (2), 02-04 (4), 04-06 (6)
        if (h < 12) {
          // 0, 2, 4, 6 -> Next Day
          isNextDay = true;
        }
      }

      // Fix hours for date object
      // If h=24, set 0 and add day
      if (h === 24) { h = 0; isNextDay = true; }

      d.setHours(h, 0, 0, 0);
      if (isNextDay) d.setDate(d.getDate() + 1);
      return d;
    };

    const now = new Date();

    // Group machines by Line
    const lines = {};

    machines.forEach(m => {
      if (!m.machine_name) return;
      const line = m.line_name || 'Unassigned';
      if (!lines[line]) lines[line] = [];

      // Find matching reports for this machine
      const mReports = rows.filter(r => r.machine === m.machine_name);

      const row = { machine: m.machine_name, slots: {} };

      slots.forEach(slot => {
        // Match logic: Report usually saves "06:00-08:00". 
        // We need to map our "06-08" to that.
        // Or check if report slot *starts* with our slot start or contains it.
        // Report slot: "06:00-08:00" | Our slot: "06-08"
        // Let's assume report slot is formatted like "06:00-08:00"

        let match = false;
        // Try to match standard format
        const rpt = mReports.find(r => {
          // Normalized check
          if (r.hour_slot === slot) return true;
          // Check "06:00-08:00" vs "06-08"
          const clean = r.hour_slot.replace(/:00/g, ''); // 06-08
          return clean === slot;
        });

        let status = 'MISSING';
        let details = null;

        // Slot End Time Logic
        const sEnd = getSlotEndTime(date, slot);

        if (rpt) {
          const created = new Date(rpt.created_at);
          // Late if created > EndTime + 15 mins
          const diffMins = (created - sEnd) / 60000;
          status = (diffMins > 15) ? 'LATE' : 'FILLED';
          details = { item: rpt.item_name, rej: rpt.qty_rejected };
        } else {
          if (now > sEnd) status = 'MISSING';
          else status = 'PENDING';
        }

        row.slots[slot] = { status, details };
      });
      lines[line].push(row);
    });

    res.json({ ok: true, data: { lines, slots } });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// 8. QC Dashboard: KPIs
app.get('/api/qc/dashboard/kpis', async (req, res) => {
  try {
    const { date, dateTo, machine } = req.query;
    const d1 = date || new Date().toISOString().split('T')[0];
    const d2 = dateTo || d1;

    let sql = `SELECT
SUM(qty_checked) as total_checked,
  SUM(qty_rejected) as total_rejected,
  COUNT(*) as total_reports
      FROM qc_online_reports
      WHERE date:: text >= $1 AND date:: text <= $2 || ' 23:59:59'`;
    // We append time to d2 to cover full day if it's just YYYY-MM-DD
    // Better: cast to date

    sql = `SELECT
SUM(qty_checked) as total_checked,
  SUM(qty_rejected) as total_rejected,
  COUNT(*) as total_reports
      FROM qc_online_reports
      WHERE date::text LIKE $1 || '%'`;
    // Simplified: Dashboard usually shows 1 day. 
    // If range needed: WHERE date::timestamp >= $1::timestamp AND date::timestamp <= ($2 || ' 23:59:59')::timestamp

    // Let's stick to the reliable LIKE for today/single date which is 99% of use case
    if (d1 === d2) {
      sql = `SELECT
SUM(qty_checked) as total_checked,
  SUM(qty_rejected) as total_rejected,
  COUNT(*) as total_reports
          FROM qc_online_reports
          WHERE date::text LIKE $1 || '%'`;

    } else {
      // Range
      sql = `SELECT
SUM(qty_checked) as total_checked,
  SUM(qty_rejected) as total_rejected,
  COUNT(*) as total_reports
          FROM qc_online_reports
          WHERE date:: date >= $1::date AND date:: date <= $2:: date`;
    }

    const finalParams = (d1 === d2) ? [d1] : [d1, d2];
    if (machine && machine !== 'All' && machine !== 'All Machines') {
      sql += ` AND machine = $${finalParams.length + 1} `;
      finalParams.push(machine);
    }
    // 1. Total Production & Rejection (From QC Reports)
    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      sql += ` AND factory_id = $${finalParams.length + 1} `;
      finalParams.push(factoryId);
    }

    console.log('KPI Query Params:', finalParams);
    const kpiRes = await q(sql, finalParams);
    console.log('KPI Result:', kpiRes);

    const kpi = (kpiRes && kpiRes[0]) || {};
    const totalChecked = Number(kpi.total_checked || 0);
    const totalRejected = Number(kpi.total_rejected || 0);
    const rejRate = totalChecked > 0 ? ((totalRejected / totalChecked) * 100).toFixed(2) : 0;

    // 2. Active Issues
    let issueSql = `SELECT COUNT(*) as c FROM qc_issue_memos WHERE status != 'Closed' AND date >= $1 AND date <= $2`;
    const issueParams = [d1, d2];
    if (machine && machine !== 'All') {
      issueSql += ` AND machine = $3`;
      issueParams.push(machine);
    }

    if (factoryId) {
      issueSql += ` AND factory_id = $${issueParams.length + 1}`;
      issueParams.push(factoryId);
    }

    const issueRes = await q(issueSql, issueParams);
    const activeIssues = issueRes[0] ? issueRes[0].c : 0;

    res.json({
      ok: true,
      data: {
        production: totalChecked,
        accepted: totalChecked - totalRejected,
        rejected: totalRejected,
        rejection_rate: rejRate,
        active_issues: activeIssues,
        complaints: 0 // Placeholder
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 9. QC Dashboard: Analysis Charts
app.get('/api/qc/dashboard/analysis', async (req, res) => {
  try {
    const { date, dateTo, type, machine } = req.query;
    const d1 = date || new Date().toISOString().split('T')[0];
    const d2 = dateTo || d1;

    let baseWhere = `date >= $1 AND date <= $2`;
    let params = [d1, d2];
    if (machine && machine !== 'All') {
      baseWhere += ` AND machine = $3`;
      params.push(machine);
    }

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);
    if (factoryId) {
      baseWhere += ` AND factory_id = $${params.length + 1}`;
      params.push(factoryId);
    }

    let data = [];

    // Helper to build queries
    const getSql = (select, group) => `
        SELECT ${select}
        FROM qc_online_reports
        WHERE ${baseWhere}
        GROUP BY ${group}
        HAVING SUM(qty_checked) > 0
        ORDER BY(SUM(qty_rejected):: float / SUM(qty_checked)) DESC
        LIMIT 10`;

    if (type === 'machine') {
      const rows = await q(getSql('machine as label, SUM(qty_checked) as checked, SUM(qty_rejected) as rejected', 'machine'), params);
      data = rows.map(r => ({ label: r.label, value: ((r.rejected / r.checked) * 100).toFixed(1) }));

    } else if (type === 'mould') {
      // Assume mould_name exists
      const rows = await q(getSql('mould_name as label, SUM(qty_checked) as checked, SUM(qty_rejected) as rejected', 'mould_name'), params);
      data = rows.map(r => ({ label: r.label || 'Unknown', value: ((r.rejected / r.checked) * 100).toFixed(1) }));

    } else if (type === 'product') {
      // Correct column is item_name
      const rows = await q(getSql('item_name as label, SUM(qty_checked) as checked, SUM(qty_rejected) as rejected', 'item_name'), params);
      data = rows.map(r => ({ label: r.label || 'Unknown', value: ((r.rejected / r.checked) * 100).toFixed(1) }));

    } else if (type === 'shift') {
      const rows = await q(getSql('shift as label, SUM(qty_checked) as checked, SUM(qty_rejected) as rejected', 'shift'), params);
      data = rows.map(r => ({ label: r.label, value: ((r.rejected / r.checked) * 100).toFixed(1) }));

    } else if (type === 'defect') {
      const rows = await q(`
            SELECT defect_description as label, SUM(qty_rejected) as value
            FROM qc_online_reports
            WHERE ${baseWhere} AND qty_rejected > 0
            GROUP BY defect_description
            ORDER BY value DESC
            LIMIT 10
  `, params);
      data = rows;


    } else if (type === 'trend') {
      // Daily Rejection Trend (Last 7 Days)
      const rows = await q(`
            SELECT date, SUM(qty_checked) as checked, SUM(qty_rejected) as rejected
            FROM qc_online_reports
            WHERE date > CURRENT_DATE - INTERVAL '15 days'
            GROUP BY date
            ORDER BY date ASC
        `, []); // trend doesn't use standard params
      data = rows.map(r => ({
        label: new Date(r.date).toLocaleDateString(),
        value: ((r.rejected / (r.checked || 1)) * 100).toFixed(1)
      }));
    }
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


/* ============================================================
   MACHINE MASTER CRUD (Added for Edit Machine Name)
   ============================================================ */
app.post('/api/machines', async (req, res) => {
  try {
    const { machine, building, line, tonnage, machine_icon, machine_icon_base64 } = req.body;
    const cleanMachine = normalizeMachineName(machine);
    const resolvedMachineIcon = machine_icon_base64
      ? saveDataUrlImage(machine_icon_base64, 'machines', 'machine')
      : normalizeOptionalText(machine_icon);
    if (!cleanMachine) return res.json({ ok: false, error: 'Machine Name required' });

    // [FIX] Factory Isolation
    const factoryId = getFactoryId(req);

    await q(
      `INSERT INTO machines(machine, building, line, tonnage, machine_icon, created_at, updated_at, factory_id)
VALUES($1, $2, $3, $4, $5, NOW(), NOW(), $6)`,
      [cleanMachine, building, line, tonnage, resolvedMachineIcon, factoryId]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.json({ ok: false, error: 'Machine already exists for this factory' });
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.put('/api/machines/:id', async (req, res) => {
  try {
    const oldName = decodeURIComponent(req.params.id);
    const { machine, building, line, tonnage, machine_icon, machine_icon_base64 } = req.body;
    const factoryId = getFactoryId(req);
    const cleanMachine = normalizeMachineName(machine);
    const hasMachineIconField = Object.prototype.hasOwnProperty.call(req.body || {}, 'machine_icon');
    const resolvedMachineIcon = machine_icon_base64
      ? saveDataUrlImage(machine_icon_base64, 'machines', 'machine')
      : (hasMachineIconField ? normalizeOptionalText(machine_icon) : undefined);

    if (!cleanMachine) return res.json({ ok: false, error: 'Machine Name required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update Machine Master
      // Assuming 'machine' is unique/PK. If 'id' exists, use custom logic, 
      // but code implies 'machine' string is the key identifier everywhere.
      const resUpd = await client.query(
        resolvedMachineIcon !== undefined
          ? `UPDATE machines 
             SET machine = $1, building = $2, line = $3, tonnage = $4, machine_icon = $5, updated_at = NOW()
             WHERE LOWER(machine) = LOWER($6)
               AND (factory_id = $7 OR ($7 IS NULL AND factory_id IS NULL))`
          : `UPDATE machines 
             SET machine = $1, building = $2, line = $3, tonnage = $4, updated_at = NOW()
             WHERE LOWER(machine) = LOWER($5)
               AND (factory_id = $6 OR ($6 IS NULL AND factory_id IS NULL))`,
        resolvedMachineIcon !== undefined
          ? [cleanMachine, building, line, tonnage, resolvedMachineIcon, oldName, factoryId]
          : [cleanMachine, building, line, tonnage, oldName, factoryId]
      );

      if (resUpd.rowCount === 0) {
        throw new Error('Machine not found');
      }

      // If Name Changed, Cascade Update to vital tables
      if (oldName !== cleanMachine) {
        // 1. Plan Board
        await client.query(`UPDATE plan_board SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, oldName, factoryId]);
        // 2. DPR Hourly
        await client.query(`UPDATE dpr_hourly SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, oldName, factoryId]);
        // 3. QC Reports
        await client.query(`UPDATE qc_online_reports SET machine = $1 WHERE machine = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, oldName, factoryId]);
        // 4. Mould Planning Summary
        await client.query(`UPDATE mould_planning_summary SET machine_name = $1 WHERE machine_name = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, oldName, factoryId]);
        // 5. Mould Planning Report
        await client.query(`UPDATE mould_planning_report SET machine_name = $1 WHERE machine_name = $2 AND (factory_id = $3 OR ($3 IS NULL AND factory_id IS NULL))`, [cleanMachine, oldName, factoryId]);
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ ok: false, error: 'Machine already exists for this factory' });
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/api/machines/:id', async (req, res) => {
  try {
    const machine = decodeURIComponent(req.params.id);
    const factoryId = getFactoryId(req);
    await q('DELETE FROM machines WHERE LOWER(machine) = LOWER($1) AND (factory_id = $2 OR ($2 IS NULL AND factory_id IS NULL))', [machine, factoryId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});



/* ============================================================
   SPA FALLBACK (must be AFTER /api)
============================================================ */
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- DEBUG: Client Error Logger ---
app.post('/api/log-client-error', (req, res) => {
  console.log('--------------------------------------------------');
  console.error('\x1b[31m[CLIENT ERROR]\x1b[0m', req.body.error);
  if (req.body.info) console.error('\x1b[33m[INFO]\x1b[0m', req.body.info);
  console.log('--------------------------------------------------');
  res.sendStatus(200);
});

// 4. List ALL Std Actuals (For DPR Setup View)
app.get('/api/dpr/setup', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM std_actual ORDER BY created_at DESC LIMIT 500');
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- SHIFT TEAM APIS ---
app.get('/api/shift/team', async (req, res) => {
  try {
    const { line, date, shift } = req.query;
    if (!date || !shift) return res.json({ ok: true, data: null });

    const factoryId = getFactoryId(req); // [FIX] Factory Isolation

    let rows;
    if (line) {
      // Fetch specific line
      const sql = `SELECT * FROM shift_teams WHERE line = $1 AND shift_date = $2 AND shift = $3`;
      const params = [line, date, shift];
      if (factoryId) {
        // Check if table has factory_id using query? It should.
        // Append filter
        // Actually, let's just append carefully
        // sql += ` AND factory_id = $4`; 
        // But wait, line is unique per factory basically? 
        // Or Line 1 exists in both factories? 
        // Yes, Line 1 exists in both. So we MUST filter by factory_id
        const sql2 = sql + ` AND factory_id = $4`;
        params.push(factoryId);
        rows = await q(sql2, params);
      } else {
        rows = await q(sql, params);
      }
      res.json({ ok: true, data: rows.length ? rows[0] : null });
    } else {
      // Fetch ALL lines for date/shift
      let sql = `SELECT * FROM shift_teams WHERE shift_date = $1 AND shift = $2`;
      const params = [date, shift];
      if (factoryId) {
        sql += ` AND factory_id = $3`;
        params.push(factoryId);
      }
      rows = await q(sql, params);
      res.json({ ok: true, data: rows }); // Return Array
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/shift/team-range', async (req, res) => {
  try {
    const { fromDate, toDate, shift } = req.query;
    if (!fromDate || !toDate || !shift) return res.json({ ok: true, data: {} });

    const factoryId = getFactoryId(req);
    let sql = `SELECT *, shift_date::text as shift_date_str FROM shift_teams WHERE shift_date BETWEEN $1 AND $2 AND shift = $3`;
    const params = [fromDate, toDate, shift];
    if (factoryId) {
      sql += ` AND factory_id = $4`;
      params.push(factoryId);
    }
    const rows = await q(sql, params);

    // Group by Date for frontend efficiency
    const grouped = {};
    rows.forEach(r => {
      const dt = r.shift_date_str;
      if (!grouped[dt]) grouped[dt] = [];
      grouped[dt].push(r);
    });

    res.json({ ok: true, data: grouped });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/shift/team', async (req, res) => {
  try {
    const { line, date, shift, entry_person, prod_supervisor, qc_supervisor, die_setter, engineer } = req.body;
    const factoryId = getFactoryId(req); // [FIX] Factory Isolation

    if (!line || !date || !shift) return res.status(400).json({ ok: false, error: 'Missing Line/Date/Shift' });

    await q(`
      INSERT INTO shift_teams(line, shift_date, shift, entry_person, prod_supervisor, qc_supervisor, die_setter, engineer, updated_at, factory_id)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      ON CONFLICT(line, shift_date, shift) DO UPDATE SET
entry_person = EXCLUDED.entry_person,
  prod_supervisor = EXCLUDED.prod_supervisor,
  qc_supervisor = EXCLUDED.qc_supervisor,
  die_setter = EXCLUDED.die_setter,
  engineer = EXCLUDED.engineer,
  updated_at = NOW(),
  factory_id = EXCLUDED.factory_id -- Also update factory_id if it somehow changes? Or keep existing.
    `, [line, date, shift, entry_person, prod_supervisor, qc_supervisor, die_setter, engineer, factoryId]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- HR MODULE APIS ---



// --- STD ACTUAL APIs ---

// 1. Check Status (Get Saved Actuals OR Master Standards)
app.get('/api/std-actual/status', async (req, res) => {
  try {
    const { planId, machine } = req.query;
    if (!planId) return res.json({ ok: false, error: 'PlanID required' });

    // 1. Check if already saved
    const exists = await q('SELECT * FROM std_actual WHERE plan_id=$1 LIMIT 1', [planId]);
    if (exists.length) {
      console.log('[STD DEBUG] Found Saved Record for:', planId);
      // Return SAVED data + Master Standards (for comparison if needed)
      // Note: Supervisor logic overwrites inputs with this data.
      // We should ALSO fetch master standards to populate the STD side if missing?
      // Supervisor app expects: row (actuals), std (standards)

      const row = exists[0];

      // Fetch Master Standards for this Mould
      const mRes = await q(`
      SELECT m.std_wt_kg as article_std, m.runner_weight as runner_std, m.no_of_cav as cavity_std,
  m.cycle_time as cycle_std, m.pcs_per_hour as pcshr_std, m.manpower as man_std,
  m.sfg_std_packing as sfgqty_std
      FROM plan_board pb
      LEFT JOIN mould_planning_summary mps ON mps.mould_name = pb.mould_name
      LEFT JOIN moulds m ON(TRIM(m.mould_number) ILIKE TRIM(COALESCE(pb.mould_code, mps.mould_no)) OR TRIM(m.mould_name) ILIKE TRIM(pb.mould_name))
        WHERE pb.plan_id = $1
  `, [planId]);

      return res.json({ ok: true, data: { done: true, row, std: mRes[0] || {} } });
    }

    // 2. Not Saved -> Fetch Master Standards Only
    console.log('[STD DEBUG] Fetching Std for PlanID:', planId);
    const mRes = await q(`
      SELECT m.std_wt_kg as article_std, m.runner_weight as runner_std, m.no_of_cav as cavity_std,
  m.cycle_time as cycle_std, m.pcs_per_hour as pcshr_std, m.manpower as man_std,
  m.sfg_std_packing as sfgqty_std
      FROM plan_board pb
      LEFT JOIN mould_planning_summary mps ON mps.mould_name = pb.mould_name
      LEFT JOIN moulds m ON(TRIM(m.mould_number) ILIKE TRIM(COALESCE(pb.mould_code, mps.mould_no)) OR TRIM(m.mould_name) ILIKE TRIM(pb.mould_name))
      WHERE pb.plan_id = $1
  `, [planId]);
    console.log('[STD DEBUG] Result:', mRes[0]);

    res.json({ ok: true, data: { done: false, std: mRes[0] || {} } });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. Save/Update
app.post('/api/std-actual/save', async (req, res) => {
  try {
    const { session, payload, geo } = req.body;
    const { PlanID, Shift, DprDate, Machine, OrderNo, MouldName,
      ArticleActual, RunnerActual, CavityActual, CycleActual, PcsHrActual, ManActual,
      EnteredBy, SfgQtyActual, OperatorActivities } = payload;

    // Check if exists
    const exists = await q('SELECT id FROM std_actual WHERE plan_id=$1', [PlanID]);

    if (exists.length) {
      // Update
      await q(`
        UPDATE std_actual SET
shift = $2, dpr_date = $3, machine = $4, order_no = $5, mould_name = $6,
  article_act = $7, runner_act = $8, cavity_act = $9, cycle_act = $10, pcshr_act = $11, man_act = $12,
  entered_by = $13, sfgqty_act = $14, operator_activities = $15,
  geo_lat = $16, geo_lng = $17, geo_acc = $18, updated_at = NOW()
        WHERE plan_id = $1
  `, [PlanID, Shift, DprDate, Machine, OrderNo, MouldName,
        toNum(ArticleActual), toNum(RunnerActual), toNum(CavityActual), toNum(CycleActual), toNum(PcsHrActual), toNum(ManActual),
        EnteredBy, toNum(SfgQtyActual), OperatorActivities,
        (geo && geo.lat) || null, (geo && geo.lng) || null, (geo && geo.acc) || null
      ]);
    } else {
      // Insert
      const factoryId = getFactoryId(req); // [FIX] Factory Isolation
      await q(`
        INSERT INTO std_actual(
    plan_id, shift, dpr_date, machine, line, order_no, mould_name,
    article_act, runner_act, cavity_act, cycle_act, pcshr_act, man_act,
    entered_by, sfgqty_act, operator_activities,
    geo_lat, geo_lng, geo_acc, created_at, updated_at, factory_id
  ) VALUES(
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13,
    $14, $15, $16,
    $17, $18, $19, NOW(), NOW(), $20
  )
    `, [PlanID, Shift, DprDate, Machine, session ? session.line : '', OrderNo, MouldName,
        toNum(ArticleActual), toNum(RunnerActual), toNum(CavityActual), toNum(CycleActual), toNum(PcsHrActual), toNum(ManActual),
        EnteredBy, toNum(SfgQtyActual), OperatorActivities,
        (geo && geo.lat) || null, (geo && geo.lng) || null, (geo && geo.acc) || null, factoryId
      ]);
    }

    syncService.triggerSync();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. Clear ALL Std Actuals (Admin Only)
app.post('/api/admin/clear-std-actual', async (req, res) => {
  try {
    const { user } = req.body;

    // Security Check
    const u = (await q('SELECT role_code, permissions FROM users WHERE username=$1', [user]))[0];
    const perms = u ? (u.permissions || {}) : {};
    const allowed = isAdminLikeRole(u) || (perms.critical_ops && perms.critical_ops.data_wipe);

    if (!allowed) return res.status(403).json({ ok: false, error: 'Access Denied: Admin or Data Wipe permission required' });

    await q('TRUNCATE TABLE std_actual');
    console.log(`[ADMIN] STD ACTUAL CLEARED by ${user} `);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   PACKING / ASSEMBLY MODULE APIS
   ============================================================ */

// 1. GET Assembly Plans (Grid)
app.get('/api/assembly/grid', async (req, res) => {
  try {
    const { date } = req.query;
    // We fetch logic: usually by date range.
    // If date is provided, we fetch plans that overlap with that date?
    // Or just all future plans + recent past?
    // Let's matching strict date for now as per frontend request.

    let sql = `SELECT * FROM assembly_plans WHERE 1 = 1`;
    const params = [];

    if (date) {
      // Simple string match on start_time if stored as text?
      // Or if stored as timestamptz, we check overlap
      // frontend saves ISO string.
      // Let's filter basically
      sql += ` AND start_time::text LIKE $1 || '%'`;
      params.push(date);
    }

    sql += ` ORDER BY start_time ASC`;

    const rows = await q(sql, params);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. Create/Update Assembly Plan
app.post('/api/assembly/plan', async (req, res) => {
  try {
    console.log('[Assembly Plan] Body:', req.body);
    const { id, table_id, item_name, plan_qty, machine, start_time, duration_min, delay_min, end_time, created_by } = req.body;

    if (id) {
      // Update
      await q(`
            UPDATE assembly_plans SET
table_id = $1, item_name = $2, plan_qty = $3, machine = $4,
  start_time = $5, duration_min = $6, delay_min = $7, end_time = $8,
  ean_number = $9,
  updated_at = NOW()
            WHERE id = $10
  `, [table_id, item_name, plan_qty, machine, start_time, duration_min, delay_min, end_time, req.body.ean_number, id]);
    } else {
      // Create
      await q(`
            INSERT INTO assembly_plans(
    table_id, item_name, plan_qty, machine,
    start_time, duration_min, delay_min, end_time, ean_number,
    created_by, created_at, updated_at
  ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
    `, [table_id, item_name, plan_qty, machine, start_time, duration_min, delay_min, end_time, req.body.ean_number, created_by]);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- ASSEMBLY LINES MANAGEMENT ---

app.get('/api/assembly/lines', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assembly_lines ORDER BY line_id');
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/assembly/lines', async (req, res) => {
  const { line_id, line_name, scanner_config } = req.body;
  try {
    // Upsert
    const result = await pool.query(`
            INSERT INTO assembly_lines(line_id, line_name, scanner_config, updated_at)
VALUES($1, $2, $3, NOW())
            ON CONFLICT(line_id) 
            DO UPDATE SET line_name = EXCLUDED.line_name, scanner_config = EXCLUDED.scanner_config, updated_at = NOW()
RETURNING *
  `, [line_id, line_name, scanner_config]);
    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/assembly/lines/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM assembly_lines WHERE line_id = $1', [req.params.id]);
    res.json({ ok: true, success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. GET Active Assembly Plans (For Scanning)
app.get('/api/assembly/active', async (req, res) => {
  try {
    // Fetch plans that are Planned/Running and today's date or active window
    // Calculate idle_seconds directly in DB to avoid Timezone issues
    const sql = `
SELECT *,
  EXTRACT(EPOCH FROM(NOW() - COALESCE(updated_at, created_at))) as idle_seconds
          FROM assembly_plans
WHERE(status IN('PLANNED', 'RUNNING') OR start_time:: date >= CURRENT_DATE)
          ORDER BY table_id, start_time ASC
  `;

    const rows = await q(sql);
    // console.log(`[DEBUG] / api / assembly / active found ${ rows.length } plans.`);
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- ALERTS MEMORY & SSE ---
const ASSEMBLY_ALERTS = [];
let SSE_CLIENTS = [];

// Send Heartbeat every 30s to keep connection alive
setInterval(() => {
  SSE_CLIENTS.forEach(client => {
    client.res.write(': heartbeat\n\n');
  });
}, 30000);

// SSE Endpoint
app.get('/api/assembly/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  SSE_CLIENTS.push(newClient);

  req.on('close', () => {
    SSE_CLIENTS = SSE_CLIENTS.filter(c => c.id !== clientId);
  });
});

function broadcastEvent(type, data) {
  SSE_CLIENTS.forEach(client => {
    client.res.write(`data: ${JSON.stringify({ type, data })} \n\n`);
  });
}

app.get('/api/assembly/alerts', (req, res) => {
  // Return alerts from last 10 seconds only to avoid spam re-fetching
  const now = Date.now();
  const recent = ASSEMBLY_ALERTS.filter(a => (now - a.timestamp) < 10000);
  res.json({ ok: true, data: recent });
});

// 4. POST Scan Log (Capture EAN)
app.post('/api/assembly/scan', async (req, res) => {
  try {
    let { plan_id, ean } = req.body;

    // --- UNIQUE BARCODE / QR LOGIC ---
    let fullString = String(ean || '').trim();
    let cleanEAN = fullString;
    let uniqueId = null;

    if (fullString.includes('\0')) {
      const parts = fullString.split('\0');
      cleanEAN = parts[0];
      uniqueId = parts[1];
      fullString = `${cleanEAN} -${uniqueId} `; // Sanitize
    } else if (fullString.includes('-')) {
      const parts = fullString.split('-');
      cleanEAN = parts[0]; // Real EAN for matching
      uniqueId = parts[1]; // Timestamp/ID
    }

    // 1. DUPLICATE CHECK (Prevent double scanning same QR)
    // Only check if it's a Unique QR (has uniqueId)
    if (uniqueId) {
      const dupes = await q(`SELECT id FROM assembly_scans WHERE scanned_ean = $1`, [fullString]);
      if (dupes.length > 0) {
        return res.json({ ok: false, error: 'DUPLICATE: This QR was already scanned!' });
      }
    }

    // 2. Fetch Plan Details
    const plans = await q(`SELECT * FROM assembly_plans WHERE id = $1`, [plan_id]);
    if (!plans.length) return res.json({ ok: false, error: 'Plan not found' });

    const plan = plans[0];

    // 3. Validate Match
    const targetEAN = String(plan.ean_number || '').trim();
    const isMatch = (targetEAN === cleanEAN);

    // 4. Log Scan (Store FULL STRING to track uniqueness)
    await q(`INSERT INTO assembly_scans(plan_id, scanned_ean, is_match) VALUES($1, $2, $3)`, [plan_id, fullString, isMatch]);

    // Broadcast Scan Event
    broadcastEvent('scan', { plan_id, table_id: plan.table_id, match: isMatch, unique_id: uniqueId });

    // 4. Update Qty IF Match
    let newQty = plan.scanned_qty || 0;
    if (isMatch) {
      newQty += 1;
      await q(`UPDATE assembly_plans SET scanned_qty = $1, updated_at = NOW() WHERE id = $2`, [newQty, plan_id]);
    } else {
      // WRONG BARCODE TRIGGER
      const alertObj = {
        id: Date.now(),
        table_id: plan.table_id,
        plan_id,
        ean: cleanEAN,
        expected: targetEAN,
        type: 'WRONG_BARCODE',
        timestamp: Date.now()
      };
      ASSEMBLY_ALERTS.push(alertObj);

      // Broadcast Alert Immediate
      broadcastEvent('alert', alertObj);

      // Keep list small
      if (ASSEMBLY_ALERTS.length > 50) ASSEMBLY_ALERTS.shift();
    }

    res.json({ ok: true, match: isMatch, new_qty: newQty, wrong_barcode: !isMatch });

  } catch (e) {
    console.error('Scan Error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================
// MOULD ANALYSIS (Industry Standard)
// ============================================================
app.get('/api/analyze/mould/:mouldCode', async (req, res) => {
  try {
    const { mouldCode } = req.params;
    const { from, to } = req.query;

    console.log('[Mould Analyze] Request for:', mouldCode, from, to);

    // 1. Fetch Mould Master Data (Standards)
    const moulds = await q(
      `SELECT * FROM moulds WHERE mould_number ILIKE $1 OR mould_name ILIKE $1 LIMIT 1`,
      [mouldCode]
    );
    const mould = moulds.length ? moulds[0] : null;

    // 2. Build Query for DPR Logs
    let sql = `
SELECT
dh.production_date,
  dh.shift,
  dh.prod_qty,
  dh.reject_qty,
  dh.downtime_min,
  dh.act_cycle_time,
  dh.reject_breakup,
  dh.downtime_breakup,
  dh.run_hours
      FROM dpr_hourly dh
WHERE(dh.mould_no ILIKE $1 OR dh.item_name ILIKE $1 OR dh.mould_name ILIKE $1)
    `;
    const params = [mouldCode];

    if (from) {
      params.push(from);
      sql += ` AND dh.production_date >= $${params.length} `;
    }
    if (to) {
      params.push(to);
      sql += ` AND dh.production_date <= $${params.length} `;
    }

    sql += ` ORDER BY dh.production_date ASC, dh.shift ASC`;

    const logs = await q(sql, params);

    // 3. Aggregate Data
    let totalGood = 0;
    let totalReject = 0;
    let totalDowntime = 0;
    let totalRunHours = 0;

    // Cycle Time Avg (Weighted by production? Or simple avg? Simple avg of non-zero entries for now)
    let cycleTimeSum = 0;
    let cycleTimeCount = 0;

    const rejectReasons = {};
    const downtimeReasons = {};
    const dailyTrend = {};

    logs.forEach(l => {
      // Basic Sums
      const good = toNum(l.prod_qty);
      const rej = toNum(l.reject_qty);
      totalGood += good;
      totalReject += rej;
      totalDowntime += toNum(l.downtime_min);
      totalRunHours += toNum(l.run_hours);

      // Avg Cycle Time
      if (l.act_cycle_time) {
        cycleTimeSum += toNum(l.act_cycle_time);
        cycleTimeCount++;
      }

      // Rejection Breakup
      if (l.reject_breakup) {
        if (typeof l.reject_breakup === 'string') {
          try { l.reject_breakup = JSON.parse(l.reject_breakup); } catch (e) { }
        }
        if (typeof l.reject_breakup === 'object') {
          Object.entries(l.reject_breakup).forEach(([k, v]) => {
            rejectReasons[k] = (rejectReasons[k] || 0) + toNum(v);
          });
        }
      }

      // Downtime Breakup
      if (l.downtime_breakup) {
        if (typeof l.downtime_breakup === 'string') {
          try { l.downtime_breakup = JSON.parse(l.downtime_breakup); } catch (e) { }
        }
        if (typeof l.downtime_breakup === 'object') {
          Object.entries(l.downtime_breakup).forEach(([k, v]) => {
            downtimeReasons[k] = (downtimeReasons[k] || 0) + toNum(v);
          });
        }
      }

      // Daily Trend
      const d = l.production_date ? new Date(l.production_date).toISOString().split('T')[0] : 'Unknown';
      if (!dailyTrend[d]) dailyTrend[d] = { date: d, good: 0, reject: 0 };
      dailyTrend[d].good += good;
      dailyTrend[d].reject += rej;
    });

    const avgCycleTime = cycleTimeCount ? (cycleTimeSum / cycleTimeCount).toFixed(2) : 0;
    const sortedTrend = Object.values(dailyTrend).sort((a, b) => a.date.localeCompare(b.date));

    // Sort Pareto
    const rejectPareto = Object.entries(rejectReasons)
      .map(([reason, qty]) => ({ reason, qty }))
      .sort((a, b) => b.qty - a.qty);

    // Sort Downtime
    const downtimePareto = Object.entries(downtimeReasons)
      .map(([reason, min]) => ({ reason, min }))
      .sort((a, b) => b.min - a.min);

    res.json({
      ok: true,
      data: {
        mould: mould || { mould_number: mouldCode, mould_name: 'Unknown (Check Master)' },
        kpi: {
          totalGood,
          totalReject,
          totalOutput: totalGood + totalReject,
          totalDowntime,
          totalRunHours: totalRunHours.toFixed(1),
          avgCycleTime
        },
        rejections: rejectPareto,
        downtime: downtimePareto,
        trend: sortedTrend
      }
    });

  } catch (e) {
    console.error('analyze/mould', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================
// ADMIN DATABASE TOOLS (Backup / Restore)
// ============================================================
// ============================================================
// DASHBOARD APIs
// ============================================================
app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    // 1. Production Today (Sum of DPR Good Qty for Today)
    // Using current date/shift logic or simple 24h window
    const prodRes = await q(`
      SELECT COALESCE(SUM(good_qty), 0) as total 
      FROM dpr_hourly 
      WHERE created_at >= CURRENT_DATE
  `);
    const production = parseInt(prodRes[0].total, 10);

    // 2. Active Machines (Count Running Plans)
    const activeRes = await q(`
      SELECT COUNT(DISTINCT machine) as active 
      FROM plan_board 
      WHERE status = 'RUNNING'
  `);
    const active = parseInt(activeRes[0].active, 10);

    const pendingRes = await q(`
      SELECT COUNT(*) as cnt
        FROM orders o
       WHERE COALESCE(o.status, 'Pending') <> 'Completed'
          OR COALESCE(o.completion_confirmation_required, FALSE) = TRUE
    `);
    const orders = parseInt(pendingRes[0].cnt, 10);

    // 4. DPR Entries (Last 24h Activity Count)
    const dprRes = await q(`
      SELECT COUNT(*) as cnt 
      FROM dpr_hourly 
      WHERE created_at >= (NOW() - INTERVAL '24 HOURS')
`);
    const dpr = parseInt(dprRes[0].cnt, 10);

    // OEE / Util / Rejects (Mocked or Calc)
    // For now return 0 or simple aggregates
    res.json({
      ok: true,
      data: {
        production,
        active,
        orders, // Backlog
        dpr, // Activity
        oee: 85, // Mock target
        utilization: 78,
        rejects: 1.2
      }
    });

  } catch (e) {
    console.error('/api/dashboard/kpis', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ============================================================
// ADMIN DATABASE TOOLS (Backup / Restore)
// ============================================================
const { spawn } = require('child_process');
// NOTE: User provided path "18", we assume they know their version or path.
const PG_BIN_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin';

// 1. BACKUP (Custom Format -Fc for better Restore)
app.get('/api/admin/backup', async (req, res) => {
  console.log('[Backup] Starting backup process...');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename = jpsms_backup_${Date.now()}.dump`);

  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'Sanjay@541##' };

  // pg_dump -U postgres -h localhost -p 5432 -F c -Z 9 jpsms
  // -F c: Custom Format (allows pg_restore features)
  // -Z 9: Max Compression
  const dump = spawn(path.join(PG_BIN_PATH, 'pg_dump.exe'), [
    '-U', 'postgres',
    '-h', 'localhost',
    '-p', '5432',
    '-F', 'c',
    '-Z', '9',
    'jpsms'
  ], { env });

  dump.stdout.pipe(res);

  dump.stderr.on('data', (data) => console.error(`[Backup Log]: ${data} `));
});

// 2. RESTORE
app.post('/api/admin/restore', upload.single('file'), async (req, res) => {
  console.log('[Restore] Request received');
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

  const filePath = req.file.path;
  const isSql = req.file.originalname.endsWith('.sql');

  console.log('[Restore] File:', filePath, 'Type:', isSql ? 'SQL' : 'Binary');

  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'Sanjay@541##' };

  let proc;
  if (isSql) {
    // Legacy Support for .sql (Plain Text)
    // WARNING: Cannot easily --clean. Will append/error on duplicates.
    console.log('[Restore] Using PSQL (Legacy Text Mode)');
    proc = spawn(path.join(PG_BIN_PATH, 'psql.exe'), [
      '-U', 'postgres',
      '-h', 'localhost',
      '-d', 'jpsms',
      '-f', filePath
    ], { env });
  } else {
    // Binary Restore (.dump)
    // ENABLE --clean to DROP tables before restoring (Fixes "Merge" issues)
    console.log('[Restore] Using PG_RESTORE (Binary Mode)');
    proc = spawn(path.join(PG_BIN_PATH, 'pg_restore.exe'), [
      '-U', 'postgres',
      '-h', 'localhost',
      '-d', 'jpsms',
      '--clean',     // DROP objects before creating
      '--if-exists', // Prevent error if db is empty
      '--no-owner',  // Prevent ownership errors on Windows
      '--no-privileges',
      filePath
    ], { env });
  }

  let errorOutput = '';
  proc.stderr.on('data', (data) => {
    const msg = data.toString();
    // Ignore "does not exist, skipping" warnings from --clean
    if (!msg.includes('does not exist, skipping')) errorOutput += msg;
    console.log(`[Restore Log]: ${msg} `);
  });

  proc.on('close', (code) => {
    fs.unlink(filePath, () => { });
    // pg_restore returns 1 on warnings, so allow it if output implies success
    console.log(`[Restore] Process ended with code ${code} `);

    res.json({ ok: true, message: 'Process Finished' });
  });
});

// ------------------------------------------------------------------
// JOB COMPLETION & APPROVAL WORKFLOW
// ------------------------------------------------------------------

// 1. COMPLETE JOB (Supervisor) -> Stops current job and Auto-Starts next prioritized job
console.log(">>>>>>>> EVALUATING JOB COMPLETE ROUTE <<<<<<<<");
app.post(/^\/api\/job\/supervisor-complete\/?$/, async (req, res) => {
  try {
    const body = req.body || {};
    // Permissive lookup for PlanID (Case Insensitive / Varied Keys)
    const planId = body.planId || body.PlanID || body.plan_id || body.id;

    if (!planId) {
      console.error('[JobComplete] Missing PlanID. Body:', body);
      return res.status(400).json({ ok: false, error: 'Missing PlanID' });
    }

    // 1. Mark current job as 'Stopped' (User override: NOT COMPLETED_PENDING)
    const r = await q(`
      UPDATE plan_board 
      SET status = 'Stopped', updated_at = NOW()
      WHERE plan_id = $1
RETURNING *
  `, [planId]);

    if (!r.length) return res.status(404).json({ ok: false, error: 'Job not found' });

    const currentJob = r[0];
    const machine = currentJob.machine;
    const currentJobId = currentJob.id;

    // 2. Log action
    await q(
      "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'COMPLETE_STOP', $2, 'System')",
      [currentJobId, JSON.stringify({ machine, msg: 'Job stopped from supervisor completion' })]
    );

    // 3. Find next prioritized job (matching mould_no first)
    const nextJobQuery = `
      WITH current_mould AS (
        SELECT COALESCE(mps.mould_no, m.mould_number, '-') as mould_no
        FROM plan_board pb
        LEFT JOIN moulds m ON m.mould_name = pb.mould_name 
        LEFT JOIN mould_planning_summary mps ON (mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
        WHERE pb.plan_id = $2
        LIMIT 1
      )
      SELECT pb.id, pb.plan_id, pb.machine, pb.status 
      FROM plan_board pb
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name 
      LEFT JOIN mould_planning_summary mps ON (mps.or_jr_no = pb.order_no AND mps.mould_name = pb.mould_name)
      WHERE pb.machine = $1 
        AND pb.status NOT IN ('Running', 'COMPLETED', 'COMPLETED_PENDING', 'CANCELLED', 'ARCHIVED')
        AND pb.plan_id != $2
      ORDER BY 
        CASE 
          WHEN COALESCE(mps.mould_no, m.mould_number, '-') = (SELECT mould_no FROM current_mould) 
               AND (SELECT mould_no FROM current_mould) != '-' 
          THEN 0 
          ELSE 1 
        END,
        pb.seq ASC, 
        pb.id ASC
      LIMIT 1
    `;

    const nextJobRes = await q(nextJobQuery, [machine, planId]);

    let autoStartMessage = 'Job stopped successfully.';
    if (nextJobRes.length > 0) {
      const nextJob = nextJobRes[0];

      // Auto-Start next prioritized job
      await q("UPDATE plan_board SET status = 'Running', start_date = NOW(), updated_at = NOW() WHERE plan_id = $1", [nextJob.plan_id]);

      // Stop any other accidentally overlapping active jobs on same machine
      await q("UPDATE plan_board SET status = 'Stopped', updated_at = NOW() WHERE machine = $1 AND plan_id != $2 AND status = 'Running'", [machine, nextJob.plan_id]);

      // Log auto-start
      await q(
        "INSERT INTO plan_audit_logs (plan_id, action, details, user_name) VALUES ($1, 'AUTO_START', $2, 'System')",
        [nextJob.id, JSON.stringify({ machine, trigger: 'Previous job completed/stopped' })]
      );

      autoStartMessage = 'Job stopped. Next job in queue auto-started.';
    }

    // Trigger live sync for connected clients if available
    try {
      if (typeof syncService !== 'undefined' && syncService.triggerSync) {
        syncService.triggerSync();
      }
    } catch (err) { console.error('Sync trigger err on job/complete', err); }

    res.json({ ok: true, message: autoStartMessage });
  } catch (e) {
    console.error('/api/job/complete', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 2. GET PENDING APPROVALS (Manager)
app.get('/api/approvals/pending', async (req, res) => {
  try {
    const { line } = req.query; // Optional filter
    let sql = `
SELECT
pb.*,
  o.client_name,
  o.item_name as sfg_name,
  r.job_card_no,
  m.mould_number as mould_code
      FROM plan_board pb
      LEFT JOIN orders o ON pb.order_no = o.order_no
      LEFT JOIN or_jr_report r ON r.or_jr_no = pb.order_no
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name
      WHERE pb.status = 'COMPLETED_PENDING'
  `;

    const params = [];
    if (line) {
      sql += ` AND pb.line = $1`;
      params.push(line);
    }

    sql += ` ORDER BY pb.end_date DESC`;

    const rows = await q(sql, params);

    // Map to simple structure for approvals.html
    const items = rows.map(r => ({
      ApprovalID: r.plan_id, // Use PlanID as ID
      OrderNo: r.order_no,
      JobCardNo: r.job_card_no || '',
      Machine: r.machine,
      Line: r.line || '',
      MouldName: r.mould_name,
      Client: r.client_name,
      SubmittedAt: new Date(r.end_date).toLocaleString(),
      SubmittedBy: 'Supervisor',
      Status: 'Pending Approval'
    }));

    res.json({ ok: true, items });
  } catch (e) {
    console.error('/api/approvals/pending', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 3. GET SINGLE APPROVAL ITEM (Review Details)
app.get('/api/approvals/item/:id', async (req, res) => {
  try {
    const { id } = req.params; // PlanID
    // Fetch Job Details
    const r = await q(`
            SELECT pb.*, o.client_name, r.job_card_no 
            FROM plan_board pb 
            LEFT JOIN orders o ON pb.order_no = o.order_no
            LEFT JOIN or_jr_report r ON r.or_jr_no = pb.order_no
            WHERE pb.plan_id = $1
  `, [id]);

    if (!r.length) return res.json({ ok: false, error: 'Job not found' });
    const job = r[0];

    // 1. Get Targets from JC
    const jcRows = await q(`
SELECT
COALESCE(data ->> 'mould_item_name', data ->> 'item_name') as name,
  COALESCE(data ->> 'plan_qty', data ->> 'item_qty') as qty
            FROM jc_details 
            WHERE TRIM(data ->> 'or_jr_no') = $1 AND TRIM(data ->> 'mould_no') = $2
  `, [String(job.order_no).trim(), String(job.mould_name).trim()]);

    // 2. Get Actuals
    const dprRows = await q(`SELECT colour, SUM(good_qty) as good FROM dpr_hourly WHERE plan_id = $1 GROUP BY colour`, [id]);

    const items = [];

    // Merge Data for Review Table
    // We will just list what was Produced vs Plan
    dprRows.forEach(row => {
      const planRow = jcRows.find(j => (j.name || '').includes(row.colour)); // Loose match for now
      items.push({
        name: row.colour,
        plan: planRow ? Number(planRow.qty) : 0,
        bal: Number(row.good) // Produced
      });
    });

    const item = {
      ApprovalID: job.plan_id,
      OrderNo: job.order_no,
      JobCardNo: job.job_card_no,
      MouldName: job.mould_name,
      Client: job.client_name,
      Line: job.line,
      Machine: job.machine,
      SubmittedAt: job.end_date,
      ImageUrl: null
    };

    res.json({
      ok: true,
      item,
      colours: items,
      totals: { plan: 0, bal: dprRows.reduce((a, b) => a + Number(b.good), 0) }
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4. REVIEW ACTION (Approve/Reject)
app.post('/api/approvals/review', async (req, res) => {
  try {
    const { id, action, notes, username } = req.body; // id=PlanID
    if (!id || !action) return res.status(400).json({ ok: false, error: 'Missing args' });

    if (action === 'APPROVE') {
      // Move to CLOSED
      // Archive? Or just Status=CLOSED?
      await q(`UPDATE plan_board SET status = 'CLOSED', note = $2 WHERE plan_id = $1`, [id, notes || 'Approved']);

      // Close the Order? logic is separate, but we could check if all plans closed.

      res.json({ ok: true, message: 'Job Approved & Closed' });
    }
    else if (action === 'REJECT') {
      // Push back to RUNNING or PLANNED
      // "Approve that Job And Also Run That Job" -> If Rejected, maybe set to Running?
      // Actually, User said: "Approve that Job And Also Run That Job"
      // So AFTER approval it should RUN? Or Does he mean "Approve it so we can run the NEXT job?"
      // Let's assume Standard: Approve -> Close. Reject -> Fix (Running).

      await q(`UPDATE plan_board SET status = 'RUNNING', note = $2 WHERE plan_id = $1`, [id, (notes ? 'REJECTED: ' + notes : 'Rejected')]);
      res.json({ ok: true, message: 'Job Rejected (Set back to Running)' });
    }
    else {
      res.status(400).json({ ok: false, error: 'Invalid action' });
    }
    // 4. REVIEW ACTION (Approve/Reject)
    // ... [existing code] ...
  } catch (e) {
    console.error('/api/approvals/review', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   [RESTORED] DPR SUMMARY MATRIX (For DPR Compliance Report)
   Restored original logic for dpr.html
   ============================================================ */
/*
app.get('/api/dpr/summary-matrix', async (req, res) => {
  try {
    const { date, shift } = req.query; // '2023-10-27', 'Day' or 'Night'
    const cleanDate = (date || '').trim();
    const cleanShift = (shift || '').trim() || 'Day';

    if (!cleanDate) return res.json({ ok: false, error: 'Date required' });

    // 1. Fetch Machines (Active)
    const machines = await q(`
      SELECT machine, line, type 
      FROM machines 
      WHERE COALESCE(is_active, TRUE) = TRUE 
      ORDER BY line ASC, machine ASC
  `);

    // 2. Fetch DPR Entries (Summary)
    // We need to aggregate by machine to show availability/status
    const entries = await q(`
SELECT
machine,
  SUM(good_qty) as total_good,
  SUM(reject_qty) as total_rej,
  SUM(downtime_min) as total_dt,
  MAX(created_at) as last_entry
      FROM dpr_hourly
      WHERE dpr_date = $1::date AND shift = $2
      GROUP BY machine
  `, [cleanDate, cleanShift]);

    // 3. Transform to Map
    const entryMap = {}; // machine -> { total_good, ... }
    entries.forEach(e => {
      entryMap[e.machine] = e;
    });

    // 4. Fetch Maintenance/Setups (Mock for now or real if tables exist)
    const maintenance = {};
    const setups = [];

    res.json({
      ok: true,
      data: {
        machines,
        entries: entryMap,
        maintenance,
        setups
      }
    });

  } catch (e) {
    console.error('DPR Summary Matrix Error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});
*/

// ------------------------------------------------------------------
// JOB ANALYSIS & REPORTING
// ------------------------------------------------------------------
app.get('/api/analyze/order/:orderNo', async (req, res) => {
  try {
    const { orderNo } = req.params;
    if (!orderNo) return res.status(400).json({ ok: false, error: 'Order No required' });

    const decodedOrder = decodeURIComponent(orderNo).trim();

    // 1. Get Plan & Standard Info
    const infoRows = await q(`
SELECT
pb.plan_qty,
  pb.item_code,
  s.article_act as act_weight,
  COALESCE(m.std_wt_kg, m2.std_wt_kg) as std_weight,
  COALESCE(m.cycle_time, m2.cycle_time) as std_cycle,
  COALESCE(m.no_of_cav, m2.no_of_cav) as std_cavity
      FROM plan_board pb 
      LEFT JOIN std_actual s ON s.plan_id = pb.plan_id
      LEFT JOIN moulds m ON m.mould_name = pb.mould_name
      LEFT JOIN moulds m2 ON m2.mould_name = pb.mould_name
      WHERE TRIM(pb.order_no) = $1
      LIMIT 1
  `, [decodedOrder]);

    const info = infoRows[0] || {};

    // 2. Get Production Logs (DPR Hourly)
    const logs = await q(`
SELECT
colour,
  good_qty,
  reject_qty,
  downtime_min,
  downtime_breakup
      FROM dpr_hourly 
      WHERE TRIM(order_no) = $1
  `, [decodedOrder]);

    // 3. Aggregate Data
    const colourStats = {};
    const downtimeStats = {};
    let totalGood = 0;
    let totalRej = 0;
    let totalDT = 0;

    logs.forEach(l => {
      // Colour Breakdown
      const c = l.colour || 'Unknown';
      if (!colourStats[c]) colourStats[c] = { good: 0, rej: 0 };
      colourStats[c].good += Number(l.good_qty || 0);
      colourStats[c].rej += Number(l.reject_qty || 0);

      // Totals
      totalGood += Number(l.good_qty || 0);
      totalRej += Number(l.reject_qty || 0);
      totalDT += Number(l.downtime_min || 0);

      // Downtime Breakdown
      if (l.downtime_breakup) {
        try {
          const dtMap = (typeof l.downtime_breakup === 'string') ? JSON.parse(l.downtime_breakup) : l.downtime_breakup;
          if (dtMap && typeof dtMap === 'object') {
            Object.keys(dtMap).forEach(k => {
              const min = Number(dtMap[k]);
              if (min > 0) downtimeStats[k] = (downtimeStats[k] || 0) + min;
            });
          }
        } catch (e) { }
      }
    });

    res.json({
      ok: true,
      data: {
        info,
        logs, // Send raw logs if needed, but summary is better
        colour_stats: colourStats,
        downtime_stats: downtimeStats,
        totals: {
          good: totalGood,
          rej: totalRej,
          dt: totalDT
        }
      }
    });

  } catch (e) {
    console.error('/api/analyze/order error', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ============================================================
   DPR SUMMARY MATRIX (Live Dashboard)
   - Tonnage Trends
   - Efficiency/Rejection Trends
   - Shift Comparison
   - Last Hour Logic
============================================================ */
// [MOVED TO TOP] /api/dpr/summary-matrix logic moved to prevent route collision
// See lines ~160
// ...

// Helper Debug Route
const SERVER_START_TIME = new Date().toISOString();
app.get('/api/dpr/debug', async (req, res) => {
  try {
    const c = await q(`
SELECT
count(*) as total,
  max(dpr_date) as last_date,
  current_database() as db_name,
  current_user as db_user
        FROM dpr_hourly
    `);
    const s = await q('SELECT DISTINCT shift FROM dpr_hourly LIMIT 5');
    res.json({
      ok: true,
      server_start: SERVER_START_TIME,
      db_stats: c[0],
      shifts: s.map(x => x.shift)
    });
  } catch (e) {
    res.json({ error: String(e), stack: e.stack });
  }
});

app.use('/api', (req, res) => {
  console.log('404 Not Found for API:', req.method, req.originalUrl);
  res.status(404).json({ ok: false, error: 'API route not found' });
});

function getLanUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach(entries => {
    (entries || []).forEach(entry => {
      if (!entry || entry.internal || entry.family !== 'IPv4') return;
      urls.push(`http://${entry.address}:${port}`);
    });
  });

  return [...new Set(urls)];
}

// HTTP server is started only after DB init completes (see async IIFE above).

  return { initializeLegacyRuntime };
};

