const { chromium } = require('playwright');
const path = require('path');

const OUTPUT = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/dogfood-output';
const URL = 'http://localhost:8765/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const issues = [];
  const screenshots = [];
  let issueNum = 0;

  function addIssue(severity, category, title, description, steps) {
    issueNum++;
    issues.push({ num: issueNum, severity, category, title, description, steps, screenshots: [...screenshots] });
    screenshots.length = 0;
  }

  async function snap(name) {
    const p = path.join(OUTPUT, 'screenshots', name);
    await page.screenshot({ path: p, fullPage: true });
    screenshots.push(name);
    console.log(`  📸 ${name}`);
    return p;
  }

  page.on('console', msg => console.log(`  [console.${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => {
    console.log(`  [PAGE ERROR] ${err.message}`);
    addIssue('high', 'console', `JS Error: ${err.message}`, err.message, ['Page load']);
  });

  // ─── Test 1: Initial page load ───
  console.log('\n=== Test 1: Initial Page Load ===');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await snap('test1-initial.png');

  const title = await page.textContent('h1');
  console.log(`  Title: ${title}`);
  if (title !== '智能装箱模拟系统') {
    addIssue('medium', 'content', 'Title mismatch', `Expected '智能装箱模拟系统', got '${title}'`, ['Load page']);
  }

  // Check step indicators
  const step1Active = await page.$('.steps__step--active[data-step="1"]');
  if (!step1Active) addIssue('medium', 'ux', 'Step 1 indicator not active', 'Step 1 should be active on initial load', ['Load page']);

  // Check dropzone exists
  const dropzone = await page.$('#dropZone');
  if (!dropzone) addIssue('critical', 'functional', 'Dropzone missing', 'Upload dropzone not rendered', ['Load page']);
  console.log('  ✅ Initial page renders correctly');

  // ─── Test 2: Upload CSV file ───
  console.log('\n=== Test 2: Upload CSV ===');
  const fileInput = page.locator('#fileInput');
  await fileInput.setInputFiles(path.join(OUTPUT, 'test_data.csv'));
  await page.waitForTimeout(1500);
  await snap('test2-after-upload.png');

  // Check if we moved to Step 2
  const step2Content = await page.$('#step-2');
  const step2Visible = step2Content ? await step2Content.isVisible() : false;
  console.log(`  Step 2 visible: ${step2Visible}`);
  
  if (!step2Visible) {
    addIssue('critical', 'functional', 'File upload does not advance to Step 2', 
      'After uploading a valid CSV, app should show Step 2 (data confirmation), but it stayed on Step 1', 
      ['Load page', 'Upload test_data.csv']);
    console.log('  ❌ Upload did not advance to Step 2');
    await browser.close();
    return;
  }

  // Check parsed summary
  const summaryText = await page.textContent('#parsed-summary');
  console.log(`  Summary: ${summaryText?.substring(0, 200)}`);

  // ─── Test 3: Step 2 - Column Mapping Table ───
  console.log('\n=== Test 3: Step 2 Column Mapping ===');
  await snap('test3-step2-mapping.png');
  
  const mappingRows = await page.$$('#column-mapping-table tbody tr');
  console.log(`  Mapping rows: ${mappingRows.length}`);
  if (mappingRows.length === 0) {
    addIssue('high', 'functional', 'Column mapping table empty', 
      'Step 2 should show column mapping table with detected fields', 
      ['Upload CSV', 'View Step 2']);
  }

  // ─── Test 4: Multi-size detection ───
  console.log('\n=== Test 4: Multi-size Detection ===');
  const multiSizeEl = await page.$('#multi-size-warnings');
  const multiSizeVisible = multiSizeEl ? await multiSizeEl.isVisible() : false;
  console.log(`  Multi-size warnings visible: ${multiSizeVisible}`);
  
  if (multiSizeVisible) {
    const multiSizeText = await multiSizeEl.textContent();
    console.log(`  Multi-size content: ${multiSizeText?.substring(0, 300)}`);
    if (!multiSizeText?.includes('NIG-25-2630-124-01')) {
      addIssue('medium', 'functional', 'Multi-size not detecting NIG-25-2630-124-01', 
        'Test data has two rows of NIG-25-2630-124-01 with different sizes, should show multi-size warning',
        ['Upload test CSV', 'View Step 2']);
    }
  }

  // ─── Test 5: Unit selector ───
  console.log('\n=== Test 5: Unit Selector ===');
  const unitSelect = await page.$('#unit-select');
  if (unitSelect) {
    const unitValue = await unitSelect.inputValue();
    console.log(`  Selected unit: ${unitValue}`);
  }

  // ─── Test 6: Confirm data → Step 3 ───
  console.log('\n=== Test 6: Confirm Data → Step 3 ===');
  await page.click('#btn-confirm-data');
  await page.waitForTimeout(1000);
  await snap('test6-step3-config.png');

  const step3El = await page.$('#step-3');
  const step3Visible = step3El ? await step3El.isVisible() : false;
  console.log(`  Step 3 visible: ${step3Visible}`);
  if (!step3Visible) {
    addIssue('critical', 'functional', 'Confirm data does not advance to Step 3',
      'After clicking confirm, app should show Step 3 (packing config)',
      ['Upload CSV', 'Click confirm data']);
    await browser.close();
    return;
  }

  // Check container recommendation
  const recText = await page.textContent('#container-recommendation');
  console.log(`  Recommendation: ${recText?.substring(0, 200)}`);

  if (!recText?.includes('推荐箱型')) {
    addIssue('high', 'functional', 'Container recommendation missing', 
      'Step 3 should show recommended container type based on cargo dimensions',
      ['Upload CSV', 'Confirm data', 'View Step 3']);
  }

  // Check SKU table
  const skuRows = await page.$$('#sku-table tbody tr');
  console.log(`  SKU rows: ${skuRows.length}`);
  
  // Check tolerance input
  const tolInput = await page.$('#tolerance-input');
  if (tolInput) {
    const tolValue = await tolInput.inputValue();
    console.log(`  Tolerance: ${tolValue} cm (expected ~5)`);
    if (Math.abs(parseFloat(tolValue) - 5) > 0.5) {
      addIssue('low', 'ux', 'Default tolerance not 5cm', 
        `Expected default tolerance ~5cm, got ${tolValue}cm`,
        ['Upload CSV', 'Confirm data', 'View Step 3']);
    }
  }

  // ─── Test 7: Calculate → Step 4 ───
  console.log('\n=== Test 7: Calculate → Step 4 ===');
  await page.click('#btn-calculate');
  
  // Wait for calculation (fake progress is ~2.5s)
  await page.waitForTimeout(4000);
  await snap('test7-step4-results.png');

  const step4El = await page.$('#step-4');
  const step4Visible = step4El ? await step4El.isVisible() : false;
  console.log(`  Step 4 visible: ${step4Visible}`);

  if (!step4Visible) {
    addIssue('critical', 'functional', 'Calculation does not advance to Step 4',
      'After clicking calculate, app should show Step 4 (results)',
      ['Upload CSV', 'Confirm data', 'Click calculate']);
    await browser.close();
    return;
  }

  // Check result summary cards
  const summaryCards = await page.$$('#result-summary > div');
  console.log(`  Summary cards: ${summaryCards.length}`);
  
  const resultSummaryText = await page.textContent('#result-summary');
  console.log(`  Result summary: ${resultSummaryText?.substring(0, 300)}`);

  // Check for warnings panel (should show unplaced items or issues)
  const warningsText = await page.textContent('#warnings-panel');
  console.log(`  Warnings: ${warningsText?.substring(0, 200)}`);

  if (warningsText && warningsText.includes('错误')) {
    addIssue('medium', 'functional', 'Self-check found errors in packing result',
      `Packing result contains errors: ${warningsText.substring(0, 200)}`,
      ['Upload CSV', 'Confirm data', 'Click calculate']);
  }

  // ─── Test 8: Check 3D viewer ───
  console.log('\n=== Test 8: 3D Viewer ===');
  const viewerContainer = await page.$('#three-viewer-container');
  if (viewerContainer) {
    const hasCanvas = await page.$('#three-viewer-container canvas');
    console.log(`  Canvas in viewer: ${!!hasCanvas}`);
    if (!hasCanvas) {
      addIssue('high', 'functional', '3D viewer has no canvas',
        'Step 4 should show 3D visualization with canvas element',
        ['Upload CSV', 'Confirm data', 'Click calculate']);
    }
  }

  // ─── Test 9: Container tabs ───
  console.log('\n=== Test 9: Container Tabs ===');
  const tabButtons = await page.$$('.container-tab-btn');
  console.log(`  Container tabs: ${tabButtons.length}`);

  // ─── Test 10: PDF Export ───
  console.log('\n=== Test 10: PDF Export Button ===');
  const pdfBtn = await page.$('#btn-export-pdf');
  console.log(`  PDF export button exists: ${!!pdfBtn}`);

  // Test back navigation
  console.log('\n=== Test 11: Back Navigation ===');
  // Step 4 → 3
  await page.click('.btn-secondary:has-text("返回配置")');
  await page.waitForTimeout(500);
  const backStep3 = await page.$('#step-3');
  console.log(`  Back to Step 3 visible: ${backStep3 ? await backStep3.isVisible() : false}`);

  await snap('test11-back-nav.png');

  // ─── Print all console messages summary ───
  console.log('\n=== Console Summary ===');

  // ─── PRINT REPORT ───
  console.log('\n\n===== DOGFOOD REPORT =====');
  console.log(`Total issues found: ${issues.length}`);
  for (const iss of issues) {
    console.log(`\nISSUE-${String(iss.num).padStart(3, '0')}: [${iss.severity.toUpperCase()}] ${iss.title}`);
    console.log(`  Category: ${iss.category}`);
    console.log(`  Description: ${iss.description}`);
    console.log(`  Screenshots: ${iss.screenshots.join(', ')}`);
  }
  if (issues.length === 0) {
    console.log('  ✅ No issues found! All tests passed.');
  }

  await browser.close();
})();