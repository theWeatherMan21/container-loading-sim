/**
 * 智能字段识别引擎
 * 处理各种不同格式的装箱单 Excel/CSV
 * 三阶段解析：结构探测 → 列语义映射 → 多尺寸消歧
 */

const FieldParser = (() => {

  // ═══════════════════════════════════════════
  // 常量定义
  // ═══════════════════════════════════════════

  /**
   * 单位推断阈值常量
   * 用于根据数值范围自动推断尺寸单位（mm/cm/m）
   */
  const UNIT_INFERENCE = {
    MM_MAX_THRESHOLD: 5000,   // max > 5000 → mm（如 12000 明显是毫米）
    MM_AVG_THRESHOLD: 2000,   // avg > 2000 → mm
    M_AVG_THRESHOLD: 3,       // avg < 3 → m（如 1.2, 5.8 是米级别）
    M_MAX_THRESHOLD: 10       // max < 10 → m
  };

  /**
   * 组合尺寸正则
   * 匹配格式如 "1200×800×600"、"5.7*4.3*4.29"、"1200x800x600"
   * 注意：每个数字部分只匹配整数或单个小数，防止贪婪匹配 "1.2.3"
   */
  const COMBINED_DIM_PATTERN = /^([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)$/;

  // ── 关键词字典 ──
  const FIELD_KEYWORDS = {
    id: [
      '序号', '编号', 'No', 'No.', 'Item', '序号Item', '序号\nItem',
      'id', 'ID', '序列号', '行号'
    ],
    model: [
      '品名', '型号', '货号', '品号', '物料号', '商品编号', 'SN', 'SKU', 'Part No', 'Model',
      'Product Code', 'Item No', '货品编号', '产品型号', 'P/N', 'PartNumber', 'model',
      'part_no', 'sku', 'item_code', 'product_code', '规格型号', '品名规格'
    ],
    length: [
      '长', '长度', 'Length', 'L', 'L(mm)', 'L(cm)', 'L(m)', 'length',
      '外长', '包装长', '箱长', '长(mm)', '长(cm)', '长(m)',
      '尺寸', '包装尺寸', '规格尺寸', '外尺寸', '长宽高', '外形尺寸', '外箱尺寸', '箱体尺寸',
      'size', 'package size', 'dimension', 'dimensions', 'dim',
      'overall size', 'product size', 'cargo size', 'crate size',
      'packing size', 'packing dimensions', 'overall dim', 'crate dim'
    ],
    width: [
      '宽', '宽度', 'Width', 'W', 'W(mm)', 'W(cm)', 'W(m)', 'width',
      '外宽', '包装宽', '箱宽', '宽(mm)', '宽(cm)', '宽(m)'
    ],
    height: [
      '高', '高度', 'Height', 'H', 'H(mm)', 'H(cm)', 'H(m)', 'height',
      '外高', '包装高', '箱高', '高(mm)', '高(cm)', '高(m)'
    ],
    quantity: [
      '数量', '件数', '台数', 'Quantity', 'Qty', 'QTY', 'PCS', 'pcs', 'qty',
      'quantity', 'count', '箱数', '包装数量', '件', '个', '台'
    ],
    // 装箱算法优先使用毛重，没有毛重时才用净重
    grossWeight: [
      '毛重', '毛重(kg)', '毛重(吨)', '总重', 'Gross Weight', 'GW', 'G.W.',
      'gross_weight', 'grossWeight', 'weight_total', '总重量',
      '单件毛重', '每件毛重', 'G Weight',
      '重量', '重量(kg)', '重量(吨)', 'Weight', 'weight',
      '单重', '单位重量'
    ],
    netWeight: [
      '净重', '净重(kg)', '净重(吨)',
      'Net Weight', 'NW', 'N.W.', 'net_weight', 'netWeight'
    ],
    volume: [
      '体积', '体积(m³)', 'Volume', 'Vol', 'CBM', 'cbm', 'volume',
      '立方', '立方米', '包装体积'
    ],
    description: [
      '描述', '品名', '名称', '货物名称', 'Description', 'Desc', 'Name',
      'Product Name', '中文品名', '英文品名', '产品名称'
    ],
    stackable: [
      '可叠放', '是否可叠放', '叠放', 'Stackable', 'stackable',
      '可堆叠', '是否可堆叠', '堆叠', 'can be stacked', 'can stack'
    ]
  };

  // ── 表头识别 ──

  /**
   * 扫描前20行，检测表头行
   * 返回 { headerRowIndex, headerRow }
   */
  function detectHeader(rows) {
    let bestRow = -1;
    let bestScore = 0;

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      let score = 0;
      const rowStr = row.map(c => String(c || '')).join(' ').toLowerCase();

      for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
        for (const kw of keywords) {
          if (rowStr.includes(kw.toLowerCase())) {
            score += 1;
          }
        }
        // 单独的列也匹配
        for (const cell of row) {
          const cs = String(cell || '').trim().toLowerCase();
          for (const kw of keywords) {
            if (cs === kw.toLowerCase()) {
              score += 2; // 精确匹配加分
            }
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRow = i;
      }
    }

    return { headerRowIndex: bestRow, score: bestScore };
  }

  // ── 列语义映射 ──

  /**
   * 对每列进行语义分类
   * 返回字段类型数组
   */
  function classifyColumns(headerRow, sampleRows) {
    if (!headerRow) return [];

    const types = [];
    for (let col = 0; col < headerRow.length; col++) {
      const headerText = String(headerRow[col] || '').trim();
      types.push(classifyColumn(headerText, col, sampleRows));
    }
    return types;
  }

  function classifyColumn(headerText, colIndex, sampleRows) {
    const h = headerText.toLowerCase();
    const headerLines = h.split(/[\r\n\s]+/).filter(Boolean);

    // 1. 关键词匹配
    // 单字符关键词用边界检测（支持 "L (mm)" / "W:" 等格式，I2 修复）
    // 必须单字符开头，后面跟着空格/(/:
    const singleCharMatch = h.match(/^([lwh])[\s\(:]/) || headerLines.find(l => /^([lwh])[\s\(:]?$/.test(l));
    if (singleCharMatch) {
      const char = (singleCharMatch[1] || singleCharMatch).toUpperCase();
      if (char === 'L') return { field: 'length', confidence: 'high' };
      if (char === 'W') return { field: 'width', confidence: 'high' };
      if (char === 'H') return { field: 'height', confidence: 'high' };
    }
    // 如果整个表头就是纯单字符，直接精确匹配
    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      for (const kw of keywords) {
        const kl = kw.toLowerCase();
        if (kw.length === 1) {
          // 单行精确匹配，或多行中的任意一行精确匹配
          if (h === kl || headerLines.some(line => line === kl)) return { field, confidence: 'high' };
        } else {
          if (h.includes(kl) || h === kl || headerLines.some(line => line.includes(kl) || line === kl)) return { field, confidence: 'high' };
        }
      }
    }

    // 2. 正则匹配样本数据
    const samples = sampleRows
      .filter(r => r && r[colIndex] != null && String(r[colIndex]).trim() !== '')
      .slice(0, 20)
      .map(r => String(r[colIndex]).trim());

    if (samples.length > 0) {
      // 型号模式：字母数字组合如 NIG-25-2630-124-01
      const modelPattern = /^[A-Za-z0-9\-\_\.\/]+$/;
      const modelCount = samples.filter(s => modelPattern.test(s) && s.length > 3).length;
      if (modelCount >= samples.length * 0.6) {
        return { field: 'model', confidence: 'medium' };
      }

      // 数量列：纯整数
      const intCount = samples.filter(s => /^\d+$/.test(s)).length;
      if (intCount >= samples.length * 0.7) {
        // 看数字范围：>100 → 可能是数量或重量
        const nums = samples.filter(s => /^\d+$/.test(s)).map(Number);
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        if (avg < 1000 && nums.every(n => n === Math.floor(n))) {
          return { field: 'quantity', confidence: 'medium' };
        }
      }

      // 小数数字 → 可能是重量或体积
      const decimalCount = samples.filter(s => /^\d+\.?\d*$/.test(s)).length;
      if (decimalCount >= samples.length * 0.7) {
        const nums = samples.map(Number).filter(n => !isNaN(n));
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        if (avg > 0 && avg < 100) {
          return { field: 'possibleWeight', confidence: 'low' };
        }
        if (avg >= 100 && avg <= 5000) {
          return { field: 'possibleDimension', confidence: 'low' };
        }
      }

      // 组合尺寸模式：如 "5.7*4.3*4.29"、"1200×800×600"
      const combinedCount = samples.filter(s => COMBINED_DIM_PATTERN.test(s)).length;
      if (combinedCount >= samples.length * 0.6) {
        return { field: 'combinedDimension', confidence: 'high' };
      }
    }

    // 3. 如果表头为空，尝试从位置推断
    if (headerText === '' && colIndex < 6) {
      const posGuesses = ['model', 'length', 'width', 'height', 'quantity', 'grossWeight'];
      if (colIndex < posGuesses.length) {
        return { field: posGuesses[colIndex], confidence: 'low' };
      }
    }

    return { field: 'unknown', confidence: 'low' };
  }

  // ── 单位推断 ──

  /**
   * 推断尺寸列的单位
   * > 1000 → mm, < 30 → 可能是 m, 否则 cm
   */
  function inferUnit(values) {
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n) && n > 0);
    if (nums.length === 0) return 'cm';

    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const max = Math.max(...nums);

    if (max > UNIT_INFERENCE.MM_MAX_THRESHOLD) return 'mm';        // 如 12000 → 明显毫米
    if (avg > UNIT_INFERENCE.MM_AVG_THRESHOLD) return 'mm';
    if (avg < UNIT_INFERENCE.M_AVG_THRESHOLD && max < UNIT_INFERENCE.M_MAX_THRESHOLD) return 'm'; // 如 1.2, 5.8 → 米级别
    return 'cm';                         // 30~2000 → 厘米
  }

  /**
   * 从表头文字中检测尺寸单位
   * 支持格式：Length (m), Width(meters), Height (cm), Length(mm), etc.
   * 注意：检测顺序 mm → cm → m，避免 "cm" 中的 "m" 被误匹配
   * @returns {string|null} 'mm' | 'cm' | 'm' | null
   */
  function detectUnitFromHeader(headerText) {
    const h = String(headerText || '').toLowerCase();

    // mm: matches "mm", "millimeter", "millimeters"
    if (/mm|millimet/i.test(h)) return 'mm';

    // cm: matches "cm", "centimeter", "centimeters" — must come BEFORE "m"
    if (/cm|centimet/i.test(h)) return 'cm';

    // m: standalone "m" bounded by space/paren, or "meter"/"metre" word
    // 正则说明：
    //   (?:[\s(]|^)m(?=[\s)]|$)  → 匹配独立字母 "m"（前后是空格/括号/行首/行尾）
    //   met(?:er|re)s?            → 匹配 "meter" / "metre" / "meters" / "metres"
    //   metr                      → 匹配 "metric" 等以 "metr" 开头的词
    if (/(?:[\s(]|^)m(?=[\s)]|$)|met(?:er|re)s?|metr/i.test(h)) return 'm';

    return null;
  }

  // ── 数据清洗 ──

  function normalizeNumber(str) {
    if (str == null) return NaN;
    // 全角数字转半角
    let s = String(str).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    // 全角小数点
    s = s.replace(/．/g, '.');
    // 移除非数字字符（保留小数点和负号）
    s = s.replace(/[^\d\.\-]/g, '');
    // 多个小数点视为无效数据
    const parts = s.split('.');
    if (parts.length > 2) return NaN;
    return parseFloat(s);
  }

  function isDataRow(row, headerRow) {
    if (!row || row.length === 0) return false;
    // 跳过汇总行（含"合计"、"总计"、"Total"等）
    const rowStr = row.map(c => String(c || '')).join(' ').toLowerCase();
    const skipWords = ['合计', '总计', '小计', 'total', 'sum', 'subtotal', '备注', 'remark'];
    if (skipWords.some(w => rowStr.includes(w))) return false;

    // 至少有一列是数字或型号格式
    let hasContent = false;
    for (const cell of row) {
      const s = String(cell || '').trim();
      if (s !== '' && !['-', '--', '/'].includes(s)) {
        hasContent = true;
        break;
      }
    }
    return hasContent;
  }

  // ── 多尺寸 SKU 处理 ──

  /**
   * 检测同一型号是否有多组不同尺寸
   * 返回 { [model]: [{ dimensions, quantity, rows }] }
   */
  function detectMultiSize(items) {
    const groups = {};
    for (const item of items) {
      if (!item.model) continue;
      const key = `${item.model}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ l: item.l, w: item.w, h: item.h, quantity: item.quantity, item });
    }

    const multiSize = {};
    for (const [model, entries] of Object.entries(groups)) {
      // 按尺寸分组
      const sizeGroups = [];
      for (const entry of entries) {
        const dimKey = `${entry.l.toFixed(3)}x${entry.w.toFixed(3)}x${entry.h.toFixed(3)}`;
        const existing = sizeGroups.find(g => g.dimKey === dimKey);
        if (existing) {
          existing.quantity += entry.quantity;
          existing.entries.push(entry);
        } else {
          sizeGroups.push({ dimKey, l: entry.l, w: entry.w, h: entry.h, quantity: entry.quantity, entries: [entry] });
        }
      }

      if (sizeGroups.length > 1) {
        // 计算体积，默认选最大的
        sizeGroups.sort((a, b) => (b.l * b.w * b.h) - (a.l * a.w * a.h));
        multiSize[model] = {
          groups: sizeGroups,
          selected: sizeGroups[0], // 默认选最大
          count: sizeGroups.length
        };
      }
    }

    return multiSize;
  }

  // ── 主解析函数 ──

  /**
   * 解析 Excel/CSV 文件
   * @param {ArrayBuffer} data
   * @param {string} fileName
   * @returns {{ sheets: Array, parsedData: object }}
   */
  function parseFile(data, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    let workbook;

    if (ext === 'csv') {
      // CSV：自动检测分隔符
      const text = new TextDecoder().decode(data);
      const delimiter = detectDelimiter(text);
      workbook = XLSX.read(text, { type: 'string', raw: true, delimiter });
    } else {
      workbook = XLSX.read(data, { type: 'array', raw: true });
    }

    const sheetNames = workbook.SheetNames;
    const sheets = [];
    let allRows = [];
    let totalRows = 0;

    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
      sheets.push({ name, rowCount: json.length, data: json });
      totalRows += json.length;
      allRows = allRows.concat(json);
    }

    // 去重表头行（合并多个Sheet时可能有重复表头）
    const cleanedRows = cleanMergedRows(allRows, totalRows);

    // 检测表头
    const { headerRowIndex } = detectHeader(cleanedRows);
    if (headerRowIndex < 0) {
      return { error: '无法识别表头行，请确认装箱单格式', sheets };
    }

    const headerRow = cleanedRows[headerRowIndex];
    const dataRows = cleanedRows.slice(headerRowIndex + 1).filter(r => isDataRow(r, headerRow));

    // 列分类
    const colTypes = classifyColumns(headerRow, dataRows);

    // 提取数据
    const extractResult = extractItems(dataRows, headerRow, colTypes);

    // 生成映射建议
    const mapping = buildMapping(colTypes, headerRow);

    return {
      sheets,
      headerRowIndex,
      headerRow,
      totalDataRows: dataRows.length,
      mapping,
      items: extractResult.items,
      warnings: extractResult.warnings,
      totalRawRows: cleanedRows.length
    };
  }

  /**
   * 合并多个Sheet的行，清理重复表头
   */
  function cleanMergedRows(allRows, totalRows) {
    if (allRows.length === 0) return [];
    // 简单的去重：如果相邻两行完全相同，合并
    const cleaned = [allRows[0]];
    for (let i = 1; i < allRows.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      const curr = allRows[i];
      if (JSON.stringify(prev) !== JSON.stringify(curr)) {
        cleaned.push(curr);
      }
    }
    return cleaned;
  }

  /**
   * 从数据行中提取货物列表
   */
  function extractItems(dataRows, headerRow, colTypes, forceDimUnit) {
    const items = [];
    const warnings = [];

    // 找到各字段对应的列索引
    let idCol = -1, modelCol = -1, lengthCol = -1, widthCol = -1, heightCol = -1,
        qtyCol = -1, weightCol = -1, netWeightCol = -1, volCol = -1, stackableCol = -1;

    for (let i = 0; i < colTypes.length; i++) {
      switch (colTypes[i]?.field) {
        case 'id': if (idCol < 0) idCol = i; break;
        case 'model': if (modelCol < 0) modelCol = i; break;
        case 'length': if (lengthCol < 0) lengthCol = i; break;
        case 'width': if (widthCol < 0) widthCol = i; break;
        case 'height': if (heightCol < 0) heightCol = i; break;
        case 'quantity': if (qtyCol < 0) qtyCol = i; break;
        case 'grossWeight': if (weightCol < 0) weightCol = i; break;
        case 'netWeight': if (netWeightCol < 0) netWeightCol = i; break;
        case 'stackable': if (stackableCol < 0) stackableCol = i; break;
        case 'combinedDimension': if (lengthCol < 0) lengthCol = i; break;
        case 'possibleDimension':
          if (lengthCol < 0) lengthCol = i;
          else if (widthCol < 0) widthCol = i;
          else if (heightCol < 0) heightCol = i;
          break;
        case 'possibleWeight': if (weightCol < 0) weightCol = i; break;
        case 'volume': volCol = i; break;
      }
    }

    // 优先使用毛重，没有毛重列时才用净重
    if (weightCol < 0 && netWeightCol >= 0) {
      weightCol = netWeightCol;
    }

    if (modelCol < 0) {
      warnings.push('未找到型号列，将使用行号作为临时型号');
    }
    if (lengthCol < 0 || widthCol < 0 || heightCol < 0) {
      warnings.push('未找到完整的三维尺寸列（长/宽/高），装箱计算可能不准确');
    }
    if (qtyCol < 0) {
      warnings.push('未找到数量列，默认每行数量=1');
    }
    if (weightCol < 0) {
      warnings.push('未找到重量列，将使用体积估算重量');
    }

    // 推断尺寸单位：优先传入的 forceDimUnit，其次表头声明，最后数值推断
    let dimUnit = 'mm';
    if (forceDimUnit) {
      dimUnit = forceDimUnit;
    } else {
      const dimIndices = [lengthCol, widthCol, heightCol].filter(i => i >= 0);
      const headerUnits = new Set();
      for (const idx of dimIndices) {
        const unit = detectUnitFromHeader(headerRow[idx]);
        if (unit) headerUnits.add(unit);
      }

      if (headerUnits.size === 1) {
        dimUnit = [...headerUnits][0];
      } else if (headerUnits.size > 1) {
        warnings.push('表头中检测到多个不同的尺寸单位 (' +
          [...headerUnits].join(', ') + ')，将根据数值自动推断');
        const lengthValues = dataRows.map(r => r[lengthCol]).filter(v => v != null && v !== '');
        dimUnit = inferUnit(lengthValues);
      // I1: 推断单位时从实际拆分的 l/w/h 中采样，而非仅从 lengthCol
    } else {
      // 从全部尺寸列的值中采样：优先组合列拆分后的各维度，其次单独列
      const allValues = [];
      for (const idx of dimIndices) {
        if (idx >= 0) {
          dataRows.forEach(r => {
            const v = r[idx];
            if (v != null && v !== '') {
              const n = parseFloat(v);
              if (!isNaN(n)) allValues.push(n);
            }
          });
        }
      }
      dimUnit = inferUnit(allValues.length > 0 ? allValues : []);
    }
  }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rawId = idCol >= 0 ? String(row[idCol] || '').trim() : '';
      const seqId = rawId || `Item-${i + 1}`;
      const model = modelCol >= 0 ? String(row[modelCol] || '').trim() : seqId;
      if (!model) continue;

      let rawL = NaN, rawW = NaN, rawH = NaN;

      // 单列组合尺寸拆分：先检查是否包含分隔符，避免 normalizeNumber 误解析
      // 如 "5.7*4.3*4.29" → normalizeNumber 会得到 5.74（假数值），拦截拆分逻辑
      if (lengthCol >= 0) {
        const rawStr = String(row[lengthCol] || '').trim();
        // 检查是否包含尺寸分隔符（×/x/X/*）
        if (/[×xX*]/.test(rawStr)) {
          // 预处理：修复脏数据空格，如 "2. 12" → "2.12", "1. 13" → "1.13"
          const cleaned = rawStr
            .replace(/(\d)\s+\.\s*(\d)/g, '$1.$2')   // "2 .12" → "2.12"
            .replace(/\.\s+(\d)/g, '.$1');             // "2. 12" → "2.12"
          const splitMatch = cleaned.match(COMBINED_DIM_PATTERN);
          if (splitMatch) {
            rawL = parseFloat(splitMatch[1]);
            rawW = parseFloat(splitMatch[2]);
            rawH = parseFloat(splitMatch[3]);
            if (!warnings.includes('combined_dim_split')) {
              warnings.push(`检测到单列组合尺寸格式（如 "${rawStr}"），已自动拆分为长/宽/高`);
            }
          }
        }
        // 非组合格式 → 正常 numeric 解析
        if (isNaN(rawL)) rawL = normalizeNumber(row[lengthCol]);
      }
      if (isNaN(rawW) && widthCol >= 0) rawW = normalizeNumber(row[widthCol]);
      if (isNaN(rawH) && heightCol >= 0) rawH = normalizeNumber(row[heightCol]);
      const rawQty = qtyCol >= 0 ? normalizeNumber(row[qtyCol]) : 1;
      const rawWeight = weightCol >= 0 ? normalizeNumber(row[weightCol]) : NaN;

      if (isNaN(rawL) || isNaN(rawW) || isNaN(rawH)) {
        warnings.push(`第${i + 2}行 "${model}" 尺寸数据不完整，已跳过`);
        continue;
      }
      if (rawL <= 0 || rawW <= 0 || rawH <= 0) continue;

      // 单位转换：统一转为米(m)
      let l = rawL, w = rawW, h = rawH;
      if (dimUnit === 'mm') { l /= 1000; w /= 1000; h /= 1000; }
      else if (dimUnit === 'cm') { l /= 100; w /= 100; h /= 100; }
      // 如果dimUnit是'm'，不需要转换

      // 重量单位推断
      let weight = rawWeight;
      if (!isNaN(rawWeight)) {
        // 看是否可能是吨
        if (rawWeight < 10 && rawWeight > 0) {
          const allWeights = dataRows.map(r => weightCol >= 0 ? normalizeNumber(r[weightCol]) : NaN).filter(n => !isNaN(n));
          const maxW = Math.max(...allWeights, 0);
          if (maxW < 10) {
            weight = rawWeight * 1000; // 吨转kg
            if (!warnings.includes('weight_unit_converted')) {
              warnings.push('检测到重量可能以吨为单位，已自动转为kg');
            }
          }
        }
      } else {
        weight = 0; // 无重量时设为0
      }

      const qty = isNaN(rawQty) || rawQty <= 0 ? 1 : Math.round(rawQty);

      // 解析可叠放标志
      let stackable = true;
      if (stackableCol >= 0) {
        const rawStackable = String(row[stackableCol] || '').trim().toLowerCase();
        // 注意：noValues/yesValues 均使用精确匹配，避免子串误判（如 'x' 匹配到 '0.5x' 等）
        const noValues = ['否', 'no', 'n', 'false', '不可', '禁止', '不能', '×', 'x', '0', '无'];
        const yesValues = ['是', 'yes', 'y', 'true', '可', '允许', '可以', '能', '√', '✓', '1'];
        if (noValues.includes(rawStackable)) {
          stackable = false;
        } else if (yesValues.includes(rawStackable)) {
          stackable = true;
        } else if (rawStackable !== '') {
          // 尝试解析为数字：0 = 否, >0 = 是
          const numVal = parseFloat(rawStackable);
          if (!isNaN(numVal)) stackable = numVal > 0;
        }
      }

      items.push({
        id: seqId,
        sequence: seqId,
        model,
        l, w, h,
        quantity: qty,
        weight: weight || 0,
        stackable,
        orientationFixed: false,
        originalRow: i + 2,
        volume: l * w * h
      });
    }

    return { items, warnings, dimUnit };
  }

  /**
   * 构建列映射信息
   */
  function buildMapping(colTypes, headerRow) {
    return colTypes.map((t, i) => ({
      index: i,
      header: String(headerRow[i] || `列${i + 1}`).trim(),
      field: t.field,
      confidence: t.confidence,
      sample: ''
    }));
  }

  /**
   * CSV 分隔符自动检测
   */
  function detectDelimiter(text) {
    const firstLine = text.split('\n')[0] || '';
    const candidates = [',', ';', '\t', '|'];
    let bestDelim = ',';
    let bestCount = 0;
    for (const d of candidates) {
      const count = (firstLine.match(new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count > bestCount) { bestCount = count; bestDelim = d; }
    }
    return bestDelim;
  }

  /**
   * 手动覆盖列映射后重新提取数据
   */
  function reExtract(dataRows, headerRow, newMapping, dimUnit) {
    const colTypes = newMapping.map(m => ({ field: m.field, confidence: 'manual' }));
    // M1: 在 reExtract 中也过滤脏数据行
    const filteredRows = dataRows.filter(isDataRow);
    const result = extractItems(filteredRows, headerRow, colTypes, dimUnit);
    return result;
  }

  // ── 公开 API ──
  return {
    parseFile,
    detectHeader,
    classifyColumns,
    inferUnit,
    detectMultiSize,
    reExtract,
    normalizeNumber,
    detectUnitFromHeader,
    FIELD_KEYWORDS
  };
})();

window.FieldParser = FieldParser;