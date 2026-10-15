# 装箱模拟系统 · E2E 复验（2026-10-13 修复后）
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

def upload_and_recommend(pg, xlsx):
    pg.goto(BASE)
    pg.wait_for_function("() => !!window.App", timeout=20000)
    pg.set_input_files('#fileInput', xlsx)
    pg.wait_for_selector('#step-2:not(.hidden)', timeout=20000)
    pg.click('#btn-confirm-data')
    pg.wait_for_selector('#step-3:not(.hidden)', timeout=20000)
    pg.wait_for_function("""() => {
        const el = document.querySelector('#container-recommendation');
        return el && (el.innerText || '').length > 30 && !el.innerText.includes('正在预演');
    }""", timeout=30000)
    pg.wait_for_timeout(600)

def wait_result(pg, timeout=60000):
    pg.wait_for_function("""() => {
        const el = document.querySelector('#result-summary');
        return el && (el.innerText || '').includes('所需箱数');
    }""", timeout=timeout)
    pg.wait_for_timeout(2500)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=EXE)
    pg = b.new_page(viewport={'width': 1440, 'height': 1100})
    logs = []
    pg.on('console', lambda m: logs.append(f"{m.type}: {m.text[:200]}") if m.type == 'error' else None)
    pg.on('pageerror', lambda e: logs.append(f"pageerror: {str(e)[:300]}"))

    # ═══ 场景 A3：真实测试单 · 推荐失败 → 启用混合 → 选箱型 → 计算（原死锁路径）═══
    print('========== 场景 A3: 真实单 · 死锁修复验证 ==========')
    upload_and_recommend(pg, f'{PROJ}/test-packing-list.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:200])
    print('  [初始 state]', json.dumps(state_of(pg)))
    # 勾选"启用混合"
    pg.evaluate("""() => {
        const cb = document.querySelector('#use-mixed-checkbox');
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    }""")
    pg.wait_for_timeout(800)
    st = state_of(pg)
    print('  [勾选后 state]', json.dumps(st), '← useMixed 应保持 true（修复点）')
    # 点选混合面板中的箱型：20GP / 40HQ / 40FR
    for code in ['20GP', '40HQ', '40FR']:
        pg.evaluate(f"""() => {{
            const btn = document.querySelector('#mixed-panel .mixed-container-btn[data-code="{code}"]');
            if (btn && btn.dataset.selected !== 'true') btn.click();
        }}""")
        pg.wait_for_timeout(200)
    st2 = state_of(pg)
    print('  [选箱型后 state]', json.dumps(st2), '← btnDisabled 应为 false（修复点）')
    pg.click('#btn-calculate')
    wait_result(pg)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:450])
    print('  [警告面板]', pg.inner_text('#warnings-panel').replace('\n', ' | ')[:400])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-A3-fixed.png', full_page=True)

    # ═══ 场景 C3：30t 重货 · 新推荐链验证 ═══
    print('\n========== 场景 C3: 30t 重货 · 推荐 40FR ==========')
    upload_and_recommend(pg, f'{SCRATCH}/m30-heavy.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:320], '← 应含"40尺框架"')
    print('  [state]', json.dumps(state_of(pg)))
    pg.click('#btn-calculate')
    wait_result(pg)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:400])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-C3-fixed.png', full_page=True)

    # ═══ 场景 D3：13m 超长货 · FR 全链路（原装不了）═══
    print('\n========== 场景 D3: 13m 超长货 · FR 全链路 ==========')
    upload_and_recommend(pg, f'{SCRATCH}/fr13.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:300])
    print('  [state]', json.dumps(state_of(pg)))
    if pg.eval_on_selector('#btn-calculate', 'el => el.disabled'):
        print('  [按钮禁用→勾选混合]')
        pg.evaluate("""() => { const cb = document.querySelector('#use-mixed-checkbox'); if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); } }""")
        pg.wait_for_timeout(600)
    pg.click('#btn-calculate')
    wait_result(pg)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:400])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-D3-fixed.png', full_page=True)

    errs = [l for l in logs if l.startswith('error') or l.startswith('pageerror')]
    print(f'\n[console errors 共 {len(errs)}]')
    for e in errs[:8]:
        print('  !', e)
    b.close()
print('\nE2E 复验完成')
