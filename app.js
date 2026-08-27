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
  // A 方向：单箱型尾货低利用率阈值（百分数口径，与 lastUtilPct 同单位）——
  // 末箱体积利用率低于该百分比视为「小体积尾货残留」，触发混合装箱建议
  const TAIL_LOW_UTIL_THRESHOLD_PCT = 35;
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
    skuOverrides: {},         // { model: { stackable, orientationFixed } }
    // Manual entry state
    manualItems: []           // manually entered cargo items
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
    ignore: '忽略',
    combinedDimension: '组合尺寸',
    possibleDimension: '可能尺寸',
    unknown: '忽略'
  };

  const LABEL_TO_FIELD = {
    '型号': 'model',
    '长': 'length',
    '宽': 'width',
    '高': 'height',
    '数量': 'quantity',
    '毛重': 'grossWeight',
    '净重': 'netWeight',
    '体积': 'volume',
    '描述': 'description',
    '可叠放': 'stackable',
    '组合尺寸': 'combinedDimension',
    '可能尺寸': 'possibleDimension',
    '忽略': 'ignore'
  };

  const DROPDOWN_OPTIONS = ['型号', '长', '宽', '高', '组合尺寸', '可能尺寸', '数量', '毛重', '净重', '体积', '描述', '可叠放', '忽略'];

  // ═══════════════════════════════════════════
  // DOM references (lazy — grabbed on init)
  // ═══════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  // ═══════════════════════════════════════════
  // Step navigation
  // ═══════════════════════════════════════════
  function showStep(step) {
    state.currentStep = step;
    // app#6 竞态防护：离开计算流程（目标非 Step4）且计算仍在途时作废之——
    // 递增 generation + 取消 setTimeout，防止旧计算完成后 renderStep4/showStep(4) 强拉用户。
    // Step4 是计算完成的目标步，不在此列；正常完成路径不受影响。
    if (step !== 4 && state._calculating) {
      calcGeneration++;
      if (activeCalcHandle) { activeCalcHandle.cancel(); activeCalcHandle = null; }
      state._calculating = false;
    }
    for (let i = 1; i <= 4; i++) {
      const el = $(`step-${i}`);
      if (el) {
        if (i === step) {
          el.classList.remove('hidden');
          el.classList.remove('step-enter');
          // 触发重排以重启动画
          void el.offsetWidth;
          el.classList.add('step-enter');
        } else {
          el.classList.add('hidden');
          el.classList.remove('step-enter');
        }
      }
    }
    updateStepIndicators(step);

    // 回到 Step 1 时刷新手动录入列表
    if (step === 1) {
      renderManualList();
      updateManualCalcButton();
    }
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
    document.querySelectorAll('[data-context-step]').forEach(panel => {
      panel.classList.toggle('context-panel--active', Number(panel.dataset.contextStep) === activeStep);
    });
    const status = document.getElementById('workspace-status');
    if (status) {
      status.textContent = ['准备导入', '确认数据', '配置方案', '结果检查'][activeStep - 1] || '工作区';
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
    },
    warning: {
      bg: '#FFF9E6', border: '#E8D5A0', color: '#8B7516', icon: '⚠️',
      className: 'alert-warning'
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
    alert.className = style.className + ' alert-enter';
    alert.style.cssText =
      `background:${style.bg};border:1px solid ${style.border};border-radius:12px;` +
      `padding:12px 16px;color:${style.color};font-size:13px;margin-bottom:16px;`;
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
  // 注：showProgress/updateProgress 已删除（无调用点，死代码）；hideProgress 仍有调用点，保留。
  function hideProgress() {
    const bar = $('progress-bar');
    const txt = $('progress-text');
    const status = $('calculation-status');
    if (bar) { bar.style.display = 'none'; bar.classList.remove('progress--indeterminate'); }
    if (txt) txt.style.display = 'none';
    if (status) status.style.display = 'none';
  }

  // 在途计算控制（app#6 竞态防护）：
  // calcGeneration 每次作废（resetState / 离开计算流程）递增，旧回调校验失败即放弃执行；
  // activeCalcHandle 持有 simulateProgress 的取消句柄，可提前清除未触发的 setTimeout。
  let calcGeneration = 0;
  let activeCalcHandle = null;
  // app#11：推荐预演防串台——连续触发多次预演时，仅最后一次结果生效（与 calcGeneration 同理）。
  let recSimToken = 0;
  let recommendationWorker = null;
  let recommendationWorkerRequestId = 0;

  function getRecommendationWorker() {
    if (typeof Worker === 'undefined') return null;
    if (!recommendationWorker) {
      try {
        recommendationWorker = new Worker('recommendation-worker.js');
      } catch (error) {
        console.warn('[refreshContainerRecommendation] Worker unavailable:', error.message);
        return null;
      }
    }
    return recommendationWorker;
  }

  function cancelRecommendationWorker() {
    if (recommendationWorker) {
      recommendationWorker.terminate();
      recommendationWorker = null;
    }
  }

  /**
   * Simulate progress while synchronous calculation runs.
   * Uses setTimeout chains to yield to the browser between ticks.
   * Returns a cancel handle so callers can void the pending callback.
   */
  // P1-D：等待期阶段文案轮播（解析→预演→计算→自检），给 indeterminate 进度条注入生命感
  const CALC_PHASES = [
    '📋 解析货物数据…',
    '🔮 推荐箱型预演中…',
    '⚙️ EMS 装箱计算…',
    '🔍 承重与边界自检…'
  ];
  function simulateProgress(_durationMs, onDone) {
    // Indeterminate 脉冲进度条，不显示虚假百分比
    const bar = $('progress-bar');
    if (bar) {
      bar.style.display = 'block';
      bar.classList.add('progress--indeterminate');
    }
    const status = $('progress-text');
    let phaseTimer = null;
    if (status) {
      status.style.display = 'block';
      let phaseIdx = 0;
      status.textContent = CALC_PHASES[0];
      phaseTimer = setInterval(() => {
        phaseIdx = (phaseIdx + 1) % CALC_PHASES.length;
        status.textContent = CALC_PHASES[phaseIdx];
      }, 900);
    }

    // 延迟启动真实计算，确保 UI 渲染；返回可取消句柄供作废
    let handle = null;
    const timeoutId = setTimeout(() => {
      if (phaseTimer) clearInterval(phaseTimer);
      // callback fired, handle is stale - drop the reference so future invalidation is clean
      if (activeCalcHandle === handle) activeCalcHandle = null;
      if (onDone) onDone();
    }, 100);

    handle = {
      cancel() {
        if (phaseTimer) clearInterval(phaseTimer);
        clearTimeout(timeoutId);
      }
    };
    return handle;
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
          const picked = await window.TauriBridge.pickExcelFileRead();
          if (!picked || !picked.bytes) {
            showError('文件读取失败，请重试～ 🥛');
            return;
          }
          // 安全转换：使用 slice 避免共享 ArrayBuffer 导致的多余字节
          const arrayBuffer = new Uint8Array(picked.bytes).slice().buffer;
          processFileBuffer(arrayBuffer, picked.name || '未命名文件');
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
      // 防御性检查：某些环境（如 Tauri WebView）下 dataTransfer 可能为 null
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      const file = dt.files[0];
      if (file) handleFileUpload(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFileUpload(file);
    });

    initManualEntry();
  }

  // ═══════════════════════════════════════════
  // Step 1: Manual Cargo Entry
  // ═══════════════════════════════════════════
  function initManualEntry() {
    const btnAdd = $('btn-add-manual');
    const btnCalc = $('btn-manual-calc');
    if (!btnAdd || !btnCalc) return;

    btnAdd.addEventListener('click', addManualItem);
    btnCalc.addEventListener('click', startCalculationFromManual);

    const inputs = ['manual-model', 'manual-length', 'manual-width', 'manual-height', 'manual-volume', 'manual-weight'];
    inputs.forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', updateManualCalcButton);
    });

    renderManualList();
  }

  function getManualInputs() {
    const model = ($('manual-model').value || '').trim();
    const quantity = parseInt($('manual-quantity').value, 10);
    const l = parseFloat($('manual-length').value);
    const w = parseFloat($('manual-width').value);
    const h = parseFloat($('manual-height').value);
    const volume = parseFloat($('manual-volume').value);
    const weight = parseFloat($('manual-weight').value);
    const stackable = $('manual-stackable').checked;
    return { model, quantity, l, w, h, volume, weight, stackable };
  }

  function clearManualInputs() {
    $('manual-model').value = '';
    $('manual-quantity').value = '1';
    $('manual-length').value = '';
    $('manual-width').value = '';
    $('manual-height').value = '';
    $('manual-volume').value = '';
    $('manual-weight').value = '';
    $('manual-stackable').checked = true;
    updateManualCalcButton();
  }

  function validateManualItem(inputs) {
    const errors = [];
    if (!inputs.model) errors.push('请填写型号');
    if (!Number.isFinite(inputs.quantity) || inputs.quantity < 1 || !Number.isInteger(inputs.quantity)) {
      errors.push('数量必须为正整数');
    }

    const hasDims = Number.isFinite(inputs.l) && Number.isFinite(inputs.w) && Number.isFinite(inputs.h) &&
                    inputs.l > 0 && inputs.w > 0 && inputs.h > 0;
    const hasVolume = Number.isFinite(inputs.volume) && inputs.volume > 0;

    if (!hasDims && !hasVolume) {
      errors.push('请填写长/宽/高，或填写体积');
    }

    if (!Number.isFinite(inputs.weight) || inputs.weight <= 0) {
      errors.push('请填写毛重（须大于0）');
    }

    return errors;
  }

  function buildManualItem(inputs) {
    const hasDims = Number.isFinite(inputs.l) && Number.isFinite(inputs.w) && Number.isFinite(inputs.h) &&
                    inputs.l > 0 && inputs.w > 0 && inputs.h > 0;
    let l = inputs.l, w = inputs.w, h = inputs.h;

    if (!hasDims && inputs.volume > 0) {
      // 仅提供体积时，按立方体估算长宽高
      const side = Math.cbrt(inputs.volume);
      l = w = h = side;
    }

    return {
      model: inputs.model,
      l,
      w,
      h,
      quantity: inputs.quantity,
      weight: inputs.weight,
      stackable: inputs.stackable,
      orientationFixed: false,
      volume: l * w * h,
      colorIndex: state.manualItems.length      // 按录入顺序分配颜色，3D视图中轮换莫兰迪色板
    };
  }

  function addManualItem() {
    const inputs = getManualInputs();
    const errors = validateManualItem(inputs);
    if (errors.length > 0) {
      showError(errors.join(' · ') + ' 🥛');
      return;
    }

    const item = buildManualItem(inputs);
    state.manualItems.push(item);
    renderManualList();
    clearManualInputs();
    showSuccess(`已添加 ${item.model} ×${item.quantity} 🥛`);
  }

  function removeManualItem(index) {
    state.manualItems.splice(index, 1);
    renderManualList();
    updateManualCalcButton();
  }

  function renderManualList() {
    const listEl = $('manualList');
    if (!listEl) return;

    if (state.manualItems.length === 0) {
      listEl.innerHTML = '';
      return;
    }

    let html = '';
    state.manualItems.forEach((item, idx) => {
      html += `
        <div class="manual-entry__item">
          <span>${escapeHtml(item.model)} ×${item.quantity} · ${item.l.toFixed(2)}×${item.w.toFixed(2)}×${item.h.toFixed(2)} m · ${item.weight.toFixed(1)} kg</span>
          <button type="button" data-idx="${idx}">删除</button>
        </div>
      `;
    });
    listEl.innerHTML = html;

    listEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => removeManualItem(parseInt(btn.dataset.idx, 10)));
    });
  }

  function updateManualCalcButton() {
    const btn = $('btn-manual-calc');
    if (!btn) return;
    btn.disabled = state.manualItems.length === 0;
  }

  function startCalculationFromManual() {
    if (state.manualItems.length === 0) {
      showError('请至少添加一件货物 🥛');
      return;
    }

    state.fileName = '手动录入';
    state.fileData = null;
    state.parsedResult = null;
    state.dataRows = null;
    state.items = state.manualItems.map(i => ({ ...i }));
    state.selectedUnit = 'm';

    // 清除可能残留的混合/推荐状态，防止手动货物被旧箱型（或旧混合方案）计算
    state.useMixed = false;
    state.containerSpecs = null;
    state.containerSpec = null;
    state.selectedContainerCode = null;
    state.packingResult = null;
    state.visualization = null;
    // tolerance 保持用户设置（不重置）

    state.skuOverrides = {};
    for (const item of state.items) {
      state.skuOverrides[item.model] = {
        stackable: item.stackable !== false,
        orientationFixed: item.orientationFixed || false
      };
    }

    renderStep3();
    showStep(3);
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
    // 与 field-parser 的 COMBINED_DIM_PATTERN 保持一致
    const COMBINED_DIM_RE = /^([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)$/;
    for (const row of dataRows) {
      for (const idx of dimIndices) {
        const v = row[idx];
        if (v != null && v !== '') {
          const rawStr = String(v).trim();
          // 组合尺寸列（如 "1.2X1.5X1.8"、"5.7*4.3*4.29"）：先按分隔符拆分，
          // 各维度分别采样。直接 normalizeNumber 会得到 NaN（或假数值），
          // 导致单位被误判为 cm，与 field-parser 拆分为 m 不一致。
          if (/[×xX*]/.test(rawStr)) {
            const cleaned = rawStr
              .replace(/(\d)\s+\.\s*(\d)/g, '$1.$2')
              .replace(/\.\s+(\d)/g, '.$1');
            const m = cleaned.match(COMBINED_DIM_RE);
            if (m) {
              for (let k = 1; k <= 3; k++) {
                const n = parseFloat(m[k]);
                if (!isNaN(n) && n > 0) dimValues.push(n);
              }
              continue;
            }
          }
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
      // app#8：currentLabel 必须真实反映实际字段且一定出现在下拉选项中。
      // 若映射表/选项表缺项（如历史上 netWeight 无 '净重' 选项），动态补充该标签，
      // 避免无 selected 时浏览器默认显示首项"型号"造成"显示型号、实为净重"的语义漂移。
      const fieldLabel = FIELD_TO_LABEL[m.field];
      const mappingOptions = fieldLabel && !DROPDOWN_OPTIONS.includes(fieldLabel)
        ? DROPDOWN_OPTIONS.concat([fieldLabel])
        : DROPDOWN_OPTIONS;
      const currentLabel = fieldLabel || '忽略';
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
          ${mappingOptions.map(opt => {
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
        // 单位变更后重新提取数据并刷新预览
        refreshPreviewForUnitChange();
      });
    }
  }

  /**
   * 单位选择器变更后，用新单位重新提取数据并刷新预览表。
   * 数据始终以米 (m) 为标准单位存储，表头动态标注源单位。
   */
  function refreshPreviewForUnitChange() {
    if (!state.parsedResult || !state.dataRows || !state.columnMapping) return;
    try {
      const newMapping = state.columnMapping.map(m => ({
        field: m.field === 'ignore' ? 'unknown' : m.field
      }));
      const result = FP.reExtract(state.dataRows, state.parsedResult.headerRow, newMapping, state.selectedUnit);
      state.parsedResult.items = result.items;
      renderDataPreview(state.parsedResult);
    } catch (err) {
      console.error('[Unit refresh] reExtract failed:', err);
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

    // 源单位 → 标准单位 (m) 的动态标注
    const srcUnit = state.selectedUnit || 'mm';
    const unitNote = srcUnit === 'm' ? '' : `（源: ${srcUnit} → m）`;

    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<thead><tr style="background:#F5F0EB;">';
    html += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #D4C5B9;">#</th>';
    html += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #D4C5B9;">型号</th>';
    html += `<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">长(m)${unitNote}</th>`;
    html += `<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">宽(m)${unitNote}</th>`;
    html += `<th style="padding:6px 8px;text-align:right;border-bottom:2px solid #D4C5B9;">高(m)${unitNote}</th>`;
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
      // app#10：收集"合并单重差异显著"的警示，确认完成后统一提示
      const mergeWeightWarnings = [];

      for (const [model, info] of Object.entries(multiSize)) {
        const selectedIdx = state.multiSizeDecisions[model] || 0;
        const selectedGroup = info.groups[selectedIdx];
        if (selectedGroup) {
          // Use selected dimensions for all items of this model
          const modelItems = result.items.filter(i => i.model === model);
          const totalQty = modelItems.reduce((s, i) => s + (i.quantity || 1), 0);
          // app#10：同型号多尺寸组合并单重 = 数量加权平均（Σ(组数量×组单重)/Σ组数量）。
          // weight=0（缺失）的行不参与加权（避免把未知重量拉低成 0 附近的假值），
          // 但数量仍计入总件数。各组单重差异显著（最大/最小 > 1.5 倍）时推 warning。
          const weightGroups = modelItems
            .filter(i => i.weight > 0)
            .map(i => ({ qty: i.quantity || 1, weight: i.weight }));
          const weightedTotalQty = weightGroups.reduce((s, g) => s + g.qty, 0);
          const mergedWeight = weightedTotalQty > 0
            ? weightGroups.reduce((s, g) => s + g.qty * g.weight, 0) / weightedTotalQty
            : 0;
          if (weightGroups.length >= 2) {
            const gw = weightGroups.map(g => g.weight);
            const maxW = Math.max(...gw);
            const minW = Math.min(...gw);
            if (minW > 0 && maxW / minW > 1.5) {
              mergeWeightWarnings.push(
                `SKU「${model}」合并单重 ${mergedWeight.toFixed(3)} kg 为 ${weightGroups.length} 组尺寸的数量加权平均，` +
                `各组单重差异显著（${minW}~${maxW} kg，最大/最小 = ${(maxW / minW).toFixed(1)} 倍），请确认数据无误～ 🥛`
              );
            }
          }

          // Preserve stackable/orientationFixed from first item
          const firstItem = modelItems[0] || {};
          mergedItems.push({
            model,
            l: selectedGroup.l,
            w: selectedGroup.w,
            h: selectedGroup.h,
            quantity: totalQty,
            weight: Math.round(mergedWeight * 1000) / 1000,
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

      // app#10：单重显著差异警示——写入数据层 warnings（供后续展示），
      // 并在 Step 3 顶部给出立即可见的提示（warning 样式常驻，不自动消失）。
      if (mergeWeightWarnings.length > 0) {
        state.parsedResult.warnings = (state.parsedResult.warnings || []).concat(mergeWeightWarnings);
        createAlert('warning', mergeWeightWarnings.join('；'), '#step-3', { autoDismiss: false });
      }

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
      // app#19：动态创建的按钮同样绑定涟漪效果（函数声明提升，此处可安全调用）
      applyButtonRipple(btn);
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

  // ── 公共：绑定手动单箱型选择按钮 ──
  function bindManualContainerButtons(container) {
    const manualBtns = container.querySelectorAll('.manual-container-btn');
    if (manualBtns.length === 0) return;

    manualBtns.forEach(btn => {
      btn.addEventListener('click', function () {
        const code = this.dataset.code;
        const spec = CDB.CONTAINER_DB[code];
        if (!spec) return;

        // 点击任意手动箱型时，强制退出混合模式并选中该箱型
        if (state.useMixed) {
          state.useMixed = false;
          state.containerSpecs = null;
          const mixedCb = container.querySelector('#use-mixed-checkbox');
          const mixedPanel = container.querySelector('#mixed-panel');
          if (mixedCb) mixedCb.checked = false;
          if (mixedPanel) mixedPanel.style.display = 'none';
        }

        state.selectedContainerCode = code;
        state.containerSpec = spec;
        state.containerSpecs = null;
        manualBtns.forEach(b => { b.style.background = '#fff'; b.style.color = '#3D3535'; });
        this.style.background = '#8FA39B';
        this.style.color = '#fff';
        const existing = container.querySelector('.manual-selected-info');
        if (existing) existing.remove();
        const info = document.createElement('div');
        info.className = 'manual-selected-info';
        info.style.cssText = 'margin-top:10px;background:#E8F8F0;border:1px solid #A3D4B0;border-radius:10px;padding:12px;';
        info.innerHTML = `<div style="font-weight:600;color:#1E7E47;">📦 手动选择：${spec.nameCN}（${spec.code}）</div>
          <div style="font-size:13px;color:#3D3535;">内尺寸：${spec.L.toFixed(3)}×${spec.W.toFixed(3)}×${spec.H.toFixed(3)} m | 最大载重：${spec.payload} kg</div>
          <div style="font-size:12px;color:#7A706B;margin-top:4px;">已手动指定箱型，可点击"开始计算"</div>`;
        container.appendChild(info);
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
    // 推荐失败时清空旧的箱型选择，防止新货物静默沿用旧 containerSpec 计算；
    // 调用链后方的 ensureCalculateButton() 会依据清空后的状态禁用计算按钮
    state.containerSpec = null;
    state.selectedContainerCode = null;
    state.containerSpecs = null;
    state.useMixed = false;

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
          refreshContainerRecommendation();
        } else {
          mixedPanel.style.display = 'none';
          state.containerSpecs = null;
          // 取消混合时保留手动单箱型按钮，不重刷推荐（避免被重新设为混合）
        }
      });
    }

    bindMixedPanelEvents(recEl);
    bindManualContainerButtons(recEl);
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
        共推荐 ${mixedRec.specs.length} 个集装箱（实际装箱时可能更少）
      </div>
      <div style="font-size:12px;color:#7A706B;margin-top:6px;">${mixedRec.reasoning}</div>
      <div style="margin-top:8px;padding:8px;background:#FFF9E6;border:1px solid #E8D5A0;border-radius:8px;font-size:12px;color:#8B7516;">
        💡 单箱型无法满足您的货物需求，系统已自动切换为混合装箱模式。您也可以手动选择其他箱型。
      </div>
    </div>`;

    mixedHtml += getMixedCheckboxHtml();
    mixedHtml += renderMixedPanel(mixedRec.specs.map(s => s.code));

    // 同时提供单箱型手动选择入口，点击后退出混合模式
    mixedHtml += '<div style="margin-top:14px;border-top:1px solid #E8E0D8;padding-top:12px;">';
    mixedHtml += '<div style="font-weight:600;color:#3D3535;margin-bottom:8px;font-size:13px;">📦 或手动指定单箱型：</div>';
    mixedHtml += '<div style="display:flex;gap:6px;flex-wrap:wrap;" id="manual-btn-group">';
    for (const c of CDB.CONTAINER_LIST) {
      mixedHtml += `<button class="manual-container-btn" data-code="${c.code}"
        style="margin:4px;padding:8px 14px;border:1px solid #D4C5B9;border-radius:10px;
               background:#fff;color:#3D3535;cursor:pointer;font-size:13px;
               transition:all 0.2s ease;">
        ${c.nameCN} (${c.code})
      </button>`;
    }
    mixedHtml += '</div></div>';

    recEl.innerHTML = mixedHtml;
    altEl.innerHTML = '';

    const mixedCb = recEl.querySelector('#use-mixed-checkbox');
    const mixedPanel = recEl.querySelector('#mixed-panel');
    if (mixedCb && mixedPanel) {
      mixedCb.checked = true;
      mixedPanel.style.display = 'block';
      mixedCb.addEventListener('change', function () {
        state.useMixed = this.checked;
        if (this.checked) {
          mixedPanel.style.display = 'block';
          refreshContainerRecommendation();
        } else {
          mixedPanel.style.display = 'none';
          state.containerSpecs = null;
          // 取消混合时保留手动单箱型按钮，不重刷推荐（避免被重新设为混合）
        }
      });
    }

    bindMixedPanelEvents(recEl);
    bindManualContainerButtons(recEl);
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

  function refreshContainerRecommendation() {
    const recEl = $('container-recommendation');
    const altEl = $('alternative-containers');
    if (!recEl || !altEl) return;

    // 每次刷新都作废已排队的预演回调；否则同步刷新路径可能被旧结果覆盖。
    const refreshToken = ++recSimToken;
    cancelRecommendationWorker();

    try {
      const recommendation = CDB.autoRecommend(state.items, state.tolerance);
      console.debug('[refreshContainerRecommendation] recommendation:', recommendation);

      // 实际装箱预演：autoRecommend 只看单件适配，不验证真实箱数。
      // 对 primary + alternatives 跑多起点装箱，若某替代箱实际箱数更少（如 20FR×3 vs 40FR×1），
      // 提升该箱型为推荐，并在 reasoning 中说明预演依据。
      if (recommendation && recommendation.type === 'single' && state.items && state.items.length > 0) {
        const candidates = [recommendation.primary];
        if (recommendation.alternatives && recommendation.alternatives.length > 0) {
          candidates.push(...recommendation.alternatives);
        }
        // 只对"单件适配但可能多箱"的场景做预演：货物数量 ≥2 时才值得比较
        const totalQty = state.items.reduce((s, i) => s + (i.quantity || 1), 0);
        if (totalQty >= 2) {
          // app#11：预演始终在独立 Worker 中执行，避免同步装箱计算阻塞浏览器 UI 主线程。
          // Worker 不可用时保留基础推荐，Worker 运行失败时也不退回主线程同步预演。
          // recSimToken 防串台：连续触发多次预演时，仅最后一次结果生效。
          recEl.innerHTML =
            '<div id="sim-preview-loading" style="padding:16px;background:#F5F0EB;border:1px dashed #B8A89A;' +
            'border-radius:12px;color:#7A706B;font-size:13px;text-align:center;">' +
            '🛠️ 正在预演装载方案，请稍候…</div>';
          altEl.innerHTML = '';
          const simToken = refreshToken;
          const worker = getRecommendationWorker();
          const simulationOptions = {
            tolerance: state.tolerance,
            optimizationSeed: 20260805,
            randomStarts: 4,
            optimizationTimeMs: 1500
          };
          const finishSimulation = (simulation) => {
            if (simToken !== recSimToken) return;
            try {
              console.debug('[refreshContainerRecommendation] simulation:', simulation.map(s => `${s.code}:${s.containerCount}箱`).join(', '));
              // 单箱容量优先：若某箱型模拟退火确认"单箱可装完全部"，直接推荐（珍珠解识别）。
              const oneBoxFit = simulation.find(s => s.feasible && s.singleBoxCapacity != null && s.singleBoxCapacity >= s.totalItems);
              if (oneBoxFit && oneBoxFit.code !== recommendation.primary.code) {
                const promoted = CDB.CONTAINER_DB[oneBoxFit.code];
                if (promoted) {
                  recommendation.primary = promoted;
                  recommendation.reasoning =
                    `实际装箱验证：${oneBoxFit.code} 可单箱装完全部 ${oneBoxFit.totalItems} 件货物，` +
                    `优于原推荐 ${recommendation.primary.code}（需 ${(simulation.find(s => s.code === recommendation.primary.code) || {}).containerCount || '?'} 箱）。`;
                  recommendation.promotedBySimulation = true;
                }
              }
              const bestSim = simulation.find(s => s.feasible);
              if (bestSim && bestSim.code !== recommendation.primary.code &&
                  bestSim.containerCount < (simulation.find(s => s.code === recommendation.primary.code) || {}).containerCount) {
                const promoted = CDB.CONTAINER_DB[bestSim.code];
                if (promoted) {
                  recommendation.primary = promoted;
                  recommendation.reasoning =
                    `实际装箱预演：${bestSim.code} 仅需 ${bestSim.containerCount} 箱装完，` +
                    `优于原推荐 ${recommendation.primary.code}（需 ${(simulation.find(s => s.code === recommendation.primary.code) || {}).containerCount || '?'} 箱）。`;
                  recommendation.promotedBySimulation = true;
                }
              }
            } catch (simErr) {
              console.warn('[refreshContainerRecommendation] simulation failed:', simErr.message);
            }
            if (!recommendation || recommendation.type === 'failed') {
              renderFailedRecommendation(recEl, altEl);
            } else if (recommendation.type === 'mixed') {
              renderMixedRecommendation(recommendation.mixed, recEl, altEl);
            } else {
              renderSingleRecommendation(recommendation, recEl, altEl);
            }
            ensureCalculateButton();
          };

          // 预演始终在 Worker 内执行，避免任何大货量方案阻塞 UI 主线程。
          // Worker 不可用或运行失败时保留基于单件适配的初始推荐，不退回同步预演。
          if (worker) {
            const requestId = ++recommendationWorkerRequestId;
            worker.onmessage = (event) => {
              const message = event.data || {};
              if (message.requestId !== requestId || simToken !== recSimToken) return;
              worker.onmessage = null;
              if (message.type === 'error') {
                console.warn('[refreshContainerRecommendation] worker simulation failed:', message.message);
                finishSimulation([]);
                return;
              }
              finishSimulation(message.simulation || []);
            };
            worker.onerror = (error) => {
              if (simToken !== recSimToken) return;
              worker.onerror = null;
              console.warn('[refreshContainerRecommendation] worker unavailable:', error.message || error);
              cancelRecommendationWorker();
              finishSimulation([]);
            };
            worker.postMessage({
              type: 'simulate',
              requestId,
              items: state.items,
              candidates,
              options: simulationOptions
            });
          } else {
            finishSimulation([]);
          }
          return; // 渲染由 Worker/降级分支完成
        }
      }

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
      recEl.innerHTML = '<div style="color:#C4827B;">箱型推荐出错：' + escapeHtml(err.message) + '</div>';
      altEl.innerHTML = '';
      ensureCalculateButton();
    }
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

    refreshContainerRecommendation();
  }

  // ═══════════════════════════════════════════
  // Step 3 → 4: Start Calculation
  // ═══════════════════════════════════════════
  function startCalculation() {
    // 防重复点击
    if (state._calculating) return;
    state._calculating = true;
    console.debug('[startCalculation] state:', { containerSpec: state.containerSpec?.code, useMixed: state.useMixed, containerSpecs: state.containerSpecs?.length, items: state.items.length });
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

      // Show indeterminate progress, then do actual calculation
      // app#6：携带 generation token；若计算期间 resetState / 离开流程，gen 失配，
      // 回调直接放弃（不渲染、不跳转、不篡改 _calculating——由作废方负责复位）。
      const gen = ++calcGeneration;
      activeCalcHandle = simulateProgress(100, () => {
        if (gen !== calcGeneration) return; // 竞态：计算已作废
        try {
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
          // 添加重新开始按钮
          appendRestartButton('step-3');
        }
      });

    } catch (err) {
      hideProgress();
      state._calculating = false;
      console.error('Start calculation error:', err);
      showError('启动计算失败：' + (err.message || '未知错误') + ' 🥛');
      appendRestartButton('step-3');
    }
  }

  function appendRestartButton(stepId) {
    const step = $(stepId);
    if (!step) return;
    // 避免重复添加
    if (step.querySelector('.restart-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'btn-secondary restart-btn';
    btn.textContent = '🔄 重新开始';
    btn.style.cssText = 'margin-top:12px;';
    btn.onclick = () => { App.resetState(); };
    step.appendChild(btn);
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

    // P1-D：结果区块 stagger 入场（摘要→tabs→警告，60ms 间隔）
    const step4 = $('step-4');
    if (step4) {
      const blocks = step4.querySelectorAll(':scope > .result-summary, :scope > .mt-4, :scope > .result-layout');
      blocks.forEach((b, i) => {
        b.style.animation = 'none';
        void b.offsetWidth; // reflow 重触发动画
        b.style.animation = `fadeInUp var(--dur-slow) var(--ease-out) ${i * 60}ms both`;
      });
    }

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

    // 检查实际 vs 推荐差异
    const recommendedBoxes = state.containerSpecs ? state.containerSpecs.length : 1;
    const actualBoxes = result.containerCount;
    const hasRecommendationGap = recommendedBoxes > actualBoxes;

    // 动态扩容补装箱：Planner 分组低估箱数后追加，不是"优化省箱"，需要向用户明示
    const expandCount = (result.containers || []).filter(c => c.isExpand).length;
    const boxHint = hasRecommendationGap
      ? `推荐${recommendedBoxes}箱（体积估算×1.3余量），实际EMS算法优化为${actualBoxes}箱`
      : (expandCount > 0 ? `实际使用${actualBoxes}箱，其中${expandCount}箱为扩容补装（Planner 分组低估箱数）` : null);

    const totalItems = result.totalItems || (result.totalPlaced + (result.unplacedCount || 0));
    const cards = [
      { label: '所需箱数', value: actualBoxes, unit: '个', cls: 'rs-boxes', hint: boxHint },
      { label: '平均利用率', value: (result.avgUtilization * 100).toFixed(1), unit: '%', cls: 'rs-util' },
      { label: '总装载重量', value: (result.totalWeightLoaded / 1000).toFixed(2), unit: '吨', cls: 'rs-weight' },
      { label: '已装件数', value: `${result.totalPlaced}`, unit: `/ ${totalItems} 件`, cls: 'rs-items',
        hint: result.unplacedCount > 0 ? `${result.unplacedCount} 件未能装入` : '全部装入 ✓' }
    ];

    el.innerHTML = cards.map(c => `
      <div class="result-summary__card ${c.cls}">
        <div class="result-summary__label">${c.label}</div>
        <div class="result-summary__number">${c.value}<span class="result-summary__unit">${c.unit}</span></div>
        ${c.hint ? `<div class="result-summary__hint">${c.hint}</div>` : ''}
      </div>
    `).join('');

    // 如果推荐箱数 > 实际箱数，显示提示条
    if (hasRecommendationGap && result.skippedContainers && result.skippedContainers.length > 0) {
      const skippedInfo = result.skippedContainers.map(s =>
        `${s.code}（${s.reason}）`
      ).join('、');
      el.insertAdjacentHTML('beforeend', `
        <div class="result-summary__note">
          推荐${recommendedBoxes}箱基于体积估算（×1.3 余量），实际 EMS 算法仅需 ${actualBoxes} 箱即可装完所有货物。未使用的箱型：${skippedInfo}
        </div>
      `);
    }

    // A 方向（单箱型尾货建议）：仅手动单箱型路径触发——引擎不允许跨箱型回退，
    // 尾货只能表现为「有件未装入」或「末箱低利用率」。检测到即引导去 Step3 开启混合装箱。
    const isSingleBoxPath = !state.useMixed && !!state.containerSpec && !state.containerSpecs;
    if (isSingleBoxPath) {
      const containers = result.containers || [];
      const lastC = containers[containers.length - 1];
      const lastUtilPct = lastC && typeof lastC.utilization === 'number'
        ? Math.round(lastC.utilization * 100)
        : null;
      const tailLowUtil = containers.length >= 2 && lastUtilPct !== null && lastUtilPct < TAIL_LOW_UTIL_THRESHOLD_PCT;
      const specCode = state.containerSpec.code || '';

      if ((result.unplacedCount || 0) > 0) {
        el.insertAdjacentHTML('beforeend', `
          <div class="result-summary__note result-summary__note--action">
            <span>📦 当前箱型 <strong>${specCode}</strong> 尚有 <strong>${result.unplacedCount} 件</strong>货物未能装入${lastUtilPct !== null ? `，末箱利用率 ${lastUtilPct}%` : ''}——单一箱型无法覆盖剩余尾货。</span>
            <button type="button" class="result-summary__switch" onclick="App.goToStep(3)">🔄 返回第 3 步 · 启用混合装箱</button>
          </div>
        `);
      } else if (tailLowUtil) {
        el.insertAdjacentHTML('beforeend', `
          <div class="result-summary__note result-summary__note--action">
            <span>💡 末箱利用率仅 <strong>${lastUtilPct}%</strong>，属于小体积尾货残留。改用多种箱型组合（大箱装主货、小箱收尾货）通常可减少总箱数。</span>
            <button type="button" class="result-summary__switch" onclick="App.goToStep(3)">🔄 返回第 3 步 · 启用混合装箱</button>
          </div>
        `);
      }
    }
  }

  function renderContainerTabs(result) {
    const el = $('container-tabs');
    if (!el) return;

    // P0-B：tab 升级为迷你分数卡 —— 箱号 + 双色利用率条（体积/载重）+ 件数徽章
    let html = '<div class="container-tabs__row" role="tablist">';
    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];
      const active = i === 0 ? ' container-tab-btn--active' : '';
      const isFR = c.containerCode && c.containerCode.includes('FR');
      const volPct = Math.min(100, (isFR && c.spaceEfficiency != null ? c.spaceEfficiency : (c.utilization || 0)) * 100);
      const wtPct = Math.min(100, (c.weightUtil || 0) * 100);
      html += `<button type="button" role="tab" aria-selected="${i === 0}" class="container-tab-btn${active}" data-index="${i}" style="--i:${i}">
        <span class="ctab__no">箱 ${i + 1}</span>
        <span class="ctab__bars">
          <span class="ctab__bar"><i style="width:${volPct.toFixed(1)}%"></i></span>
          <span class="ctab__bar ctab__bar--wt"><i style="width:${wtPct.toFixed(1)}%"></i></span>
        </span>
        <span class="ctab__meta">${volPct.toFixed(0)}% · ${c.placedItems.length}件</span>
      </button>`;
    }
    html += '</div>';

    // Container detail panel
    html += '<div id="container-detail"></div>';

    el.innerHTML = html;

    // Update detail for first container
    updateContainerDetail(result, 0);

    // Attach tab click handlers
    el.querySelectorAll('.container-tab-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.index);

        // Update active styles
        el.querySelectorAll('.container-tab-btn').forEach(b => {
          b.classList.remove('container-tab-btn--active');
        });
        this.classList.add('container-tab-btn--active');

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
    const volPct = Math.min(100, (isFR && c.spaceEfficiency != null ? c.spaceEfficiency : (c.utilization || 0)) * 100);
    const wtPct = Math.min(100, (c.weightUtil || 0) * 100);

    // P0-B：状态判定 —— weightBottleneck（载重瓶颈）非错误，用雾蓝中性提示
    let statusBadge = '';
    const hasBottleneck = check && check.warnings.some(w => w.type === 'weightBottleneck');
    if (errCount > 0) {
      statusBadge = '<span class="score-card__badge score-card__badge--error">🔴 ' + errCount + ' 错误</span>';
    } else if (hasBottleneck) {
      statusBadge = '<span class="score-card__badge score-card__badge--bottleneck">⚖️ 载重瓶颈</span>';
    } else if (warnCount > 0) {
      statusBadge = '<span class="score-card__badge score-card__badge--warn">⚠️ ' + warnCount + ' 提示</span>';
    } else {
      statusBadge = '<span class="score-card__badge score-card__badge--ok">✅ 无异常</span>';
    }

    const utilMainLabel = isFR && c.spaceEfficiency != null ? '空间效率' : '体积利用率';

    detailEl.innerHTML = `
      <div class="score-card">
        <div class="score-card__main">
          <div class="score-card__big"><span class="score-card__num">${volPct.toFixed(1)}</span><span class="score-card__unit">%</span></div>
          <div class="score-card__label">${utilMainLabel}${isFR && c.spaceEfficiency != null ? `<span class="score-card__sub">标称 ${(c.utilization * 100).toFixed(1)}%</span>` : ''}</div>
        </div>
        <div class="score-card__bars">
          <div class="score-card__barrow">
            <span class="score-card__barlabel">体积</span>
            <span class="score-card__track"><i style="width:${volPct.toFixed(1)}%"></i></span>
            <span class="score-card__barval">${volPct.toFixed(1)}%</span>
          </div>
          <div class="score-card__barrow">
            <span class="score-card__barlabel">载重</span>
            <span class="score-card__track score-card__track--wt"><i style="width:${wtPct.toFixed(1)}%"></i></span>
            <span class="score-card__barval">${wtPct.toFixed(1)}%</span>
          </div>
        </div>
        <div class="score-card__facts">
          ${statusBadge}
          <span class="score-card__fact">箱型 <strong>${c.containerCode}</strong>${c.isExpand ? ' <span class="score-card__expand">扩容补装</span>' : ''}${c.plannerReason ? ` <span class="score-card__reason">${escapeHtml(c.plannerReason)}</span>` : ''}</span>
          <span class="score-card__fact">装载 <strong>${c.placedItems.length}</strong> 件</span>
          <span class="score-card__fact">总重 <strong>${c.totalWeight.toFixed(0)}</strong> kg</span>
        </div>
      </div>
      <div class="sku-pills">
        ${Object.entries(modelCounts).map(([m, n]) => `<span class="sku-pill">${escapeHtml(m)}<b>×${n}</b></span>`).join('')}
      </div>
    `;
  }

  function renderWarningsPanel(result) {
    const el = $('warnings-panel');
    if (!el) return;

    // P0-B：三档分组 —— errors（红）/ bottleneck（雾蓝，载重瓶颈非错误）/ warnings（橙）
    const allErrors = [];
    const allBottlenecks = [];
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
          if (warn.type === 'weightBottleneck') {
            allBottlenecks.push(`[箱${i + 1}] ${warn.message}`);
          } else {
            allWarnings.push(`[箱${i + 1}] ${warn.message}`);
          }
        }
      }
    }

    // 承重/支撑类错误提供业务可读解释：通常是下层货物承压能力不足，而不是"装不下"。
    const bearingErrorCount = (result.checks || []).reduce((sum, ch) =>
      sum + ch.errors.filter(e => e.type === 'bearingViolation' || e.type === 'supportViolation' || e.type === 'cornerViolation').length, 0);
    if (bearingErrorCount > 0) {
      allErrors.push(`[叠放约束] ${bearingErrorCount} 处叠放因支撑/承重不足被拒绝。请检查下层货物是否可承重（或标记为不可叠放），避免将重货压在轻货上。`);
    }

    if (result.unplacedCount > 0) {
      allWarnings.push(`[未装载] ${result.unplacedCount} 件货物无法装入：${(result.unplacedItems || []).join(', ')}`);

      // 载重提示：单箱型模式下，若剩余货物中存在单件超重，或每箱都已接近载重上限，提示换箱型
      const spec = state.useMixed ? null : state.containerSpec;
      if (spec) {
        const heaviestUnplaced = Math.max(...(result.unplacedItems || []).map(u => {
          const item = state.items.find(i => i.model === u);
          return item ? item.weight : 0;
        }).filter(Boolean), 0);
        const singleTooHeavy = heaviestUnplaced > spec.payload;
        const allWeightFull = result.containers.length > 0 &&
          result.containers.every(c => c.totalWeight >= spec.payload * 0.99);
        if (singleTooHeavy) {
          allWarnings.push(`[载重提示] 有未装货物单重 ${heaviestUnplaced.toLocaleString()} kg 超过 ${spec.nameCN} 最大载重 ${spec.payload.toLocaleString()} kg，请改用更大载重箱型。`);
        } else if (allWeightFull) {
          allWarnings.push(`[载重提示] 当前 ${spec.nameCN} 载重已达上限（${spec.payload.toLocaleString()} kg），如需装完请改用更大载重箱型或确认已允许多箱装载。`);
        }
      }
    }

    // 混合装箱：提示被跳过的箱型（独立于未装载提示，因可能货物已装完但方案中多余箱型被跳过）
    if (result.skippedContainers && result.skippedContainers.length > 0) {
      for (const sc of result.skippedContainers) {
        allWarnings.push(`[跳过箱型] ${sc.nameCN}（${sc.code}）：${sc.reason}`);
      }
    }

    if (allErrors.length === 0 && allBottlenecks.length === 0 && allWarnings.length === 0) {
      el.innerHTML = '<div class="wp__empty">✅ 无异常，所有货物完美装箱 ✨</div>';
      return;
    }

    // P0-B：分色分组渲染
    let html = '';
    const group = (title, cls, items, itemCls) => {
      if (items.length === 0) return '';
      let g = `<div class="wp__group wp__group--${cls}">`;
      g += `<div class="wp__title">${title}</div>`;
      for (const it of items) {
        g += `<div class="wp__item ${itemCls || ''}">${escapeHtml(it)}</div>`;
      }
      return g + '</div>';
    };

    html += group(`🔴 错误 (${allErrors.length})`, 'error', allErrors);
    html += group(`⚖️ 载重瓶颈提示 (${allBottlenecks.length})`, 'bottleneck', allBottlenecks, 'wp__item--bottleneck');
    html += group(`⚠️ 提示 (${allWarnings.length})`, 'warn', allWarnings);

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
        // 区分 ES Module 加载失败 vs 正在加载中
        const isESModuleFailed = typeof window.ThreeViewer === 'undefined'
          && document.querySelector('script[type="module"][src="three-viewer.js"]');

        if (isESModuleFailed) {
          // 明确告知用户3D模块不可用，不自动降级
          container.innerHTML = `<div style="color:#C97B7B;padding:40px;text-align:center;background:#FFF5F5;border-radius:12px;margin:10px;">
            <div style="font-weight:600;margin-bottom:8px;">3D 模块加载失败 🥛</div>
            <div style="font-size:12px;color:#8B6B6B;margin-bottom:8px;">
              ES Module 无法加载（可能因 file:// 协议限制）。<br>
              请使用本地服务器打开：<code style="background:#fff;padding:2px 8px;border-radius:4px;">python3 -m http.server 8080</code>
            </div>
            <button id="btn-force-2d" style="padding:6px 16px;border:1px solid #C97B7B;border-radius:8px;background:#fff;color:#C97B7B;cursor:pointer;">使用 2D 降级视图</button>
          </div>`;
          document.getElementById('btn-force-2d')?.addEventListener('click', () => render2DFallback(result, container));
          return;
        }

        // ThreeViewer 正在加载中，显示占位并轮询重试
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
      container.innerHTML = '<div style="color:#999;padding:40px;text-align:center;">3D 视图加载失败：' + escapeHtml(err.message) + '</div>';
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
    html += `⚠️ <strong>3D 视图不可用，当前为 2D 降级示意图。</strong><br>`;
    html += `仅显示底层（z=0）货物俯视图，${result.totalPlaced}件中部分高层叠放货物未显示。`;
    if (isFileProtocol) {
      html += `<br>💡 <strong>file:// 协议限制了 3D 模块加载。</strong>建议用本地服务器打开以获得完整 3D 视图：<code style="background:#fff;padding:2px 6px;border-radius:4px;">python3 -m http.server 8080</code>`;
    }
    html += `</div>`;
    html += `<div style="display:flex;gap:${gap}px;flex-wrap:wrap;">`;

    const colors = ['#B8A89A','#9C8B7D','#A8B6B1','#D4C5B9','#8FA39B','#C4B5A5','#BEAD98','#A9AFA9','#99A8A0','#CCBFB0'];

    containers.forEach((c, idx) => {
      const spec = CDB.CONTAINER_DB[c.containerCode] || { L: 12, W: 2.4, H: 2.6 };
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
      html += ` · 共${result.totalPlaced}件（含叠放层）`;
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

      await PDFX.generateReport(state.packingResult, state.visualization, {
        tolerance: state.tolerance,
        autoRetry: true,
        recalculated: state.packingResult && state.packingResult.recalculated,
        containerType: state.useMixed ? '混合箱型' : (state.containerSpec ? state.containerSpec.nameCN : '')
      });

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
    document.querySelectorAll('.steps__step').forEach(stepEl => {
      const go = () => {
        const targetStep = Number(stepEl.dataset.step);
        if (!Number.isInteger(targetStep) || targetStep < 1 || targetStep > 4) return;
        if (targetStep <= state.currentStep || (targetStep === 2 && state.items.length) || (targetStep === 3 && state.items.length) || (targetStep === 4 && state.packingResult)) {
          showStep(targetStep);
        }
      };
      stepEl.addEventListener('click', go);
      stepEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          go();
        }
      });
    });

    // Back buttons in steps 2-4
    for (let step = 2; step <= 4; step++) {
      const backBtn = document.querySelector(`#step-${step} .btn-back`);
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          showStep(step - 1);
        });
      }
    }

    // Tauri 打包 CSP 兜底：内联 onclick 在发布包中可能被静默拦截（浏览器不受影响），
    // 所有依赖内联 onclick 的导航按钮在此补 JS 绑定；重复触发均幂等（showStep/resetState）。
    const inlineFallbacks = [
      ['#step-2 button[onclick*="goToStep(1)"]', () => showStep(1)],
      ['#step-3 button[onclick*="goToStep(2)"]', () => showStep(2)],
      ['#step-4 button[onclick*="goToStep(3)"]', () => showStep(3)],
      ['#step-4 button[onclick*="resetState"]', () => App.resetState()]
    ];
    for (const [selector, handler] of inlineFallbacks) {
      const btn = document.querySelector(selector);
      if (btn && !btn.dataset.inlineFallbackBound) {
        btn.dataset.inlineFallbackBound = '1';
        btn.addEventListener('click', handler);
      }
    }

    // Step 2 "重新上传" button
    const reuploadBtn = document.querySelector('#step-2 .btn-reupload');
    if (reuploadBtn) {
      reuploadBtn.addEventListener('click', () => {
        // 完整清理：复用 App.resetState()（覆盖全部 state 字段，含 manualItems，
        // 并调用 TV.disposeAll() 释放 3D 视图、清空结果容器、showStep(1)）
        App.resetState();

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
        // 手动录入没有 Step 2 的解析数据，回到 Step 1 继续编辑
        showStep(state.parsedResult ? 2 : 1);
      });
    }

    // Step 4 "重新计算" button
    const recalcBtn = document.querySelector('#step-4 .btn-recalc');
    if (recalcBtn) {
      recalcBtn.addEventListener('click', () => {
        showStep(3);
      });
    }

    // Step 4 "返回配置" / "重新开始"（内联 onclick 兜底绑定）
    // 这两个按钮没有 .btn-back class，旧代码 initNavigation 未绑定任何监听，
    // 完全依赖内联 onclick（App.goToStep(3) / App.resetState()）。
    // 显式绑定后即使内联属性失效也有兜底；重复触发是幂等的（showStep/resetState）。
    const step4Back = document.querySelector('#step-4 button[onclick*="goToStep(3)"]');
    if (step4Back) {
      step4Back.addEventListener('click', () => { showStep(3); });
    }
    const step4Restart = document.querySelector('#step-4 button[onclick*="resetState"]');
    if (step4Restart) {
      step4Restart.addEventListener('click', () => { App.resetState(); });
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
      state.manualItems = [];
      state._calculating = false;
      // app#6：作废在途计算——取消未触发的 setTimeout + 递增 generation，
      // 旧 onDone 即使已进入队列也会因 token 失配而放弃渲染/跳转。
      calcGeneration++;
      if (activeCalcHandle) { activeCalcHandle.cancel(); activeCalcHandle = null; }
      // 作废并终止仍在运行的推荐预演，避免重置后旧结果写回新的界面状态。
      recSimToken++;
      cancelRecommendationWorker();
      // 清理 3D 视图：释放渲染器/场景/rAF，避免"重新开始"后资源泄漏
      // （此前遗漏，与 Step 2"重新上传"的清理逻辑对齐）
      const TV = getTV();
      if (TV && typeof TV.disposeAll === 'function') {
        TV.disposeAll();
      }
      const viewerContainer = $('three-viewer-container');
      if (viewerContainer) viewerContainer.innerHTML = '';
      const resultContainer = $('resultContainer');
      if (resultContainer) resultContainer.innerHTML = '';
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

  // app#19 修复：提取 ripple 绑定逻辑为独立函数，供静态按钮（initButtonRipples）与
  // 动态创建的按钮（ensureCalculateButton）复用；dataset 标记防止重复绑定。
  function applyButtonRipple(btn) {
    if (!btn || btn.dataset.rippleBound === '1') return;
    btn.dataset.rippleBound = '1';
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
  }

  function initButtonRipples() {
    document.querySelectorAll('.btn-primary, .btn-secondary, .btn-export, .btn-ghost, .theme-btn, .container-tabs__btn').forEach(applyButtonRipple);
  }

  // ═══════════════════════════════════════════
  // Command Palette (P1-C · ⌘K) — 键盘优先命令面板
  // 设计卡：「⌘K 命令面板 · 设计卡 v2（2026-08-27）」§一~五
  // 权限对齐导航铁律；主题执行复用 .theme-btn click 作单一事实源。
  // ═══════════════════════════════════════════
  function initCommandPalette() {
    if ($('cmdk-root')) return; // 幂等：重复调用不重建

    const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
    const iconSvg = (inner) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    const ICONS = {
      nav: iconSvg('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
      calc: iconSvg('<path d="M8 5l11 7-11 7V5z"/>'),
      export: iconSvg('<path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
      sun: iconSvg('<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
      moon: iconSvg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
      contrast: iconSvg('<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20V2z"/>')
    };
    // 权限谓词：与侧栏导航铁律一致（showStep 前的可达性判断）
    const stepEnabled = (n) => n <= state.currentStep ||
      ((n === 2 || n === 3) && state.items.length > 0) ||
      (n === 4 && !!state.packingResult);

    const COMMANDS = [
      { id: 'nav-1', group: '导航', label: '第 1 步 · 导入货物', hint: '1', icon: ICONS.nav, enabled: () => stepEnabled(1), run: () => showStep(1) },
      { id: 'nav-2', group: '导航', label: '第 2 步 · 确认数据', hint: '2', icon: ICONS.nav, enabled: () => stepEnabled(2), run: () => showStep(2) },
      { id: 'nav-3', group: '导航', label: '第 3 步 · 装箱配置', hint: '3', icon: ICONS.nav, enabled: () => stepEnabled(3), run: () => showStep(3) },
      { id: 'nav-4', group: '导航', label: '第 4 步 · 结果检查', hint: '4', icon: ICONS.nav, enabled: () => stepEnabled(4), run: () => showStep(4) },
      { id: 'calc', group: '操作', label: '开始计算（当前步）', hint: 'C', icon: ICONS.calc, enabled: () => state.currentStep === 3, run: () => { const b = $('btn-calculate'); if (b) b.click(); } },
      { id: 'export-pdf', group: '操作', label: '导出 PDF 报告', hint: 'E', icon: ICONS.export, enabled: () => !!state.packingResult, run: () => { const b = $('btn-export-pdf'); if (b) b.click(); } },
      { id: 'theme-light', group: '外观', label: '切换至亮色主题', hint: '', icon: ICONS.sun, enabled: () => true, run: () => clickThemeBtn('light') },
      { id: 'theme-dark', group: '外观', label: '切换至暗色主题', hint: '', icon: ICONS.moon, enabled: () => true, run: () => clickThemeBtn('dark') },
      { id: 'theme-hc', group: '外观', label: '切换至高对比主题', hint: '', icon: ICONS.contrast, enabled: () => true, run: () => clickThemeBtn('contrast') }
    ];
    // 主题单一事实源：程序化点击现有 .theme-btn，initThemeSwitcher 的 handler
    // 一并完成 localStorage 与 active 态同步，绝不手写第二份逻辑。
    function clickThemeBtn(t) {
      const b = document.querySelector('.theme-btn[data-theme="' + t + '"]');
      if (b) b.click();
    }
    // 全局 T：循环切换主题（读当前 active 的下一个）
    function cycleTheme() {
      const active = document.querySelector('.theme-btn.active');
      const cur = active ? active.dataset.theme : (document.documentElement.getAttribute('data-theme') || 'light');
      const order = ['light', 'dark', 'contrast'];
      const idx = order.indexOf(cur);
      clickThemeBtn(order[(idx >= 0 ? idx : 0) + 1] || 'light');
    }

    // ── 构建浮层 DOM（一次）──
    const root = document.createElement('div');
    root.id = 'cmdk-root';
    root.className = 'cmdk-overlay cmdk-hidden';
    root.innerHTML =
      '<div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="命令面板">' +
        '<div class="cmdk-head">' +
          iconSvg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>').replace('<svg ', '<svg class="cmdk-search-icon" ') +
          '<input id="cmdk-input" class="cmdk-input" type="text" placeholder="搜索命令…" autocomplete="off" spellcheck="false" aria-label="搜索命令"/>' +
          '<span class="cmdk-chip"><kbd>' + (isMac ? '⌘K' : 'Ctrl K') + '</kbd></span>' +
        '</div>' +
        '<div id="cmdk-list" class="cmdk-list" role="listbox" aria-label="命令列表"></div>' +
        '<div class="cmdk-foot"><span>↑↓ 选择</span><i>·</i><span>↵ 执行</span><i>·</i><span>Esc 关闭</span></div>' +
      '</div>';
    document.body.appendChild(root);

    const panel = root.querySelector('.cmdk-panel');
    const inputEl = root.querySelector('#cmdk-input');
    const listEl = root.querySelector('#cmdk-list');
    let isOpen = false;
    let filtered = [];
    let selected = 0;

    function currentFiltered() {
      const q = inputEl.value.trim().toLowerCase();
      if (!q) return COMMANDS.slice();
      return COMMANDS.filter(c => c.label.toLowerCase().includes(q));
    }

    function render() {
      filtered = currentFiltered();
      if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);
      const byGroup = {};
      filtered.forEach((c, i) => { (byGroup[c.group] = byGroup[c.group] || []).push([c, i]); });
      let html = '';
      ['导航', '操作', '外观'].forEach(g => {
        const rows = byGroup[g];
        if (!rows || !rows.length) return;
        html += '<div class="cmdk-group-title" role="presentation">' + g + '</div>';
        rows.forEach(([c, i]) => {
          html += '<div class="cmdk-item' + (i === selected ? ' cmdk-item--active' : '') + '" role="option"' +
            ' aria-selected="' + (i === selected) + '"' +
            (c.enabled() ? '' : ' aria-disabled="true" data-disabled="1"') +
            ' data-idx="' + i + '">' +
            '<span class="cmdk-icon" aria-hidden="true">' + c.icon + '</span>' +
            '<span class="cmdk-label">' + c.label + '</span>' +
            (c.hint ? '<span class="cmdk-hint"><kbd>' + c.hint + '</kbd></span>' : '') +
          '</div>';
        });
      });
      listEl.innerHTML = html || '<div class="cmdk-empty">未找到匹配命令</div>';
    }

    // 仅切高亮类与 aria，不重渲染，保持滚动位置
    function paintActive() {
      listEl.querySelectorAll('.cmdk-item').forEach(el => {
        const i = parseInt(el.dataset.idx, 10);
        el.classList.toggle('cmdk-item--active', i === selected);
        el.setAttribute('aria-selected', String(i === selected));
      });
      const act = listEl.querySelector('.cmdk-item--active');
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }

    function openPalette() {
      if (isOpen) return;
      isOpen = true;
      root.classList.remove('cmdk-hidden');
      // 重启入场动画（同 showStep 的重排技巧；reduced-motion 下由局部规则关闭）
      panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
      inputEl.value = '';
      selected = 0;
      render();
      requestAnimationFrame(() => inputEl.focus());
    }
    function closePalette() {
      if (!isOpen) return;
      isOpen = false;
      root.classList.add('cmdk-hidden');
      if (inputEl.blur) inputEl.blur();
    }
    function togglePalette() { isOpen ? closePalette() : openPalette(); }

    function executeIndex(i) {
      const c = filtered[i];
      if (!c || !c.enabled()) return; // 禁用命令：Enter 无动作（视觉已降透明度）
      closePalette();
      c.run();
    }

    // 输入过滤：匹配集变化即重置高亮为 0（设计卡 §一）
    inputEl.addEventListener('input', () => { selected = 0; render(); });

    listEl.addEventListener('mousemove', (e) => {
      const it = e.target.closest ? e.target.closest('.cmdk-item') : null;
      if (!it) return;
      const i = parseInt(it.dataset.idx, 10);
      if (i !== selected) { selected = i; paintActive(); }
    });
    listEl.addEventListener('mousedown', (e) => e.preventDefault());
    listEl.addEventListener('click', (e) => {
      const it = e.target.closest ? e.target.closest('.cmdk-item') : null;
      if (!it) return;
      executeIndex(parseInt(it.dataset.idx, 10));
    });
    // 点遮罩空白处关闭（点面板内部不关）
    root.addEventListener('mousedown', (e) => { if (e.target === root) closePalette(); });

    // ── 全局键盘调度 ──
    document.addEventListener('keydown', (e) => {
      // IME 组合期防护（中文输入法确认候选时忽略）
      if (e.isComposing || e.keyCode === 229) return;
      // ⌘K / Ctrl+K：任意时刻开关面板
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
      if (e.key === 'Tab') { e.preventDefault(); return; } // 焦点固定在输入框
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) { selected = (selected + 1) % filtered.length; paintActive(); }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) { selected = (selected - 1 + filtered.length) % filtered.length; paintActive(); }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); executeIndex(selected); return; }
    });

    // ── 面板外全局单字符快捷键 ──
    // 前提：面板已关（开着时焦点在搜索框，输入域豁免天然生效）、无修饰键
    //（防 Ctrl+C 等系统快捷键误触发）、焦点不在任何可编辑元素内。
    document.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (isOpen) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      const k = e.key.toLowerCase(); // 大写防护：Ctrl+Shift 使 key 变大写
      if (k === 't') { cycleTheme(); return; }
      const c = COMMANDS.find(cmd => cmd.hint && cmd.hint.toLowerCase() === k);
      if (c && c.enabled()) c.run();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initThemeSwitcher();
      initButtonRipples();
      initCommandPalette();
    });
  } else {
    initThemeSwitcher();
    initButtonRipples();
    initCommandPalette();
  }
})();