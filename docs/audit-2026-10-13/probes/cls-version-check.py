# 版本号可见性验收：headless 打开 dist，断言页眉/页脚显示版本，并出截图
import http.server, socketserver, threading, functools, sys, os
from playwright.sync_api import sync_playwright

PROJ = '/Users/russospencer/Documents/trae_projects/ContainerLoadingSim'
DIST = os.path.join(PROJ, 'dist')
SCRATCH = '/Users/russospencer/.hermes/cache/scratch'
PORT = 8391
EXPECT = 'v' + open(os.path.join(PROJ, 'package.json')).read().split('"version": "')[1].split('"')[0]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST)
class Q(socketserver.TCPServer):
    allow_reuse_address = True
httpd = Q(('127.0.0.1', PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()

out = {}
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path='/Users/russospencer/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{PORT}/index.html', wait_until='load')
    pg.wait_for_timeout(1500)
    out['header'] = pg.inner_text('#app-version')
    out['footer'] = pg.inner_text('#app-version-footer')
    out['badge_visible'] = pg.is_visible('#app-version')
    out['js_version'] = pg.evaluate('window.APP_VERSION || null')
    pg.screenshot(path=f'{SCRATCH}/cls-version-header.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 160})
    pg.screenshot(path=f'{SCRATCH}/cls-version-full.png', full_page=False)
    out['console_errors'] = errs
    b.close()
httpd.shutdown()

ok = out['header'] == EXPECT and out['footer'] == EXPECT and out['badge_visible'] and out['js_version'] == EXPECT[1:]
print('EXPECT', EXPECT)
print('RESULT', out)
print('VERDICT', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
