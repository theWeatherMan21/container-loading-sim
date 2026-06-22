/**
 * Container Loading Simulator — Main Application Controller
 * IIFE pattern, exposes window.App
 * Coordinates: FieldParser → ContainerDB → PackingEngine → ThreeViewer → PdfExporter
 * 4-step wizard with Morandi-kawaii micro-interactions 💗
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════
  // Module references (via window globals)
  // ═══════════════════════════════════════════
  const FP = window.FieldParser;
  const CDB = window.ContainerDB;
  const PE = window.PackingEngine;
  // ThreeViewer 是 ES module，可能尚未加载，使用轮询获取
  function getTV() { return window.ThreeViewer; }
  const PDFX = window.PdfExporter;

  // ═══════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════
  const state = {
    fileData: null,
    fileName: '',
    parsedResult: null,       // raw result from FieldParser.parseFile
    dataRows: null,           // raw data rows (reconstructed from sheets)
    items: [],                // final extracted items
    containerSpec: null,
    containerSpecs: null,     // 多箱组合: [{ code, nameCN, L, W, H, ... }]
    useMixed: false,          // 用户是否启用混合装箱
    tolerance: 0.05,
    selectedContainerCode: null,
    packingResult: null,
    visualization: null,
    currentStep: 1,
    // Step 2 ephemeral state
    columnMapping: [],        // user-overridden mapping: [{ index, header, field }]
    multiSizeDecisions: {},   // { model: selectedGroupIndex }
    selectedUnit: 'cm',       // 'mm' | 'cm' | 'm'
    // Step 3 ephemeral state
    skuOverrides: {}          // { model: { stackable, orientationFixed } }
  };

  // ═══════════════════════════════════════════
  // Field name ↔ dropdown label mapping
  // ═══════════════════════════════════════════
  const FIELD_TO_LABEL = {
    model: '型号',
    length: '长',
    width: '宽',
    height: '高',
    quantity: '数量',
    grossWeight: '毛重',
    netWeight: '净重',
    volume: '体积',
    description: '描述',
    stackable: '可叠放',
    possibleWeight: '忽略',
    combinedDimension: '组合尺寸',
    possibleDimension: '长',
    unknown: '忽略'
  };

  const LABEL_TO_FIELD = {
    '型号': 'model',
    '长': 'length',
    '宽': 'width',
    '高': 'height',
    '数量': 'quantity',
    '毛重': 'grossWeight',
    '体积': 'volume',
    '可叠放': 'stackable',
    '组合尺寸': 'combinedDimension',
    '忽略': 'ignore'
  };

  const DROPDOWN_OPTIONS = ['型号', '长', '宽', '高', '组合尺寸', '数量', '毛重', '体积', '可叠放', '忽略'];

  // ═══════════════════════════════════════════
  // DOM references (lazy — grabbed on init)
  // ═══════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  // ═══════════════════════════════════════════
  // Step navigation
  // ═══════════════════════════════════════════
  function showStep(step) {
    state.currentStep = step;
    for (let i = 1; i <= 4; i++) {
      const el = $(`step-${i}`);
      if (el) {
        if (i === step) {
          el.classList.remove('hidden');
          el.style.animation = 'fadeIn 0.35s ease';
        } else {
          el.classList.add('hidden');
          el.style.animation = '';
        }
      }
    }
    updateStepIndicators(step);
  }

  function updateStepIndicators(activeStep) {
    for (let i = 1; i <= 4; i++) {
      const stepEl = document.querySelector(`.steps__step[data-step="${i}"]`);
      if (!stepEl) continue;
      stepEl.classList.remove('steps__step--active', 'steps__step--completed');
      if (i < activeStep) {
        stepEl.classList.add('steps__step--completed');
      } else if (i === activeStep) {
        stepEl.classList.add('steps__step--active');
      }
    }
  }

  // ═══════════════════════════════════════════
  // Alert 组件
  // ═══════════════════════════════════════════

  const ALERT_STYLES = {
    error: {
      bg: '#FDEDEC', border: '#E6B0AA', color: '#943126', icon: '💔',
      className: 'alert-error'
    },
    success: {
      bg: '#E8F8F0', border: '#A3D4B0', color: '#1E7E47', icon: '✨',
      className: 'alert-success'
    }
  };

  /**
   * 统一创建并显示提示消息
   * @param {'error'|'success'} type
   * @param {string} message
   * @param {string} [targetSelector]
   * @param {object} [options]
   * @param {boolean} options.autoDismiss - 是否5秒后自动消失
   * @param {boolean} options.dismissPrevious - 是否清除同类型旧消息
   */
  function createAlert(type, message, targetSelector, options = {}) {
    const { autoDismiss = true, dismissPrevious = true } = options;
    const style = ALERT_STYLES[type];
    if (!style) return;

    if (dismissPrevious) {
      const existing = document.querySelector(`.${style.className}`);
      if (existing) existing.remove();
    }

    const alert = document.createElement('div');
    alert.className = style.className;
    alert.style.cssText =
      `background:${style.bg};border:1px solid ${style.border};border-radius:12px;` +
      `padding:12px 16px;color:${style.color};font-size:13px;margin-bottom:16px;` +
      'animation:fadeIn 0.3s ease;';
    alert.textContent = `${style.icon} ${message}`;

    const target = targetSelector
      ? document.querySelector(targetSelector)
      : ($(`step-${state.currentStep}`) || document.body);
    if (target) target.prepend(alert);

    if (autoDismiss) {
      setTimeout(() => {
        alert.style.transition = 'opacity 0.5s ease';
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 500);
      }, 5000);
    }

    return alert;
  }

  // 向后兼容的薄包装
  function showError(message, targetSelector) {
    createAlert('error', message, targetSelector, { autoDismiss: false });
  }

  function showSuccess(message, targetSelector) {
    createAlert('success', message, targetSelector, { autoDismiss: true });
  }

  // ═══════════════════════════════════════════
  // Progress bar
  // ═══════════════════════════════════════════
  function showProgress(text) {
    const bar = $('progress-bar');
    const txt = $('progress-text');
    const status = $('calculation-status');
    if (bar) { bar.style.display = 'block'; bar.value = 0; }
    if (txt) { txt.style.display = 'block'; txt.textContent = '0%'; }
    if (status) { status.style.display = 'block'; status.textContent = text || '计算中…'; }
  }

  function updateProgress(percent, text) {
    const bar = $('progress-bar');
    const txt = $('progress-text');
    const status = $('calculation-status');
    if (bar) bar.value = percent;
    if (txt) txt.textContent = Math.round(percent) + '%';
    if (status && text) status.textContent = text;
  }

  function hideProgress() {
    const bar = $('progress-bar');
    const txt = $('progress-text');
    const status = $('calculation-status');
    if (bar) bar.style.display = 'none';
    if (txt) txt.style.display = 'none';
    if (status) status.style.display = 'none';
  }

  /**
   * Simulate progress while synchronous calculation runs.
   * Uses setTimeout chains to yield to the browser between ticks.
   */
  function simulateProgress(durationMs, onDone) {
    const steps = 10;
    const interval = durationMs / steps;
    let current = 0;

    function tick() {
      current++;
      const pct = Math.min(current / steps * 100, 90);
      const messages = [
        '正在分析货物数据…', '正在匹配最佳箱型…', '正在执行3D装箱算法…',
        '正在优化空间利用率…', '正在校验约束条件…', '正在生成装箱方案…',
        '正在进行重叠检测…', '正在计算重量分布…', '正在整理结果…', '即将完成…'
      ];
      updateProgress(pct, messages[Math.min(current - 1, messages.length - 1)]);

      if (current < steps) {
        setTimeout(tick, interval);
      } else {
        // Final stretch: jump to 100%
        updateProgress(100, '计算完成 ✨');
        setTimeout(() => {
          hideProgress();
          if (onDone) onDone();
        }, 400);
      }
    }

    updateProgress(0, '初始化计算…');
    setTimeout(tick, interval);
  }

  // ═══════════════════════════════════════════
  // Step 1: File Upload
  // ═══════════════════════════════════════════
  function initStep1() {
    const dropZone = $('dropZone');
    const fileInput = $('fileInput');

    if (!dropZone || !fileInput) return;

    // Click to open file dialog
    dropZone.addEventListener('click', async () => {
      if (window.TauriBridge && window.TauriBridge.isTauri) {
        try {
          const path = await window.TauriBridge.pickExcelFile();
          if (!path) return;
          const bytes = await window.TauriBridge.readFileBytes(path);
          if (!bytes) {
            showError('文件读取失败，请重试～ 🥛');
            return;
          }
          // 安全转换：使用 slice 避免共享 ArrayBuffer 导致的多余字节
          const arrayBuffer = new Uint8Array(bytes).slice().buffer;
          processFileBuffer(arrayBuffer, path.split('/').pop() || path);
        } catch (err) {
          console.error('Tauri file pick/read error:', err);
          showError('打开文件失败：' + (err.message || '未知错误') + ' 🥛');
        }
        return;
      }
      fileInput.click();
    });

    // Drag & drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drop-zone--drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drop-zone--drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drop-zone--drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFileUpload(file);
    });
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  function handleFileUpload(file) {
    const validExts = ['.xlsx', '.xls', '.csv'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!validExts.includes(ext)) {
      showError('仅支持 .xlsx / .xls / .csv 格式的文件哦～请重新选择 🥛');
      return;
    }

    if (file.size === 0) {
      showError('文件为空，请重新选择 🥛');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showError('文件超过10MB，请压缩后重新上传 🥛');
      return;
    }

    state.fileName = file.name;

    const reader = new FileReader();
    reader.onload = function (e) {
      processFileBuffer(e.target.result, file.name);
    };

    reader.onerror = function () {
      showError('文件读取失败，请重试～ 🥛');
    };

    reader.readAsArrayBuffer(file);
  }

  function processFileBuffer(buffer, fileName) {
    try {
      if (!buffer || buffer.byteLength === 0) {
        showError('文件读取结果为空，请检查文件是否损坏 🥛');
        return;
      }

      state.fileName = fileName;
      state.fileData = buffer;

      let result;
      try {
        result = FP.parseFile(state.fileData, state.fileName);
      } catch (parseErr) {
        console.error('Parse error:', parseErr);
        showError('文件解析失败：' + (parseErr.message || '未知错误') + '，请检查文件格式 🥛');
        return;
      }

      if (result.error) {
        showError(result.error);
        return;
      }

      state.parsedResult = result;

      // Reconstruct dataRows from sheets (for reExtract later)
      const allRows = [];
      for (const sheet of result.sheets) {
        allRows.push(...sheet.data);
      }
      // Clean merged (deduplicate consecutive rows, matching FieldParser behavior)
      const cleaned = allRows.length > 0 ? [allRows[0]] : [];
      for (let i = 1; i < allRows.length; i++) {
        if (JSON.stringify(cleaned[cleaned.length - 1]) !== JSON.stringify(allRows[i])) {
          cleaned.push(allRows[i]);
        }
      }
      state.dataRows = cleaned.slice(result.headerRowIndex + 1);

      // Infer unit from raw data
      state.selectedUnit = inferUnitFromMapping(result);

      // Initialize column mapping from parser result
      state.columnMapping = result.mapping.map(m => ({
        index: m.index,
        header: m.header,
        field: m.field
      }));

      // Initialize multi-size decisions (default: first group)
      state.multiSizeDecisions = {};
      const multiSize = FP.detectMultiSize(result.items);
      for (const [model, info] of Object.entries(multiSize)) {
        state.multiSizeDecisions[model] = 0; // select first group
      }

      // Store initial items
      state.items = result.items;

      // Render Step 2
      renderStep2(result, multiSize);
      showStep(2);

    } catch (err) {
      console.error('File parse error:', err);
      showError('文件解析失败：' + (err.message || '未知错误') + '，请检查文件格式 🥛');
    }
  }

  /**
   * Infer the original dimension unit from the parsed mapping and raw data.
   * Uses FieldParser.inferUnit() against the raw dimension column values.
   */
  function inferUnitFromMapping(parsedResult) {
    const { mapping, headerRowIndex } = parsedResult;
    const dimIndices = mapping
      .filter(m => m.field === 'length' || m.field === 'width' || m.field === 'height' || m.field === 'possibleDimension' || m.field === 'combinedDimension')
      .map(m => m.index);

    if (dimIndices.length === 0) return 'cm';

    // 优先：从表头文字中检测单位
    const headerUnits = new Set();
    for (const idx of dimIndices) {
      const m = mapping.find(m => m.index === idx);
      const header = m ? m.header || '' : '';
      const unit = FP.detectUnitFromHeader ? FP.detectUnitFromHeader(header) : null;
      if (unit) headerUnits.add(unit);
    }

    if (headerUnits.size === 1) {
      return [...headerUnits][0];
    }

    // 其次：数值推断
    const allRawRows = [];
    for (const sheet of parsedResult.sheets) {
      allRawRows.push(...sheet.data);
    }
    const dataRows = allRawRows.slice(headerRowIndex + 1);

    const dimValues = [];
    for (const row of dataRows) {
      for (const idx of dimIndices) {
        const v = row[idx];
        if (v != null && v !== '') {
          const n = FP.normalizeNumber ? FP.normalizeNumber(v) : parseFloat(v);
          if (!isNaN(n) && n > 0) dimValues.push(n);
        }
      }
    }

    if (dimValues.length > 0) {
      return FP.inferUnit(dimValues);
    }
    return 'cm';
  }

  // ═══════════════════════════════════════════
  // Step 2: Data Confirmation
  // ═══════════════════════════════════════════
  function renderStep2(parsedResult, multiSize) {
    // Summary
    const summaryEl = $('parsed-summary');
    if (summaryEl) {
      const uniqueModels = new Set(parsedResult.items.map(i => i.model)).size;
      const totalQty = parsedResult.items.reduce((s, i) => s + (i.quantity || 1), 0);
      summaryEl.innerHTML =
        `<div style="display:flex;gap:24px;flex-wrap:wrap;">
          <div><strong>工作表数：</strong>${parsedResult.sheets.length}</div>
          <div><strong>数据行数：</strong>${parsedResult.totalDataRows}</div>
          <div><strong>SKU 数：</strong>${uniqueModels}</div>
          <div><strong>总件数：</strong>${totalQty}</div>
        </div>`;
    }

    // Column mapping table
    renderColumnMappingTable(parsedResult);

    // Multi-size warnings
    renderMultiSizeWarnings(multiSize);

    // Unit selector
    renderUnitSelector();

    // Data preview
    renderDataPreview(parsedResult);

    // Confirm button
    const btnConfirm = $('btn-confirm-data');
    if (btnConfirm) {
      btnConfirm.onclick = confirmData;
    }
  }

  function renderColumnMappingTable(parsedResult) {
    const tableEl = $('column-mapping-table');
    if (!tableEl) return;

    const { mapping, headerRowIndex } = parsedResult;

    // Build preview samples for each column (first 3 data rows)
    const allRawRows = [];
    for (const sheet of parsedResult.sheets) {
      allRawRows.push(...sheet.data);
    }
    const dataRows = allRawRows.slice(headerRowIndex + 1);
    const samples = dataRows.slice(0, 3);

    // Sanitize mapping to ensure it has all required fields
    const safeMapping = mapping.map(m => ({
      ...m,
      field: m.field || 'unknown',
      confidence: m.confidence || 'low',
      sample: m.sample || (samples.length > 0 ? String(samples[0][m.index] || '').trim() : '')
    }));

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#F5F0EB;">';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">列序号</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">表头名称</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">字段映射</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">识别置信度</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">数据样本</th>';
    html += '</tr></thead><tbody>';

    for (const m of safeMapping) {
      const currentLabel = FIELD_TO_LABEL[m.field] || '忽略';
      const confidenceLabel = m.confidence === 'high' ? '高 ⭐' : m.confidence === 'medium' ? '中 ◇' : '低 ○';

      // Build sample text from first 3 rows
      const sampleTexts = [];
      for (const row of samples) {
        const v = row[m.index];
        if (v != null && v !== '') sampleTexts.push(String(v).trim());
      }
      const sampleStr = sampleTexts.slice(0, 3).join(', ') || '—';

      html += '<tr style="border-bottom:1px solid #E8DFD5;">';
      html += `<td style="padding:6px 8px;color:#7A706B;">${m.index + 1}</td>`;
      html += `<td style="padding:6px 8px;">${escapeHtml(m.header)}</td>`;
      html += `<td style="padding:6px 8px;">
        <select data-col-index="${m.index}" class="col-mapping-select"
          style="padding:4px 8px;border:1px solid #D4C5B9;border-radius:8px;
                 font-size:13px;background:#fff;color:#3D3535;cursor:pointer;
                 transition:border-color 0.2s ease;">
          ${DROPDOWN_OPTIONS.map(opt => {
            const sel = opt === currentLabel ? ' selected' : '';
            return `<option value="${opt}"${sel}>${opt}</option>`;
          }).join('')}
        </select>
      </td>`;
      html += `<td style="padding:6px 8px;font-size:12px;color:#7A706B;">${confidenceLabel}</td>`;
      html += `<td style="padding:6px 8px;font-size:12px;color:#999;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(sampleStr)}">${escapeHtml(sampleStr)}</td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    tableEl.innerHTML = html;

    // Attach change listeners to update state.columnMapping
    tableEl.querySelectorAll('.col-mapping-select').forEach(sel => {
      sel.addEventListener('change', function () {
        const colIndex = parseInt(this.dataset.colIndex);
        const label = this.value;
        const field = LABEL_TO_FIELD[label] || 'unknown';
        const entry = state.columnMapping.find(m => m.index === colIndex);
        if (entry) {
          entry.field = field;
        }
      });
    });
  }

  function renderMultiSizeWarnings(multiSize) {
    const el = $('multi-size-warnings');
    if (!el) return;

    const entries = Object.entries(multiSize);
    if (entries.length === 0) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';
    let html = '<div style="background:#FFF9E6;border:1px solid #E8D5A0;border-radius:12px;padding:16px;margin-bottom:12px;">';
    html += '<div style="font-weight:600;color:#8B7516;margin-bottom:12px;">⚠️ 检测到以下 SKU 存在多组不同尺寸，请选择使用哪组尺寸：</div>';

    for (const [model, info] of entries) {
      const selectedIdx = state.multiSizeDecisions[model] || 0;
      html += `<div style="margin-bottom:12px;padding:10px;background:#FFF;border-radius:10px;border:1px solid #F0E8D0;">`;
      html += `<div style="font-weight:600;margin-bottom:8px;color:#3D3535;">${escapeHtml(model)}</div>`;

      for (let g = 0; g < info.groups.length; g++) {
        const grp = info.groups[g];
        const checked = g === selectedIdx ? ' checked' : '';
        html += `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:13px;color:#555;">
          <input type="radio" name="multisize-${escapeAttr(model)}" value="${g}"${checked}
            style="accent-color:#8FA39B;">
          尺寸 ${g + 1}: ${grp.l.toFixed(3)}×${grp.w.toFixed(3)}×${grp.h.toFixed(3)} m | 数量: ${grp.quantity}
        </label>`;
      }

      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;

    // Attach radio listeners
    el.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', function () {
        const modelName = this.name.replace('multisize-', '');
        state.multiSizeDecisions[modelName] = parseInt(this.value);
      });
    });
  }

  function renderUnitSelector() {
    const el = $('unit-selector');
    if (!el) return;

    const options = [
      { value: 'mm', label: '毫米 (mm)' },
      { value: 'cm', label: '厘米 (cm)' },
      { value: 'm', label: '米 (m)' }
    ];

    el.innerHTML = `
      <label style="font-weight:600;margin-right:12px;color:#3D3535;">📏 尺寸单位：</label>
      <select id="unit-select" style="padding:6px 12px;border:1px solid #D4C5B9;border-radius:8px;
        font-size:13px;background:#fff;color:#3D3535;cursor:pointer;">
        ${options.map(o => {
          const sel = o.value === state.selectedUnit ? ' selected' : '';
          return `<option value="${o.value}"${sel}>${o.label}</option>`;
        }).join('')}
      </select>
    `;

    const select = el.querySelector('#unit-select');
    if (select) {
      select.addEventListener('change', function () {
        state.selectedUnit = this.value;
      });
    }
  }

  function renderDataPreview(parsedResult) {
    const el = $('data-preview');
    if (!el) return;

    const { items } = parsedResult;
    const preview = items.slice(0, 10);

    if (preview.length === 0) {
      el.innerHTML = '<div style="color:#999;font-size:13px;">暂无数据预览</div>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:#F5F0EB;">';
    html += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #D4C5B9;">#</th>';
    html += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #D4C5B9;">型号</th>';
    html += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">长(m)</th>';
    html += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">宽(m)</th>';
    html += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">高(m)</th>';
    html += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">数量</th>';
    html += '<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">重量(kg)</th>';
    html += '</tr></thead><tbody>';

    for (let i = 0; i < preview.length; i++) {
      const item = preview[i];
      html += '<tr style="border-bottom:1px solid #E8DFD5;">';
      html += `<td style="padding:4px 8px;color:#999;">${i + 1}</td>`;
      html += `<td style="padding:4px 8px;">${escapeHtml(item.model)}</td>`;
      html += `<td style="padding:4px 8px;text-align:right;">${item.l.toFixed(3)}</td>`;
      html += `<td style="padding:4px 8px;text-align:right;">${item.w.toFixed(3)}</td>`;
      html += `<td style="padding:4px 8px;text-align:right;">${item.h.toFixed(3)}</td>`;
      html += `<td style="padding:4px 8px;text-align:right;">${item.quantity}</td>`;
      html += `<td style="padding:4px 8px;text-align:right;">${item.weight.toFixed(1)}</td>`;
      html += '</tr>';
    }

    if (items.length > 10) {
      html += `<tr><td colspan="7" style="padding:6px 8px;color:#999;text-align:center;font-size:12px;">
        … 共 ${items.length} 行，仅展示前 10 行</td></tr>`;
    }

    html += '</tbody></table>';
    el.innerHTML = html;
  }

  /**
   * Step 2 → confirm: re-extract items with user's column mapping and unit.
   */
  function confirmData() {
    try {
      if (!state.parsedResult || !state.dataRows) {
        showError('请先上传装箱单文件～ 🥛');
        return;
      }

      // Build new mapping for reExtract: [{ field: 'model'|'length'|... }]
      const newMapping = state.columnMapping.map(m => ({
        field: m.field === 'ignore' ? 'unknown' : m.field
      }));

      const result = FP.reExtract(state.dataRows, state.parsedResult.headerRow, newMapping, state.selectedUnit);

      // Apply multi-size decisions: for models with multiple size groups, use selected size
      const multiSize = FP.detectMultiSize(result.items);
      const mergedItems = [];

      for (const [model, info] of Object.entries(multiSize)) {
        const selectedIdx = state.multiSizeDecisions[model] || 0;
        const selectedGroup = info.groups[selectedIdx];
        if (selectedGroup) {
          // Use selected dimensions for all items of this model
          const modelItems = result.items.filter(i => i.model === model);
          const totalQty = modelItems.reduce((s, i) => s + (i.quantity || 1), 0);

          // Preserve stackable/orientationFixed from first item
          const firstItem = modelItems[0] || {};
          mergedItems.push({
            model,
            l: selectedGroup.l,
            w: selectedGroup.w,
            h: selectedGroup.h,
            quantity: totalQty,
            weight: firstItem.weight || 0,
            stackable: firstItem.stackable !== false,
            orientationFixed: firstItem.orientationFixed || false,
            volume: selectedGroup.l * selectedGroup.w * selectedGroup.h
          });
        }
      }

      // Add non-multi-size items
      for (const item of result.items) {
        if (!multiSize[item.model]) {
          mergedItems.push(item);
        }
      }

      state.items = mergedItems;
      state.parsedResult.items = result.items; // update parsed items too
      state.parsedResult.warnings = result.warnings;

      // Reset SKU overrides
      state.skuOverrides = {};
      for (const item of mergedItems) {
        state.skuOverrides[item.model] = {
          stackable: item.stackable !== false,
          orientationFixed: item.orientationFixed || false
        };
      }

      // Render Step 3
      renderStep3();
      showStep(3);

    } catch (err) {
      console.error('Data confirmation error:', err);
      showError('数据确认失败：' + (err.message || '未知错误') + ' 🥛');
    }
  }

  // ═══════════════════════════════════════════
  // Step 3: Packing Configuration
  // ═══════════════════════════════════════════
  function renderStep3() {
    // Tolerance input
    const tolInput = $('tolerance-input');
    if (tolInput) {
      tolInput.type = 'number';
      tolInput.min = '0';
      tolInput.max = '20';
      tolInput.step = '0.5';
      tolInput.value = (state.tolerance * 100).toFixed(1); // display in cm
      tolInput.addEventListener('change', function () {
        const vCm = parseFloat(this.value);
        if (!isNaN(vCm) && vCm >= 0) {
          state.tolerance = vCm / 100; // convert cm → m for algorithm
        }
      });
    }

    // SKU table
    renderSkuTable();

    // Container recommendation
    renderContainerRecommendation();

    // Calculate button
    const btnCalc = $('btn-calculate');
    if (btnCalc) {
      btnCalc.onclick = startCalculation;
    }
  }

  function renderSkuTable() {
    const tableEl = $('sku-table');
    if (!tableEl) return;

    const items = state.items;
    if (!items || items.length === 0) {
      tableEl.innerHTML = '<div style="color:#999;">暂无货物数据</div>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#F5F0EB;">';
    html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #D4C5B9;">型号</th>';
    html += '<th style="padding:8px;text-align:right;border-bottom:2px solid #D4C5B9;">长(m)</th>';
    html += '<th style="padding:8px;text-align:right;border-bottom:2px solid #D4C5B9;">宽(m)</th>';
    html += '<th style="padding:8px;text-align:right;border-bottom:2px solid #D4C5B9;">高(m)</th>';
    html += '<th style="padding:8px;text-align:right;border-bottom:2px solid #D4C5B9;">数量</th>';
    html += '<th style="padding:8px;text-align:right;border-bottom:2px solid #D4C5B9;">单重(kg)</th>';
    html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #D4C5B9;">可叠放</th>';
    html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #D4C5B9;">仅可水平旋转</th>';
    html += '</tr></thead><tbody>';

    for (const item of items) {
      const override = state.skuOverrides[item.model] || {
        stackable: item.stackable !== false,
        orientationFixed: item.orientationFixed || false
      };
      const stackChecked = override.stackable ? ' checked' : '';
      const orientChecked = override.orientationFixed ? ' checked' : '';

      html += '<tr style="border-bottom:1px solid #E8DFD5;">';
      html += `<td style="padding:6px 8px;">${escapeHtml(item.model)}</td>`;
      html += `<td style="padding:6px 8px;text-align:right;">${item.l.toFixed(3)}</td>`;
      html += `<td style="padding:6px 8px;text-align:right;">${item.w.toFixed(3)}</td>`;
      html += `<td style="padding:6px 8px;text-align:right;">${item.h.toFixed(3)}</td>`;
      html += `<td style="padding:6px 8px;text-align:right;">${item.quantity}</td>`;
      html += `<td style="padding:6px 8px;text-align:right;">${(item.weight || 0).toFixed(0)}</td>`;
      html += `<td style="padding:6px 8px;text-align:center;">
        <input type="checkbox" data-model="${escapeAttr(item.model)}" class="sku-stackable"${stackChecked}
          style="accent-color:#8FA39B;width:16px;height:16px;cursor:pointer;"></td>`;
      html += `<td style="padding:6px 8px;text-align:center;">
        <input type="checkbox" data-model="${escapeAttr(item.model)}" class="sku-orientation-fixed"${orientChecked}
          style="accent-color:#C4827B;width:16px;height:16px;cursor:pointer;"></td>`;
      html += '</tr>';
    }

    html += '</tbody></table>';
    tableEl.innerHTML = html;

    // Attach checkbox listeners
    tableEl.querySelectorAll('.sku-stackable').forEach(cb => {
      cb.addEventListener('change', function () {
        const model = this.dataset.model;
        if (!state.skuOverrides[model]) {
          state.skuOverrides[model] = { stackable: true, orientationFixed: false };
        }
        state.skuOverrides[model].stackable = this.checked;
      });
    });

    tableEl.querySelectorAll('.sku-orientation-fixed').forEach(cb => {
      cb.addEventListener('change', function () {
        const model = this.dataset.model;
        if (!state.skuOverrides[model]) {
          state.skuOverrides[model] = { stackable: true, orientationFixed: false };
        }
        state.skuOverrides[model].orientationFixed = this.checked;
      });
    });
  }

  /**
   * 确保计算按钮存在，并根据状态启用/禁用
   */
  function ensureCalculateButton() {
    let btn = $('btn-calculate');
    if (!btn) {
      const step3 = $('step-3');
      if (!step3) return;
      btn = document.createElement('button');
      btn.id = 'btn-calculate';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'margin-top:20px;padding:14px 36px;font-size:16px;border-radius:12px;';
      btn.innerHTML = '📦 开始计算';
      btn.onclick = startCalculation;
      step3.appendChild(btn);
    }
    // 根据状态启用/禁用按钮
    const canCalculate = state.containerSpec || (state.useMixed && state.containerSpecs && state.containerSpecs.length > 0);
    btn.disabled = !canCalculate;
    btn.style.opacity = canCalculate ? '1' : '0.5';
    btn.style.cursor = canCalculate ? 'pointer' : 'not-allowed';
  }

  // ── 公共：渲染混合多选面板 ──
  function renderMixedPanel(preselectedCodes) {
    const allContainers = CDB.CONTAINER_LIST;
    let html = '<div id="mixed-panel" style="display:none;margin-top:8px;background:#F5F0EB;border:2px dashed #B8A89A;border-radius:12px;padding:16px;">';
    html += '<div style="font-weight:600;color:#3D3535;margin-bottom:8px;">选择组合箱型（可多选）：</div>';
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;" id="mixed-btn-group">';
    for (const c of allContainers) {
      const preselected = preselectedCodes && preselectedCodes.includes(c.code);
      html += `<button class="mixed-container-btn" data-code="${c.code}" data-selected="${preselected ? 'true' : 'false'}"
        style="margin:4px;padding:8px 14px;border:2px ${preselected ? 'solid' : 'dashed'} #B8A89A;border-radius:10px;
               background:${preselected ? '#8FA39B' : '#fff'};color:${preselected ? '#fff' : '#3D3535'};
               cursor:pointer;font-size:13px;transition:all 0.2s ease;">
        ${c.nameCN} (${c.code})<br><span style="font-size:11px;color:${preselected ? '#E0E8E3' : '#999'};">${c.L.toFixed(1)}×${c.W.toFixed(1)}×${c.H.toFixed(1)}m</span>
      </button>`;
    }
    html += '</div>';
    html += '<div id="mixed-selected-count" style="margin-top:6px;font-size:12px;color:#7A706B;">已选 ' + (preselectedCodes ? preselectedCodes.length : 0) + ' 种箱型</div>';
    html += '</div>';
    return html;
  }

  // ── 公共：绑定混合面板事件 ──
  function bindMixedPanelEvents(container) {
    const mixedBtns = container.querySelectorAll('.mixed-container-btn');
    const countEl = container.querySelector('#mixed-selected-count');
    if (mixedBtns.length === 0) return;

    function updateCount() {
      const selectedCodes = [];
      mixedBtns.forEach(b => {
        if (b.dataset.selected === 'true') selectedCodes.push(b.dataset.code);
      });
      if (countEl) countEl.textContent = '已选 ' + selectedCodes.length + ' 种箱型';

      if (selectedCodes.length > 0) {
        state.containerSpecs = selectedCodes.map(code => CDB.CONTAINER_DB[code]).filter(Boolean);
        state.containerSpec = state.containerSpecs[0];
        state.selectedContainerCode = state.containerSpecs[0].code;
      } else {
        state.containerSpecs = null;
        state.containerSpec = null;
        state.selectedContainerCode = null;
      }
    }

    mixedBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        if (!state.useMixed) return;
        const isSelected = this.dataset.selected === 'true';
        if (isSelected) {
          this.dataset.selected = 'false';
          this.style.background = '#fff';
          this.style.color = '#3D3535';
          this.style.borderStyle = 'dashed';
          const span = this.querySelector('span');
          if (span) span.style.color = '#999';
        } else {
          this.dataset.selected = 'true';
          this.style.background = '#8FA39B';
          this.style.color = '#fff';
          this.style.borderStyle = 'solid';
          const span = this.querySelector('span');
          if (span) span.style.color = '#E0E8E3';
        }
        updateCount();
      });
      btn.addEventListener('mouseenter', function () {
        if (this.dataset.selected !== 'true') {
          this.style.background = '#F5F0EB';
        }
      });
      btn.addEventListener('mouseleave', function () {
        if (this.dataset.selected !== 'true') {
          this.style.background = '#fff';
        }
      });
    });
    // 初始绑定时不覆盖 state.containerSpecs：
    // renderMixedRecommendation 已根据推荐方案设置好含重复箱型的 specs（如 1×40HQ + 9×40FR）。
    // 若立即 updateCount，多选面板会把重复代码去重为唯一箱型，导致丢失箱数。
    // 仅当用户主动点击时才按面板选择更新。
  }

  // ── 公共：混合复选框 HTML ──
  function getMixedCheckboxHtml() {
    return `<div style="margin-top:12px;border-top:1px solid #E8E0D8;padding-top:10px;">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#7A706B;">
        <input type="checkbox" id="use-mixed-checkbox" style="accent-color:#8FA39B;width:16px;height:16px;">
        🔄 启用混合装箱（多种箱型组合）
      </label>
    </div>`;
  }

  // ── 分支 B: 推荐失败 ──
  function renderFailedRecommendation(recEl, altEl) {
    const allContainers = CDB.CONTAINER_LIST;
    let manualHtml = '<div style="background:#FFF9E6;border:1px solid #E8D5A0;border-radius:12px;padding:16px;">';
    manualHtml += '<div style="font-weight:600;color:#8B7516;margin-bottom:8px;">⚠️ 自动推荐失败，请手动选择箱型：</div>';
    manualHtml += '<div style="display:flex;gap:6px;flex-wrap:wrap;" id="manual-btn-group">';
    for (const c of allContainers) {
      manualHtml += `<button class="manual-container-btn" data-code="${c.code}"
        style="margin:4px;padding:8px 14px;border:1px solid #D4C5B9;border-radius:10px;
               background:#fff;color:#3D3535;cursor:pointer;font-size:13px;
               transition:all 0.2s ease;">
        ${c.nameCN} (${c.code})<br><span style="font-size:11px;color:#999;">${c.L.toFixed(1)}×${c.W.toFixed(1)}×${c.H.toFixed(1)}m</span>
      </button>`;
    }
    manualHtml += '</div>';

    const failureReasons = CDB.analyzeRecommendationFailure(state.items, state.tolerance);
    if (failureReasons.length > 0) {
      manualHtml += `<div style="margin-top:10px;padding:10px;background:#FDEDEC;border:1px solid #E6B0AA;border-radius:10px;">
        <div style="font-weight:600;color:#943126;margin-bottom:6px;font-size:13px;">📋 失败原因分析：</div>
        ${failureReasons.map(r => `<div style="font-size:12px;color:#C4827B;padding:2px 0;">• ${r}</div>`).join('')}
      </div>`;
    }

    manualHtml += getMixedCheckboxHtml();
    manualHtml += renderMixedPanel([]);
    manualHtml += '</div>';
    recEl.innerHTML = manualHtml;
    altEl.innerHTML = '';

    const mixedCb = recEl.querySelector('#use-mixed-checkbox');
    const mixedPanel = recEl.querySelector('#mixed-panel');
    const manualBtns = recEl.querySelectorAll('.manual-container-btn');
    if (mixedCb && mixedPanel) {
      mixedCb.addEventListener('change', function () {
        state.useMixed = this.checked;
        if (this.checked) {
          mixedPanel.style.display = 'block';
          manualBtns.forEach(b => { b.style.background = '#fff'; b.style.color = '#3D3535'; });
          state.containerSpec = null;
          state.selectedContainerCode = null;
        } else {
          mixedPanel.style.display = 'none';
          state.containerSpecs = null;
        }
      });
    }

    bindMixedPanelEvents(recEl);

    manualBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        if (state.useMixed) return;
        const code = this.dataset.code;
        const spec = CDB.CONTAINER_DB[code];
        if (spec) {
          state.selectedContainerCode = code;
          state.containerSpec = spec;
          state.containerSpecs = null;
          manualBtns.forEach(b => { b.style.background = '#fff'; b.style.color = '#3D3535'; });
          this.style.background = '#8FA39B';
          this.style.color = '#fff';
          const existing = recEl.querySelector('.manual-selected-info');
          if (existing) existing.remove();
          const info = document.createElement('div');
          info.className = 'manual-selected-info';
          info.style.cssText = 'margin-top:10px;background:#E8F8F0;border:1px solid #A3D4B0;border-radius:10px;padding:12px;';
          info.innerHTML = `<div style="font-weight:600;color:#1E7E47;">📦 手动选择：${spec.nameCN}（${spec.code}）</div>
            <div style="font-size:13px;color:#3D3535;">内尺寸：${spec.L.toFixed(3)}×${spec.W.toFixed(3)}×${spec.H.toFixed(3)} m | 最大载重：${spec.payload} kg</div>
            <div style="font-size:12px;color:#7A706B;margin-top:4px;">已手动指定箱型，可点击"开始计算"</div>`;
          recEl.appendChild(info);
        }
      });
      btn.addEventListener('mouseenter', function () {
        if (state.useMixed) return;
        if (state.selectedContainerCode !== this.dataset.code) {
          this.style.background = '#F5F0EB';
        }
      });
      btn.addEventListener('mouseleave', function () {
        if (state.useMixed) return;
        if (state.selectedContainerCode !== this.dataset.code) {
          this.style.background = '#fff';
        }
      });
    });
  }

  // ── 分支 C: 自动混合推荐成功 ──
  function renderMixedRecommendation(mixedRec, recEl, altEl) {
    state.useMixed = true;
    state.containerSpecs = mixedRec.specs;
    state.containerSpec = mixedRec.specs[0];
    state.selectedContainerCode = mixedRec.specs[0].code;

    let mixedHtml = `<div style="background:#E8F8F0;border:1px solid #A3D4B0;border-radius:12px;padding:16px;">
      <div style="font-weight:600;color:#1E7E47;margin-bottom:4px;">
        🔄 已自动推荐混合装箱方案：${mixedRec.description}
      </div>
      <div style="font-size:13px;color:#3D3535;margin-bottom:4px;">
        共 ${mixedRec.specs.length} 个集装箱
      </div>
      <div style="font-size:12px;color:#7A706B;margin-top:6px;">${mixedRec.reasoning}</div>
      <div style="margin-top:8px;padding:8px;background:#FFF9E6;border:1px solid #E8D5A0;border-radius:8px;font-size:12px;color:#8B7516;">
        💡 单箱型无法满足您的货物需求，系统已自动切换为混合装箱模式。您也可以手动选择其他箱型。
      </div>
    </div>`;

    mixedHtml += getMixedCheckboxHtml();
    mixedHtml += renderMixedPanel(mixedRec.specs.map(s => s.code));
    recEl.innerHTML = mixedHtml;
    altEl.innerHTML = '';

    const mixedCb = recEl.querySelector('#use-mixed-checkbox');
    const mixedPanel = recEl.querySelector('#mixed-panel');
    if (mixedCb && mixedPanel) {
      mixedCb.checked = true;
      mixedPanel.style.display = 'block';
    }

    bindMixedPanelEvents(recEl);
  }

  // ── 分支 A: 自动推荐成功 ──
  function renderSingleRecommendation(recommendation, recEl, altEl) {
    state.selectedContainerCode = recommendation.primary.code;
    state.containerSpec = recommendation.primary;

    let recHtml = `<div id="rec-primary" style="background:#E8F8F0;border:1px solid #A3D4B0;border-radius:12px;padding:16px;">
      <div style="font-weight:600;color:#1E7E47;margin-bottom:4px;">
        📦 推荐箱型：${recommendation.primary.nameCN}（${recommendation.primary.code}）
      </div>
      <div style="font-size:13px;color:#3D3535;margin-bottom:4px;">
        内尺寸：${recommendation.primary.L.toFixed(3)}×${recommendation.primary.W.toFixed(3)}×${recommendation.primary.H.toFixed(3)} m
      </div>
      <div style="font-size:13px;color:#3D3535;margin-bottom:4px;">
        最大载重：${recommendation.primary.payload} kg | 容积：${recommendation.primary.volume.toFixed(2)} m³
      </div>
      <div style="font-size:12px;color:#7A706B;margin-top:6px;">${recommendation.reasoning}</div>
    </div>`;

    const mixedRec = CDB.recommendMixedContainers(state.items, state.tolerance);
    if (mixedRec && mixedRec.specs.length > 1) {
      recHtml += `<div style="margin-top:8px;background:#F0F5F8;border:1px solid #A8B6B1;border-radius:10px;padding:12px;opacity:0.8;">
        <div style="font-size:12px;color:#7A706B;">💡 也可考虑多箱组合：<strong>${mixedRec.description}</strong>（启用混合装箱可选）</div>
      </div>`;
    }

    recHtml += getMixedCheckboxHtml();
    recHtml += renderMixedPanel([recommendation.primary.code]);
    recEl.innerHTML = recHtml;

    if (recommendation.alternatives && recommendation.alternatives.length > 0) {
      let altHtml = '<div style="margin-top:8px;font-size:13px;color:#7A706B;">也可选用：</div>';
      for (const alt of recommendation.alternatives) {
        altHtml += `<button class="btn-alt-container" data-code="${alt.code}"
          style="margin:4px;padding:8px 14px;border:1px solid #D4C5B9;border-radius:10px;
                 background:#fff;color:#3D3535;cursor:pointer;font-size:13px;
                 transition:all 0.2s ease;">
          ${alt.nameCN} (${alt.code})
        </button>`;
      }
      altEl.innerHTML = altHtml;

      altEl.querySelectorAll('.btn-alt-container').forEach(btn => {
        btn.addEventListener('click', function () {
          if (state.useMixed) return;
          const code = this.dataset.code;
          const spec = CDB.CONTAINER_DB[code];
          if (spec) {
            state.selectedContainerCode = code;
            state.containerSpec = spec;
            state.containerSpecs = null;
            altEl.querySelectorAll('.btn-alt-container').forEach(b => {
              b.style.background = '#fff';
              b.style.color = '#3D3535';
            });
            this.style.background = '#8FA39B';
            this.style.color = '#fff';
          }
        });
        btn.addEventListener('mouseenter', function () {
          if (state.useMixed) return;
          if (state.selectedContainerCode !== this.dataset.code) {
            this.style.background = '#F5F0EB';
          }
        });
        btn.addEventListener('mouseleave', function () {
          if (state.useMixed) return;
          if (state.selectedContainerCode !== this.dataset.code) {
            this.style.background = '#fff';
          }
        });
      });
    } else {
      altEl.innerHTML = '';
    }

    const mixedCb2 = recEl.querySelector('#use-mixed-checkbox');
    const mixedPanel2 = recEl.querySelector('#mixed-panel');
    const recPrimary = recEl.querySelector('#rec-primary');
    if (mixedCb2 && mixedPanel2) {
      mixedCb2.addEventListener('change', function () {
        state.useMixed = this.checked;
        if (this.checked) {
          mixedPanel2.style.display = 'block';
          if (recPrimary) recPrimary.style.opacity = '0.5';
          altEl.querySelectorAll('.btn-alt-container').forEach(b => {
            b.style.pointerEvents = 'none';
            b.style.opacity = '0.5';
          });
        } else {
          mixedPanel2.style.display = 'none';
          state.containerSpecs = null;
          if (recPrimary) recPrimary.style.opacity = '1';
          altEl.querySelectorAll('.btn-alt-container').forEach(b => {
            b.style.pointerEvents = 'auto';
            b.style.opacity = '1';
          });
          state.containerSpec = recommendation.primary;
          state.selectedContainerCode = recommendation.primary.code;
        }
      });
    }

    bindMixedPanelEvents(recEl);
  }

  function renderContainerRecommendation() {
    const recEl = $('container-recommendation');
    const altEl = $('alternative-containers');
    if (!recEl || !altEl) return;

    // 仅在首次渲染且无用户选择时重置混合状态
    const hasUserSelection = state.containerSpec || state.containerSpecs || state.useMixed;
    if (!hasUserSelection) {
      state.useMixed = false;
      state.containerSpecs = null;
    }

    try {
      const recommendation = CDB.autoRecommend(state.items, state.tolerance);
      console.log('[renderContainerRecommendation] recommendation:', recommendation);

      if (!recommendation || recommendation.type === 'failed') {
        renderFailedRecommendation(recEl, altEl);
      } else if (recommendation.type === 'mixed') {
        renderMixedRecommendation(recommendation.mixed, recEl, altEl);
      } else {
        renderSingleRecommendation(recommendation, recEl, altEl);
      }

      ensureCalculateButton();
    } catch (err) {
      console.error('Container recommendation error:', err);
      recEl.innerHTML = '<div style="color:#C4827B;">箱型推荐出错：' + err.message + '</div>';
      altEl.innerHTML = '';
      ensureCalculateButton();
    }
  }

  // ═══════════════════════════════════════════
  // Step 3 → 4: Start Calculation
  // ═══════════════════════════════════════════
  function startCalculation() {
    // 防重复点击
    if (state._calculating) return;
    state._calculating = true;
    console.log('[startCalculation] state:', { containerSpec: state.containerSpec?.code, useMixed: state.useMixed, containerSpecs: state.containerSpecs?.length, items: state.items.length });
    try {
      if (!state.items || state.items.length === 0) {
        showError('没有货物数据，请先上传装箱单～ 🥛');
        state._calculating = false;
        return;
      }
      if (!state.containerSpec && !(state.useMixed && state.containerSpecs && state.containerSpecs.length > 0)) {
        showError('未选择集装箱类型，请返回上一步重新确认数据 🥛');
        state._calculating = false;
        return;
      }

      // Apply SKU overrides to items
      const itemsWithOverrides = state.items.map(item => {
        const override = state.skuOverrides[item.model];
        if (override) {
          return { ...item, stackable: override.stackable, orientationFixed: override.orientationFixed };
        }
        return item;
      });

      // Show progress
      showProgress('开始装箱计算…');

      // Simulate progress for ~2 seconds, then do actual calculation
      simulateProgress(2000, () => {
        try {
          // Show final progress stage
          showProgress('正在执行装箱算法…');
          updateProgress(95, '正在生成最终方案…');

          // 检测混合装箱模式
          const useMixed = state.useMixed && state.containerSpecs && state.containerSpecs.length > 0;
          const calcOptions = {
            tolerance: state.tolerance,
            autoRetry: true
          };
          if (useMixed) {
            calcOptions.mixedContainers = state.containerSpecs;
          }

          const containerSpecOrNull = useMixed ? null : state.containerSpec;
          if (!useMixed && !containerSpecOrNull) {
            hideProgress();
            state._calculating = false;
            showError('箱型规格丢失，请返回上一步重新确认 🥛');
            return;
          }

          const result = PE.calculate(
            itemsWithOverrides,
            containerSpecOrNull,
            calcOptions
          );

          state.packingResult = result;
          hideProgress();

          // Render Step 4
          renderStep4();
          showStep(4);
          state._calculating = false;

        } catch (calcErr) {
          hideProgress();
          state._calculating = false;
          console.error('Calculation error:', calcErr);
          showError('装箱计算失败：' + (calcErr.message || '未知错误') + '，请尝试调整参数 🥛');
        }
      });

    } catch (err) {
      hideProgress();
      state._calculating = false;
      console.error('Start calculation error:', err);
      showError('启动计算失败：' + (err.message || '未知错误') + ' 🥛');
    }
  }

  // ═══════════════════════════════════════════
  // Step 4: Results
  // ═══════════════════════════════════════════
  function renderStep4() {
    const result = state.packingResult;
    if (!result) return;

    // Summary cards
    renderResultSummary(result);

    // Container tabs
    renderContainerTabs(result);

    // Warnings / errors panel
    renderWarningsPanel(result);

    // 3D Viewer
    renderThreeViewer(result);

    // PDF Export button
    const btnExport = $('btn-export-pdf');
    if (btnExport) {
      btnExport.onclick = exportPdf;
    }
  }

  function renderResultSummary(result) {
    const el = $('result-summary');
    if (!el) return;

    const cards = [
      { label: '所需箱数', value: result.containerCount, unit: '个', color: '#8FA39B' },
      { label: '平均利用率', value: (result.avgUtilization * 100).toFixed(1), unit: '%', color: '#8B9E8B' },
      { label: '总装载重量', value: (result.totalWeightLoaded / 1000).toFixed(2), unit: '吨', color: '#B8A89A' },
      { label: '已装件数', value: result.totalPlaced, unit: '件', color: '#9C8B7D' }
    ];

    el.innerHTML = cards.map(c => `
      <div style="flex:1;min-width:120px;background:#fff;border-radius:16px;padding:18px 16px;
                  box-shadow:0 2px 8px rgba(0,0,0,0.05);text-align:center;
                  border-top:3px solid ${c.color};">
        <div style="font-size:12px;color:#7A706B;margin-bottom:4px;">${c.label}</div>
        <div style="font-size:24px;font-weight:700;color:${c.color};">
          ${c.value}<span style="font-size:14px;font-weight:400;margin-left:2px;">${c.unit}</span>
        </div>
      </div>
    `).join('');

    el.style.display = 'flex';
    el.style.gap = '12px';
    el.style.flexWrap = 'wrap';
  }

  function renderContainerTabs(result) {
    const el = $('container-tabs');
    if (!el) return;

    let html = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];
      const active = i === 0 ? ' style="background:#8FA39B;color:#fff;"' :
        ' style="background:#F5F0EB;color:#3D3535;"';
      const isFR = c.containerCode && c.containerCode.includes('FR');
      const effLabel = isFR && c.spaceEfficiency != null
        ? `${(c.spaceEfficiency * 100).toFixed(1)}%`
        : (c.utilization ? `${(c.utilization * 100).toFixed(1)}%` : 'N/A');
      html += `<button class="container-tab-btn" data-index="${i}"${active}>
        箱 ${i + 1} | ${effLabel}
      </button>`;
    }
    html += '</div>';

    // Container detail panel
    html += '<div id="container-detail" style="font-size:13px;color:#555;"></div>';

    el.innerHTML = html;

    // Update detail for first container
    updateContainerDetail(result, 0);

    // Attach tab click handlers
    el.querySelectorAll('.container-tab-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.index);

        // Update active styles
        el.querySelectorAll('.container-tab-btn').forEach(b => {
          b.style.background = '#F5F0EB';
          b.style.color = '#3D3535';
        });
        this.style.background = '#8FA39B';
        this.style.color = '#fff';

        // Update detail
        updateContainerDetail(result, idx);

        // Switch 3D viewer
        if (state.visualization && state.visualization.showContainer) {
          state.visualization.showContainer(idx);
        }
      });
    });
  }

  function updateContainerDetail(result, index) {
    const detailEl = $('container-detail');
    if (!detailEl) return;

    const c = result.containers[index];
    if (!c) return;

    const check = result.checks ? result.checks[index] : null;
    const errCount = check ? check.errors.length : 0;
    const warnCount = check ? check.warnings.length : 0;

    // Group items by model for summary
    const modelCounts = {};
    for (const item of c.placedItems) {
      modelCounts[item.model] = (modelCounts[item.model] || 0) + 1;
    }

    const isFR = c.containerCode && c.containerCode.includes('FR');
    const utilText = isFR && c.spaceEfficiency != null
      ? `空间效率 ${(c.spaceEfficiency * 100).toFixed(1)}%（标称利用率 ${(c.utilization * 100).toFixed(1)}%）`
      : `体积利用率 ${(c.utilization * 100).toFixed(1)}%`;

    detailEl.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
        <span><strong>箱型：</strong>${c.containerCode}</span>
        <span><strong>装载件数：</strong>${c.placedItems.length}</span>
        <span><strong>${utilText}</strong></span>
        <span><strong>载重利用率：</strong>${(c.weightUtil * 100).toFixed(1)}%</span>
        <span><strong>总重：</strong>${c.totalWeight.toFixed(0)} kg</span>
        ${errCount > 0 ? `<span style="color:#C4827B;">🔴 ${errCount} 错误</span>` : ''}
        ${warnCount > 0 ? `<span style="color:#D4A574;">⚠️ ${warnCount} 警告</span>` : ''}
      </div>
      <div style="margin-top:6px;font-size:12px;color:#999;">
        SKU分布：${Object.entries(modelCounts).map(([m, n]) => `${escapeHtml(m)}×${n}`).join(', ')}
      </div>
    `;
  }

  function renderWarningsPanel(result) {
    const el = $('warnings-panel');
    if (!el) return;

    const allErrors = [];
    const allWarnings = [];

    if (result.checks) {
      for (let i = 0; i < result.checks.length; i++) {
        const ch = result.checks[i];
        for (const err of ch.errors) {
          allErrors.push(`[箱${i + 1}] ${err.message}`);
          if (err.details) {
            for (const d of err.details) {
              allErrors.push(`  └ ${d}`);
            }
          }
        }
        for (const warn of ch.warnings) {
          allWarnings.push(`[箱${i + 1}] ${warn.message}`);
        }
      }
    }

    if (result.unplacedCount > 0) {
      allWarnings.push(`[未装载] ${result.unplacedCount} 件货物无法装入：${(result.unplacedItems || []).join(', ')}`);
    }

    if (allErrors.length === 0 && allWarnings.length === 0) {
      el.innerHTML = '<div style="color:#8B9E8B;font-size:13px;">✅ 无异常，所有货物完美装箱 ✨</div>';
      return;
    }

    let html = '';
    if (allErrors.length > 0) {
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="font-weight:600;color:#C4827B;margin-bottom:4px;">🔴 错误</div>';
      for (const e of allErrors) {
        html += `<div style="font-size:12px;color:#943126;padding:2px 0;">${escapeHtml(e)}</div>`;
      }
      html += '</div>';
    }

    if (allWarnings.length > 0) {
      html += '<div>';
      html += '<div style="font-weight:600;color:#D4A574;margin-bottom:4px;">⚠️ 警告</div>';
      for (const w of allWarnings) {
        html += `<div style="font-size:12px;color:#8B7516;padding:2px 0;">${escapeHtml(w)}</div>`;
      }
      html += '</div>';
    }

    el.innerHTML = html;
  }

  function renderThreeViewer(result) {
    const container = $('three-viewer-container');
    if (!container) return;

    // Ensure container has size
    if (!container.style.height || container.style.height === '0px') {
      container.style.height = '500px';
    }
    container.style.position = 'relative';

    try {
      const TV = getTV();
      if (!TV) {
        // ThreeViewer 尚未加载，显示占位并轮询重试
        container.innerHTML = '<div id="tv-waiting" style="color:#999;padding:40px;text-align:center;">3D 模块加载中，请稍后重试 ☕</div>';
        let retries = 0;
        const retryInterval = setInterval(() => {
          retries++;
          const tv = getTV();
          if (tv) {
            clearInterval(retryInterval);
            const waiting = container.querySelector('#tv-waiting');
            if (waiting) waiting.remove();
            state.visualization = tv.buildVisualization(result, 'three-viewer-container');
          } else if (retries > 20) {
            clearInterval(retryInterval);
            render2DFallback(result, container);
          }
        }, 500);
        return;
      }
      state.visualization = TV.buildVisualization(result, 'three-viewer-container');
    } catch (err) {
      console.error('3D viewer error:', err);
      container.innerHTML = '<div style="color:#999;padding:40px;text-align:center;">3D 视图加载失败：' + err.message + '</div>';
    }
  }

  // 2D 降级视图：当 Three.js ES module 无法加载时（如 file:// 协议）使用
  function render2DFallback(result, container) {
    const isFileProtocol = location.protocol === 'file:';
    const containers = result.containers || [];
    const totalW = container.clientWidth || 800;
    const padding = 16;
    const gap = 16;
    const cardW = Math.max(260, Math.min(360, Math.floor((totalW - padding * 2 - gap * (Math.max(1, containers.length) - 1)) / Math.max(1, containers.length))));
    const cardH = 320;

    let html = `<div style="padding:${padding}px;overflow:auto;">`;
    html += `<div style="background:#FFF9E6;border:1px solid #E8D5A0;border-radius:12px;padding:12px 16px;margin-bottom:16px;color:#8B7516;font-size:13px;">`;
    if (isFileProtocol) {
      html += `💡 <strong>file:// 协议限制了 3D 模块加载。</strong><br>建议用本地服务器打开以获得完整 3D 视图：<code style="background:#fff;padding:2px 6px;border-radius:4px;">python3 -m http.server 8080</code>`;
    } else {
      html += `💡 3D 模块加载超时，已切换为 2D 装载示意图。`;
    }
    html += `</div>`;
    html += `<div style="display:flex;gap:${gap}px;flex-wrap:wrap;">`;

    const colors = ['#B8A89A','#9C8B7D','#A8B6B1','#D4C5B9','#8FA39B','#C4B5A5','#BEAD98','#A9AFA9','#99A8A0','#CCBFB0'];

    containers.forEach((c, idx) => {
      const spec = CDB.CONTAINER_DB[c.containerCode] || { L: c.totalWeight ? 1 : 1, W: 1, H: 1 };
      const maxL = spec.L;
      const maxW = spec.W;
      const scale = Math.min((cardW - 40) / maxL, (cardH - 80) / maxW);
      const innerW = maxL * scale;
      const innerH = maxW * scale;

      html += `<div style="width:${cardW}px;background:#fff;border-radius:16px;padding:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">`;
      html += `<div style="font-weight:600;color:#3D3535;margin-bottom:8px;">箱 ${idx + 1} · ${c.containerCode}</div>`;
      html += `<div style="position:relative;width:${innerW}px;height:${innerH}px;background:#F5F0EB;border:2px solid #B8A89A;margin:0 auto;border-radius:4px;">`;

      (c.placedItems || []).forEach((item, i) => {
        const ix = item.x * scale;
        const iy = item.y * scale;
        const iw = item.l * scale;
        const ih = item.w * scale;
        const color = colors[i % colors.length];
        html += `<div style="position:absolute;left:${ix}px;top:${iy}px;width:${iw}px;height:${ih}px;background:${color};border:1px solid rgba(255,255,255,0.6);box-sizing:border-box;font-size:9px;color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;" title="${escapeHtml(String(item.model))}">${escapeHtml(String(item.model))}</div>`;
      });

      html += `</div>`;
      html += `<div style="margin-top:8px;font-size:12px;color:#7A706B;text-align:center;">`;
      html += `装载 ${c.placedItems.length} 件 · 利用率 ${((c.utilization || 0) * 100).toFixed(1)}%`;
      html += `</div>`;
      html += `</div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;
    state.visualization = null; // 2D 视图不支持截图/PDF导出中的 3D 图
  }

  // ═══════════════════════════════════════════
  // PDF Export
  // ═══════════════════════════════════════════
  async function exportPdf() {
    try {
      if (!state.packingResult) {
        showError('没有装箱结果，请先计算 🥛');
        return;
      }

      if (window.TauriBridge && window.TauriBridge.isTauri) {
        PDFX.setSaveHandler(async (fileName, uint8Array) => {
          const saved = await window.TauriBridge.savePdfFile(fileName, uint8Array);
          if (saved) showSuccess('PDF 已保存 🥛');
        });
      }

      await PDFX.generateReport(state.packingResult, state.visualization);

      // 清除一次性处理器，避免影响后续浏览器导出
      if (window.TauriBridge && window.TauriBridge.isTauri) {
        PDFX.setSaveHandler(null);
      }
    } catch (err) {
      console.error('PDF export error:', err);
      showError('PDF 导出失败：' + (err.message || '未知错误') + ' 🥛');
    }
  }

  // ═══════════════════════════════════════════
  // Navigation: step buttons
  // ═══════════════════════════════════════════
  function initNavigation() {
    // Back buttons in steps 2-4
    for (let step = 2; step <= 4; step++) {
      const backBtn = document.querySelector(`#step-${step} .btn-back`);
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          showStep(step - 1);
        });
      }
    }

    // Step 2 "重新上传" button
    const reuploadBtn = document.querySelector('#step-2 .btn-reupload');
    if (reuploadBtn) {
      reuploadBtn.addEventListener('click', () => {
        // Reset state
        state.fileData = null;
        state.fileName = '';
        state.parsedResult = null;
        state.dataRows = null;
        state.items = [];
        state.containerSpec = null;
        state.containerSpecs = null;
        state.useMixed = false;
        state.tolerance = 0.05;
        state.selectedUnit = 'cm';
        state.selectedContainerCode = null;
        state.packingResult = null;
        state.visualization = null;
        state.columnMapping = [];
        state.multiSizeDecisions = {};
        state.skuOverrides = {};

        // 清理 3D 视图，避免旧场景干扰新导入
        const TV = getTV();
        if (TV && typeof TV.disposeAll === 'function') {
          TV.disposeAll();
        }

        // 清空结果容器
        const resultContainer = $('resultContainer');
        if (resultContainer) resultContainer.innerHTML = '';

        showStep(1);

        // Reset file input（克隆以彻底重置，解决 WebView 中 change 事件不触发的问题）
        const fileInput = $('fileInput');
        if (fileInput) {
          const newInput = fileInput.cloneNode(true);
          fileInput.parentNode.replaceChild(newInput, fileInput);
          // 重新绑定 change 事件，因为克隆节点不带旧监听器
          newInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleFileUpload(file);
          });
        }
      });
    }

    // Step 3 "重新确认数据" button
    const reconfigBtn = document.querySelector('#step-3 .btn-reconfig');
    if (reconfigBtn) {
      reconfigBtn.addEventListener('click', () => {
        showStep(2);
      });
    }

    // Step 4 "重新计算" button
    const recalcBtn = document.querySelector('#step-4 .btn-recalc');
    if (recalcBtn) {
      recalcBtn.addEventListener('click', () => {
        showStep(3);
      });
    }
  }

  // ═══════════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════════
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/["&<>]/g, function (c) {
      switch (c) {
        case '"': return '&quot;';
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        default: return c;
      }
    });
  }

  // ═══════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════
  function init() {
    // Show Step 1 only
    showStep(1);

    // Init file upload handlers
    initStep1();

    // Init navigation
    initNavigation();

    // Hide progress bar initially
    hideProgress();

    console.log('📦 Container Loading Simulator — ready ✨');
  }

  // ═══════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════
  window.App = {
    init,
    showStep,
    handleFileUpload,
    getState: () => state,
    // Exposed for debugging / external control
    goToStep: showStep,
    resetState() {
      state.fileData = null;
      state.fileName = '';
      state.parsedResult = null;
      state.dataRows = null;
      state.items = [];
      state.containerSpec = null;
      state.containerSpecs = null;
      state.useMixed = false;
      state.tolerance = 0.05;
      state.selectedContainerCode = null;
      state.packingResult = null;
      state.visualization = null;
      state.currentStep = 1;
      state.columnMapping = [];
      state.multiSizeDecisions = {};
      state.selectedUnit = 'cm';
      state.skuOverrides = {};
      state._calculating = false;
      showStep(1);
    }
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ═══════════════════════════════════════════════════════════
     Theme Switcher & Global Micro-interactions
     ═══════════════════════════════════════════════════════════ */
  function initThemeSwitcher() {
    const themeBtns = document.querySelectorAll('.theme-btn');
    if (!themeBtns.length) return;

    themeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        document.documentElement.setAttribute('data-theme', theme);
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        try { localStorage.setItem('cls-theme', theme); } catch (e) {}
      });
    });

    let saved = 'light';
    try { saved = localStorage.getItem('cls-theme') || 'light'; } catch (e) {}
    document.documentElement.setAttribute('data-theme', saved);
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.theme === saved));
  }

  function initButtonRipples() {
    document.querySelectorAll('.btn-primary, .btn-secondary, .btn-export, .btn-ghost, .theme-btn, .container-tabs__btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        btn.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
        btn.style.setProperty('--my', ((e.clientY - rect.top) / rect.height * 100) + '%');
      });

      btn.addEventListener('click', function (e) {
        if (this.disabled) return;
        const rect = this.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        const size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initThemeSwitcher();
      initButtonRipples();
    });
  } else {
    initThemeSwitcher();
    initButtonRipples();
  }
})();