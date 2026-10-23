# 装箱模拟系统 · E2E 冒烟 第二版（精确版）
import json
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8377/index.html'
SCRATCH = '/Users/russospencer/.hermes/cache/scratch'
PROJ = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim'
EXE = '/Users/russospencer/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

def state_of(pg):
    return pg.evaluate("""() => {
        const s = window.App.getState();
        return { useMixed: s.useMixed, hasSpec: !!s.containerSpec, specsLen: s.containerSpecs ? s.containerSpecs.length : 0,
                 btnDisabled: document.querySelector('#btn-calculate') ? document.querySelector('#btn-calculate').disabled : null };
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=EXE)
    pg = b.new_page(viewport={'width': 1440, 'height': 1100})
    logs = []
    pg.on('console', lambda m: logs.append(f"{m.type}: {m.text[:150]}") if m.type == 'error' else None)
    pg.on('pageerror', lambda e: logs.append(f"pageerror: {str(e)[:250]}"))

    # ═══ 场景 A：真实测试单，验证"启用混合"死锁 ═══
    print('========== 场景 A2: 真实测试单 · 混合启用死锁验证 ==========')
    pg.goto(BASE)
    pg.wait_for_function("() => !!window.App", timeout=20000)
    pg.set_input_files('#fileInput', f'{PROJ}/test-packing-list.xlsx')
    pg.wait_for_selector('#step-2:not(.hidden)', timeout=20000)
    pg.click('#btn-confirm-data')
    pg.wait_for_selector('#step-3:not(.hidden)', timeout=20000)
    pg.wait_for_function("""() => {
        const el = document.querySelector('#container-recommendation');
        return el && (el.innerText || '').length > 30 && !el.innerText.includes('正在预演');
    }""", timeout=30000)
    pg.wait_for_timeout(500)
    print('  [初始 state]', json.dumps(state_of(pg)))
    # 勾选"启用混合"
    pg.evaluate("""() => {
        const cb = document.querySelector('#use-mixed-checkbox');
        if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
        return !!cb;
    }""")
    pg.wait_for_timeout(2000)
    print('  [勾选混合 2s 后 state]', json.dumps(state_of(pg)))
    rec_after = pg.inner_text('#container-recommendation')[:120].replace('\n', ' | ')
    print('  [勾选后推荐区]', rec_after)
    # 绕行：点手动箱型 40HQ
    try:
        pg.click('.manual-container-btn[data-code="40HQ"]', timeout=5000)
        pg.wait_for_timeout(500)
        print('  [手动选 40HQ 后 state]', json.dumps(state_of(pg)))
        pg.click('#btn-calculate')
        pg.wait_for_function("""() => {
            const el = document.querySelector('#result-summary');
            return el && (el.innerText || '').includes('所需箱数');
        }""", timeout=60000)
        pg.wait_for_timeout(500)
        print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:400])
        print('  [警告面板]', pg.inner_text('#warnings-panel').replace('\n', ' | ')[:400])
        pg.screenshot(path=f'{SCRATCH}/cls-e2e-A2-result.png', full_page=True)
    except Exception as e:
        print('  [手动绕行失败]', str(e)[:200])

    # ═══ 场景 C：30t 重货单件 ═══
    print('\n========== 场景 C2: 30t 重货单件 ==========')
    pg.goto(BASE)
    pg.wait_for_function("() => !!window.App", timeout=20000)
    pg.set_input_files('#fileInput', f'{SCRATCH}/m30-heavy.xlsx')
    pg.wait_for_selector('#step-2:not(.hidden)', timeout=20000)
    pg.click('#btn-confirm-data')
    pg.wait_for_selector('#step-3:not(.hidden)', timeout=20000)
    pg.wait_for_function("""() => {
        const el = document.querySelector('#container-recommendation');
        return el && (el.innerText || '').length > 30 && !el.innerText.includes('正在预演');
    }""", timeout=30000)
    pg.wait_for_timeout(500)
    print('  [推荐区]', pg.inner_text('#container-recommendation').replace('\n', ' | ')[:500])
    print('  [state]', json.dumps(state_of(pg)))
    if pg.eval_on_selector('#btn-calculate', 'el => el.disabled'):
        print('  [计算按钮禁用 → 尝试勾混合]')
        pg.evaluate("""() => { const cb = document.querySelector('#use-mixed-checkbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } }""")
        pg.wait_for_timeout(1500)
        print('  [启用后 state]', json.dumps(state_of(pg)))
    pg.click('#btn-calculate')
    pg.wait_for_function("""() => {
        const el = document.querySelector('#result-summary');
        return el && (el.innerText || '').includes('所需箱数');
    }""", timeout=60000)
    pg.wait_for_timeout(500)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:500])
    print('  [警告面板]', pg.inner_text('#warnings-panel').replace('\n', ' | ')[:500])
    print('  [箱 tab]', pg.inner_text('#container-tabs').replace('\n', ' | ')[:300])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-C2-result.png', full_page=True)

    errs = [l for l in logs if l.startswith('error') or l.startswith('pageerror')]
    print(f'\n[console errors 共 {len(errs)}]')
    for e in errs[:8]:
        print('  !', e)
    b.close()
print('\n完成')
