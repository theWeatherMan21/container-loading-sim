from playwright.sync_api import sync_playwright
import os
import sys

OUTPUT_DIR = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/dogfood-output/e2e'
os.makedirs(OUTPUT_DIR, exist_ok=True)

TEST_FILE = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim/dogfood-output/test_data.csv'
URL = 'http://localhost:8080/trae_projects/ContainerLoadingSim/index.html'

console_errors = []
console_logs = []

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1400, 'height': 900})

        # Capture console messages
        page.on('console', lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
        page.on('pageerror', lambda err: console_errors.append(str(err)))

        print("Step 1: 打开页面...")
        page.goto(URL)
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        page.screenshot(path=f'{OUTPUT_DIR}/01-initial.png', full_page=True)

        # Verify step indicators
        for i in range(1, 5):
            assert page.locator(f'.steps__step[data-step="{i}"]').is_visible(), f"Step indicator {i} not found"
        print("  ✓ 4个步骤指示器都正常")

        print("Step 2: 上传测试文件...")
        file_input = page.locator('#fileInput')
        file_input.set_input_files(TEST_FILE)
        page.wait_for_timeout(2000)
        page.screenshot(path=f'{OUTPUT_DIR}/02-after-upload.png', full_page=True)

        # Wait for step 2
        page.wait_for_selector('#step-2:not(.hidden)', timeout=10000)
        print("  ✓ Step 2 已显示")

        # Check column mapping table
        mapping_table = page.locator('#column-mapping-table')
        assert mapping_table.is_visible(), "Column mapping table not found"
        rows = mapping_table.locator('tbody tr').count()
        print(f"  ✓ 列映射表格渲染完成，共 {rows} 列")
        page.screenshot(path=f'{OUTPUT_DIR}/03-step2-mapping.png', full_page=True)

        print("Step 3: 确认数据...")
        confirm_btn = page.locator('#btn-confirm-data')
        confirm_btn.click()
        page.wait_for_timeout(1500)
        page.screenshot(path=f'{OUTPUT_DIR}/04-step3-config.png', full_page=True)

        # Wait for step 3
        page.wait_for_selector('#step-3:not(.hidden)', timeout=10000)
        print("  ✓ Step 3 已显示")

        # Check SKU table
        sku_table = page.locator('#sku-table')
        assert sku_table.is_visible(), "SKU table not found"
        sku_rows = sku_table.locator('tbody tr').count()
        print(f"  ✓ SKU 表格渲染完成，共 {sku_rows} 行")

        # Check container recommendation or manual select
        rec = page.locator('#container-recommendation')
        if rec.is_visible():
            text = rec.inner_text()
            print(f"  箱型推荐区域内容: {text[:100]}...")

        # If no recommendation shown, manually select 20GP
        manual_btn = page.locator('.manual-container-btn[data-code="20GP"]')
        if manual_btn.count() > 0:
            print("  未检测到自动推荐，手动选择 20GP...")
            manual_btn.click()
            page.wait_for_timeout(500)

        print("Step 4: 开始计算...")
        calc_btn = page.locator('#btn-calculate')
        calc_btn.click()
        page.wait_for_timeout(500)
        page.screenshot(path=f'{OUTPUT_DIR}/05-calculating.png', full_page=True)

        # Wait for progress to complete and step 4 to show
        page.wait_for_selector('#step-4:not(.hidden)', timeout=30000)
        page.wait_for_timeout(1000)
        page.screenshot(path=f'{OUTPUT_DIR}/06-step4-result.png', full_page=True)
        print("  ✓ Step 4 已显示")

        # Check result summary
        summary = page.locator('#result-summary')
        assert summary.is_visible(), "Result summary not found"
        print(f"  ✓ 结果摘要已渲染")

        # Check 3D viewer canvas
        canvas = page.locator('#three-viewer-container canvas')
        canvas_count = canvas.count()
        print(f"  ✓ 3D 视图 canvas 数量: {canvas_count}")
        page.screenshot(path=f'{OUTPUT_DIR}/07-3d-viewer.png', full_page=True)

        # Check container tabs
        tabs = page.locator('.container-tab-btn')
        tab_count = tabs.count()
        print(f"  集装箱 tab 数量: {tab_count}")

        if tab_count > 1:
            print("Step 5: 切换集装箱 tab...")
            for i in range(min(tab_count, 3)):
                tabs.nth(i).click()
                page.wait_for_timeout(800)
                page.screenshot(path=f'{OUTPUT_DIR}/08-tab-{i+1}.png', full_page=True)
            print("  ✓ Tab 切换完成")

        # Check for errors
        errors = page.locator('.alert-error')
        error_count = errors.count()
        if error_count > 0:
            print(f"  ⚠️ 发现 {error_count} 个错误提示:")
            for i in range(error_count):
                print(f"    - {errors.nth(i).inner_text()}")
        else:
            print("  ✓ 未发现错误提示")

        # Check warnings
        warnings = page.locator('.alert-warning')
        warn_count = warnings.count()
        if warn_count > 0:
            print(f"  ⚠️ 发现 {warn_count} 个警告提示")

        browser.close()

    # Print console logs
    print("\n=== 浏览器控制台日志 ===")
    for log in console_logs[-50:]:
        print(log)

    if console_errors:
        print("\n=== JavaScript 错误 ===")
        for err in console_errors:
            print(f"ERROR: {err}")
    else:
        print("\n✓ 未发现 JavaScript 错误")

    print(f"\n=== 测试完成 ===")
    print(f"截图保存在: {OUTPUT_DIR}/")

if __name__ == '__main__':
    try:
        run_test()
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
