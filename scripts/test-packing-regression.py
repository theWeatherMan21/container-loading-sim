"""
装箱单回归测试 —— Playwright 自动化
4组场景：单箱型40HQ、单箱型40FR、混合推荐、批量小件
"""
import re
import json
import os
from playwright.sync_api import sync_playwright

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = "http://localhost:8080"
TEST_FILE = os.path.join(PROJECT, "test-packing-list.xlsx")
TEST_FILE_BULK = os.path.join(PROJECT, "test-packing-list-bulk.xlsx")
SCREENSHOT_DIR = os.path.join(PROJECT, "test-screenshots")

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

diag_logs = []  # 收集 [3D Diag] 日志


def upload_and_confirm(page, file_path, test_name):
    """Step 1 → Step 2：上传文件并确认数据"""
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    # 上传文件
    file_input = page.locator("#fileInput")
    file_input.set_input_files(file_path)
    print(f"  [上传] {os.path.basename(file_path)}")

    # 等待解析完成并跳转到 Step 2
    page.wait_for_selector("#step-2:not(.hidden)", timeout=15000)
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_step2.png"), full_page=True)

    # 点击确认数据
    page.locator("#btn-confirm-data").click()
    page.wait_for_selector("#step-3:not(.hidden)", timeout=10000)
    page.wait_for_timeout(1500)
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_step3.png"), full_page=True)
    print(f"  [Step 2→3] 数据确认完成")


def select_container_and_calc(page, container_code, test_name):
    """Step 3：选择箱型并计算"""
    # 点击对应的箱型按钮
    btn = page.locator(f'.manual-container-btn[data-code="{container_code}"]')
    btn.click()
    page.wait_for_timeout(500)
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_selected.png"), full_page=True)
    print(f"  [选择] {container_code}")

    # 点击开始计算
    page.locator("#btn-calculate").click()
    print(f"  [计算中...]")

    # 等待 Step 4 出现
    page.wait_for_selector("#step-4:not(.hidden)", timeout=60000)
    page.wait_for_timeout(3000)  # 等待 3D 渲染完成
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_result.png"), full_page=True)
    print(f"  [完成] Step 4 结果页面已加载")


def select_mixed_and_calc(page, test_name):
    """Step 3：启用混合模式并计算"""
    # 勾选混合装箱
    mixed_cb = page.locator("#use-mixed-checkbox")
    mixed_cb.check()
    page.wait_for_timeout(500)

    # 如果有推荐的混合方案，直接使用；否则选择全部箱型
    mixed_btns = page.locator('.mixed-container-btn[data-selected="true"]')
    count = mixed_btns.count()
    if count > 0:
        print(f"  [混合推荐] 自动选中 {count} 种箱型")
    else:
        # 手动全选
        all_mixed = page.locator('.mixed-container-btn')
        for i in range(all_mixed.count()):
            btn = all_mixed.nth(i)
            if btn.get_attribute("data-selected") != "true":
                btn.click()
                page.wait_for_timeout(200)
        print(f"  [混合] 手动全选箱型")

    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_mixed_selected.png"), full_page=True)

    # 点击开始计算
    page.locator("#btn-calculate").click()
    print(f"  [计算中...]")

    page.wait_for_selector("#step-4:not(.hidden)", timeout=60000)
    page.wait_for_timeout(3000)
    page.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_result.png"), full_page=True)
    print(f"  [完成] Step 4 结果页面已加载")


def collect_results(page, test_name):
    """收集结果数据"""
    # 截取 3D 视图
    viewer = page.locator("#three-viewer-container")
    if viewer.is_visible():
        viewer.screenshot(path=os.path.join(SCREENSHOT_DIR, f"{test_name}_3d.png"))
        print(f"  [3D截图] 已保存")

    # 收集摘要文本
    summary = page.locator("#result-summary").inner_text()
    print(f"  [摘要] {summary[:200]}")

    # 收集容器标签
    tabs = page.locator("#container-tabs").inner_text()
    print(f"  [Tabs] {tabs[:200]}")

    return summary, tabs


def run_test(page, test_name, file_path, mode, container_code=None):
    """执行单个测试"""
    global diag_logs
    diag_logs.clear()

    print(f"\n{'='*60}")
    print(f"测试: {test_name}")
    print(f"{'='*60}")

    # 监听 console
    def on_console(msg):
        text = msg.text
        if "[3D Diag]" in text:
            diag_logs.append(text)
            if "⚠️" in text or "❌" in text or "ERROR" in text.upper():
                print(f"  [!] {text}")

    page.on("console", on_console)

    # 上传并确认
    upload_and_confirm(page, file_path, test_name)

    # 根据模式选择箱型
    if mode == "single":
        select_container_and_calc(page, container_code, test_name)
    elif mode == "mixed":
        select_mixed_and_calc(page, test_name)

    # 收集结果
    summary, tabs = collect_results(page, test_name)

    # 打印诊断日志
    print(f"\n  [3D Diag 日志] ({len(diag_logs)} 条)")
    for log in diag_logs:
        print(f"    {log}")

    # 验证
    print(f"\n  === 验证 ===")
    has_error = any("ERROR" in l.upper() for l in diag_logs)
    has_skip = any("跳过=" in l and not l.endswith("跳过=0") for l in diag_logs)
    mismatch = any("⚠️" in l and "不一致" in l for l in diag_logs)

    checks = {
        "无ERROR日志": not has_error,
        "无跳过渲染": not has_skip,
        "数据一致": not mismatch,
    }
    for name, passed in checks.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {name}")

    return checks


def main():
    print("=" * 60)
    print("装箱单回归测试")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2
        )
        page = ctx.new_page()

        all_results = {}

        # 测试1: 单箱型 40HQ
        all_results["单箱型40HQ"] = run_test(
            page, "test1_40hq", TEST_FILE, "single", "40HQ"
        )

        # 测试2: 单箱型 40FR
        all_results["单箱型40FR"] = run_test(
            page, "test2_40fr", TEST_FILE, "single", "40FR"
        )

        # 测试3: 混合推荐
        all_results["混合推荐"] = run_test(
            page, "test3_mixed", TEST_FILE, "mixed"
        )

        # 测试4: 批量小件
        all_results["批量小件"] = run_test(
            page, "test4_bulk", TEST_FILE_BULK, "single", "40HQ"
        )

        browser.close()

    # 汇总
    print(f"\n{'='*60}")
    print("测试汇总")
    print(f"{'='*60}")
    for name, checks in all_results.items():
        all_pass = all(checks.values())
        status = "✅ ALL PASS" if all_pass else "❌ HAS FAILURES"
        print(f"  {name}: {status}")
        if not all_pass:
            for cname, passed in checks.items():
                if not passed:
                    print(f"    - FAIL: {cname}")

    # 保存 JSON 结果
    with open(os.path.join(SCREENSHOT_DIR, "test_results.json"), "w") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n截图已保存至: {SCREENSHOT_DIR}/")


if __name__ == "__main__":
    main()
