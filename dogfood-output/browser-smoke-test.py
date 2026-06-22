from playwright.sync_api import sync_playwright
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL = os.path.join(ROOT, '土耳其货物明细(1).xlsx')
OUT_DIR = os.path.join(ROOT, 'dogfood-output')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.goto('http://localhost:8080')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=os.path.join(OUT_DIR, 'browser-step1-home.png'), full_page=True)

    # Step 1: upload file directly via hidden input
    page.set_input_files('#fileInput', EXCEL)

    # Wait for Step 2 to appear and verify items parsed
    page.wait_for_selector('#step-2:not(.hidden)', timeout=30000)
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(OUT_DIR, 'browser-step2-data.png'), full_page=True)
    step2_text = page.inner_text('#step-2')
    print('Step 2 text preview:', step2_text.replace('\n', ' | ')[:300])

    # Confirm data and go to Step 3
    page.click('#btn-confirm-data')
    page.wait_for_selector('#step-3:not(.hidden)', timeout=30000)
    # Wait for recommendation panel to render (mixed or single)
    page.wait_for_selector('#container-recommendation', timeout=10000)
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(OUT_DIR, 'browser-step3-config.png'), full_page=True)
    rec_text = page.inner_text('#container-recommendation')
    print('Step 3 recommendation:', rec_text.replace('\n', ' | ')[:400])

    # Step 3: start calculation
    page.click('#btn-calculate')

    # Wait for Step 4 to appear
    page.wait_for_selector('#step-4:not(.hidden)', timeout=120000)
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(OUT_DIR, 'browser-step4-result.png'), full_page=True)

    # Verify key results
    summary = page.inner_text('#result-summary')
    errors = page.locator('.alert-error').count()

    print('=== Browser Smoke Test ===')
    print('Summary:', summary.replace('\n', ' | '))
    print('Error alerts:', errors)

    # The summary card shows total placed count; must be 15
    assert '15' in summary, f'Expected 15 items placed, got summary={summary}'
    assert errors == 0, f'Expected 0 errors, got {errors}'

    browser.close()
    print('Browser smoke test PASSED')
