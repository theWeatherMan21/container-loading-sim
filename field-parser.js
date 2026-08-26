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
    // F-04: 判 m 条件放宽为 max<10 && (min>=1 || avg<3)：
    //   min>=1 覆盖 [6.5,2.4,2.6] 米制大件（旧 avg<3 漏判，avg=3.83 被误判 cm）；
    //   avg<3 保留，覆盖 [1.2,0.8,0.6]/[0.5,0.4,0.3] 等 0.x 米小箱（避免 min<1 误判 cm 回归）
    M_AVG_THRESHOLD: 3,       // avg < 3 → m（0.x~3 米级小箱）
    M_MIN_THRESHOLD: 1,       // min >= 1 → m（1~10 米级大件，配合 max<10）
    M_MAX_THRESHOLD: 10       // max < 10 → m
  };

  /**
   * 组合尺寸正则
   * 匹配格式如 "1200×800×600"、"5.7*4.3*4.29"、"1200x800x600"
   * F-05: 每维度支持可选单位后缀："1.5m×2m×3m"、"1200mm×800mm×600mm"、"1.5m×800mm×60cm"
   * 注意：
   *  - /i 标志：单位后缀大小写通吃（"1.5M×2M×3M"、"1200MM×800MM×600MM"）
   *  - 每个数字部分只匹配整数或单个小数，防止贪婪匹配 "1.2.3"
   *  - 单位 alternation 长词在前（mm 在 m 前、inch 在 in 前、毫米/厘米 在 米 前），避免前缀误吞
   */
  const COMBINED_DIM_PATTERN = /^([\d]+(?:\.[\d]+)?)\s*(mm|cm|m|inch|in|ft|英尺|厘米|毫米|米)?\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)\s*(mm|cm|m|inch|in|ft|英尺|厘米|毫米|米)?\s*[×xX*]\s*([\d]+(?:\.[\d]+)?)\s*(mm|cm|m|inch|in|ft|英尺|厘米|毫米|米)?$/i;

  /**
   * 尺寸单位换算表：单位后缀 → 米(m) 倍率（F-05）
   * 1mm=0.001、1cm=0.01、1m=1、1inch=0.0254、1ft=0.3048
   */
  const DIM_UNIT_TO_M = {
    'mm': 0.001, '毫米': 0.001,
    'cm': 0.01, '厘米': 0.01,
    'm': 1, '米': 1,
    'inch': 0.0254, 'in': 0.0254,
    'ft': 0.3048, '英尺': 0.3048
  };

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
    const warnings = [];
    const colCount = headerRow.length;
    for (let col = 0; col < headerRow.length; col++) {
      const headerText = String(headerRow[col] || '').trim();
      types.push(classifyColumn(headerText, col, sampleRows, colCount, warnings));
    }
    // 附加警告通道（数组可带属性，公开签名/序列化形态不变）
    types.warnings = warnings;
    return types;
  }

  function classifyColumn(headerText, colIndex, sampleRows, colCount, warnings) {
    // F-06: 全角括号归一化（"长（毫米）" → "长(毫米)"，让 '长(mm)' 等关键词命中，避免列分类失败）
    const h = headerText.toLowerCase().replace(/[（）]/g, m => m === '（' ? '(' : ')');
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
    // D-13: 关键词按长度降序匹配（长关键词优先），避免 "单件毛重(kg)" 被 quantity 的 "件" 子串抢占
    // 单字符关键词仅做整头/整行精确匹配，多字符关键词才允许子串匹配
    const rankedKeywords = [];
    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      for (const kw of keywords) {
        rankedKeywords.push({ field, kl: kw.toLowerCase(), len: kw.length });
      }
    }
    rankedKeywords.sort((a, b) => b.len - a.len);
    for (const { field, kl, len } of rankedKeywords) {
      if (len === 1) {
        // 单行精确匹配，或多行中的任意一行精确匹配
        if (h === kl || headerLines.some(line => line === kl)) return { field, confidence: 'high' };
      } else {
        if (h === kl || headerLines.some(line => line === kl || line.includes(kl))) return { field, confidence: 'high' };
      }
    }

    // 2. 正则匹配样本数据
    const samples = sampleRows
      .filter(r => r && r[colIndex] != null && String(r[colIndex]).trim() !== '')
      .slice(0, 20)
      .map(r => String(r[colIndex]).trim());

    if (samples.length > 0) {
      // 型号模式：字母数字组合如 NIG-25-2630-124-01
      // F-03: 纯数字（≥4 位）不得判为型号 → 至少含一个字母，或含 -/./_ 分隔符
      const modelPattern = /^[A-Za-z0-9\-\_\.\/]+$/;
      const modelCount = samples.filter(s =>
        modelPattern.test(s) && s.length > 3 &&
        (/[A-Za-z]/.test(s) || /[\-\_\.\/]/.test(s))
      ).length;
      if (modelCount >= samples.length * 0.6) {
        return { field: 'model', confidence: 'medium' };
      }

      // 纯整数列（F-03 优先级重排：尺寸表头 > 列数推断 > 数量）
      const intCount = samples.filter(s => /^\d+$/.test(s)).length;
      if (intCount >= samples.length * 0.7) {
        const nums = samples.filter(s => /^\d+$/.test(s)).map(Number);
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        // ① 表头含尺寸关键词（长/宽/高/L/W/H/尺寸/dimension 等）→ 优先判尺寸
        const dimHeaderHit = /长|宽|高|尺寸|length|width|height|dimension|dimension/i.test(h);
        if (dimHeaderHit) {
          return { field: 'possibleDimension', confidence: 'medium' };
        }
        // ② 无尺寸表头关键词：列数 ≥3 且数值范围合理（1~50000）且全整数 → 推断为尺寸列并推警告
        const colCountNum = (typeof colCount === 'number' && colCount > 0) ? colCount : (colIndex + 1);
        if (colCountNum >= 3 && nums.length > 0 && nums.every(n => n >= 1 && n <= 50000)) {
          if (warnings && !warnings.includes(`col_dim_inferred_${colIndex}`)) {
            warnings.push(`列${colIndex + 1}（表头"${headerText || '(空)'}"）无尺寸关键词，但数值范围疑似尺寸列，已推断为尺寸（请确认）`);
          }
          return { field: 'possibleDimension', confidence: 'low' };
        }
        // ③ 数量判定：avg<1000 且全整数，且不超过合理上限（>100000 不判数量）
        if (avg < 1000 && nums.every(n => n === Math.floor(n)) && nums.every(n => n <= 100000)) {
          return { field: 'quantity', confidence: 'medium' };
        }
      }

      // 小数数字 → 可能是重量或体积
      const decimalCount = samples.filter(s => /^\d+\.?\d*$/.test(s)).length;
      if (decimalCount >= samples.length * 0.7) {
        const nums = samples.map(Number).filter(n => !isNaN(n));
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        // F-06: 表头明确含尺寸关键词（长/宽/高/尺寸/L/W/H/dimension 等）时，
        // 小数列也优先判尺寸——否则 "长(米)"+1.5/2/3 会被 possibleWeight 抢占，尺寸列全丢
        const dimHeaderHit = /长|宽|高|尺寸|length|width|height|dimension/i.test(h);
        if (dimHeaderHit) {
          return { field: 'possibleDimension', confidence: 'medium' };
        }
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
   * F-04: 带歧义信号的单位推断（内部使用）
   * 逻辑与 inferUnit 完全一致，额外返回 ambiguous 信号：
   * 当推断结果为 cm 且 max 落在 [50, 2000]（如 200×150×100、800×600×500、
   * 1200×800×50，数值上既可能厘米也可能毫米）时返回 { unit: 'cm', ambiguous: true }。
   * 供 extractItems 推送"尺寸单位存疑（疑似毫米或厘米），请核对"警告。
   * 不改变推断值（保守：仅提示，不强行改写）。
   */
  function inferUnitWithSignal(values) {
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n) && n > 0);
    if (nums.length === 0) return { unit: 'cm', ambiguous: false };

    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const max = Math.max(...nums);
    const min = Math.min(...nums);

    let unit;
    if (max > UNIT_INFERENCE.MM_MAX_THRESHOLD) unit = 'mm';        // 如 12000 → 明显毫米
    else if (avg > UNIT_INFERENCE.MM_AVG_THRESHOLD) unit = 'mm';
    // 增强：全部维度都 ≥100 且最大值 ≥1000 → 工业装箱单典型毫米（如 2500X2750X2800）。
    // 厘米下 1000+ 意味着 10m+ 的货物，在装箱场景极不合理；毫米下 100 是 10cm 小件。
    else if (min >= 100 && max >= 1000) unit = 'mm';
    // F-04: 分支④阈值放宽。旧规则 avg<3 && max<10 漏判 [6.5,2.4,2.6]（avg=3.83）；
    // 新规则 max<10 && (min>=1 || avg<3)：
    //   min>=1 覆盖 1~10 米级大件；avg<3 保留覆盖 0.x 米小箱（[1.2,0.8,0.6] 等，防回归）
    else if (max < UNIT_INFERENCE.M_MAX_THRESHOLD &&
             (min >= UNIT_INFERENCE.M_MIN_THRESHOLD || avg < UNIT_INFERENCE.M_AVG_THRESHOLD)) unit = 'm'; // 如 1.2, 5.8, 6.5 → 米级别
    else unit = 'cm';                         // 30~2000 → 厘米

    // F-04: 判 cm 且 max∈[50,2000] → 可能是 mm（mm 量纲下 50~2000 即 5cm~2m，装箱场景常见）
    const ambiguous = unit === 'cm' && max >= 50 && max <= 2000;
    return { unit, ambiguous };
  }

  /**
   * 推断尺寸列的单位
   * > 1000 → mm, < 30 → 可能是 m, 否则 cm
   * 公开 API 签名保持 string（歧义信号走内部 inferUnitWithSignal）
   */
  function inferUnit(values) {
    return inferUnitWithSignal(values).unit;
  }

  /**
   * 从表头文字中检测尺寸单位
   * 支持格式：Length (m), Width(meters), Height (cm), Length(mm), etc.
   * 注意：检测顺序 mm → cm → m，避免 "cm" 中的 "m" 被误匹配
   * @returns {string|null} 'mm' | 'cm' | 'm' | null
   */
  function detectUnitFromHeader(headerText) {
    // F-06: 全角括号先归一化（"长（毫米）" → "长(毫米)"），再检测中文尺寸单位
    let h = String(headerText || '').toLowerCase().replace(/[（）]/g, m => m === '（' ? '(' : ')');

    // F-06: 中文尺寸单位优先（长词在前："毫米/厘米/公分" 含 "米" 子串，必须排在 "米" 前）
    // 重量单位（公斤/千克/克/吨/磅/盎司）由 detectWeightUnitFromHeader 负责，此处不重复实现
    if (/毫米/.test(h)) return 'mm';
    if (/厘米|公分/.test(h)) return 'cm';
    if (/米/.test(h)) return 'm';

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

  /**
   * 从表头文字中检测重量单位（F-02 扩展：lb/oz/g/ton 支持）
   * 检测顺序：kg → ton → lb → oz → g → t（长词优先，避免 "kg" 的 "g"、"ton" 的 "t" 误匹配）
   * @returns {string|null} 'kg' | 'g' | 'ton' | 'lb' | 'oz' | null
   */
  function detectWeightUnitFromHeader(headerText) {
    const h = String(headerText || '').toLowerCase();
    if (/千克|公斤|kilogram|kilograms|kg/.test(h)) return 'kg';
    if (/吨|tonne|tonnes|metric ton|\bton\b|\btons\b/.test(h)) return 'ton';
    if (/磅|pound|pounds|\blb\b|\blbs\b/.test(h)) return 'lb';
    if (/盎司|ounce|ounces|\boz\b/.test(h)) return 'oz';
    if (/克|gram|grams|\bg\b/.test(h)) return 'g';
    if (/\bt\b/.test(h)) return 'ton';
    return null;
  }

  /**
   * 重量单位换算表：单位后缀/表头单位 → kg 倍率
   * 1g=0.001kg、1t=1000kg、1lb=0.4536kg、1oz=0.02835kg
   */
  const WEIGHT_UNIT_MAP = {
    'kg': 1, '千克': 1, '公斤': 1,
    'g': 0.001, '克': 0.001, 'gram': 0.001, 'grams': 0.001,
    't': 1000, 'ton': 1000, 'tons': 1000, '吨': 1000,
    'lb': 0.4536, 'lbs': 0.4536, 'pound': 0.4536, 'pounds': 0.4536, '磅': 0.4536,
    'oz': 0.02835, 'ounce': 0.02835, 'ounces': 0.02835, '盎司': 0.02835
  };

  /**
   * F-02: 解析单行重量原始值 → kg
   * 优先级：行内单位后缀 > 表头单位 > 原数值（启发式吨转换由调用方按全列判定）
   * @param {*} raw 原始单元格值
   * @param {string|null} headerUnit 表头单位（detectWeightUnitFromHeader 结果）
   * @returns {{ kg: number, unit: string|null, warning: string|null }}
   */
  function parseWeightValue(raw, headerUnit) {
    if (raw == null) return { kg: NaN, unit: null, warning: null };
    let s = String(raw).trim();
    if (s === '') return { kg: NaN, unit: null, warning: null };
    // 全角转半角（数字/小数点/字母，兼容 "５００ｇ" 等全角写法）
    s = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    s = s.replace(/．/g, '.');
    s = s.replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    s = s.trim();

    // 1) 数值 + 单位后缀（如 "500g" "5lb" "2.5kg" "1t" "5 磅"）
    const unitMatch = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z]+|千克|公斤|克|吨|磅|盎司)?$/);
    if (unitMatch) {
      const num = parseFloat(unitMatch[1]);
      const suffix = unitMatch[2] ? unitMatch[2].toLowerCase() : null;
      if (suffix && WEIGHT_UNIT_MAP[suffix] != null) {
        return { kg: num * WEIGHT_UNIT_MAP[suffix], unit: suffix, warning: null };
      }
      if (suffix) {
        // 未知字母后缀（如 "500pcs"）→ 按原数值处理并提示
        return { kg: num, unit: null, warning: `检测到无法识别的重量单位 "${unitMatch[2]}"，按原数值处理` };
      }
      // 无后缀 → 表头单位优先
      if (headerUnit && WEIGHT_UNIT_MAP[headerUnit] != null) {
        return { kg: num * WEIGHT_UNIT_MAP[headerUnit], unit: headerUnit, warning: null };
      }
      return { kg: num, unit: null, warning: null };
    }

    // 2) 科学计数法（"1.5E3"/"1e3"），E 后带数字不会被上面的字母后缀正则匹配
    if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
      const sci = parseFloat(s);
      return { kg: isNaN(sci) ? NaN : sci, unit: null, warning: null };
    }

    // 3) 兜底：normalizeNumber（剥除其他字符）
    return { kg: normalizeNumber(s), unit: null, warning: null };
  }

  // ── 数据清洗 ──

  function normalizeNumber(str) {
    if (str == null) return NaN;
    // 全角数字转半角
    let s = String(str).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    // 全角小数点
    s = s.replace(/．/g, '.');
    // 全角字母转半角（避免 "５００ｇ" 等全角单位后缀干扰）
    s = s.replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    s = s.trim();
    // C-N2: 科学计数法优先检测（"1.5E3"/"1e3"），直接 parseFloat，不走字符剥离
    if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(s)) {
      const sci = parseFloat(s);
      return isNaN(sci) ? NaN : sci;
    }
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
    const colWarnings = colTypes.warnings || [];

    // 提取数据
    const extractResult = extractItems(dataRows, headerRow, colTypes);

    // 合并列分类警告与提取警告（去重）
    const mergedWarnings = [];
    for (const w of [...colWarnings, ...(extractResult.warnings || [])]) {
      if (!mergedWarnings.includes(w)) mergedWarnings.push(w);
    }

    // 生成映射建议
    const mapping = buildMapping(colTypes, headerRow);

    return {
      sheets,
      headerRowIndex,
      headerRow,
      totalDataRows: dataRows.length,
      mapping,
      items: extractResult.items,
      warnings: mergedWarnings,
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
   * D-16: 从全部尺寸列采样数值用于单位推断
   * 组合列（"2500X2750X2800"）拆分出所有维度参与推断，
   * 避免 parseFloat 只取第一个数字导致范围失真（如 2500 vs 2500/2750/2800）。
   */
  function collectDimSamples(dataRows, dimIndices) {
    const allValues = [];
    for (const idx of dimIndices) {
      if (idx < 0) continue;
      dataRows.forEach(r => {
        const v = r[idx];
        if (v == null || v === '') return;
        const rawStr = String(v).trim();
        if (/[×xX*]/.test(rawStr)) {
          const parts = rawStr.split(/[×xX*]/);
          for (const part of parts) {
            const n = parseFloat(part);
            if (!isNaN(n) && n > 0) allValues.push(n);
          }
        } else {
          const n = parseFloat(v);
          if (!isNaN(n)) allValues.push(n);
        }
      });
    }
    return allValues;
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
        case 'grossWeight':
          // 空表头列可能被误判为 grossWeight（confidence low）。
          // 优先"表头非空 + 数据列有值"的重量列，避免空列抢占（如 G 列真重量被跳过的 bug）。
          if (weightCol < 0) weightCol = i;
          else {
            const curHeader = String(headerRow[weightCol] || '').trim();
            const newHeader = String(headerRow[i] || '').trim();
            const curHasData = dataRows.some(r => r[weightCol] != null && String(r[weightCol]).trim() !== '');
            const newHasData = dataRows.some(r => r[i] != null && String(r[i]).trim() !== '');
            // 当前列是空表头/无数据，新列是真实重量列 → 替换
            if ((!curHeader || !curHasData) && (newHeader || newHasData)) weightCol = i;
          }
          break;
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
      } else {
        // D-16: 多单位冲突分支同样使用"全维度 + 组合尺寸拆分"采样（与无表头单位分支一致）
        // F-04: 统一走 inferUnitWithSignal，判 cm 且 max∈[50,2000] 时推"疑似毫米"歧义警告
        if (headerUnits.size > 1) {
          warnings.push('表头中检测到多个不同的尺寸单位 (' +
            [...headerUnits].join(', ') + ')，将根据数值自动推断');
        }
        const allValues = collectDimSamples(dataRows, dimIndices);
        const sig = inferUnitWithSignal(allValues.length > 0 ? allValues : []);
        dimUnit = sig.unit;
        if (sig.ambiguous && sig.unit === 'cm' && !warnings.includes('dim_unit_ambiguous')) {
          warnings.push('尺寸单位存疑（疑似毫米或厘米），请核对');
        }
        if (headerUnits.size === 0 && !warnings.includes('dim_unit_inferred')) {
          warnings.push(`表头未声明尺寸单位，已根据数值推断为 ${dimUnit}，请确认单位是否正确`);
        }
      }
    }

    // 重量表头单位（F-02：kg/g/t/lb/oz 检测，供整列换算与 F-01 启发式判定）
    let weightHeaderUnit = null;
    if (weightCol >= 0) {
      weightHeaderUnit = detectWeightUnitFromHeader(headerRow[weightCol]);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rawId = idCol >= 0 ? String(row[idCol] || '').trim() : '';
      const seqId = rawId || `Item-${i + 1}`;
      const model = modelCol >= 0 ? String(row[modelCol] || '').trim() : seqId;
      if (!model) continue;

      let rawL = NaN, rawW = NaN, rawH = NaN;
      // F-05: 组合尺寸若含行内单位后缀，rawL/W/H 直接按后缀换算为米（混合单位无法统一换算）
      let combinedDimsInMeters = false;

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
            // F-05: 每维度可选单位后缀（"1.5m×2m×3m"、"1200mm×800mm×600mm"、混合单位）
            // 正则 /i 标志允许大写（"1.5M×2M×3M"），此处统一 toLowerCase 再查换算表
            // 有后缀 → 按后缀换算为米；无后缀 → 沿用整列推断单位 dimUnit
            const dimParts = [
              { num: parseFloat(splitMatch[1]), unit: splitMatch[2] ? splitMatch[2].toLowerCase() : null },
              { num: parseFloat(splitMatch[3]), unit: splitMatch[4] ? splitMatch[4].toLowerCase() : null },
              { num: parseFloat(splitMatch[5]), unit: splitMatch[6] ? splitMatch[6].toLowerCase() : null }
            ];
            let rowUnitConflict = false;
            const meters = dimParts.map(dp => {
              if (dp.unit && DIM_UNIT_TO_M[dp.unit] != null) {
                // 后缀与整列推断单位不一致 → 以后缀为准并推警告（F-05）
                if (dimUnit != null && DIM_UNIT_TO_M[dimUnit] != null &&
                    DIM_UNIT_TO_M[dimUnit] !== DIM_UNIT_TO_M[dp.unit]) {
                  rowUnitConflict = true;
                }
                return dp.num * DIM_UNIT_TO_M[dp.unit];
              }
              // 无后缀 → 整列推断单位换算
              if (dimUnit === 'mm') return dp.num / 1000;
              if (dimUnit === 'cm') return dp.num / 100;
              return dp.num; // 'm' 或未知 → 原值即米
            });
            rawL = meters[0];
            rawW = meters[1];
            rawH = meters[2];
            combinedDimsInMeters = true;
            if (!warnings.includes('combined_dim_split')) {
              warnings.push(`检测到单列组合尺寸格式（如 "${rawStr}"），已自动拆分为长/宽/高`);
            }
            if (rowUnitConflict && !warnings.includes('combined_dim_unit_conflict')) {
              warnings.push(`行内尺寸单位与整列推断单位（${dimUnit}）不一致，已按行内单位后缀换算`);
            }
          }
        }
        // 非组合格式 → 正常 numeric 解析
        if (isNaN(rawL)) rawL = normalizeNumber(row[lengthCol]);
      }
      if (isNaN(rawW) && widthCol >= 0) rawW = normalizeNumber(row[widthCol]);
      if (isNaN(rawH) && heightCol >= 0) rawH = normalizeNumber(row[heightCol]);
      const rawQty = qtyCol >= 0 ? normalizeNumber(row[qtyCol]) : 1;

      if (isNaN(rawL) || isNaN(rawW) || isNaN(rawH)) {
        warnings.push(`第${i + 2}行 "${model}" 尺寸数据不完整，已跳过`);
        continue;
      }
      // F-10 修复：非正尺寸行不再静默跳过，补 warning（与上方 NaN 分支口径一致）
      if (rawL <= 0 || rawW <= 0 || rawH <= 0) {
        warnings.push(`第${i + 2}行 "${model}" 尺寸非正（${rawL}×${rawW}×${rawH}），已跳过`);
        continue;
      }

      // 单位转换：统一转为米(m)
      let l = rawL, w = rawW, h = rawH;
      if (!combinedDimsInMeters) {
        if (dimUnit === 'mm') { l /= 1000; w /= 1000; h /= 1000; }
        else if (dimUnit === 'cm') { l /= 100; w /= 100; h /= 100; }
        // 如果dimUnit是'm'，不需要转换
      }

      // F-02: 重量解析（行内单位后缀 > 表头单位 > 启发式）
      let weight = NaN;
      let weightNote = null;
      if (weightCol >= 0 && String(row[weightCol] || '').trim() !== '') {
        const parsed = parseWeightValue(row[weightCol], weightHeaderUnit);
        weight = parsed.kg;
        if (parsed.warning) weightNote = parsed.warning;
        // F-01: 吨启发式仅在"本行无单位后缀 + 表头无单位或明确吨 + 全列无显式单位行 + 全列 <10"时触发
        if (!isNaN(weight) && weight > 0 && weight < 10 && parsed.unit == null) {
          const hdrAllowsTon = weightHeaderUnit == null || WEIGHT_UNIT_MAP[weightHeaderUnit] === 1000;
          const colHasExplicitUnit = dataRows.some(r => {
            if (weightCol < 0 || String(r[weightCol] || '').trim() === '') return false;
            return parseWeightValue(r[weightCol], weightHeaderUnit).unit != null;
          });
          const rawNums = dataRows
            .map(r => weightCol >= 0 ? normalizeNumber(r[weightCol]) : NaN)
            .filter(n => !isNaN(n) && n > 0);
          const maxW = rawNums.length > 0 ? Math.max(...rawNums) : 0;
          if (hdrAllowsTon && !colHasExplicitUnit && maxW < 10) {
            weight = weight * 1000; // 吨转kg
            weightNote = '检测到重量可能以吨为单位，已自动转为kg';
          }
        }
      }
      if (weightNote && !warnings.includes(weightNote)) warnings.push(weightNote);
      // C-N3: 非正值/NaN 钳制为 0（负值推警告，与行级缺失处理一致）
      if (!isNaN(weight) && weight <= 0) {
        if (weight < 0 && !warnings.includes(`weight_non_positive_${i}`)) {
          warnings.push(`第${i + 2}行 "${model}" 重量为非正值（${weight}），已置为 0`);
        }
        weight = 0;
      } else if (isNaN(weight)) {
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