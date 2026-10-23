# 装箱模拟系统 · E2E 复验（2026-10-21 C4 批次：45HQ vs 40FR 分档）
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
                 hasResult: !!s.packingResult,
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
    pg.wait_for_timeout(1200)

def wait_result(pg, timeout=60000):
    pg.wait_for_function("""() => {
        const el = document.querySelector('#result-summary');
        return el && (el.innerText || '').includes('所需箱数');
    }""", timeout=timeout)
    pg.wait_for_timeout(2200)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path=EXE)
    pg = b.new_page(viewport={'width': 1440, 'height': 1100})
    logs = []
    pg.on('console', lambda m: logs.append(f"{m.type}: {m.text[:220]}"))
    pg.on('pageerror', lambda e: logs.append(f"pageerror: {str(e)[:300]}"))

    # ═══ A5：真实测试单 · 全链路（混合 + Worker 计算）═══
    print('========== 场景 A5: 真实单 · 全链路 ==========')
    upload_and_recommend(pg, f'{PROJ}/test-packing-list.xlsx')
    print('  [推荐区]', pg.inner_text('#container-recommendation').replace('\n', ' | ')[:200])
    for code in ['20GP', '40HQ', '45HQ', '40FR']:
        pg.evaluate(f"""() => {{
            const btn = document.querySelector('#mixed-panel .mixed-container-btn[data-code="{code}"]');
            if (btn && btn.dataset.selected !== 'true') btn.click();
        }}""")
        pg.wait_for_timeout(200)
    pg.click('#btn-calculate')
    wait_result(pg)
    summary = pg.inner_text('#result-summary').replace('\n', ' | ')
    print('  [结果摘要]', summary[:380])
    print('  [state]', json.dumps(state_of(pg)))
    assert '14/ 14' in summary or '14/14' in summary, '真实单应 14/14 全装'
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-A5.png', full_page=True)

    # ═══ D5：13m 管 → 45HQ（45HQ 优先档）═══
    print('\n========== 场景 D5: 13m 超长货 → 45HQ ==========')
    upload_and_recommend(pg, f'{SCRATCH}/fr13.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:300])
    assert '45尺' in rec or '45HQ' in rec, '13m 应推荐 45HQ'
    assert '平放' in rec, '13m 应说明平放装载'
    pg.click('#btn-calculate')
    wait_result(pg)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:340])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-D5.png', full_page=True)

    # ═══ E5：14m → 40FR（悬挑覆盖档）═══
    print('\n========== 场景 E5: 14m → 40FR 贴端悬挑 ==========')
    upload_and_recommend(pg, f'{SCRATCH}/fr14.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:320])
    assert '40尺框架' in rec or '40FR' in rec, '14m 应推荐 40FR'
    assert '悬挑' in rec, '14m 应注明悬挑装载'
    pg.click('#btn-calculate')
    wait_result(pg)
    print('  [结果摘要]', pg.inner_text('#result-summary').replace('\n', ' | ')[:340])
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-E5.png', full_page=True)

    # ═══ F5：16.5m → 警告无法装载 ═══
    print('\n========== 场景 F5: 16.5m → 警告无法装载 ==========')
    upload_and_recommend(pg, f'{SCRATCH}/fr165.xlsx')
    rec = pg.inner_text('#container-recommendation')
    print('  [推荐区]', rec.replace('\n', ' | ')[:320])
    assert '无法装载该货物' in rec, '16.5m 应警告无法装载'
    pg.screenshot(path=f'{SCRATCH}/cls-e2e-F5.png', full_page=True)

    errs = [l for l in logs if l.startswith('error') or l.startswith('pageerror')]
    warns = [l for l in logs if 'worker' in l.lower() and ('warn' in l or 'error' in l)]
    print(f'\n[console errors 共 {len(errs)}]')
    for e in errs[:8]:
        print('  !', e)
    print(f'[worker 回退/异常 warnings 共 {len(warns)}] ← 应为 0（Worker 正常工作）')
    for w in warns[:5]:
        print('  !', w)
    b.close()
print('\nE2E 复验完成')
