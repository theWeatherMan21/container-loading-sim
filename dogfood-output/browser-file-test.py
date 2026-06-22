from playwright.sync_api import sync_playwright
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL = os.path.join(ROOT, '土耳其货物明细(1).xlsx')
OUT_DIR = os.path.join(ROOT, 'dogfood-output')
HTML = 'file://' + os.path.join(ROOT, 'index.html')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.goto(HTML)
    page.wait_for_load_state('networkidle')
    page.screenshot(path=os.path.join(OUT_DIR, 'file-step1-home.png'), full_page=True)

    page.set_input_files('#fileInput', EXCEL)
    page.wait_for_selector('#step-2:not(.hidden)', timeout=30000)
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(OUT_DIR, 'file-step2-data.png'), full_page=True)

    page.click('#btn-confirm-data')
    page.wait_for_selector('#step-3:not(.hidden)', timeout=30000)
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(OUT_DIR, 'file-step3-config.png'), full_page=True)

    page.click('#btn-calculate')
    page.wait_for_selector('#step-4:not(.hidden)', timeout=120000)
    # Wait for 3D timeout fallback (20 retries * 500ms = 10s) + buffer
    page.wait_for_timeout(12000)
    page.screenshot(path=os.path.join(OUT_DIR, 'file-step4-result.png'), full_page=True)

    summary = page.inner_text('#result-summary')
    viewer_text = page.inner_text('#three-viewer-container')
    errors = page.locator('.alert-error').count()

    print('=== File:// Browser Test ===')
    print('Summary:', summary.replace('\n', ' | '))
    print('3D viewer text:', viewer_text.replace('\n', ' | ')[:200])
    print('Error alerts:', errors)

    assert '15' in summary, f'Expected 15 items, got {summary}'
    assert errors == 0, f'Expected 0 errors, got {errors}'

    browser.close()
    print('File:// test completed')
