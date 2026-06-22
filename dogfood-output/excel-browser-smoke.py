from playwright.sync_api import sync_playwright
import os
import time

SRC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL_FILE = os.path.join(SRC_DIR, '土耳其货物明细(1).xlsx')
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def wait_for_step(page, step_num, timeout=30000):
    page.wait_for_selector(f'#step-{step_num}:not(.hidden)', timeout=timeout)

def screenshot(page, name):
    path = os.path.join(OUT_DIR, f'excel-step-{name}.png')
    page.screenshot(path=path, full_page=True)
    print(f'Screenshot saved: {path}')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        print('Opening http://localhost:8000/index.html')
        page.goto('http://localhost:8000/index.html')
        page.wait_for_load_state('networkidle')
        screenshot(page, '1-initial')

        print('Uploading Excel file:', EXCEL_FILE)
        page.locator('#fileInput').set_input_files(EXCEL_FILE)

        # Wait for parsing and Step 2 to appear
        wait_for_step(page, 2, timeout=30000)
        time.sleep(0.5)
        screenshot(page, '2-mapping')

        print('Confirming data...')
        page.locator('#btn-confirm-data').click()

        wait_for_step(page, 3, timeout=30000)
        time.sleep(0.5)
        screenshot(page, '3-config')

        print('Starting calculation...')
        page.locator('#btn-calculate').click()

        wait_for_step(page, 4, timeout=120000)
        time.sleep(1.0)
        screenshot(page, '4-result')

        # Capture summary text
        summary = page.locator('#result-summary').inner_text() if page.locator('#result-summary').count() > 0 else 'N/A'
        warnings = page.locator('#warnings-panel').inner_text() if page.locator('#warnings-panel').count() > 0 else 'N/A'
        print('\nResult summary:')
        print(summary)
        print('\nWarnings panel:')
        print(warnings)

    except Exception as e:
        print(f'Browser smoke test failed: {e}')
        screenshot(page, 'error')
        raise
    finally:
        browser.close()

print('Browser smoke test completed.')
