/**
 * PDF 导出模块 — 按 A4 页规范分页渲染
 * 生成含3D透视截图 + 详细装箱清单的PDF
 * 依赖: jsPDF (window.jspdf), html2canvas
 *
 * 分页策略：报告按逻辑页拆分（标题汇总 / 每箱明细 / 问题报告），
 * 每页单独 html2canvas 渲染并写入一个 A4 物理页，杜绝页缝切字与元素错位。
 */

const PdfExporter = (() => {
  let saveHandler = null;

  function setSaveHandler(handler) {
    saveHandler = handler;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // A4 规格（mm）
  const PAGE_W = 210;
  const PAGE_H = 297;

  // ═══ P-01 修复：分页常量 ═══
  const PAGE_ROWS_PER_SHEET = 45;   // 拆页后每页明细行数上限
  const SINGLE_PAGE_MAX_ROWS = 60;  // 单页可容纳行数上限（≤此值保持既有单页行为，避免小单回归）
  const SUMMARY_ROWS_PER_PAGE = 40; // 汇总页每页箱数上限

  /**
   * P-01 修复：纯函数 — 明细行按页拆分（不依赖 DOM，可直接单元测试）
   * @param {Array} items placedItems
   * @param {Object} [opts] { rowsPerSheet, singlePageMax }
   * @returns {Array<{rows:Array, pageNo:number, pageCount:number, startIndex:number}>}
   */
  function buildDetailPages(items, opts = {}) {
    const rowsPerSheet = opts.rowsPerSheet ?? PAGE_ROWS_PER_SHEET;
    const singlePageMax = opts.singlePageMax ?? SINGLE_PAGE_MAX_ROWS;
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return [{ rows: [], pageNo: 1, pageCount: 1, startIndex: 0 }];
    }
    // 小单（≤单页上限）保持既有单页行为，不强制拆页 → 无回归
    if (list.length <= singlePageMax) {
      return [{ rows: list, pageNo: 1, pageCount: 1, startIndex: 0 }];
    }
    const pageCount = Math.ceil(list.length / rowsPerSheet);
    const pages = [];
    for (let p = 0; p < pageCount; p++) {
      pages.push({
        rows: list.slice(p * rowsPerSheet, (p + 1) * rowsPerSheet),
        pageNo: p + 1,
        pageCount,
        startIndex: p * rowsPerSheet
      });
    }
    return pages;
  }

  /**
   * P-01 修复：纯函数 — 汇总行按页拆分（多箱时汇总页超高同样拆页）
   */
  function buildSummaryPages(containers, rowsPerPage = SUMMARY_ROWS_PER_PAGE) {
    const list = Array.isArray(containers) ? containers : [];
    if (list.length === 0) {
      return [{ rows: [], pageNo: 1, pageCount: 1, startIndex: 0 }];
    }
    const pageCount = Math.ceil(list.length / rowsPerPage);
    const pages = [];
    for (let p = 0; p < pageCount; p++) {
      pages.push({
        rows: list.slice(p * rowsPerPage, (p + 1) * rowsPerPage),
        pageNo: p + 1,
        pageCount,
        startIndex: p * rowsPerPage
      });
    }
    return pages;
  }

  /**
   * 生成分页报告 HTML：每个 .pdf-page 块对应一个 A4 页
   */
  function renderReportHtml(result, visualization, config = {}) {
    const el = document.getElementById('pdf-report');
    if (!el) {
      throw new Error('PDF 报告模板元素 #pdf-report 不存在');
    }
    el.innerHTML = '';

    const pages = [];

    // ═══ 页 1: 标题 + 方案汇总 ═══
    // P-01 修复：汇总行按需分页（每页 ≤40 箱）
    const summaryPages = buildSummaryPages(result.containers);
    for (const sp of summaryPages) {
      let summaryRows = '';
      for (let i = 0; i < sp.rows.length; i++) {
        const c = sp.rows[i];
        const boxNo = sp.startIndex + i + 1;
        summaryRows += `
        <tr style="border-bottom:1px solid #EDE7E0;">
          <td style="padding:6px 10px;text-align:center;">${boxNo}</td>
          <td style="padding:6px 10px;">${escapeHtml(c.containerCode)}</td>
          <td style="padding:6px 10px;text-align:right;">${c.placedItems.length}</td>
          <td style="padding:6px 10px;text-align:right;">${(c.totalVolume || 0).toFixed(2)}</td>
          <td style="padding:6px 10px;text-align:right;">${(c.totalWeight || 0).toFixed(0)}</td>
          <td style="padding:6px 10px;text-align:right;">${(c.utilization * 100).toFixed(1)}%</td>
        </tr>`;
      }
      const summaryTitle = sp.pageCount > 1
        ? `一、方案汇总（第 ${sp.pageNo} 页 / 共 ${sp.pageCount} 页）`
        : '一、方案汇总';

      pages.push(`
      <div class="pdf-page" style="width:794px;background:#fff;color:#3C3A36;padding:40px 48px;box-sizing:border-box;font-family:'Work Sans','PingFang SC','Microsoft YaHei',sans-serif;">
        <div style="text-align:center;margin-bottom:28px;border-bottom:2px solid #7B9A7B;padding-bottom:16px;">
          <h1 style="font-size:26px;color:#7B9A7B;margin:0 0 8px;">装箱方案报告</h1>
          <p style="color:#7A7570;margin:4px 0;font-size:12px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>
          <p style="color:#7A7570;margin:4px 0;font-size:11px;">
            操作间隙: ${(config.tolerance != null ? (config.tolerance * 100) : 5)}cm |
            箱型: ${escapeHtml(config.containerType || result.containerName || '自动')} |
            自动重算: ${config.autoRetry ? '是' : '否'}${config.recalculated ? '（已触发）' : ''}
          </p>
        </div>
        <h2 style="font-size:16px;margin:0 0 10px;color:#3C3A36;">${summaryTitle}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#EDE7E0;">
              <th style="padding:7px 10px;text-align:center;border:1px solid #D8D2CC;">箱号</th>
              <th style="padding:7px 10px;text-align:left;border:1px solid #D8D2CC;">箱型</th>
              <th style="padding:7px 10px;text-align:right;border:1px solid #D8D2CC;">件数</th>
              <th style="padding:7px 10px;text-align:right;border:1px solid #D8D2CC;">体积m³</th>
              <th style="padding:7px 10px;text-align:right;border:1px solid #D8D2CC;">重量kg</th>
              <th style="padding:7px 10px;text-align:right;border:1px solid #D8D2CC;">利用率</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
        </table>
        ${sp.pageNo === sp.pageCount ? `
        <p style="font-size:12px;color:#7A7570;margin-top:14px;">
          总计: ${result.containerCount} 个${escapeHtml(result.containerCode || 'mixed')} |
          共装 ${result.totalPlaced} 件 |
          总重 ${(result.totalWeightLoaded || 0).toFixed(0)} kg |
          总容积 ${(result.totalVolumePlaced || 0).toFixed(2)} m³
        </p>` : ''}
      </div>
      `);
    }

    // ═══ 每箱一页（行数超限时拆多页）: 明细清单 ═══
    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];
      const detailPages = buildDetailPages(c.placedItems || []);

      for (const dp of detailPages) {
        // 截图仅放在该箱第 1 页，避免每页重复渲染截图拖慢导出
        const screenshot = dp.pageNo === 1 && visualization && visualization.getScreenshotFixed
          ? visualization.getScreenshotFixed(i, 900, 560)
          : null;

        let rows = '';
        for (let idx = 0; idx < dp.rows.length; idx++) {
          const p = dp.rows[idx];
          const seq = dp.startIndex + idx + 1;
          rows += `
          <tr style="border-bottom:1px solid #F0EBE5;">
            <td style="padding:5px 8px;text-align:center;border:1px solid #E5DED6;">${seq}</td>
            <td style="padding:5px 8px;border:1px solid #E5DED6;">${escapeHtml(p.model)}</td>
            <td style="padding:5px 8px;text-align:right;border:1px solid #E5DED6;">${p.l.toFixed(2)}</td>
            <td style="padding:5px 8px;text-align:right;border:1px solid #E5DED6;">${p.w.toFixed(2)}</td>
            <td style="padding:5px 8px;text-align:right;border:1px solid #E5DED6;">${p.h.toFixed(2)}</td>
            <td style="padding:5px 8px;text-align:right;border:1px solid #E5DED6;">${p.weight.toFixed(1)}</td>
            <td style="padding:5px 8px;text-align:center;border:1px solid #E5DED6;">(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})</td>
          </tr>`;
        }

        const detailTitle = dp.pageCount > 1
          ? `箱 ${i + 1}: ${escapeHtml(c.containerCode)} 详细清单（第 ${dp.pageNo} 页 / 共 ${dp.pageCount} 页）`
          : `箱 ${i + 1}: ${escapeHtml(c.containerCode)} 详细清单`;

        pages.push(`
        <div class="pdf-page" style="width:794px;background:#fff;color:#3C3A36;padding:32px 44px;box-sizing:border-box;font-family:'Work Sans','PingFang SC','Microsoft YaHei',sans-serif;">
          <div style="border-bottom:2px solid #B8A89A;padding-bottom:10px;margin-bottom:12px;">
            <h2 style="font-size:17px;margin:0;color:#3C3A36;">${detailTitle}</h2>
            <p style="font-size:11px;color:#7A7570;margin:4px 0 0;">
              装载 ${c.placedItems.length} 件 · 体积利用率 ${(c.utilization * 100).toFixed(1)}% ·
              载重利用率 ${((c.weightUtil || 0) * 100).toFixed(1)}% · 总重 ${(c.totalWeight || 0).toFixed(0)} kg
            </p>
          </div>
          ${screenshot ? `<div style="text-align:center;margin:8px 0 12px;"><img src="${screenshot}" style="max-width:100%;max-height:170px;object-fit:contain;background:#F5F0EB;border:1px solid #E5DED6;border-radius:8px;" /></div>` : ''}
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
              <tr style="background:#EDE7E0;">
                <th style="padding:6px 8px;text-align:center;border:1px solid #D8D2CC;">序号</th>
                <th style="padding:6px 8px;text-align:left;border:1px solid #D8D2CC;">品名</th>
                <th style="padding:6px 8px;text-align:right;border:1px solid #D8D2CC;">长(m)</th>
                <th style="padding:6px 8px;text-align:right;border:1px solid #D8D2CC;">宽(m)</th>
                <th style="padding:6px 8px;text-align:right;border:1px solid #D8D2CC;">高(m)</th>
                <th style="padding:6px 8px;text-align:right;border:1px solid #D8D2CC;">重量(kg)</th>
                <th style="padding:6px 8px;text-align:center;border:1px solid #D8D2CC;">位置(x,y,z)</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        `);
      }
    }

    // ═══ 问题报告页 ═══
    if (result.hasErrors || result.hasWarnings || result.unplacedCount > 0) {
      const issueColor = result.hasErrors ? '#C97B7B' : '#C4A882';
      let issueRows = '';
      for (let i = 0; i < result.containers.length; i++) {
        const ch = (result.checks && result.checks[i]) || { errors: [], warnings: [] };
        for (const err of ch.errors) {
          issueRows += `<p style="margin:4px 0;color:#C97B7B;font-size:12px;">[箱${i + 1}错误] ${escapeHtml(err.message)}</p>`;
          if (err.details) {
            for (const d of err.details) {
              issueRows += `<p style="margin:2px 0 2px 18px;color:#7A7570;font-size:11px;">- ${escapeHtml(d)}</p>`;
            }
          }
        }
        for (const warn of ch.warnings) {
          issueRows += `<p style="margin:4px 0;color:#C4A882;font-size:12px;">[箱${i + 1}警告] ${escapeHtml(warn.message)}</p>`;
        }
      }
      if (result.unplacedCount > 0) {
        issueRows += `<p style="margin:4px 0;color:#C97B7B;font-size:12px;">[未装载] ${result.unplacedCount} 件货物无法装入: ${escapeHtml((result.unplacedItems || []).join(', '))}</p>`;
      }
      pages.push(`
        <div class="pdf-page" style="width:794px;background:#fff;color:#3C3A36;padding:40px 48px;box-sizing:border-box;font-family:'Work Sans','PingFang SC','Microsoft YaHei',sans-serif;">
          <h2 style="font-size:16px;margin:0 0 10px;color:${issueColor};">问题报告</h2>
          <div style="border:1px solid #E5DED6;border-radius:8px;padding:12px 16px;">${issueRows || '<p style="color:#7A7570;font-size:12px;margin:0;">无</p>'}</div>
        </div>
      `);
    }

    el.innerHTML = pages.join('');
    return el;
  }

  /**
   * 生成PDF报告（逐 A4 页渲染）
   */
  async function generateReport(result, visualization, config = {}) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
      alert('PDF库未加载，请确认 vendor/jspdf.umd.min.js 已引入');
      return;
    }
    if (typeof html2canvas === 'undefined') {
      alert('html2canvas 未加载，请确认 vendor/html2canvas.min.js 已引入');
      return;
    }
    if (!result || !result.containers || result.containers.length === 0) {
      alert('没有装箱结果数据，请先完成计算');
      return;
    }

    try {
      const reportEl = renderReportHtml(result, visualization, config);

      // 元素需可见供 html2canvas 渲染（移到视口外，避免闪烁）
      const originalDisplay = reportEl.style.display;
      const originalPosition = reportEl.style.position;
      const originalLeft = reportEl.style.left;
      reportEl.classList.remove('hidden');
      reportEl.style.display = 'block';
      reportEl.style.position = 'absolute';
      reportEl.style.left = '-9999px';
      reportEl.style.top = '0';

      const pageEls = reportEl.querySelectorAll('.pdf-page');
      const doc = new jsPDF('p', 'mm', 'a4');
      const margin = 0; // 页面内容已自带内边距

      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await html2canvas(pageEls[i], {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          windowWidth: 900
        });

        const imgData = canvas.toDataURL('image/png');
        const imgW = PAGE_W - margin * 2;
        let imgH = (canvas.height * imgW) / canvas.width;

        // 内容超出单页高度时整体缩放适配（保证不切字、元素完整）
        const maxH = PAGE_H - 10;
        if (imgH > maxH) {
          const ratio = maxH / imgH;
          imgH = maxH;
          doc.addImage(imgData, 'PNG', margin, 5, imgW * ratio, imgH * ratio);
        } else {
          doc.addImage(imgData, 'PNG', margin, 5, imgW, imgH);
        }

        if (i < pageEls.length - 1) doc.addPage();
      }

      // 恢复隐藏样式
      reportEl.style.display = originalDisplay;
      reportEl.style.position = originalPosition;
      reportEl.style.left = originalLeft;
      reportEl.style.top = '';
      reportEl.classList.add('hidden');

      const fileName = `装箱方案_${result.containerCode || 'mixed'}_${new Date().toISOString().slice(0, 10)}.pdf`;

      if (saveHandler) {
        const blob = doc.output('arraybuffer');
        saveHandler(fileName, new Uint8Array(blob));
      } else {
        doc.save(fileName);
      }
    } catch (e) {
      console.error('PDF 生成失败:', e);
      alert('PDF 生成失败: ' + e.message);
    }
  }

  return {
    generateReport,
    setSaveHandler,
    // P-01 修复：导出纯函数与常量，供单元测试与外部复用（只增不减，不破坏既有 API）
    renderReportHtml,
    buildDetailPages,
    buildSummaryPages,
    PAGE_ROWS_PER_SHEET,
    SINGLE_PAGE_MAX_ROWS,
    SUMMARY_ROWS_PER_PAGE
  };
})();

window.PdfExporter = PdfExporter;
