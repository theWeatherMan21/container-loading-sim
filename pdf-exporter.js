/**
 * PDF 导出模块
 * 生成含3D透视截图 + 详细装箱清单的PDF
 * 依赖: jsPDF (window.jspdf), html2canvas
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

  function renderReportHtml(result, visualization) {
    const el = document.getElementById('pdf-report');
    if (!el) {
      throw new Error('PDF 报告模板元素 #pdf-report 不存在');
    }
    el.innerHTML = '';

    const summaryRows = result.containers.map((c, i) => `
      <tr style="border-bottom:1px solid #EDE7E0;">
        <td style="padding:8px;">箱${i + 1}</td>
        <td style="padding:8px;">${escapeHtml(c.containerCode)}</td>
        <td style="padding:8px;">${c.placedItems.length}</td>
        <td style="padding:8px;">${c.totalVolume.toFixed(2)}</td>
        <td style="padding:8px;">${c.totalWeight.toFixed(0)}</td>
        <td style="padding:8px;">${(c.utilization * 100).toFixed(1)}%</td>
      </tr>
    `).join('');

    let detailHtml = '';
    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];
      const screenshot = visualization && visualization.getScreenshotFixed ? visualization.getScreenshotFixed(i, 800, 600) : null;
      detailHtml += `
        <div style="margin-bottom:32px;page-break-inside:avoid;">
          <h2 style="font-size:18px;margin:0 0 12px;color:#3C3A36;">箱${i + 1}: ${escapeHtml(c.containerCode)} 详细清单</h2>
          ${screenshot ? `<img src="${screenshot}" style="width:auto;height:auto;max-width:100%;max-height:260px;object-fit:contain;background:#F5F0EB;border-radius:12px;margin-bottom:12px;" />` : ''}
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#EDE7E0;">
                <th style="padding:8px;text-align:left;">序号</th>
                <th style="padding:8px;text-align:left;">品名</th>
                <th style="padding:8px;text-align:left;">长(m)</th>
                <th style="padding:8px;text-align:left;">宽(m)</th>
                <th style="padding:8px;text-align:left;">高(m)</th>
                <th style="padding:8px;text-align:left;">重量(kg)</th>
                <th style="padding:8px;text-align:left;">位置</th>
              </tr>
            </thead>
            <tbody>
              ${c.placedItems.map((p, idx) => `
                <tr style="border-bottom:1px solid #EDE7E0;">
                  <td style="padding:6px 8px;">${escapeHtml(p.id || idx + 1)}</td>
                  <td style="padding:6px 8px;">${escapeHtml(p.model)}</td>
                  <td style="padding:6px 8px;">${p.l.toFixed(2)}</td>
                  <td style="padding:6px 8px;">${p.w.toFixed(2)}</td>
                  <td style="padding:6px 8px;">${p.h.toFixed(2)}</td>
                  <td style="padding:6px 8px;">${p.weight.toFixed(0)}</td>
                  <td style="padding:6px 8px;">(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    let issueHtml = '';
    if (result.hasErrors || result.hasWarnings || result.unplacedCount > 0) {
      const issueColor = result.hasErrors ? '#C97B7B' : '#C4A882';
      let rows = '';
      for (let i = 0; i < result.containers.length; i++) {
        const ch = (result.checks && result.checks[i]) || { errors: [], warnings: [] };
        for (const err of ch.errors) {
          rows += `<p style="margin:4px 0;color:#C97B7B;">[箱${i + 1}错误] ${escapeHtml(err.message)}</p>`;
          if (err.details) {
            for (const d of err.details) {
              rows += `<p style="margin:2px 0 2px 16px;color:#7A7570;">- ${escapeHtml(d)}</p>`;
            }
          }
        }
        for (const warn of ch.warnings) {
          rows += `<p style="margin:4px 0;color:#C4A882;">[箱${i + 1}警告] ${escapeHtml(warn.message)}</p>`;
        }
      }
      if (result.unplacedCount > 0) {
        rows += `<p style="margin:4px 0;color:#C97B7B;">[未装载] ${result.unplacedCount} 件货物无法装入: ${escapeHtml(result.unplacedItems.join(', '))}</p>`;
      }
      issueHtml = `
        <div style="margin-top:24px;">
          <h2 style="font-size:16px;margin:0 0 8px;color:${issueColor};">问题报告</h2>
          ${rows}
        </div>
      `;
    }

    el.innerHTML = `
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:28px;color:#7B9A7B;margin:0;">装箱方案报告</h1>
        <p style="color:#7A7570;margin:8px 0 0;font-size:12px;">生成时间: ${new Date().toLocaleString('zh-CN')}</p>
      </div>
      <h2 style="font-size:16px;margin:0 0 8px;color:#3C3A36;">方案汇总</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;">
        <thead>
          <tr style="background:#EDE7E0;">
            <th style="padding:8px;text-align:left;">箱号</th>
            <th style="padding:8px;text-align:left;">箱型</th>
            <th style="padding:8px;text-align:left;">件数</th>
            <th style="padding:8px;text-align:left;">体积m³</th>
            <th style="padding:8px;text-align:left;">重量kg</th>
            <th style="padding:8px;text-align:left;">利用率</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
      </table>
      <p style="font-size:12px;color:#7A7570;margin-bottom:24px;">
        总计: ${result.containerCount}个${escapeHtml(result.containerCode || 'mixed')} | 共装${result.totalPlaced}件 | 总重${result.totalWeightLoaded.toFixed(0)}kg
      </p>
      ${detailHtml}
      ${issueHtml}
    `;

    return el;
  }

  /**
   * 生成PDF报告
   * @param {object} result - PackingEngine.calculate 的返回结果
   * @param {object} visualization - ThreeViewer.buildVisualization 的返回结果
   */
  async function generateReport(result, visualization) {
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
      const reportEl = renderReportHtml(result, visualization);

      // Ensure element is visible and rendered for html2canvas
      const originalVisibility = reportEl.style.visibility;
      const originalPosition = reportEl.style.position;
      const originalLeft = reportEl.style.left;
      reportEl.classList.remove('hidden');
      reportEl.style.visibility = 'visible';
      reportEl.style.position = 'absolute';
      reportEl.style.left = '0';
      reportEl.style.top = '0';
      reportEl.style.zIndex = '-9999';

      const canvas = await html2canvas(reportEl, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      });

      // Restore hidden styles
      reportEl.style.visibility = originalVisibility;
      reportEl.style.position = originalPosition;
      reportEl.style.left = originalLeft;
      reportEl.style.top = '';
      reportEl.style.zIndex = '';
      reportEl.classList.add('hidden');

      const imgData = canvas.toDataURL('image/png');
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const pageH = 297;
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let position = 0;

      doc.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      let heightLeft = imgH - pageH;

      while (heightLeft > 0) {
        position = heightLeft - imgH;
        doc.addPage();
        doc.addImage(imgData, 'PNG', 0, position, imgW, imgH);
        heightLeft -= pageH;
      }

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

  return { generateReport, setSaveHandler };
})();

window.PdfExporter = PdfExporter;
