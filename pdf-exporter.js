/**
 * PDF 导出模块
 * 生成含3D透视截图 + 详细装箱清单的PDF
 * 依赖: jsPDF (window.jspdf)
 */

const PdfExporter = (() => {
  let saveHandler = null;

  function setSaveHandler(handler) {
    saveHandler = handler;
  }

  /**
   * 生成PDF报告
   * @param {object} result - PackingEngine.calculate 的返回结果
   * @param {object} visualization - ThreeViewer.buildVisualization 的返回结果
   */
  function generateReport(result, visualization) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
      alert('PDF库未加载，请确认 vendor/jspdf.umd.min.js 已引入');
      return;
    }

    if (!result || !result.containers || result.containers.length === 0) {
      alert('没有装箱结果数据，请先完成计算');
      return;
    }

    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = 190; // A4 usable width
    const pageH = 277;
    let y = 15;

    // ── 封面/汇总页 ──
    doc.setFontSize(18);
    doc.setTextColor(0x6B, 0x90, 0x80);
    doc.text('装箱方案报告', 105, y, { align: 'center' });
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(0x66, 0x66, 0x66);
    doc.text(`生成时间: ${new Date().toLocaleString('zh-CN')}`, 105, y, { align: 'center' });
    y += 8;

    // 汇总表
    doc.setFontSize(12);
    doc.setTextColor(0x33, 0x33, 0x33);
    doc.text('方案汇总', 15, y);
    y += 8;

    // 汇总表头
    const tableHeaders = ['箱号', '箱型', '件数', '体积m³', '重量kg', '利用率'];
    const colWidths = [15, 30, 25, 30, 30, 30];
    let x = 15;

    doc.setFillColor(0xE8, 0xDF, 0xD5);
    doc.rect(15, y - 5, pageW - 25, 7, 'F');

    doc.setFontSize(9);
    doc.setTextColor(0x55, 0x55, 0x55);
    for (let i = 0; i < tableHeaders.length; i++) {
      doc.text(tableHeaders[i], x + 2, y);
      x += colWidths[i];
    }
    y += 8;

    doc.setFontSize(8);
    doc.setTextColor(0x33, 0x33, 0x33);

    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];
      x = 15;
      const row = [
        `箱${i + 1}`,
        c.containerCode,
        String(c.placedItems.length),
        c.totalVolume.toFixed(2),
        c.totalWeight.toFixed(0),
        (c.utilization * 100).toFixed(1) + '%'
      ];
      for (let j = 0; j < row.length; j++) {
        doc.text(String(row[j]), x + 2, y);
        x += colWidths[j];
      }
      y += 5;

      if (y > pageH - 20) { doc.addPage(); y = 15; }
    }

    y += 8;
    doc.setFontSize(10);
    doc.text(`总计: ${result.containerCount}个${result.containerCode} | 共装${result.totalPlaced}件 | 总重${result.totalWeightLoaded.toFixed(0)}kg`, 15, y);
    y += 12;

    // ── 每个集装箱的详情页 ──
    for (let i = 0; i < result.containers.length; i++) {
      const c = result.containers[i];

      if (y > pageH - 60) { doc.addPage(); y = 15; }

      doc.setFontSize(12);
      doc.setTextColor(0x33, 0x33, 0x33);
      doc.text(`箱${i + 1}: ${c.containerCode} 详细清单`, 15, y);
      y += 7;

      // 3D截图
      if (visualization && visualization.getScreenshot) {
        const screenshot = visualization.getScreenshot(i);
        if (screenshot) {
          try {
            doc.addImage(screenshot, 'PNG', 15, y, pageW - 30, 70);
            y += 75;
          } catch(e) {
            console.warn('PDF 截图失败，跳过:', e.message);
          }
        }
      }

      if (y > pageH - 30) { doc.addPage(); y = 15; }

      // 货物清单表头
      const detailHeaders = ['型号', '尺寸(m)', '位置(x,y,z)', '重量kg', '可叠'];
      const detailWidths = [60, 45, 50, 18, 15];
      x = 15;
      doc.setFillColor(0xE8, 0xDF, 0xD5);
      doc.rect(15, y - 5, pageW - 25, 7, 'F');
      doc.setFontSize(8);
      doc.setTextColor(0x55, 0x55, 0x55);
      for (let j = 0; j < detailHeaders.length; j++) {
        doc.text(detailHeaders[j], x + 2, y);
        x += detailWidths[j];
      }
      y += 8;

      doc.setFontSize(7);
      doc.setTextColor(0x44, 0x44, 0x44);
      for (const item of c.placedItems) {
        if (y > pageH - 10) { doc.addPage(); y = 15; }

        x = 15;
        const row = [
          String(item.model).substring(0, 30),
          `${item.l.toFixed(3)}×${item.w.toFixed(3)}×${item.h.toFixed(3)}`,
          `(${item.x.toFixed(2)},${item.y.toFixed(2)},${item.z.toFixed(2)})`,
          String(Math.round(item.weight)),
          item.stackable ? '✔' : '✗'
        ];
        for (let j = 0; j < row.length; j++) {
          doc.text(String(row[j]), x + 2, y);
          x += detailWidths[j];
        }
        y += 4;
      }

      y += 8;
    }

    // ── 冲突报告 ──
    if (result.hasErrors || result.hasWarnings || result.unplacedCount > 0) {
      if (y > pageH - 40) { doc.addPage(); y = 15; }

      doc.setFontSize(12);
      const errColor = result.hasErrors ? [0xCC, 0x44, 0x44] : [0xCC, 0x88, 0x00];
      doc.setTextColor(errColor[0], errColor[1], errColor[2]);
      doc.text('问题报告', 15, y);
      y += 8;

      doc.setFontSize(8);
      doc.setTextColor(0x55, 0x55, 0x55);

      for (let i = 0; i < result.containers.length; i++) {
        const ch = (result.checks && result.checks[i]) || { errors: [], warnings: [] };
        for (const err of ch.errors) {
          doc.text(`[箱${i+1}错误] ${err.message}`, 18, y);
          y += 4;
          if (err.details) {
            for (const d of err.details) {
              doc.text(`  - ${d}`, 22, y);
              y += 3.5;
            }
          }
        }
        for (const warn of ch.warnings) {
          doc.text(`[箱${i+1}警告] ${warn.message}`, 18, y);
          y += 4;
        }
      }

      if (result.unplacedCount > 0) {
        doc.text(`[未装载] ${result.unplacedCount} 件货物无法装入: ${result.unplacedItems.join(', ')}`, 18, y);
      }
    }

    // 保存
    const fileName = `装箱方案_${result.containerCode}_${new Date().toISOString().slice(0,10)}.pdf`;
    if (saveHandler) {
      const blob = doc.output('arraybuffer');
      saveHandler(fileName, new Uint8Array(blob));
    } else {
      doc.save(fileName);
    }
  }

  return { generateReport, setSaveHandler };
})();

window.PdfExporter = PdfExporter;