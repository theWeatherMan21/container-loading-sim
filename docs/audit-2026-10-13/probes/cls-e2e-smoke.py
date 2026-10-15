# 装箱模拟系统 · E2E 冒烟（headless）——审阅 2026-10-13
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8377/index.html'
SCRATCH = '/Users/russospencer/.hermes/cache/scratch'
PROJ = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim'

def run_scene(pg, xlsx_path, tag, scene_name):
    logs = []
    pg2 = pg
    pg2.on('console', lambda msg: logs.append(f"{msg.type}: {msg.text[:200]}") if msg.type in ('error', 'warning') else None)
    pg2.on('pageerror', lambda e: logs.append(f"pageerror: {str(e)[:300]}"))
    pg2.goto(BASE)
    pg2.wait_for_function("() => !!window.App", timeout=20000)
    print(f"\n========== 场景 {tag}: {scene_name} ==========")
    # 上传
    pg2.set_input_files('#fileInput', xlsx_path)
    pg2.wait_for_selector('#step-2:not(.hidden)', timeout=20000)
    # 检查解析摘要
    try:
        summary = pg2.inner_text('#parsed-summary')
        print('  [step2 摘要]', summary.replace('\n', ' | ')[:300])
    except Exception as e:
        print('  [step2 摘要读取失败]', e)
    # 确认数据
    pg2.click('#btn-confirm-data')
    pg2.wait_for_selector('#step-3:not(.hidden)', timeout=20000)
    # 等推荐稳定（worker 预演可能先显示 loading）
    pg2.wait_for_function("""() => {
        const el = document.querySelector('#container-recommendation');
        if (!el) return false;
        const t = el.innerText || '';
        return t.length > 30 && !t.includes('正在预演');
    }""", timeout=30000)
    pg2.wait_for_timeout(800)  # 等 render 完成
    rec = pg2.inner_text('#container-recommendation')
    print('  [推荐区文本]', rec.replace('\n', ' | ')[:600])
    # 计算（若按钮禁用则先启用混合装箱）
    btn_disabled = pg2.eval_on_selector('#btn-calculate', 'el => el.disabled')
    if btn_disabled:
        print('  [计算按钮被禁用 → 启用混合装箱]')
        pg2.evaluate('''() => {
            const cb = document.querySelector('#use-mixed-checkbox');
            if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
        }''')
        pg2.wait_for_timeout(1200)
    pg2.click('#btn-calculate')
    pg2.wait_for_function("""() => {
        const el = document.querySelector('#result-summary');
        return el && (el.innerText || '').includes('所需箱数');
    }""", timeout=60000)
    pg2.wait_for_timeout(600)
    res = pg2.inner_text('#result-summary')
    print('  [结果摘要]', res.replace('\n', ' | ')[:500])
    try:
        warn = pg2.inner_text('#warnings-panel')
        print('  [警告面板]', warn.replace('\n', ' | ')[:600])
    except Exception:
        pass
    pg2.screenshot(path=f'{SCRATCH}/cls-e2e-{tag}-result.png', full_page=True)
    print(f'  [截图] cls-e2e-{tag}-result.png')
    errs = [l for l in logs if l.startswith('error') or l.startswith('pageerror')]
    warns = [l for l in logs if l.startswith('warning')]
    print(f'  [console] errors={len(errs)}, warnings={len(warns)}')
    for e in errs[:6]:
        print('    !', e)
    for w in warns[:6]:
        print('    ~', w)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path='/Users/russospencer/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    pg = b.new_page(viewport={'width': 1440, 'height': 1100})
    run_scene(pg, f'{PROJ}/test-packing-list.xlsx', 'A', '真实测试单 test-packing-list.xlsx')
    run_scene(pg, f'{SCRATCH}/m30-heavy.xlsx', 'C', '重货 30t 单件 m30-heavy.xlsx')
    b.close()
print('\nE2E 冒烟完成')
