    function mEscHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    // Custom "Natural" Sort: Splits strings into text/number chunks and compares them.
    // Fixes "Line>Machine-1" vs "Line>Machine-10" deterministically.
    function naturalCompare(a, b) {
      const ax = [];
      const bx = [];

      String(a).replace(/(\d+)|(\D+)/g, function (_, $1, $2) { ax.push([$1 || Infinity, $2 || ""]) });
      String(b).replace(/(\d+)|(\D+)/g, function (_, $1, $2) { bx.push([$1 || Infinity, $2 || ""]) });

      while (ax.length && bx.length) {
        const an = ax.shift();
        const bn = bx.shift();
        const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
        if (nn) return nn;
      }

      return ax.length - bx.length;
    }

    jQuery.extend(jQuery.fn.dataTableExt.oSort, {
      "series-asc": function (a, b) {
        return naturalCompare(a, b);
      },
      "series-desc": function (a, b) {
        return naturalCompare(b, a);
      }
    });

    let masterTable;
    let masterDataLoading = false;

    let pendingUploadData = [];
    let pendingUploadMode = null;
    let pendingUploadFile = null;
    let pendingUploadPreviewMeta = {};
    let currentType = 'orders';
    let currentView = 'active'; // 'active' or 'closed'
    let allowedFactories = [];
    let currentFactoryScope = { id: null, name: '', isAll: false };
    let currentWriteScope = { id: null, name: '', isAll: false };
    let currentMachineIconBase64 = null;
    const templateSupportedTypes = ['orders', 'moulds', 'machines', 'orjr', 'orjrwise', 'orjrwisedetail', 'jcdetails', 'boplanningdetail', 'wipstock'];
    const reportOnlyTypes = ['labour-parties'];
    const clientPreviewSchemas = {
      boplanningdetail: {
        label: 'BO Planning Detail',
        columns: [
          { key: 'or_jr_no', label: 'OR/JR No', sample: 'OR-123' },
          { key: 'jr_date', label: 'JR Date', sample: '2024-01-01' },
          { key: 'our_code', label: 'Our Code', sample: 'ITM-001' },
          { key: 'bom_type', label: 'BomType', sample: 'FG' },
          { key: 'jr_item_name', label: 'JR Item Name', sample: 'Product A' },
          { key: 'jr_qty', label: 'JR Qty', sample: '1000' },
          { key: 'uom', label: 'UOM', sample: 'PCS' },
          { key: 'plan_date', label: 'Plan Date', sample: '2024-01-05' },
          { key: 'plan_qty', label: 'Plan Qty', sample: '500' },
          { key: 'bo_item_code', label: 'Bo Item Code', sample: 'B-001' },
          { key: 'bo_item_name', label: 'Bo Item Name', sample: 'Component X' },
          { key: 'bo_uom', label: 'Bo UOM', sample: 'PCS' },
          { key: 'bo_item_qty', label: 'Bo Item Qty', sample: '500' },
          { key: 'remarks_all', label: 'Remarks', sample: 'N/A' }
        ]
      },
      orders: {
        label: 'Orders Master',
        maxHeaderScanRows: 25,
        minMatchedColumns: 5,
        columns: [
          { key: 'order_no', label: 'Order No', aliases: ['OrderNo'] },
          { key: 'item_code', label: 'Item Code', aliases: ['ItemCode'] },
          { key: 'item_name', label: 'Item Name', aliases: ['ItemName'] },
          { key: 'mould_code', label: 'Mould Code', aliases: ['MouldCode'] },
          { key: 'qty', label: 'Qty', aliases: ['Qty'] },
          { key: 'priority', label: 'Priority', aliases: ['Priority'] },
          { key: 'client_name', label: 'Client Name', aliases: ['Client Name'] },
          { key: 'factory_id', label: 'Factory ID', aliases: ['Factory ID', 'Factory', 'Factory Code'], optional: true }
        ]
      },
      moulds: {
        label: 'Moulds Master',
        maxHeaderScanRows: 25,
        minMatchedColumns: 10,
        columns: [
          { key: 'mould_number', label: 'Mould Number', aliases: ['MOULD NUMBER', 'ERP Item Code'] },
          { key: 'mould_name', label: 'Mould Name', aliases: ['MOULD NAME', 'Product Name'] },
          { key: 'std_wt_kg', label: 'STD WT (KG)', aliases: ['STD WT (KG)', 'STD WT KG'] },
          { key: 'runner_weight', label: 'Runner Weight', aliases: ['RUNNER WEIGHT'] },
          { key: 'primary_machine', label: 'Primary Machine', aliases: ['PRIMARY MACHINE'] },
          { key: 'secondary_machine', label: 'Secondary Machine', aliases: ['SECONDARY MACHINE'] },
          { key: 'moulding_sqn', label: 'Moulding SQN.', aliases: ['MOULDING SQN.', 'MOULDING SQN'] },
          { key: 'consumption_ratio_qty', label: 'Consumption Ratio(QTY)', aliases: ['CONSUMPTION RATIO(QTY)', 'CONSUMPTION RATIO (QTY)', 'CONSUMPTION RATIO QTY'] },
          { key: 'tonnage', label: 'Tonnage', aliases: ['TONNAGE', 'Machine'] },
          { key: 'no_of_cav', label: 'No Of Cav', aliases: ['NO OF CAV', 'NO OF CAVITY'] },
          { key: 'cycle_time', label: 'Cycle Time', aliases: ['CYCLE TIME'] },
          { key: 'pcs_per_hour', label: 'PCS/HOUR', aliases: ['PCS/HOUR', 'PCS PER HOUR'] },
          { key: 'target_pcs_day', label: 'Target PCS/Day', aliases: ['TARGET PCS/DAY', 'TARGET PCS DAY', 'OUTPUT PER DAY'] },
          { key: 'material', label: 'Material', aliases: ['MATERIAL', 'MATERIAL 1'] },
          { key: 'manpower', label: 'Manpower', aliases: ['MANPOWER'] },
          { key: 'operator_activities', label: 'Operator Activities', aliases: ['OPERATOR ACTIVITIES'] },
          { key: 'sfg_std_packing', label: 'SFG STD Packing', aliases: ['SFG STD PACKING', 'SFG QTY'] },
          { key: 'sfg_bag_type', label: 'SFG Bag Type', aliases: ['SFG BAG TYPE'] },
          { key: 'sfg_bag_size', label: 'SFG Bag Size', aliases: ['SFG BAG SIZE', 'SFG BAG SIZE '] },
          { key: 'std_volume_cap', label: 'STD Volume Cap.', aliases: ['STD VOLUME CAP.', 'STD VOLUME CAP', 'STD VOLUME CAPACITY'] },
          { key: 'factory_id', label: 'Factory ID', aliases: ['FACTORY ID', 'FACTORY', 'FACTORY CODE'], optional: true }
        ]
      },
      orjrwise: {
        label: 'ORJR Wise Summary',
        maxHeaderScanRows: 25,
        minMatchedColumns: 8,
        columns: [
          { key: 'or_jr_no', label: 'OR/JR No', aliases: ['OR/JR No'] },
          { key: 'jr_date', label: 'JR Date', aliases: ['JR Date', 'OR/JR Date'] },
          { key: 'our_code', label: 'Our Code', aliases: ['Our Code', 'Item Code'] },
          { key: 'bom_type', label: 'BomType', aliases: ['BomType', 'BOM Type'] },
          { key: 'jr_item_name', label: 'JR Item Name', aliases: ['JR Item Name', 'Product Name'] },
          { key: 'jr_qty', label: 'JR Qty', aliases: ['JR Qty'] },
          { key: 'uom', label: 'UOM', aliases: ['UOM'] },
          { key: 'mould_no', label: 'Mould No', aliases: ['Mould No', 'Mold No'] },
          { key: 'mould_name', label: 'Mould', aliases: ['Mould', 'Mould Name', 'Mold'] },
          { key: 'mould_item_qty', label: 'Mould Item Qty', aliases: ['Mould Item Qty', 'Mold Item Qty'] },
          { key: 'tonnage', label: 'Tonnage', aliases: ['Tonnage'] },
          { key: 'machine_name', label: 'Machine', aliases: ['Machine', 'Machine Name'] },
          { key: 'cycle_time', label: 'Cycle Time', aliases: ['Cycle Time'] },
          { key: 'cavity', label: 'Cavity', aliases: ['Cavity'] },
          { key: 'factory_id', label: 'Factory ID', aliases: ['Factory ID', 'Factory', 'Factory Code'], optional: true }
        ]
      },
      orjrwisedetail: {
        label: 'ORJR Wise Detail',
        maxHeaderScanRows: 25,
        minMatchedColumns: 10,
        columns: [
          { key: 'or_jr_no', label: 'OR/JR No', aliases: ['OR/JR No'] },
          { key: 'jr_date', label: 'JR Date', aliases: ['JR Date', 'OR/JR Date'] },
          { key: 'our_code', label: 'Our Code', aliases: ['Our Code', 'Item Code'] },
          { key: 'bom_type', label: 'BomType', aliases: ['BomType', 'BOM Type'] },
          { key: 'jr_item_name', label: 'JR Item Name', aliases: ['JR Item Name', 'Product Name'] },
          { key: 'jr_qty', label: 'JR Qty', aliases: ['JR Qty'] },
          { key: 'uom', label: 'UOM', aliases: ['UOM'] },
          { key: 'mould_item_code', label: 'Mold Item Code', aliases: ['Mold Item Code', 'Mould Item Code'] },
          { key: 'mould_item_name', label: 'Mold Item Name', aliases: ['Mold Item Name', 'Mould Item Name'] },
          { key: 'mould_no', label: 'Mould No', aliases: ['Mould No', 'Mold No'] },
          { key: 'mould_name', label: 'Mould', aliases: ['Mould', 'Mould Name', 'Mold'] },
          { key: 'mould_item_qty', label: 'Mould Item Qty', aliases: ['Mould Item Qty', 'Mold Item Qty'] },
          { key: 'tonnage', label: 'Tonnage', aliases: ['Tonnage'] },
          { key: 'machine_name', label: 'Machine', aliases: ['Machine', 'Machine Name'] },
          { key: 'cycle_time', label: 'Cycle Time', aliases: ['Cycle Time'] },
          { key: 'cavity', label: 'Cavity', aliases: ['Cavity'] },
          { key: 'factory_id', label: 'Factory ID', aliases: ['Factory ID', 'Factory', 'Factory Code'], optional: true }
        ]
      },
      jcdetails: {
        label: 'JC Detail',
        maxHeaderScanRows: 25,
        minMatchedColumns: 12,
        columns: [
          { key: 'or_jr_no', label: 'OR/JR No', aliases: ['OR/JR No'] },
          { key: 'jr_date', label: 'JR Date', aliases: ['JR Date', 'OR/JR Date'] },
          { key: 'jc_no', label: 'JC No', aliases: ['JC No', 'Job Card No'] },
          { key: 'jc_id', label: 'JC ID', aliases: ['JC ID', 'Job Card ID'] },
          { key: 'jc_date', label: 'JC Date', aliases: ['JC Date', 'Job Card Date'] },
          { key: 'jc_qty', label: 'JC Qty', aliases: ['JC Qty', 'Job Card Qty'] },
          { key: 'our_code', label: 'Our Code', aliases: ['Our Code', 'Item Code'] },
          { key: 'bom_type', label: 'BomType', aliases: ['BomType', 'BOM Type'] },
          { key: 'jr_item_name', label: 'JR Item Name', aliases: ['JR Item Name', 'Product Name'] },
          { key: 'jr_qty', label: 'JR Qty', aliases: ['JR Qty'] },
          { key: 'uom', label: 'UOM', aliases: ['UOM'] },
          { key: 'plan_date', label: 'Plan Date', aliases: ['Plan Date'] },
          { key: 'plan_qty', label: 'Plan Qty', aliases: ['Plan Qty'] },
          { key: 'mould_item_code', label: 'Mold Item Code', aliases: ['Mold Item Code', 'Mould Item Code'] },
          { key: 'mould_item_name', label: 'Mold Item Name', aliases: ['Mold Item Name', 'Mould Item Name'] },
          { key: 'mould_no', label: 'Mould No', aliases: ['Mould No', 'Mold No'] },
          { key: 'mould', label: 'Mould', aliases: ['Mould', 'Mould Name', 'Mold'] },
          { key: 'mould_item_qty', label: 'Mould Item Qty', aliases: ['Mould Item Qty', 'Mold Item Qty'] },
          { key: 'tonnage', label: 'Tonnage', aliases: ['Tonnage'] },
          { key: 'machine', label: 'Machine', aliases: ['Machine', 'Machine Name'] },
          { key: 'cycle_time', label: 'Cycle Time', aliases: ['Cycle Time'] },
          { key: 'cavity', label: 'Cavity', aliases: ['Cavity'] },
          { key: 'factory_id', label: 'Factory ID', aliases: ['Factory ID', 'Factory', 'Factory Code'], optional: true }
        ]
      }
    };

    function slugifyText(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'factory';
    }

    function getFactoryScopeLabel() {
      return currentFactoryScope.isAll ? 'All Factories' : (currentFactoryScope.name || 'Factory');
    }

    function getWriteScopeLabel() {
      return currentWriteScope.isAll ? 'All Factories' : (currentWriteScope.name || 'Selected Login Factory');
    }

    function canWriteCurrentFactoryScope() {
      if (currentType === 'users') return JPSMS.auth.can('masters', 'edit');
      if (!JPSMS.auth.can('masters', 'edit')) return false;
      if (currentFactoryScope.isAll || currentWriteScope.isAll) return false;
      if (!currentFactoryScope.id || !currentWriteScope.id) return false;
      return String(currentFactoryScope.id) === String(currentWriteScope.id);
    }

    function getWriteLockReason(actionLabel = 'make changes') {
      if (currentType === 'users') return '';
      if (currentWriteScope.isAll) {
        return `This login is in All Factories mode. Log out and log in to one factory to ${actionLabel}.`;
      }
      if (currentFactoryScope.isAll) {
        return `All Factories view is read only. Select ${getWriteScopeLabel()} to ${actionLabel}.`;
      }
      if (currentWriteScope.id && currentFactoryScope.id && String(currentFactoryScope.id) !== String(currentWriteScope.id)) {
        return `This session can ${actionLabel} only in ${getWriteScopeLabel()}. Log out and log in again to work in another factory.`;
      }
      if (!currentFactoryScope.id) {
        return `Select ${getWriteScopeLabel()} to ${actionLabel}.`;
      }
      return `Select the correct factory to ${actionLabel}.`;
    }

    function getWriteLockShortHint() {
      if (currentWriteScope.isAll) return 'Log in to one factory';
      if (currentFactoryScope.isAll) return 'Select one factory';
      if (currentWriteScope.id && currentFactoryScope.id && String(currentFactoryScope.id) !== String(currentWriteScope.id)) {
        return `Write: ${getWriteScopeLabel()}`;
      }
      return 'Read only';
    }

    function getExportScopeFileLabel() {
      return currentFactoryScope.isAll ? 'ALL' : (currentFactoryScope.name || 'Factory');
    }

    function getExportMasterLabel() {
      const labels = {
        orders: 'Orders Master',
        moulds: 'Mould Master',
        machines: 'Machine Master',
        orjr: 'OR-JR Status',
        orjrwise: 'ORJR Wise Summary',
        orjrwisedetail: 'ORJR Wise Detail',
        jcdetails: 'JC Detail',
        boplanningdetail: 'BO Planning Detail',
        wipstock: 'WIP Stock',
        users: 'User Master'
      };
      return labels[currentType] || 'Master Data';
    }

    function resetPendingUploadState() {
      pendingUploadData = [];
      pendingUploadMode = null;
      pendingUploadFile = null;
      pendingUploadPreviewMeta = {};
    }

    function normalizePreviewHeaderKey(value) {
      return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getPreviewSchema(type) {
      return clientPreviewSchemas[type] || null;
    }

    function getPreviewAliasKeys(column) {
      return [...new Set([column.label, ...(column.aliases || [])].map(normalizePreviewHeaderKey).filter(Boolean))];
    }

    function getPreviewHeaderMatchCount(row, schema) {
      if (!Array.isArray(row) || !schema) return 0;
      const normalizedCells = row.map(normalizePreviewHeaderKey).filter(Boolean);
      if (!normalizedCells.length) return 0;

      let count = 0;
      schema.columns.forEach(column => {
        const aliasKeys = getPreviewAliasKeys(column);
        if (normalizedCells.some(cell => aliasKeys.includes(cell))) count++;
      });
      return count;
    }

    function isPreviewCellFilled(value) {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      return String(value).trim() !== '';
    }

    function formatPreviewCell(value) {
      if (value === null || value === undefined) return '';
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().split('T')[0];
      }
      return String(value);
    }

    let _xlsxLoadPromise = null;
    function ensureXlsxLoaded() {
      if (typeof XLSX !== 'undefined') return Promise.resolve();
      if (_xlsxLoadPromise) return _xlsxLoadPromise;
      _xlsxLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = '/assets/vendor/jsdelivr/xlsx@0.18.5/xlsx.full.min.js';
        s.onload = () => resolve();
        s.onerror = () => { _xlsxLoadPromise = null; reject(new Error('Preview library failed to load. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
      return _xlsxLoadPromise;
    }

    async function buildClientUploadPreview(file, type) {
      await ensureXlsxLoaded();
      if (typeof XLSX === 'undefined') {
        throw new Error('Preview library failed to load. Refresh and try again.');
      }
      const schema = getPreviewSchema(type);
      if (!schema) {
        throw new Error(`Preview is not configured for ${getExportMasterLabel()}.`);
      }

      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', raw: true, cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('Selected file is empty.');
      }

      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
        header: 1,
        defval: null,
        blankrows: false,
        raw: true
      });

      if (!rawRows.length) {
        throw new Error('Selected file is empty.');
      }

      const maxScanRows = Math.min(rawRows.length, schema.maxHeaderScanRows || 20);
      let headerRowIndex = -1;
      let bestMatchCount = -1;
      for (let i = 0; i < maxScanRows; i++) {
        const matchCount = getPreviewHeaderMatchCount(rawRows[i], schema);
        if (matchCount > bestMatchCount) {
          bestMatchCount = matchCount;
          headerRowIndex = i;
        }
      }

      if (headerRowIndex === -1 || bestMatchCount < (schema.minMatchedColumns || 1)) {
        throw new Error(`Upload file columns do not match the JMS template for ${schema.label}.`);
      }

      const normalizedHeader = (rawRows[headerRowIndex] || []).map(normalizePreviewHeaderKey);
      const indexMap = new Map();
      schema.columns.forEach(column => {
        const aliasKeys = getPreviewAliasKeys(column);
        const idx = normalizedHeader.findIndex(cell => aliasKeys.includes(cell));
        if (idx >= 0) indexMap.set(column.key, idx);
      });

      const missingColumns = schema.columns
        .filter(column => !column.optional && !indexMap.has(column.key))
        .map(column => column.label);
      if (missingColumns.length) {
        throw new Error(`Upload file columns do not match the JMS template. Missing: ${missingColumns.join(', ')}.`);
      }

      const parsedRows = [];
      for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
        const sourceRow = rawRows[i];
        if (!Array.isArray(sourceRow) || !sourceRow.some(isPreviewCellFilled)) continue;
        if (getPreviewHeaderMatchCount(sourceRow, schema) >= (schema.minMatchedColumns || 1)) continue;

        const previewRow = {};
        let hasData = false;
        schema.columns.forEach(column => {
          const sourceIndex = indexMap.get(column.key);
          const value = sourceIndex === undefined ? null : sourceRow[sourceIndex];
          previewRow[column.key] = formatPreviewCell(value);
          if (!hasData && isPreviewCellFilled(value)) hasData = true;
        });

        if (hasData) parsedRows.push(previewRow);
      }

      if (!parsedRows.length) {
        throw new Error('No data rows were found after the header.');
      }

      return {
        rows: parsedRows.slice(0, 200),
        totalRows: parsedRows.length,
        keys: schema.columns.map(column => column.key).filter(key => parsedRows.some(row => String(row[key] || '').trim() !== '')),
        title: `${schema.label} Preview`
      };
    }

    function isAllFactoriesScope() {
      return currentFactoryScope.isAll === true;
    }

    function ensureSingleFactoryScope(actionLabel = 'perform this action') {
      if (canWriteCurrentFactoryScope()) return true;
      JPSMS.toast(getWriteLockReason(actionLabel), 'error');
      return false;
    }

    async function initializeFactoryScope() {
      allowedFactories = Array.isArray(JPSMS.factories.getAllowed()) ? JPSMS.factories.getAllowed() : [];

      if (!allowedFactories.length) {
        try {
          const res = await JPSMS.api.get('/factories');
          allowedFactories = Array.isArray(res.data) ? res.data : [];
          localStorage.setItem('jpsms_allowed_factories', JSON.stringify(allowedFactories));
          localStorage.setItem('jpsms_can_all_factories', res.can_select_all_factories ? 'true' : 'false');

          const user = JPSMS.auth.getUser();
          if (user && typeof user === 'object') {
            user.can_select_all_factories = !!res.can_select_all_factories;
            localStorage.setItem('user', JSON.stringify(user));
          }
        } catch (error) {
          console.error('Unable to load factories', error);
          allowedFactories = [];
        }
      }

      const canSelectAll = JPSMS.factories.canSelectAll(JPSMS.auth.getUser());
      currentFactoryScope = JPSMS.factories.getCurrentScope();
      currentWriteScope = JPSMS.factories.getWriteScope();

      if (currentFactoryScope.isAll && !canSelectAll) {
        currentFactoryScope = { id: null, name: '', isAll: false };
      }
      if (currentWriteScope.isAll && !canSelectAll) {
        currentWriteScope = { id: null, name: '', isAll: false };
      }

      if (currentFactoryScope.isAll) {
        JPSMS.factories.setCurrentScope('all', 'All Factories');
      } else {
        const matchedFactory = allowedFactories.find(factory => String(factory.id) === String(currentFactoryScope.id));
        const fallbackFactory = matchedFactory || allowedFactories[0] || null;

        if (fallbackFactory) {
          currentFactoryScope = {
            id: String(fallbackFactory.id),
            name: fallbackFactory.name || fallbackFactory.code || `Factory ${fallbackFactory.id}`,
            isAll: false
          };
          JPSMS.factories.setCurrentScope(currentFactoryScope.id, currentFactoryScope.name);
        } else {
          currentFactoryScope = { id: null, name: '', isAll: false };
        }
      }

      if (!currentWriteScope.id && currentFactoryScope.id) {
        currentWriteScope = { ...currentFactoryScope };
        JPSMS.factories.setWriteScope(currentWriteScope.id, currentWriteScope.name);
      }

      renderFactoryScopeControl();
    }

    function renderFactoryScopeControl() {
      const selector = document.getElementById('factorySelector');
      const note = document.getElementById('factoryScopeNote');
      if (!selector) return;

      const canSelectAll = JPSMS.factories.canSelectAll(JPSMS.auth.getUser());
      const options = [];

      if (canSelectAll) {
        options.push({ id: 'all', name: 'All Factories' });
      }

      allowedFactories.forEach(factory => {
        options.push({
          id: String(factory.id),
          name: factory.name || factory.code || `Factory ${factory.id}`
        });
      });

      selector.innerHTML = options.length
        ? options.map(option => `<option value="${option.id}">${option.name}</option>`).join('')
        : '<option value="">No factory access</option>';

      const selectedValue = currentFactoryScope.isAll
        ? 'all'
        : (currentFactoryScope.id ? String(currentFactoryScope.id) : (options[0]?.id || ''));

      selector.value = selectedValue;
      selector.disabled = options.length <= 1;

      if (note) {
        if (currentType === 'users') {
          note.textContent = 'User master is global. Factory scope is saved here for the next factory-based screen.';
        } else if (currentWriteScope.isAll) {
          note.textContent = `Viewing ${getFactoryScopeLabel()}. This login was opened in All Factories mode, so add, edit, upload, and delete stay disabled until you log out and log in to one factory.`;
        } else if (currentFactoryScope.isAll) {
          note.textContent = `Showing combined data from ${allowedFactories.length} allowed factories. Downloads include all of them, but write access for this login stays locked to ${getWriteScopeLabel()}.`;
        } else if (currentWriteScope.id && currentFactoryScope.id && String(currentFactoryScope.id) !== String(currentWriteScope.id)) {
          note.textContent = `Viewing ${getFactoryScopeLabel()}. This session can add, edit, upload, and delete only in ${getWriteScopeLabel()}. Log out and log in again to write in another factory.`;
        } else if (allowedFactories.length > 1) {
          note.textContent = `Showing ${getFactoryScopeLabel()}. You can switch the view here, but write access stays locked to the factory selected at login.`;
        } else if (allowedFactories.length === 1) {
          note.textContent = `Showing ${getFactoryScopeLabel()}. This is also your active write factory for this login.`;
        } else {
          note.textContent = 'No factory access is configured for this user.';
        }
      }

      updateScopedEditState();
    }

    function updateScopedEditState() {
      const uploadSection = document.getElementById('uploadSection');
      const allFactoryUploadLock = document.getElementById('allFactoryUploadLock');
      const allFactoryUploadLockTitle = document.getElementById('factoryWriteLockTitle');
      const allFactoryUploadLockText = document.getElementById('factoryWriteLockText');
      const addMachineBtn = document.getElementById('addMachineBtn');
      const canWriteScope = canWriteCurrentFactoryScope();
      const canEditMasters = JPSMS.auth.can('masters', 'edit');

      if (uploadSection && reportOnlyTypes.includes(currentType)) {
        uploadSection.style.display = 'none';
        if (allFactoryUploadLock) allFactoryUploadLock.style.display = 'none';
      }

      if (uploadSection && currentType !== 'users') {
        if (reportOnlyTypes.includes(currentType)) return;
        if (!canEditMasters) {
          uploadSection.style.display = 'none';
          if (allFactoryUploadLock) allFactoryUploadLock.style.display = 'none';
          return;
        }

        uploadSection.style.opacity = '1';
        uploadSection.style.pointerEvents = 'auto';
        uploadSection.title = '';
        uploadSection.style.display = canWriteScope ? 'flex' : 'none';

        if (allFactoryUploadLock) {
          allFactoryUploadLock.style.display = canWriteScope ? 'none' : 'block';
          if (!canWriteScope) {
            if (allFactoryUploadLockTitle) {
              allFactoryUploadLockTitle.textContent = currentWriteScope.isAll
                ? 'All Factories Login Is Read Only'
                : (currentFactoryScope.isAll ? 'All Factories Scope Selected' : 'Write Access Locked To Login Factory');
            }
            if (allFactoryUploadLockText) {
              allFactoryUploadLockText.textContent = getWriteLockReason('add, edit, upload, or delete data');
            }
          }
        }
      } else if (allFactoryUploadLock) {
        allFactoryUploadLock.style.display = 'none';
      }

      if (addMachineBtn) {
        addMachineBtn.style.display = currentType === 'machines' && canEditMasters && canWriteScope ? 'inline-block' : 'none';
        addMachineBtn.disabled = !canWriteScope;
        addMachineBtn.style.opacity = canWriteScope ? '1' : '0.55';
        addMachineBtn.title = canWriteScope ? '' : getWriteLockReason('add or edit machines');
      }
      const addLabourPartyBtn = document.getElementById('addLabourPartyBtn');
      if (addLabourPartyBtn) {
        addLabourPartyBtn.style.display = currentType === 'labour-parties' && canEditMasters ? 'inline-block' : 'none';
      }
    }

    function updateTemplateButtons(type) {
      const templateBtn = document.getElementById('templateBtn');
      const allFactoryTemplateBtn = document.getElementById('allFactoryTemplateBtn');
      const enabled = templateSupportedTypes.includes(type);
      const machineTemplateLabel = isPrintingMachineView() ? 'Printing Machines Template' : 'Machines Template';
      const typeLabels = {
        orders: 'Orders Template',
        moulds: 'Moulds Template',
        machines: machineTemplateLabel,
        orjr: 'OR-JR Status Template',
        orjrwise: 'ORJR Wise Summary Template',
        orjrwisedetail: 'ORJR Wise Detail Template',
        jcdetails: 'JC Detail Template',
        boplanningdetail: 'BO Planning Detail Template',
        wipstock: 'WIP Stock Template'
      };
      const btnLabel = typeLabels[type] || 'Download Template';

      if (templateBtn) {
        templateBtn.style.display = enabled ? 'inline-flex' : 'none';
        templateBtn.innerHTML = `<i class="bi bi-file-earmark-excel"></i> ${btnLabel}`;
      }

      if (allFactoryTemplateBtn) {
        allFactoryTemplateBtn.style.display = enabled ? 'inline-flex' : 'none';
        allFactoryTemplateBtn.innerHTML = `<i class="bi bi-file-earmark-excel"></i> ${btnLabel}`;
      }
    }

    function handleFactoryScopeChange(event) {
      const selectedValue = event.target.value;

      if (selectedValue === 'all') {
        currentFactoryScope = { id: 'all', name: 'All Factories', isAll: true };
        JPSMS.factories.setCurrentScope('all', 'All Factories');
      } else {
        const selectedFactory = allowedFactories.find(factory => String(factory.id) === String(selectedValue));
        currentFactoryScope = {
          id: selectedFactory ? String(selectedFactory.id) : String(selectedValue || ''),
          name: selectedFactory?.name || selectedFactory?.code || `Factory ${selectedValue}`,
          isAll: false
        };
        JPSMS.factories.setCurrentScope(currentFactoryScope.id, currentFactoryScope.name);
      }

      const machineList = document.getElementById('machineList');
      if (machineList) machineList.innerHTML = '';

      renderFactoryScopeControl();
      loadMasterData();
    }

    document.addEventListener('DOMContentLoaded', async () => {
      JPSMS.auth.requireAuth();

      const params = new URLSearchParams(window.location.search);
      const allowedTypes = ['orders', 'moulds', 'machines', 'orjr', 'orjrwise', 'orjrwisedetail', 'jcdetails', 'boplanningdetail', 'wipstock', 'users', 'labour-parties'];
      const requestedType = params.get('type') || 'orders';
        const optionalDateTypes = ['orjrwise', 'orjrwisedetail', 'jcdetails', 'boplanningdetail', 'wipstock'];
      const manualDateTypes = ['orjr'];
      currentType = allowedTypes.includes(requestedType) ? requestedType : 'orders';
      currentView = params.get('view') || 'active'; // Allow deep linking
      if (currentType !== requestedType) {
        params.set('type', currentType);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      }
      JPSMS.renderShell(params.get('context') || 'masters');

      /* Show "Confirm All" button only for Superadmin on Orders view */
      const confirmAllBtn = document.getElementById('confirmAllBtn');
      if (confirmAllBtn && currentType === 'orders' && JPSMS.auth.isSuperadmin()) {
        confirmAllBtn.style.display = 'inline-flex';
      }

      setupUI(currentType, currentView);
      await initializeFactoryScope();

      const factorySelector = document.getElementById('factorySelector');
      if (factorySelector) {
        factorySelector.addEventListener('change', handleFactoryScopeChange);
      }

      const machineProcessFilter = document.getElementById('machineProcessFilter');
      if (machineProcessFilter) {
        machineProcessFilter.addEventListener('change', () => {
          if (currentType === 'machines') {
            updateTemplateButtons(currentType);
            updateMachineSearchPlaceholder();
            loadMasterData();
          }
        });
      }

      const machineProcessSelect = document.getElementById('m_machine_process');
      if (machineProcessSelect) {
        machineProcessSelect.addEventListener('change', (event) => {
          updateMachineModalProcessView(event.target.value);
        });
      }

      // Default Dates
      if (optionalDateTypes.includes(currentType)) {
        document.getElementById('filterTo').value = '';
        document.getElementById('filterFrom').value = '';
        loadMasterData();
      } else if (!manualDateTypes.includes(currentType)) {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        document.getElementById('filterTo').valueAsDate = now;
        document.getElementById('filterFrom').valueAsDate = firstDay;

        loadMasterData();
      } else {
        // Manual date screens: clear dates and wait for Apply Filters
        document.getElementById('filterTo').value = '';
        document.getElementById('filterFrom').value = '';

        document.querySelector('#masterTable tbody').innerHTML = '<tr><td colspan="5" class="text-center p-3" style="color:#64748b">Click <b>Apply Filters</b> to load data (Leave dates empty for all).</td></tr>';
      }
    });

    function setupUI(type, view) {
      const titleEl = document.getElementById('pageTitle');
      const hintEl = document.getElementById('uploadHint');
      const fileIn = document.getElementById('uploadFile');
      const filterSec = document.getElementById('filterSection');
      const machineScopeGrid = document.getElementById('machineScopeGrid');
      const machineProcessSection = document.getElementById('machineProcessSection');
      const filterFromLabel = document.getElementById('filterFromLabel');
      const filterToLabel = document.getElementById('filterToLabel');
      const filterDateHint = document.getElementById('filterDateHint');
      const filterSearch = document.getElementById('filterSearch');

      const configs = {
        'orders': { title: 'Orders', hint: 'orders.xlsx', hasDates: false },
        'moulds': { title: 'Moulds', hint: 'moulds.xlsx', hasDates: false },
        'machines': { title: 'Machines', hint: 'IT only', hasDates: false },
        'machines': { title: 'Machines', hint: 'IT only', hasDates: false },
        'orjr': { title: 'OR-JR Status', hint: 'Upload .xlsx', hasDates: true },
        'orjrwise': { title: 'ORJR Wise Summary', hint: 'Upload .xlsx', hasDates: true },
        'orjrwisedetail': { title: 'ORJR Wise Detail', hint: 'Upload .xlsx', hasDates: true, icon: 'bi-file-earmark-richtext' },
        'jcdetails': { title: 'JC Detail', hint: 'Upload .xlsx', hasDates: true, icon: 'bi-journal-richtext' },
        'boplanningdetail': { title: 'BO Planning Detail', hint: 'Upload .xlsx', hasDates: true, icon: 'bi-clipboard-data' },
        'wipstock': { title: 'WIP Stock', hint: 'Upload dated WIP stock sheet', hasDates: true, icon: 'bi-box-seam-fill' },
        'users': { title: 'User Master', hint: 'Admin Only', hasDates: false },
        'labour-parties': { title: 'Labour Job Parties', hint: 'N/A', hasDates: false }
      };

      const cfg = configs[type] || { title: 'Master Data', hint: 'Upload file', hasDates: false };
      if (view === 'summary') cfg.title += ' (Summary)';
      updateTemplateButtons(type);

      const titleIcon = cfg.icon ? `<i class="bi ${cfg.icon}" style="margin-right:8px;"></i>` : '';
      titleEl.innerHTML = titleIcon + cfg.title + ' <span style="font-size:0.7rem; background:#2563eb; color:white; padding:2px 6px; border-radius:4px; vertical-align:middle;">v2.3</span>';
      hintEl.textContent = cfg.hint;

      // Show/Hide Add Machine Button
      const addBtn = document.getElementById('addMachineBtn');
      if (type === 'machines' && JPSMS.auth.can('masters', 'edit')) {
        addBtn.style.display = 'inline-block';
      } else {
        addBtn.style.display = 'none';
      }

      if (cfg.hasDates) {
        filterSec.classList.add('active');
      } else {
        filterSec.classList.remove('active');
      }

      if (machineProcessSection) {
        const showMachineProcess = type === 'machines';
        machineProcessSection.style.display = showMachineProcess ? 'block' : 'none';
        if (machineScopeGrid) {
          machineScopeGrid.classList.toggle('dual', showMachineProcess);
        }
        const machineProcessFilter = document.getElementById('machineProcessFilter');
        if (type === 'machines' && machineProcessFilter && !machineProcessFilter.value) {
          machineProcessFilter.value = 'Moulding';
        }
      } else if (machineScopeGrid) {
        machineScopeGrid.classList.remove('dual');
      }

      if (filterFromLabel && filterToLabel && filterDateHint) {
        const optionalDateFilters = ['orjrwise', 'orjrwisedetail', 'boplanningdetail', 'wipstock'];
        const isOptionalDateType = optionalDateFilters.includes(type);
        filterFromLabel.textContent = type === 'wipstock'
          ? 'From Stock Date (Optional)'
          : (isOptionalDateType ? 'From Date (Optional)' : 'From Date');
        filterToLabel.textContent = type === 'wipstock'
          ? 'To Stock Date (Optional)'
          : (isOptionalDateType ? 'To Date (Optional)' : 'To Date');
        filterDateHint.style.display = isOptionalDateType ? 'block' : 'none';
      }

      if (filterSearch) {
        if (['orjrwise', 'orjrwisedetail', 'jcdetails', 'boplanningdetail'].includes(type)) {
          filterSearch.placeholder = 'OR/JR No, Code, Name, Bo Item...';
        } else if (type === 'wipstock') {
          filterSearch.placeholder = 'Item Code, Item Name, Location, Job No...';
        } else if (type === 'machines') {
          updateMachineSearchPlaceholder();
        } else {
          filterSearch.placeholder = 'Order No, Item, Mould...';
        }
      }

      if (!JPSMS.auth.can('masters', 'edit') && type !== 'users') {
        document.getElementById('uploadSection').style.display = 'none';
      }

      if (reportOnlyTypes.includes(type)) {
        document.getElementById('uploadSection').style.display = 'none';
      }

      // Hide Upload Section for Orders (Auto-fetch)
      if (type === 'orders') {
        document.getElementById('uploadSection').style.display = 'flex'; // Keep flex to show fetch button
        document.getElementById('uploadFile').style.display = 'none';    // Hide file input
        document.getElementById('uploadHint').style.display = 'none';    // Hide hint
        document.querySelector('#uploadSection button[onclick="uploadMaster()"]').style.display = 'none'; // Hide Upload Btn

        // Show Fetch Button
        document.getElementById('omFetchBtn').style.display = 'inline-flex';
        document.getElementById('omHistoryBtn').style.display = JPSMS.auth.isAdminLike() ? 'inline-flex' : 'none';
        document.getElementById('omLastFetch').style.display = 'inline-block';
      } else {
        document.getElementById('omFetchBtn').style.display = 'none';
        document.getElementById('omHistoryBtn').style.display = 'none';
        document.getElementById('omLastFetch').style.display = 'none';
      }

      // User Master Specific UI
      if (type === 'users') {
        document.getElementById('uploadSection').innerHTML = `
            <div style="font-weight:700; font-size:0.8rem; width:120px">User Master</div>
            <button class="btn-action" onclick="openUserModal()" style="background:#16a34a"><i class="bi bi-person-plus-fill"></i> Add User</button>
          `;
        document.getElementById('uploadSection').style.display = 'flex';
      }

      // OR-JR Toggle Button
      if (type === 'orjr') {
        const box = document.querySelector('.upload-box > div');
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-action';
        toggleBtn.style.marginLeft = '10px';
        toggleBtn.style.background = currentView === 'closed' ? '#64748b' : '#334155'; // Gray for toggle

        toggleBtn.innerHTML = currentView === 'closed'
          ? '<i class="bi bi-arrow-left"></i> Back to Active'
          : '<i class="bi bi-archive"></i> Closed OR-JR';

        toggleBtn.onclick = toggleOrJrView;
        box.appendChild(toggleBtn);
      }

      // MOULD Master Specific UI
      if (type === 'moulds' && JPSMS.auth.can('masters', 'edit')) {
        const box = document.querySelector('.upload-box > div');
        const addBtn = document.createElement('button');
        addBtn.className = 'btn-action';
        addBtn.onclick = () => openMouldModal('add');
        addBtn.style.background = '#16a34a';
        addBtn.style.marginLeft = '10px';
        addBtn.innerHTML = '<i class="bi bi-plus-lg"></i> Add Mould';
        box.appendChild(addBtn);
      }

      // Clear Data Button (Superadmin Only)
      const user = JPSMS.auth.getUser();
      let clearBtn = document.getElementById('clearDataBtn');
      if (!clearBtn) {
        // Create it if missing
        clearBtn = document.createElement('button');
        clearBtn.id = 'clearDataBtn';
        clearBtn.className = 'btn-action';
        clearBtn.style.backgroundColor = '#dc2626'; // Red
        clearBtn.style.marginLeft = '10px';
        clearBtn.innerHTML = '<i class="bi bi-trash"></i> Clear All Data';
        clearBtn.onclick = clearMasterData;
        document.querySelector('.upload-box > div').appendChild(clearBtn);
      }

      // Show/Hide based on role (Case Insensitive)
      const role = (user && (user.role || user.role_code || '')).toLowerCase();
      if (['superadmin', 'admin'].includes(role)) {
        clearBtn.style.display = 'inline-block';
      } else {
        clearBtn.style.display = 'none';
      }
    }

    async function clearMasterData() {
      if (!confirm('DANGER: This will delete ALL data for the current view.\n\nAre you sure you want to proceed?')) return;
      const second = prompt('Type "DELETE" to confirm:');
      if (second !== 'DELETE') return alert('Cancelled');

      try {
        let endpoint = `/admin/clear-data`;
        // Map currentType to server type if needed, or pass currentType
        // Server needs to know table name
        const user = JPSMS.auth.getUser() || {};
        const res = await JPSMS.api.post(endpoint, { type: currentType, username: user.username });
        if (!res.ok) throw new Error(res.error || 'Failed to clear data');
        alert(res.message || 'Data cleared successfully.');
        loadMasterData();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function loadMasterData() {
      // Labour Parties has its own dedicated UI — bypass the generic DataTable rendering
      if (currentType === 'labour-parties') {
        masterDataLoading = false;
        await loadLabourParties();
        return;
      }
      if (masterDataLoading) return;
      masterDataLoading = true;
      const from = document.getElementById('filterFrom').value;
      const to = document.getElementById('filterTo').value;
      const search = (document.getElementById('filterSearch') ? document.getElementById('filterSearch').value : '').trim();
      const machineProcess = currentType === 'machines' ? getSelectedMachineProcessFilter() : '';

      if ($.fn.DataTable.isDataTable('#masterTable')) {
        $('#masterTable').DataTable().destroy();
      }
      masterTable = null;
      document.querySelector('#masterTable tbody').innerHTML = '<tr><td colspan="5" class="text-center p-3">Loading...</td></tr>';
      document.querySelector('#masterTable thead').innerHTML = '';

      try {
        let endpoint = `/masters/${currentType}`;
        const query = new URLSearchParams({ from, to, search });
        if (currentType === 'machines' && machineProcess) query.set('process', machineProcess);
        const qParams = query.toString();

        if (currentType === 'orjr') {
          endpoint = `/reports/or-jr-full?${qParams}`;
        } else if (currentType === 'orjrwise') {
          endpoint = `/reports/orjr-wise-summary?${qParams}`;
        } else if (currentType === 'orjrwisedetail') {
          endpoint = `/reports/orjr-wise-detail?${qParams}`;
        } else if (currentType === 'jcdetails') {
          endpoint = `/masters/jcdetails?${qParams}`;
        } else if (currentType === 'boplanningdetail') {
          endpoint = `/reports/bo-planning-detail?${qParams}`;
        } else if (currentType === 'users') {
          endpoint = `/users`; // GET /api/users
        } else if (currentType === 'machines') {
          endpoint = `/masters/machines?${qParams}`;
        }

        console.log('[Masters] Loading data for type:', currentType);
        console.log('[Masters] Endpoint:', endpoint);

        const res = await JPSMS.api.get(endpoint);
        let rows = res.data || [];

        // CLIENT-SIDE FILTERING for OR-JR View (Active vs Closed)
        // CRITICAL FIX: If Searching, DO NOT FILTER. Show everything found.
        if (currentType === 'orjr' && !search) {
          if (currentView === 'closed') {
            rows = rows.filter(r => r.is_closed === true);
          } else {
            // Default Active: Not closed (false or null)
            rows = rows.filter(r => !r.is_closed);
          }
        }

        if (!rows.length) {
          document.querySelector('#masterTable tbody').innerHTML = '<tr><td colspan="5" class="text-center p-3">No records found.</td></tr>';
          return;
        }

        // Pre-sort machines client-side so initial display is correct regardless of backend order.
        // Machines stored as "C -L2>..." have a non-empty line prefix in naturalCompare which
        // causes the backend to order them after plain-name machines — fix here instead.
        if (currentType === 'machines') {
          const padN = s => String(s || '').replace(/(\d+)/g, m => m.padStart(10, '0'));
          const getMachKey = (r) => {
            const line = String(r.line || '').trim();
            const mach = String(r.machine || '');
            // Use row.line if it has L# info, else fall back to prefix before '>'
            const lineKey = /L\d+/i.test(line) ? padN(line)
              : mach.includes('>') ? padN(mach.split('>')[0].trim())
              : padN(line);
            const trail = (mach.match(/(\d+)$/) || ['', '999999'])[1];
            return lineKey + String(trail).padStart(10, '0');
          };
          rows = rows.slice().sort((a, b) => {
            const ka = getMachKey(a), kb = getMachKey(b);
            return ka < kb ? -1 : ka > kb ? 1 : 0;
          });
        }

        // Columns (Exclude technical)
        let cols = Object.keys(rows[0]).filter(c => !['created_date', 'edited_date', 'remarks_all', 'id', 'search_vector', 'created_at', 'updated_at', 'password'].includes(c));

        // If users OR moulds, explicitly order columns
        if (currentType === 'users') {
          cols = ['username', 'role_code', 'line', 'permissions', 'is_active', 'actions'];
        } else if (currentType === 'machines') {
          const printingView = isPrintingMachineView();
          cols = cols.filter(c => !['machine_icon', 'machine_process', 'actions'].includes(c));
          if (JPSMS.auth.can('masters', 'edit')) {
            cols.unshift('actions');
          }
          if (printingView) {
            cols = cols.filter(c => !['building', 'line', 'tonnage', 'is_active'].includes(c));
            const orderedPrintingCols = ['machine', 'machine_icon', 'vendor_name', 'model_no', 'machine_type'];
            cols = [
              ...cols.filter(c => c === 'actions'),
              ...cols.filter(c => c === 'factory_name'),
              ...orderedPrintingCols.filter(c => Object.prototype.hasOwnProperty.call(rows[0], c))
            ];
          } else {
            cols = cols.filter(c => !['vendor_name', 'model_no', 'machine_type'].includes(c));
            const machineIdx = cols.indexOf('machine');
            if (machineIdx !== -1) {
              cols.splice(machineIdx + 1, 0, 'machine_process', 'machine_icon');
            } else {
              cols.push('machine_process');
              cols.push('machine_icon');
            }
          }
        } else if (currentType === 'moulds') {
          cols = mouldFields.filter(c => cols.includes(c));
          if (JPSMS.auth.can('masters', 'edit')) {
            cols = ['actions', ...cols];
          }
        } else if (currentType === 'orjrwise') {
          cols = ['factory_name', ...orjrWiseSummaryColumns].filter(c => cols.includes(c));
        } else if (currentType === 'orjrwisedetail') {
          cols = ['factory_name', ...orjrWiseDetailColumns].filter(c => cols.includes(c));
        } else if (currentType === 'jcdetails') {
          cols = ['factory_name', ...jcDetailColumns].filter(c => cols.includes(c));
        } else if (currentType === 'boplanningdetail') {
          cols = ['factory_name', ...boPlanningDetailColumns].filter(c => cols.includes(c));
        } else if (currentType === 'wipstock') {
          cols = wipStockColumns.filter(c => cols.includes(c));
        } else if (currentType === 'orjr') {
          // Use STRICT column list to match Excel/Order view exact structure
          const orJrCols = [
            "or_jr_no", "or_jr_date", "or_qty", "jr_qty",
            "job_card_no", "job_card_date", "item_code", "product_name", "client_name",
            "prod_plan_qty", "std_pack", "uom", "planned_comp_date",
            "mld_start_date", "mld_end_date", "actual_mld_start_date",
            "prt_tuf_end_date", "pack_end_date",
            "mld_status", "shift_status", "prt_tuf_status", "pack_status", "wh_status",
            "rev_mld_end_date", "shift_comp_date", "rev_ptd_tuf_end_date", "rev_pak_end_date", "wh_rec_date",
            "remarks_all", "jr_close", "or_remarks", "jr_remarks",
            "created_by", "created_date", "edited_by", "edited_date"
          ];
          cols = ['actions', 'factory_name', ...orJrCols.filter(c => c !== 'factory_name')];
        } else if (currentType === 'orders') {
          // STRICT User Request: "Get All data Same in Or-JR status Dont Change Or dont ADD"
          // We use the exact schema order from DB, plus Action/Status at start.
          const orJrCols = [
            "or_jr_no", "or_jr_date", "or_qty", "jr_qty",
            "job_card_no", "job_card_date", "item_code", "product_name", "client_name",
            "prod_plan_qty", "std_pack", "uom", "planned_comp_date",
            "mld_start_date", "mld_end_date", "actual_mld_start_date",
            "prt_tuf_end_date", "pack_end_date",
            "mld_status", "shift_status", "prt_tuf_status", "pack_status", "wh_status",
            "rev_mld_end_date", "shift_comp_date", "rev_ptd_tuf_end_date", "rev_pak_end_date", "wh_rec_date",
            "remarks_all", "jr_close", "or_remarks", "jr_remarks",
            "created_by", "created_date", "edited_by", "edited_date"
          ];

          // Action & Plan Status are UI helpers, we keep them but then follow strict data order.
          // Added confirmation workflow columns so completed OR/JR changes stay visible until confirmed.
          cols = ['action', 'priority', 'plan_status', 'status_change', 'confirmation_action', 'factory_name', 'mould_progress', ...orJrCols.filter(c => c !== 'factory_name')];
        } else if ((currentType === 'machines' || currentType === 'moulds') && JPSMS.auth.can('masters', 'edit')) {
          if (!cols.includes('actions')) cols.unshift('actions');
        }

        if (cols.includes('factory_name') && !['orders', 'orjr', 'users'].includes(currentType)) {
          cols = cols.filter(c => c !== 'factory_name' && c !== 'factory_code');
          const actionKey = cols.includes('actions') ? 'actions' : (cols.includes('action') ? 'action' : null);
          if (actionKey) {
            cols.splice(cols.indexOf(actionKey) + 1, 0, 'factory_name');
          } else {
            cols.unshift('factory_name');
          }
        } else {
          cols = cols.filter(c => c !== 'factory_code');
        }

        // Body
        // Initialize DataTable with Direct Data Injection (FASTEST)

        // 1. Build Dynamic Column Configurations
        // We need to map `cols` to { data: 'key', title: 'Key' }
        // And handle special columns like 'actions' or 'plan_status' via renderters.

        const dtColumns = cols.map(c => {
          const base = { data: c, title: c.replace(/_/g, ' ').toUpperCase() };
          const isFactoryExportOnlyColumn = currentType !== 'users' && ['factory_name', 'factory_code'].includes(c);
          const isUiOnlyColumn = ['actions', 'action', 'confirmation_action', 'status_change', 'mould_progress', 'plan_status'].includes(c);

          if (c === 'factory_name') {
            base.title = 'Factory';
          } else if (boPlanningDetailTitles[c]) {
            base.title = boPlanningDetailTitles[c];
          } else if (currentType === 'jcdetails' && jcDetailTitles[c]) {
            base.title = jcDetailTitles[c];
          } else if (c === 'factory_code') {
            base.title = 'Factory Code';
          } else if (currentType === 'machines' && isPrintingMachineView() && c === 'machine') {
            base.title = 'Machine Number';
          } else if (c === 'vendor_name') {
            base.title = 'Vendor Name';
          } else if (c === 'model_no') {
            base.title = 'Model No';
          } else if (c === 'machine_type') {
            base.title = 'Machine Type';
          } else if (c === 'machine_process') {
            base.title = 'Process';
          } else if (c === 'status_change') {
            base.title = 'Status Change';
          } else if (c === 'confirmation_action') {
            base.title = 'Confirmation';
          } else if (c === 'priority' && currentType === 'orders') {
            base.title = 'Priority';
          }

          if (currentType === 'moulds' && mouldColumnTitles[c]) {
            base.title = mouldColumnTitles[c];
          } else if (currentType === 'orjrwise' && orjrWiseSummaryTitles[c]) {
            base.title = orjrWiseSummaryTitles[c];
          } else if (currentType === 'orjrwisedetail' && orjrWiseDetailTitles[c]) {
            base.title = orjrWiseDetailTitles[c];
          } else if (currentType === 'wipstock' && wipStockTitles[c]) {
            base.title = wipStockTitles[c];
          }

          if (isFactoryExportOnlyColumn) {
            base.visible = false;
            base._exportOnly = true;
            base._excludeFromColvis = true;
          }

          if (isUiOnlyColumn) {
            base.defaultContent = '';
          }

          if (['actions', 'action', 'machine_icon', 'confirmation_action'].includes(c)) {
            base._excludeFromExport = true;
            if (c === 'machine_icon') {
              base._excludeFromColvis = true;
            }
          }

          // Custom Renderers based on Column Name
            if (c === 'actions') {
              base.render = function (data, type, row) {
                const safeData = encodeURIComponent(JSON.stringify(row));
                if (currentType === 'moulds') {
                  if (!canWriteCurrentFactoryScope()) {
                    return `<span style="color:#94a3b8; font-size:0.74rem; white-space:nowrap;">${getWriteLockShortHint()}</span>`;
                  }
                  return `<div style="white-space:nowrap">
                            <button onclick="openMouldModal('edit', JSON.parse(decodeURIComponent('${safeData}')))" class="btn-action-icon" title="Edit"><i class="bi bi-pencil-square text-blue-600"></i></button>
                            <button onclick="viewMouldHistory('${row.mould_number}')" class="btn-action-icon" title="History"><i class="bi bi-clock-history text-gray-600"></i></button>
                        </div>`;
              } else if (currentType === 'users') {
                const perms = row.permissions || {};
                const permBadges = Object.keys(perms).map(k => perms[k] ? `<span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:4px">${k}</span>` : '').join('');

                // This render is for the 'actions' column, not permissions.
                // The permissions column itself should be handled separately if it's part of `cols`.
                // For 'users', the `cols` array already includes 'permissions' and 'actions' as separate columns.
                // So, this 'actions' render is correct.
                return `<div style="white-space:nowrap">
                            <button onclick="openUserModal(JSON.parse(decodeURIComponent('${safeData}')))" class="btn-action-icon" style="color:blue"><i class="bi bi-pencil"></i></button>
                            <button onclick="deleteUser('${row.id}')" class="btn-action-icon" style="color:red"><i class="bi bi-trash"></i></button>
                        </div>`;
              } else if (currentType === 'machines') {
                if (!canWriteCurrentFactoryScope()) {
                  return `<span style="color:#94a3b8; font-size:0.74rem; white-space:nowrap;">${getWriteLockShortHint()}</span>`;
                }
                const machineId = encodeURIComponent(String(row.machine || ''));
                return `<div style="white-space:nowrap">
                            <button onclick="openMachineModal('edit', JSON.parse(decodeURIComponent('${safeData}')))" class="btn-action-icon"><i class="bi bi-pencil-square text-blue-600"></i></button>
                            <button onclick="viewMachineHistory('${machineId}')" class="btn-action-icon" title="History"><i class="bi bi-clock-history text-gray-600"></i></button>
                        </div>`;
              } else if (currentType === 'orjr') {
                const safeNo = row.or_jr_no;
                if (!canWriteCurrentFactoryScope()) {
                  return `<span style="color:#94a3b8; font-size:0.74rem; white-space:nowrap;">${getWriteLockShortHint()}</span>`;
                }
                if (currentView === 'closed') {
                  return `<button onclick="reopenOrJr('${safeNo}', '${row.job_card_no || ''}')" class="btn-action" style="padding:2px 8px; font-size:0.7rem; background:#16a34a">Reopen</button>`;
                } else {
                  return `<button onclick="closeOrJr('${safeNo}', '${row.job_card_no || ''}')" class="btn-action" style="padding:2px 8px; font-size:0.7rem; background:#dc2626">Close</button>`;
                }
              }
              return '';
            };
          }

          // Permissions column for users
          if (c === 'permissions' && currentType === 'users') {
            base.render = function (data, type, row) {
              const perms = data || {};
              const permBadges = Object.keys(perms).map(k => perms[k] ? `<span style="background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:4px">${k}</span>` : '').join('');
              return permBadges || '<span style="color:#94a3b8">None</span>';
            };
          }

          // is_active column for users
          if (c === 'is_active' && currentType === 'users') {
            base.render = function (data) {
              return data ? '<span style="color:green">Active</span>' : '<span style="color:red">Inactive</span>';
            };
          }

          if (c === 'machine_icon' && currentType === 'machines') {
            base.title = 'MACHINE ICON';
            base.render = function (data) {
              const src = normalizeMachineIconSrc(data);
              if (!src) return '<span style="color:#94a3b8">No icon</span>';
              const safeSrc = src.replace(/"/g, '&quot;');
              const safeLabel = (src.split('/').pop() || 'Machine icon').replace(/"/g, '&quot;');
              return `<div style="display:flex; align-items:center; gap:8px; min-width:120px">
                        <img src="${safeSrc}" alt="Machine Icon" style="width:48px; height:28px; object-fit:contain; border:1px solid #e2e8f0; border-radius:6px; background:#fff; padding:2px" onerror="this.style.display='none'; if(this.nextElementSibling){ this.nextElementSibling.textContent='No icon'; this.nextElementSibling.style.color='#94a3b8'; }">
                        <span style="font-size:0.72rem; color:#475569; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${safeLabel}</span>
                      </div>`;
            };
          }

          if (c === 'machine_process' && currentType === 'machines') {
            base.render = function (data) {
              const process = normalizeMachineProcessValue(data, 'Moulding');
              const styles = {
                Moulding: 'background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;',
                Tuffting: 'background:#fef3c7; color:#92400e; border:1px solid #fcd34d;',
                Printing: 'background:#ecfccb; color:#3f6212; border:1px solid #bef264;'
              };
              return `<span style="display:inline-flex; align-items:center; justify-content:center; min-width:92px; padding:3px 10px; border-radius:999px; font-weight:700; font-size:0.74rem; ${styles[process] || styles.Moulding}">${process}</span>`;
            };
          }

          // Plan Status Badge (Orders) - Enhanced Logic
          if (c === 'plan_status') {
            base.render = function (data) {
              let color = '#94a3b8'; // Pending (Gray)
              let text = data || 'Pending';

              if (text === 'Fully Planned') color = '#16a34a'; // Green
              else if (text === 'Partially Planned') color = '#f59e0b'; // Orange

              return `<span style="background:${color}; color:white; padding:2px 8px; border-radius:12px; font-size:0.75rem; white-space:nowrap; font-weight:600">${text}</span>`;
            };
          }

          if (c === 'mould_progress') {
            base.title = 'MOULDS';
            base.render = function (data, type, row) {
              const p = row.planned_count || 0;
              const r = row.required_count || 0;
              return `<span style="font-weight:bold; font-size:0.85rem; color:#334155">${p} / ${r}</span>`;
            };
          }

          if (c === 'row_status' && currentType === 'wipstock') {
            base.render = function (data) {
              const value = String(data || '').trim() || 'Existing';
              const normalized = value.toLowerCase();
              const palette = normalized === 'new'
                ? { bg: '#dcfce7', color: '#166534' }
                : normalized === 'nil'
                  ? { bg: '#fee2e2', color: '#b91c1c' }
                  : { bg: '#dbeafe', color: '#1d4ed8' };
              return `<span style="display:inline-flex; align-items:center; justify-content:center; min-width:84px; padding:4px 10px; border-radius:999px; background:${palette.bg}; color:${palette.color}; font-size:0.74rem; font-weight:800;">${value}</span>`;
            };
          }

          if (currentType === 'wipstock' && ['previous_stock_qty', 'current_stock_available_qty', 'current_live_qty', 'total_qty'].includes(c)) {
            base.render = function (data) {
              if (data === null || data === undefined || data === '') return '';
              const numeric = Number(data);
              const displayValue = Number.isFinite(numeric)
                ? numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 })
                : data;
              return `<div style="text-align:right; font-weight:700; color:#0f172a">${displayValue}</div>`;
            };
          }

          if (c === 'priority' && currentType === 'orders') {
            base.render = function (data, type, row) {
              const currentPriority = String(data || 'Normal').trim() || 'Normal';
              const isHigh = currentPriority.toLowerCase() === 'high';
              const nextPriority = isHigh ? 'Normal' : 'High';
              const badgeLabel = isHigh ? 'High Priority' : 'Normal';
              const buttonBg = isHigh
                ? 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
                : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
              const buttonColor = isHigh ? '#ffffff' : '#475569';
              const buttonBorder = isHigh ? '#f59e0b' : '#cbd5e1';
              const buttonShadow = isHigh
                ? '0 6px 14px rgba(245, 158, 11, 0.2)'
                : '0 5px 12px rgba(148, 163, 184, 0.14)';
              const icon = isHigh ? 'bi bi-star-fill' : 'bi bi-star';
              const pillMinWidth = '118px';
              const pillMinHeight = '30px';
              const pillPadding = '0 10px';
              const pillRadius = '10px';
              const pillFontSize = '0.71rem';
              const pillGap = '5px';

              if (!canWriteCurrentFactoryScope()) {
                return `
                  <div style="display:flex; flex-direction:column; align-items:center; gap:5px; min-width:${pillMinWidth};">
                    <span style="display:inline-flex; align-items:center; justify-content:center; gap:${pillGap}; width:100%; min-height:${pillMinHeight}; padding:${pillPadding}; border-radius:${pillRadius}; font-size:${pillFontSize}; font-weight:800; letter-spacing:0.01em; background:${buttonBg}; color:${buttonColor}; border:1px solid ${buttonBorder}; box-shadow:${buttonShadow};">
                      <i class="${icon}"></i>
                      ${badgeLabel}
                    </span>
                    <span style="color:#94a3b8; font-size:0.66rem; text-align:center;">${getWriteLockShortHint()}</span>
                  </div>
                `;
              }

              const orderNo = row.or_jr_no || row.order_no || '';
              const factoryId = row.factory_id || '';
              const canEditPriority = JPSMS.auth.can('masters', 'edit');

              if (!canEditPriority) {
                return `
                  <div style="display:flex; justify-content:center; min-width:${pillMinWidth};">
                    <span style="display:inline-flex; align-items:center; justify-content:center; gap:${pillGap}; width:100%; min-height:${pillMinHeight}; padding:${pillPadding}; border-radius:${pillRadius}; font-size:${pillFontSize}; font-weight:800; letter-spacing:0.01em; background:${buttonBg}; color:${buttonColor}; border:1px solid ${buttonBorder}; box-shadow:${buttonShadow};">
                      <i class="${icon}"></i>
                      ${badgeLabel}
                    </span>
                  </div>
                `;
              }

              return `
                <div style="display:flex; justify-content:center; min-width:${pillMinWidth};">
                  <button onclick="setOrderPriority('${orderNo}', '${factoryId}', '${nextPriority}')" class="btn-action" title="${isHigh ? 'Remove high priority' : 'Mark as high priority'}" style="display:inline-flex; align-items:center; justify-content:center; gap:${pillGap}; width:100%; min-height:${pillMinHeight}; padding:${pillPadding}; border-radius:${pillRadius}; background:${buttonBg}; color:${buttonColor}; border:1px solid ${buttonBorder}; font-size:${pillFontSize}; font-weight:800; letter-spacing:0.01em; box-shadow:${buttonShadow};">
                    <i class="${icon}"></i>
                    ${badgeLabel}
                  </button>
                </div>
              `;
            };
          }

          if (c === 'status_change' && currentType === 'orders') {
            base.render = function (data, type, row) {
              if (!row.completion_confirmation_required) return '<span style="color:#94a3b8;">-</span>';
              const detectedAt = row.completion_detected_at
                ? `<div style="font-size:0.72rem; color:#64748b; margin-top:4px;">${moment(row.completion_detected_at).format('DD-MMM-YYYY hh:mm A')}</div>`
                : '';
              return `
                <div style="min-width:180px;">
                  <span style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; background:#fff7ed; color:#c2410c; font-weight:700; font-size:0.75rem;">
                    <i class="bi bi-arrow-repeat"></i>
                    ${data || 'MLD Status changed'}
                  </span>
                  ${detectedAt}
                </div>
              `;
            };
          }

          if (c === 'confirmation_action' && currentType === 'orders') {
            base.render = function (data, type, row) {
              const orderNo = row.or_jr_no || row.order_no || '';
              const factoryId = row.factory_id || '';
              const isAdmin = JPSMS.auth.isAdminLike();

              if (!row.completion_confirmation_required) {
                if (!isAdmin) return '<span style="color:#94a3b8;">-</span>';
                return `<button onclick="openOrderCompletionHistory('${orderNo}', '${factoryId}')" class="btn-action" style="padding:4px 10px; background:#f8fafc; color:#334155; border:1px solid #cbd5e1;"><i class="bi bi-clock-history"></i> History</button>`;
              }

              const confirmButton = !canWriteCurrentFactoryScope()
                ? `<span style="color:#94a3b8; font-size:0.74rem; white-space:nowrap;">${getWriteLockShortHint()}</span>`
                : (JPSMS.auth.can('masters', 'edit')
                  ? `<button onclick="confirmOrderCompletion('${orderNo}', '${factoryId}')" class="btn-action" style="padding:4px 10px; background:#16a34a;"><i class="bi bi-check2-circle"></i> Confirm</button>`
                  : `<span style="display:inline-flex; padding:4px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:0.74rem; font-weight:700;">Pending</span>`);

              const historyButton = isAdmin
                ? `<button onclick="openOrderCompletionHistory('${orderNo}', '${factoryId}')" class="btn-action" style="padding:4px 10px; background:#f8fafc; color:#334155; border:1px solid #cbd5e1;"><i class="bi bi-clock-history"></i> History</button>`
                : '';

              return `<div style="display:flex; flex-wrap:wrap; gap:6px; min-width:170px;">${confirmButton}${historyButton}</div>`;
            };
          }

          if (c === 'remarks_all' && (currentType === 'orjr' || currentType === 'orders')) {
            base.title = 'Remarks';
            base.render = function (data, type, row) {
              if (type === 'sort' || type === 'type') return data || '';
              const text = data == null ? '' : String(data);
              const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const safeTitle = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              return `<div title="${safeTitle}" style="white-space:nowrap; font-size:0.78rem; color:#334155; line-height:1.35; min-width:max-content;">${safe || '—'}</div>`;
            };
          }

          // Date Formatting
          if ((c.includes('date') || c.includes('dob') || c.includes('time')) && c !== 'cycle_time' && !['actions', 'plan_status'].includes(c)) {
            base.render = function (data, type) {
              if (type === 'sort' || type === 'type') {
                // For sorting, return numeric timestamp if possible, or ISO string
                if (!data) return -Infinity; // Push nulls to bottom/top
                return new Date(data).getTime();
              }
              // Display/Filter
              if (!data) return '';
              const d = new Date(data);
              return isNaN(d.getTime()) ? data : moment(d).format('DD-MMM-YYYY');
            };
          }

          // Default render for null values
          if (!base.render) {
            base.render = function (data) {
              return data !== null ? data : '';
            };
          }

          // Force Natural Sort via Suffix Key (Line + LastNumber Priority)
          if (c === 'machine' || c === 'mould_name' || c === 'mould_no' || c === 'mould_number') {
            base.render = function (data, type, row) {
              const name = String(data || '');
              // For machine column: build full display name as line>machine when line exists
              let displayName = name;
              if (c === 'machine') {
                if (name.includes('>')) {
                  // Strip line prefix stored in old format — show only the machine code
                  displayName = name.split('>').slice(1).join('>').trim();
                } else {
                  const linePfx = row && row.line ? String(row.line).trim() : '';
                  const startsWithLine = linePfx && name.replace(/\s+/g, '').toLowerCase().startsWith(linePfx.replace(/\s+/g, '').toLowerCase());
                  if (linePfx && !startsWithLine) displayName = name;
                }
              }
              if (type === 'sort') {
                if (c === 'machine') {
                  const machName = String(data || '');
                  // Use row.line as primary source; if it has no L# (e.g. just "C"),
                  // fall back to the prefix before ">" in the machine name (e.g. "C -L2>...")
                  let lineStr = row && row.line ? String(row.line).trim() : '';
                  if (!lineStr.match(/L\d+/i) && machName.includes('>')) {
                    lineStr = machName.split('>')[0].trim();
                  }
                  const lineKey = lineStr.replace(/(\d+)/g, (m) => m.padStart(10, '0'));
                  const trailMatch = machName.match(/(\d+)$/);
                  const trailNum = trailMatch ? parseInt(trailMatch[1], 10) : 999999;
                  return lineKey + String(trailNum).padStart(10, '0');
                }
                // mould columns: full natural sort by padding all digit sequences
                return displayName.replace(/(\d+)/g, (m) => m.padStart(10, '0'));
              }
              return displayName;
            };
          }

          return base;
        });

        // Special Case: Orders Actions (Plan + View)
        if (currentType === 'orders') {
          const actionColIndex = dtColumns.findIndex(col => col.data === 'action');
          if (actionColIndex !== -1) {
            dtColumns[actionColIndex].render = function (data, type, row) {
              if (!canWriteCurrentFactoryScope()) {
                return `<span style="color:#94a3b8; font-size:0.74rem; white-space:nowrap;">${getWriteLockShortHint()}</span>`;
              }
              const orderNo = row.or_jr_no || row.order_no || '';
              const awaitingConfirmation = row.completion_confirmation_required === true;
              // Safe Encode
              let detailsSafe = '[]';
              try { detailsSafe = encodeURIComponent(JSON.stringify(row.planned_details || [])); } catch (e) { }

              return `<div style="display:flex; gap:4px">
                     ${awaitingConfirmation
                  ? `<span style="display:inline-flex; align-items:center; justify-content:center; min-width:34px; padding:4px 8px; border-radius:10px; background:#fff7ed; color:#c2410c; border:1px solid #fed7aa;" title="Awaiting completion confirmation">
                              <i class="bi bi-hourglass-split"></i>
                            </span>`
                  : `<a href="planning.html?order=${orderNo}" class="btn-action" style="padding:4px 8px; background:#2563eb; color:white; text-decoration:none;" title="Create Plan">
                              <i class="bi bi-calendar-plus"></i>
                            </a>`}
                     <button onclick="viewOrderPlan('${orderNo}', '${detailsSafe}')" class="btn-action" style="padding:4px 8px; background:#f8fafc; color:#475569; border:1px solid #cbd5e1" title="View Detail">
                        <i class="bi bi-eye"></i>
                     </button>
                 </div>`;
            };
          }
        }

        // 2. Clear HTML (Important!)
        document.querySelector('#masterTable tbody').innerHTML = '';
        document.querySelector('#masterTable thead').innerHTML = `<tr>${dtColumns.map(c => `<th>${c.title}</th>`).join('')}</tr>`;

        const exportScopeLabel = getFactoryScopeLabel();
        const exportMasterLabel = getExportMasterLabel();
        const exportTitle = `${exportMasterLabel} - ${exportScopeLabel}`;
        const exportFileName = `${exportMasterLabel}-${getExportScopeFileLabel()}`;
        const getColvisColumnIndexes = () => dtColumns
          .map((column, index) => ({ column, index }))
          .filter(({ column }) => !column._excludeFromColvis)
          .map(({ index }) => index);
        const shouldExportColumn = (idx) => {
          const column = dtColumns[idx];
          if (!column || column._excludeFromExport) return false;
          if (column._exportOnly) return true;
          if (masterTable) {
            return masterTable.column(idx).visible();
          }
          return column.visible !== false;
        };

        // 3. Initialize DataTable with 'data'
        const machineColIdx = dtColumns.findIndex(c => c.data === 'machine');
        const defaultOrder = machineColIdx >= 0 ? [[machineColIdx, 'asc']] : [[0, 'asc']];
        masterTable = $('#masterTable').DataTable({
          data: rows,
          columns: dtColumns,
          dom: 'Bfrtip',
          order: defaultOrder,
          // Performance Tuning
          deferRender: true,
          scroller: true,
          scrollY: '65vh',
          scrollCollapse: true,
          processing: true,
          orderClasses: false,
          createdRow: function (row, data, dataIndex) {
            if (currentType === 'orders') {
              const priority = String(data && data.priority || 'Normal').toLowerCase();
              if (priority === 'high') {
                row.style.background = 'linear-gradient(90deg, rgba(255,247,237,0.95) 0%, rgba(255,255,255,1) 22%)';
                row.style.boxShadow = 'inset 4px 0 0 #f59e0b';
              } else if (priority === 'urgent') {
                row.style.background = 'linear-gradient(90deg, rgba(254,226,226,0.98) 0%, rgba(255,255,255,1) 24%)';
                row.style.boxShadow = 'inset 4px 0 0 #dc2626';
              }
            } else if (currentType === 'wipstock') {
              const status = String(data && data.row_status || '').toLowerCase();
              if (status === 'new') {
                row.style.background = 'linear-gradient(90deg, rgba(240,253,244,1) 0%, rgba(255,255,255,1) 22%)';
                row.style.boxShadow = 'inset 4px 0 0 #16a34a';
              } else if (status === 'nil') {
                row.style.background = 'linear-gradient(90deg, rgba(254,242,242,1) 0%, rgba(255,255,255,1) 22%)';
                row.style.boxShadow = 'inset 4px 0 0 #dc2626';
              } else if (status === 'existing') {
                row.style.background = 'linear-gradient(90deg, rgba(239,246,255,0.85) 0%, rgba(255,255,255,1) 18%)';
                row.style.boxShadow = 'inset 4px 0 0 #38bdf8';
              }
            }
            return row;
          },

          buttons: [
            {
              extend: 'colvis',
              text: 'Cols',
              columns: getColvisColumnIndexes()
            },
            {
              extend: 'copy',
              title: exportTitle,
              exportOptions: {
                columns: shouldExportColumn
              }
            },
            {
              extend: 'excel',
              title: exportTitle,
              filename: exportFileName,
              exportOptions: {
                columns: shouldExportColumn
              }
            },
            {
              extend: 'print',
              title: exportTitle,
              exportOptions: {
                columns: shouldExportColumn
              }
            }
          ],
          scrollX: true,
          paging: true, // Scroller needs paging enabled theoretically, but it overrides it visually
          pageLength: 50, // Ignored by Scroller usually

          order: [[1, 'asc']],
          language: { search: "", searchPlaceholder: "Search..." },
          autoWidth: false
        });

        // Enable Row Selection
        $('#masterTable tbody').on('click', 'tr', function () {
          if ($(this).hasClass('selected')) {
            $(this).removeClass('selected');
          } else {
            masterTable.$('tr.selected').removeClass('selected');
            $(this).addClass('selected');
          }
        });

        $('#masterTable tbody').on('dblclick', 'tr', function () {
          masterTable.$('tr.selected').removeClass('selected');
          $(this).addClass('selected');
        });

      } catch (e) {
        console.error(e);
        document.querySelector('#masterTable tbody').innerHTML = `<tr><td style="color:red" colspan="5">Error: ${e.message}</td></tr>`;
      } finally {
        masterDataLoading = false;
      }
    }

    async function uploadMaster() {
      if (!ensureSingleFactoryScope('upload master data')) return;
      const fileInput = document.getElementById('uploadFile');
      if (!fileInput.files.length) return alert('Select file first');
      const selectedFile = fileInput.files[0];

      const formData = new FormData();
      formData.append('file', selectedFile);

      const btn = document.querySelector('button[onclick="uploadMaster()"]');
      const oldTxt = btn.textContent;
      btn.textContent = '...'; btn.disabled = true;

      try {
        if (currentType === 'orjr') {
          const res = await JPSMS.api.upload('/upload/or-jr-preview', formData);
          if (!res.ok) throw new Error(res.error || 'Preview failed');
          pendingUploadMode = 'server-orjr';
          showReviewModal(res.data, {
            mode: 'server',
            title: 'Review OR-JR Changes',
            confirmLabel: 'Confirm Update'
          });
          return;
        }

        if (currentType === 'machines') {
          formData.append('process', getSelectedMachineProcessFilter() || 'Moulding');
          const res = await JPSMS.api.upload('/upload/machines-preview', formData);
          if (!res.ok) throw new Error(res.error || 'Preview failed');
          pendingUploadMode = 'server-machines';
          showReviewModal(res.data, {
            mode: 'server',
            title: 'Review Machine Changes',
            confirmLabel: 'Confirm Update'
          });
          return;
        }

        if (currentType === 'wipstock') {
          const res = await JPSMS.api.upload('/upload/wipstock-preview', formData);
          if (!res.ok) throw new Error(res.error || 'Preview failed');
          pendingUploadMode = 'server-wipstock';
          showReviewModal(res.data.rows || [], {
            mode: 'file',
            keys: res.data.keys || [],
            totalRows: res.data.totalRows || 0,
            title: res.data.stock_date
              ? `WIP Stock Preview - ${res.data.stock_date}`
              : 'WIP Stock Preview',
            confirmLabel: 'Confirm Upload',
            stockDate: res.data.stock_date || '',
            headerDateText: res.data.header_date_text || '',
            sourceFileName: res.data.source_file_name || selectedFile.name
          });
          return;
        }

        const preview = await buildClientUploadPreview(selectedFile, currentType);
        pendingUploadMode = 'file-upload';
        pendingUploadFile = selectedFile;
        showReviewModal(preview.rows, {
          mode: 'file',
          keys: preview.keys,
          totalRows: preview.totalRows,
          title: preview.title,
          confirmLabel: 'Confirm Upload'
        });

      } catch (e) {
        alert(e.message);
      } finally {
        btn.textContent = oldTxt; btn.disabled = false;
      }
    }

    async function downloadTemplate() {
      if (!templateSupportedTypes.includes(currentType)) {
        JPSMS.toast('Template is not available for this master.', 'error');
        return;
      }

      const buttons = [
        document.getElementById('templateBtn'),
        document.getElementById('allFactoryTemplateBtn')
      ].filter(Boolean);
      const originalHtml = buttons.map(btn => btn.innerHTML);
      buttons.forEach(btn => {
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Downloading...';
      });

      try {
        const headers = {};
        const user = JPSMS.auth.getUser();
        if (user?.username) headers['X-User-Name'] = user.username;

        const factoryId = localStorage.getItem('jpsms_factory_id');
        if (factoryId) headers['X-Factory-ID'] = factoryId;

        const templateUrl = new URL(`/api/templates/${currentType}`, window.location.origin);
        if (currentType === 'machines') {
          templateUrl.searchParams.set('process', getSelectedMachineProcessFilter() || 'Moulding');
        }

        const response = await fetch(templateUrl.toString(), { headers });
        if (!response.ok) {
          let message = 'Template download failed';
          try {
            const errJson = await response.json();
            message = errJson.error || message;
          } catch (_err) { }
          throw new Error(message);
        }

        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const fileName = (match && match[1]) ? match[1] : `jms-ocean-${currentType}-template.xlsx`;
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        JPSMS.toast('Template downloaded', 'success');
      } catch (error) {
        alert(error.message || 'Template download failed');
      } finally {
        buttons.forEach((btn, idx) => {
          btn.disabled = false;
          btn.innerHTML = originalHtml[idx];
        });
      }
    }

    function showReviewModal(data, options = {}) {
      if (!data || !Array.isArray(data)) {
        console.error('showReviewModal received invalid data:', data);
        alert('Internal Error: No data received from server.');
        return;
      }
      pendingUploadData = data;
      pendingUploadPreviewMeta = options || {};
      const modal = document.getElementById('reviewModal');
      const table = modal.querySelector('table');
      const thead = table.querySelector('thead');
      const tbody = document.getElementById('reviewTableBody');
      const countSpan = document.getElementById('reviewCount');
      const titleEl = document.getElementById('reviewModalTitle');
      const confirmBtn = document.getElementById('confirmBtn');
      const mode = options.mode || 'server';

      const toProcess = mode === 'server' ? data.filter(d => d._status !== 'SKIP') : data;
      titleEl.textContent = options.title || (mode === 'file' ? 'Upload Preview' : 'Review Changes');
      confirmBtn.textContent = options.confirmLabel || (mode === 'file' ? 'Confirm Upload' : 'Confirm Update');
      countSpan.textContent = mode === 'file'
        ? (options.totalRows > toProcess.length
          ? `Previewing first ${toProcess.length} of ${options.totalRows} rows before upload.`
          : `Previewing ${toProcess.length} rows before upload.`)
        : `Found ${toProcess.length} changes`;

      if (toProcess.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:15px">${mode === 'file' ? 'No rows found in the selected file.' : 'No changes detected.'}</td></tr>`;
        confirmBtn.disabled = true;
      } else {
        confirmBtn.disabled = false;

        // Dynamic Columns with Explicit Titles
        const headerMap = {
          'order_no': 'Order No',
          'item_name': 'Item Name',
          'mould_code': 'Mould Code',
          'qty': 'Qty',
          'priority': 'Priority',
          'mould_number': 'Mould Number',
          'mould_name': 'Mould Name',
          'std_wt_kg': 'STD WT (KG)',
          'runner_weight': 'Runner Weight',
          'primary_machine': 'Primary Machine',
          'secondary_machine': 'Secondary Machine',
          'moulding_sqn': 'Moulding SQN.',
          'consumption_ratio_qty': 'Consumption Ratio(QTY)',
          'no_of_cav': 'No Of Cav',
          'pcs_per_hour': 'PCS/HOUR',
          'target_pcs_day': 'Target PCS/Day',
          'material': 'Material',
          'manpower': 'Manpower',
          'operator_activities': 'Operator Activities',
          'sfg_std_packing': 'SFG STD Packing',
          'sfg_bag_type': 'SFG Bag Type',
          'sfg_bag_size': 'SFG Bag Size',
          'std_volume_cap': 'STD Volume Cap.',
          'building': 'Building',
          'line': 'Line',
          'machine': (currentType === 'machines' && isPrintingMachineView()) ? 'Machine Number' : 'Machine',
          'vendor_name': 'Vendor Name',
          'model_no': 'Model No',
          'machine_type': 'Machine Type',
          'machine_name': 'Machine',
          'tonnage': 'Tonnage',
          'factory_id': 'Factory ID',
          'or_jr_no': 'OR/JR No',
          'or_jr_date': 'OR/JR Date',
          'jr_date': 'JR Date',
          'our_code': 'Our Code',
          'bom_type': 'BomType',
          'jr_item_name': 'JR Item Name',
          'or_qty': 'OR Qty',
          'jr_qty': 'JR Qty',
          'plan_qty': 'Plan Qty',
          'plan_date': 'Plan Date',
          'job_card_no': 'Job Card No',
          'job_card_date': 'Job Card Date',
          'item_code': 'Item Code',
          'product_name': 'Product Name',
          'client_name': 'Client Name',
          'prod_plan_qty': 'Production Plan Qty',
          'std_pack': 'STD Pack',
          'uom': 'UOM',
          'planned_comp_date': 'Planned Comp Date',
          'mld_start_date': 'MLD Start Date',
          'mld_end_date': 'MLD End Date',
          'actual_mld_start_date': 'Actual Mld Start Date',
          'prt_tuf_end_date': 'Prt/Tuf End Date',
          'pack_end_date': 'Pack End Date',
          'mld_status': 'MLD Status',
          'shift_status': 'Shift Status',
          'prt_tuf_status': 'Prt/Tuf Status',
          'pack_status': 'Pack Status',
          'wh_status': 'WH Status',
          'rev_mld_end_date': 'Rev MLD End Date',
          'shift_comp_date': 'Shift Comp. Date',
          'rev_ptd_tuf_end_date': 'Rev Ptd/Tuf End Date',
          'rev_pak_end_date': 'Rev Pak End Date',
          'wh_rec_date': 'WH Rec Date',
          'remarks_all': 'JC-Mld-Shift-Pur-Ptd/Tuft-Pkg-WH Remarks',
          'jr_close': 'JR Close',
          'or_remarks': 'OR Remarks',
          'jr_remarks': 'JR Remarks',
          'mould_item_code': 'Mold Item Code',
          'mould_item_name': 'Mold Item Name',
          'mould_no': 'Mould No',
          'mould': 'Mould',
          'mould_item_qty': 'Mould Item Qty',
          'cavity': 'Cavity',
          'sr_no': 'Sr.No.',
          'stock_date': 'Stock Date',
          'row_status': 'Row Status',
          'factory_unit': 'Factory Unit',
          'party_group': 'Party Group',
          'location_floor_dept': 'Location/Floor/Dept',
          'job_no': 'Job No.',
          'job_date': 'Job Date',
          'ageing_period': 'Ageing Period',
          'previous_stock_qty': 'Previous Stock',
          'current_stock_available_qty': 'Current Stock Available',
          'current_live_qty': 'Current Live Qty',
          'total_qty': 'Total Qty',
          'remark_from_factory_unit': 'Remark From Factory Unit',
          'remark_from_ho_sales_team': 'Remark From HO/Sales Team',
          'created_by': 'Created By',
          'created_date': 'Created Date',
          'edited_by': 'Edited By',
          'edited_date': 'Edited Date'
        };

        const first = toProcess[0];
        // Get keys that exist in data
        let keys = (options.keys && options.keys.length
          ? options.keys
          : Object.keys(first).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'created_at' && k !== 'updated_at'));

        const isPrintingMachinePreview = currentType === 'machines' && (
          isPrintingMachineView()
          || toProcess.every(row => normalizeMachineProcessValue(row.machine_process, '') === 'Printing')
        );

        if (isPrintingMachinePreview) {
          keys = ['machine', 'vendor_name', 'model_no', 'machine_type'].filter(k => keys.includes(k));
        }

        // Sort keys based on the User's A-AL order
        const priority = [
          'order_no', 'item_code', 'item_name', 'mould_code', 'qty', 'priority', 'client_name',
          'mould_number', 'mould_name', 'std_wt_kg', 'runner_weight', 'primary_machine', 'secondary_machine',
          'moulding_sqn', 'consumption_ratio_qty', 'tonnage', 'no_of_cav', 'cycle_time', 'pcs_per_hour', 'target_pcs_day',
          'material', 'manpower', 'operator_activities', 'sfg_std_packing', 'sfg_bag_type', 'sfg_bag_size', 'std_volume_cap',
          'building', 'line', 'machine', 'vendor_name', 'model_no', 'machine_type', 'factory_id',
          'or_jr_no', 'or_jr_date', 'or_qty', 'jr_qty', 'plan_qty', 'plan_date',
          'jr_date', 'our_code', 'bom_type', 'jr_item_name',
          'mould_item_code', 'mould_item_name', 'mould_no', 'mould', 'mould_item_qty', 'machine_name', 'cavity',
          'job_card_no', 'job_card_date', 'item_code', 'product_name', 'client_name',
          'prod_plan_qty', 'std_pack', 'uom', 'planned_comp_date', 'mld_start_date',
          'mld_end_date', 'actual_mld_start_date', 'prt_tuf_end_date', 'pack_end_date',
          'mld_status', 'shift_status', 'prt_tuf_status', 'pack_status', 'wh_status',
          'rev_mld_end_date', 'shift_comp_date', 'rev_ptd_tuf_end_date', 'rev_pak_end_date', 'wh_rec_date',
          'sr_no', 'stock_date', 'row_status', 'factory_unit', 'party_group', 'location_floor_dept',
          'job_no', 'job_date', 'ageing_period', 'previous_stock_qty', 'current_stock_available_qty', 'current_live_qty',
          'total_qty', 'remark_from_factory_unit', 'remark_from_ho_sales_team',
          'remarks_all', 'jr_close', 'or_remarks', 'jr_remarks',
          'created_by', 'created_date', 'edited_by', 'edited_date'
        ];

        keys.sort((a, b) => {
          const idxA = priority.indexOf(a);
          const idxB = priority.indexOf(b);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return 0;
        });

        // Render Header
        thead.innerHTML = `
            <tr>
                <th style="padding:8px; text-align:left; border-bottom:1px solid #e2e8f0; font-size:0.75rem; background:#f1f5f9; position:sticky; top:0">${mode === 'file' ? 'ROW' : 'STATUS'}</th>
                ${keys.map(k => `<th style="padding:8px; text-align:left; border-bottom:1px solid #e2e8f0; font-size:0.75rem; background:#f1f5f9; position:sticky; top:0; white-space:nowrap">${headerMap[k] || k.toUpperCase().replace(/_/g, ' ')}</th>`).join('')}
            </tr>
        `;

        // Render Body
        tbody.innerHTML = toProcess.map((r, idx) => {
          const color = r._status === 'NEW' ? '#166534' : (r._status === 'DELETE' ? '#b91c1c' : '#ea580c');
          const bg = r._status === 'NEW' ? '#dcfce7' : (r._status === 'DELETE' ? '#fee2e2' : '#ffedd5');
          const statusCell = mode === 'file'
            ? `<td style="padding:8px; color:#0f172a; font-weight:700">${idx + 1}</td>`
            : `<td style="padding:8px"><span style="background:${bg}; color:${color}; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem; white-space:nowrap">${r._status}</span></td>`;
          return `
            <tr style="border-bottom:1px solid #eee">
                ${statusCell}
                ${keys.map(k => {
            let val = r[k] ?? '';
            return `<td style="padding:8px; color:#334155; white-space:nowrap">${String(val)}</td>`;
          }).join('')}
            </tr>
         `;
        }).join('');
      }
      modal.style.display = 'flex';
    }

    function closeReviewModal() {
      document.getElementById('reviewModal').style.display = 'none';
      resetPendingUploadState();
    }

    async function confirmUpload() {
      const btn = document.getElementById('confirmBtn');
      const defaultLabel = ['file-upload', 'server-wipstock'].includes(pendingUploadMode) ? 'Confirm Upload' : 'Confirm Update';
      if (!pendingUploadMode) return alert('No preview is waiting for confirmation.');

      btn.textContent = '...'; btn.disabled = true;
      try {
        let res;
        if (pendingUploadMode === 'server-orjr' || pendingUploadMode === 'server-machines') {
          if (!pendingUploadData || !pendingUploadData.length) throw new Error('No preview data found.');
          const endpoint = pendingUploadMode === 'server-machines'
            ? '/upload/machines-confirm'
            : '/upload/or-jr-confirm';
          res = await JPSMS.api.post(endpoint, {
            rows: pendingUploadData,
            user: JPSMS.auth.getUser().username
          });
        } else if (pendingUploadMode === 'server-wipstock') {
          if (!pendingUploadData || !pendingUploadData.length) throw new Error('No WIP Stock preview data found.');
          res = await JPSMS.api.post('/upload/wipstock-confirm', {
            rows: pendingUploadData,
            stock_date: pendingUploadPreviewMeta.stockDate || '',
            header_date_text: pendingUploadPreviewMeta.headerDateText || '',
            source_file_name: pendingUploadPreviewMeta.sourceFileName || '',
            user: JPSMS.auth.getUser().username
          });
        } else if (pendingUploadMode === 'file-upload') {
          if (!pendingUploadFile) throw new Error('No file selected for upload.');
          const formData = new FormData();
          formData.append('file', pendingUploadFile);
          res = await JPSMS.api.upload(`/upload/${currentType}`, formData);
        } else {
          throw new Error('Unsupported upload confirmation mode.');
        }
        const successMessage = res.counts
          ? `New: ${res.counts.new}, Updated: ${res.counts.update}, Deleted: ${res.counts.delete}`
          : (res.message || (res.count ? `Saved: ${res.count}` : 'Upload completed'));
        alert(successMessage);
        document.getElementById('uploadFile').value = '';
        closeReviewModal();
        loadMasterData();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.textContent = defaultLabel; btn.disabled = false;
      }
    }

    // --- Machine CRUD ---
    function normalizeMachineIconSrc(src) {
      const raw = String(src || '').trim();
      if (!raw) return '';
      if (/^data:image\//i.test(raw)) return raw;
      if (/^https?:\/\//i.test(raw)) return raw;

      const normalized = raw.replace(/\\/g, '/');
      if (normalized.startsWith('/uploads/')) return normalized;
      if (normalized.startsWith('uploads/')) return `/${normalized}`;
      if (normalized.startsWith('/public/uploads/')) return normalized.replace(/^\/public/, '');
      if (normalized.startsWith('public/uploads/')) return `/${normalized.replace(/^public\//, '')}`;

      const fileName = normalized.split('/').pop();
      if (fileName && /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) {
        return `/uploads/machines/${fileName}`;
      }

      return normalized.startsWith('/') ? normalized : `/${normalized}`;
    }

    function setMachineIconPreview(src) {
      const preview = document.getElementById('m_machine_icon_preview');
      const empty = document.getElementById('m_machine_icon_empty');
      const cleanSrc = normalizeMachineIconSrc(src);
      if (!preview || !empty) return;

      if (cleanSrc) {
        preview.src = mEscHtml(cleanSrc);
        preview.onerror = function () {
          preview.removeAttribute('src');
          preview.style.display = 'none';
          empty.style.display = 'flex';
        };
        preview.style.display = 'block';
        empty.style.display = 'none';
      } else {
        preview.removeAttribute('src');
        preview.onerror = null;
        preview.style.display = 'none';
        empty.style.display = 'flex';
      }
    }

    function resizeMachineIconFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read icon file'));
        reader.onload = function (event) {
          const img = new Image();
          img.onerror = () => reject(new Error('Selected file is not a valid image'));
          img.onload = function () {
            const maxWidth = 320;
            const maxHeight = 180;
            const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
            const width = Math.max(1, Math.round(img.width * ratio));
            const height = Math.max(1, Math.round(img.height * ratio));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Image resize is not supported in this browser'));
              return;
            }
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            const preferredType = String(file.type || '').toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
            resolve(canvas.toDataURL(preferredType, 0.85));
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    async function previewMachineIconFile(input) {
      const file = input?.files?.[0];
      if (!file) {
        currentMachineIconBase64 = null;
        setMachineIconPreview(document.getElementById('m_machine_icon').value);
        return;
      }

      try {
        currentMachineIconBase64 = await resizeMachineIconFile(file);
        document.getElementById('m_machine_icon').value = '';
        setMachineIconPreview(currentMachineIconBase64);
      } catch (e) {
        currentMachineIconBase64 = null;
        input.value = '';
        alert(e.message || 'Failed to process machine icon');
        setMachineIconPreview(document.getElementById('m_machine_icon').value);
      }
    }

    function handleMachineIconTextInput(input) {
      currentMachineIconBase64 = null;
      const fileInput = document.getElementById('m_machine_icon_file');
      if (fileInput) fileInput.value = '';
      setMachineIconPreview(input?.value || '');
    }

    function openMachineModal(mode, data = {}) {
      if (!ensureSingleFactoryScope(mode === 'add' ? 'add machines' : 'edit machines')) return;
      const modal = document.getElementById('machineModal');
      document.getElementById('machineModalTitle').textContent = mode === 'add' ? 'Add Machine' : 'Edit Machine';
      document.getElementById('machineId').value = data.machine || ''; // Original ID if editing
      document.getElementById('m_machine').value = data.machine || '';
      document.getElementById('m_machine').readOnly = false; // Allow renaming
      document.getElementById('m_building').value = data.building || '';
      document.getElementById('m_line').value = data.line || '';
      const machineProcess = normalizeMachineProcessValue(
        data.machine_process || getSelectedMachineProcessFilter(),
        'Moulding'
      );
      document.getElementById('m_machine_process').value = machineProcess;
      document.getElementById('m_tonnage').value = data.tonnage || '';
      document.getElementById('m_mould_load_time').value = (data.mould_load_time ?? '') === '' ? '' : data.mould_load_time;
      document.getElementById('m_mould_unload_time').value = (data.mould_unload_time ?? '') === '' ? '' : data.mould_unload_time;
      document.getElementById('m_vendor_name').value = data.vendor_name || '';
      document.getElementById('m_model_no').value = data.model_no || '';
      document.getElementById('m_machine_type').value = data.machine_type || '';
      document.getElementById('m_machine_icon').value = data.machine_icon || '';
      document.getElementById('m_machine_icon_file').value = '';
      currentMachineIconBase64 = null;
      setMachineIconPreview(data.machine_icon || '');
      updateMachineModalProcessView(machineProcess);
      // After process view is updated (which populates party dropdown), set the selected party
      if (machineProcess === 'Labour Job' && data.labour_party_id) {
        // Wait for the async party load triggered by updateMachineModalProcessView, then set value
        const trySetParty = (attempts) => {
          const partySelect = document.getElementById('m_labour_party_id');
          if (!partySelect) return;
          // If options already loaded (> 1 = the placeholder + at least one party)
          if (partySelect.options.length > 1) {
            partySelect.value = String(data.labour_party_id);
          } else if (attempts > 0) {
            setTimeout(() => trySetParty(attempts - 1), 150);
          }
        };
        setTimeout(() => trySetParty(10), 100);
      }
      modal.setAttribute('data-mode', mode);
      modal.style.display = 'flex';
    }

    function closeMachineModal() {
      document.getElementById('machineModal').style.display = 'none';
    }

    async function saveMachine() {
      if (!ensureSingleFactoryScope('save machine changes')) return;
      const mode = document.getElementById('machineModal').getAttribute('data-mode');
      const id = document.getElementById('machineId').value;
      const process = document.getElementById('m_machine_process').value;
      const normalizedProc = normalizeMachineProcessValue(process, 'Moulding');
      const isPrinting = normalizedProc === 'Printing';
      const isLabourJob = normalizedProc === 'Labour Job';
      const body = {
        machine: document.getElementById('m_machine').value,
        building: isPrinting ? '' : document.getElementById('m_building').value,
        line: isPrinting ? '' : document.getElementById('m_line').value,
        machine_process: process,
        tonnage: isPrinting ? '' : document.getElementById('m_tonnage').value,
        mould_load_time: isPrinting ? '' : document.getElementById('m_mould_load_time').value,
        mould_unload_time: isPrinting ? '' : document.getElementById('m_mould_unload_time').value,
        vendor_name: isPrinting ? document.getElementById('m_vendor_name').value : '',
        model_no: isPrinting ? document.getElementById('m_model_no').value : '',
        machine_type: isPrinting ? document.getElementById('m_machine_type').value : '',
        machine_icon: document.getElementById('m_machine_icon').value,
        machine_icon_base64: currentMachineIconBase64,
        labour_party_id: isLabourJob ? (document.getElementById('m_labour_party_id')?.value || null) : null
      };

      try {
        if (mode === 'add') {
          await JPSMS.api.post('/machines', body);
        } else {
          await JPSMS.api.request(`/machines/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
        }
        alert('Saved');
        closeMachineModal();
        loadMasterData();
      } catch (e) { alert(e.message); }
    }

    async function deleteMachine(id) {
      if (!ensureSingleFactoryScope('delete machines')) return;
      if (!confirm('Are you sure you want to delete ' + id + '?')) return;
      try {
        await JPSMS.api.request(`/machines/${encodeURIComponent(id)}`, { method: 'DELETE' });
        loadMasterData();
      } catch (e) { alert(e.message); }
    }

    async function fetchOrdersFromORJR() {
      if (!ensureSingleFactoryScope('fetch orders into one factory')) return;
      const btn = document.getElementById('omFetchBtn');
      const label = document.getElementById('omLastFetch');

      try {
        btn.disabled = true;
        // Store original icon/text if needed, or just hardcode reset
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Fetching...';

        const res = await JPSMS.api.post('/orders/fetch-from-orjr');

        JPSMS.toast(res.message, res.ok ? 'success' : 'error');
        if (res.ok) {
          loadMasterData();
          if (label) {
            label.style.display = 'inline-block';
            label.textContent = 'Last: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }
        }

      } catch (e) {
        alert('Fetch Failed: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-down"></i> Auto-Fetch Orders';
      }
    }

    // --- OR-JR Actions ---
    function toggleOrJrView() {
      const newView = currentView === 'closed' ? 'active' : 'closed';
      const url = new URL(window.location);
      url.searchParams.set('view', newView);
      window.history.pushState({}, '', url);
      // Reload page to reset UI clearly or just reload data
      window.location.reload();
    }

    async function closeOrJr(id, jcNo) {
      if (!ensureSingleFactoryScope('close OR-JR records')) return;
      if (!confirm('Are you sure you want to CLOSE this OR-JR?\nIt will be locked from future updates.')) return;
      try {
        const user = JPSMS.auth.getUser();
        const res = await JPSMS.api.post('/orjr/close', {
          or_jr_no: id,
          job_card_no: jcNo,
          user_id: user.username,
          user_name: user.username
        });
        if (res.ok) {
          JPSMS.toast('OR-JR Closed', 'success');
          loadMasterData();
        } else {
          alert(res.error);
        }
      } catch (e) { alert(e.message); }
    }

    async function reopenOrJr(id, jcNo) {
      if (!ensureSingleFactoryScope('reopen OR-JR records')) return;
      if (!confirm('Reopen this OR-JR?\nIt will act as an Active record again.')) return;
      try {
        const user = JPSMS.auth.getUser();
        const res = await JPSMS.api.post('/orjr/reopen', {
          or_jr_no: id,
          job_card_no: jcNo,
          user_id: user.username,
          user_name: user.username
        });
        if (res.ok) {
          JPSMS.toast('OR-JR Reopened', 'success');
          loadMasterData();
        } else {
          alert(res.error);
        }
      } catch (e) { alert(e.message); }
    }
    /* =========================================
       ADMIN DATABASE TOOLS
       ========================================= */
    function checkAdminTools() {
      const user = JPSMS.auth.getUser();
      // Show if admin OR if specifically allowed
      if (user && ((window.JPSMS && window.JPSMS.auth && window.JPSMS.auth.isAdminLike && window.JPSMS.auth.isAdminLike(user)) || user.username === 'admin')) {
        const card = document.getElementById('adminToolsCard');
        if (card) card.style.display = 'flex';
      }
    }
    document.addEventListener('DOMContentLoaded', checkAdminTools);

    function downloadBackup() {
      JPSMS.toast('Starting Download...', 'info');
      window.location.href = '/api/admin/backup';
    }

    function openRestoreModal() {
      document.getElementById('restoreModal').style.display = 'flex';
    }
    function closeRestoreModal() {
      document.getElementById('restoreModal').style.display = 'none';
      document.getElementById('restoreFile').value = '';
    }

    async function performRestore() {
      const fileInput = document.getElementById('restoreFile');
      if (!fileInput.files.length) return alert('Please select a .sql or .backup file first.');

      const confirmMsg = "WARNING: This will DESTRUCTIVELY OVERWRITE the database with the selected backup.\n\nAre you absolutely sure?";
      if (!confirm(confirmMsg)) return;

      const btn = document.getElementById('btnRestoreConfirm');
      const originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Restoring... (Do not close)';

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      try {
        const token = localStorage.getItem('jpsms_token');
        const res = await fetch('/api/admin/restore', {
          method: 'POST',
          headers: { 'Authorization': token ? 'Bearer ' + token : '' },
          body: formData
        });
        const json = await res.json();

        if (json.ok) {
          alert('Restore Completed Successfully!\nThe page will now reload.');
          window.location.reload();
        } else {
          alert('Restore Failed:\n' + json.error);
        }
      } catch (e) {
        alert('Network Error during Restore: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }

    /* ---- Live Tab Sync -------------------------------------------------- */
    window.addEventListener('jpsms:live-refresh', function (e) {
      var mod = (e.detail || {}).module;
      if (mod !== 'masters') return;
      // Don't reload if a modal is open (user might be mid-edit)
      var openModal = document.querySelector('.modal[style*="flex"], .modal.show');
      if (openModal) return;
      if (typeof loadMasterData === 'function') loadMasterData();
    });
    /* =====================================================================
       LABOUR PARTIES MASTER — dedicated list + modal functions
       ===================================================================== */

    let labourPartyMode = 'add';
    let labourPartyEditId = null;

    async function loadLabourParties() {
      const tbody = document.querySelector('#masterTable tbody');
      const thead = document.querySelector('#masterTable thead');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center p-3">Loading...</td></tr>';
      if (thead) thead.innerHTML = '';

      // Show Add button
      const addBtn = document.getElementById('addLabourPartyBtn');
      if (addBtn) addBtn.style.display = JPSMS.auth.can('masters', 'edit') ? 'inline-block' : 'none';

      try {
        const res = await JPSMS.api.get('/labour-parties');
        const parties = res.data || [];

        if (thead) {
          thead.innerHTML = `<tr>
            <th style="width:50px">Actions</th>
            <th>#</th>
            <th>Party Name</th>
            <th>Party Type</th>
            <th>Status</th>
            <th>Assigned Machines</th>
          </tr>`;
        }

        if (!parties.length) {
          if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center p-3" style="color:#64748b">No labour parties found. Click <b>Add Party</b> to create one.</td></tr>';
          return;
        }

        const canEdit = JPSMS.auth.can('masters', 'edit');
        // Cache parties for delegated click handlers (avoids inline onclick with user data)
        window._labourPartiesCache = {};
        parties.forEach(p => { window._labourPartiesCache[p.id] = p; });

        if (tbody) {
          tbody.innerHTML = parties.map((p, i) => `
            <tr>
              <td>
                ${canEdit ? `
                  <button class="lp-edit-btn" data-party-id="${p.id}"
                    style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:0.75rem;margin-right:3px">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <button class="lp-del-btn" data-party-id="${p.id}"
                    style="background:#dc2626;color:#fff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:0.75rem">
                    <i class="bi bi-trash"></i>
                  </button>
                ` : ''}
              </td>
              <td>${i + 1}</td>
              <td style="font-weight:600">${escHtml(p.party_name || '')}</td>
              <td><span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700">${escHtml(p.party_type || 'Labour Job')}</span></td>
              <td>${p.is_active
                ? '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700">Active</span>'
                : '<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700">Inactive</span>'}</td>
              <td style="color:#475569;font-size:0.78rem">${
                (p.machines && p.machines.length)
                  ? p.machines.map(m => `<span style="background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:8px;font-size:0.7rem;margin-right:3px">${escHtml(m)}</span>`).join('')
                  : '<span style="color:#94a3b8">None assigned</span>'
              }</td>
            </tr>
          `).join('');

          // Delegated event listeners — no user data in onclick (CodeQL safe)
          tbody.addEventListener('click', (ev) => {
            const editBtn = ev.target.closest('.lp-edit-btn');
            const delBtn = ev.target.closest('.lp-del-btn');
            if (editBtn) {
              const party = window._labourPartiesCache[editBtn.dataset.partyId];
              if (party) openLabourPartyModal('edit', party);
            } else if (delBtn) {
              const party = window._labourPartiesCache[delBtn.dataset.partyId];
              if (party) deleteLabourParty(party.id, party.party_name);
            }
          });
        }
      } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center p-3" style="color:#dc2626">Error: ${escHtml(e.message)}</td></tr>`;
      }
    }

    function openLabourPartyModal(mode, data = {}) {
      labourPartyMode = mode;
      labourPartyEditId = data.id || null;
      const modal = document.getElementById('labourPartyModal');
      if (!modal) return;
      document.getElementById('labourPartyModalTitle').textContent = mode === 'add' ? 'Add Labour Party' : 'Edit Labour Party';
      document.getElementById('lp_party_name').value = data.party_name || '';
      const isActiveEl = document.getElementById('lp_is_active');
      if (isActiveEl) isActiveEl.checked = data.is_active !== false; // default true for new
      modal.style.display = 'flex';
    }

    function closeLabourPartyModal() {
      const modal = document.getElementById('labourPartyModal');
      if (modal) modal.style.display = 'none';
    }

    async function saveLabourParty() {
      const partyName = (document.getElementById('lp_party_name')?.value || '').trim();
      if (!partyName) { alert('Party Name is required'); return; }
      const isActive = document.getElementById('lp_is_active')?.checked !== false;

      const body = { party_name: partyName, is_active: isActive };

      try {
        if (labourPartyMode === 'add') {
          const res = await JPSMS.api.post('/labour-parties', body);
          if (!res.ok) throw new Error(res.error || 'Failed to create party');
          JPSMS.toast('Labour party created', 'success');
        } else {
          const res = await JPSMS.api.request(`/labour-parties/${labourPartyEditId}`, { method: 'PUT', body: JSON.stringify(body) });
          if (!res.ok) throw new Error(res.error || 'Failed to update party');
          JPSMS.toast('Labour party updated', 'success');
        }
        closeLabourPartyModal();
        await loadLabourParties();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    async function deleteLabourParty(id, name) {
      if (!confirm(`Delete labour party "${name}"? Machines assigned to this party will be unlinked.`)) return;
      try {
        const res = await JPSMS.api.request(`/labour-parties/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(res.error || 'Failed to delete party');
        JPSMS.toast('Labour party deleted', 'success');
        await loadLabourParties();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }

    /* --------------------------------------------------------------------- */