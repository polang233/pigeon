#!/usr/bin/env python3
"""原型的本机服务：放 prototype/ 里的文件，顺带把本机 magpie 的额度转给页面。

magpie 的网关不许网页跨域读，所以由这里转一道。只转两个只读的接口：

  /magpie/hello   -> magpie 的 /api/hello（在不在、什么版本）
  /magpie/quotas  -> magpie 的 /v1/magpie/quotas?kept=1（上次读到的额度，不去问厂商）

转之前只留页面用得到的字段，账号邮箱这类都去掉。不带钥匙、不写 magpie 的任何东西。

用法（在仓库根目录）：python3 prototype/tools/serve.py [端口，默认 5189]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
CARD_KEYS = ('provider', 'name', 'kind', 'plan', 'balance', 'error', 'readAt', 'asOf', 'last', 'lastServedAt', 'from')
WIN_KEYS = ('name', 'used', 'remaining', 'resetsAt', 'display', 'text', 'lane', 'unlimited')


def magpie_base():
    """magpie 的端口写在它的 settings.json 里（只读），没有就是默认的 3425。"""
    port = os.environ.get('MAGPIE_PORT')
    if not port:
        cfg = os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config')
        try:
            with open(os.path.join(cfg, 'magpie', 'settings.json')) as f:
                port = json.load(f).get('port')
        except (OSError, ValueError):
            port = None
    return f'http://127.0.0.1:{port or 3425}'


def scrub(v):
    return EMAIL.sub('‹账号›', v) if isinstance(v, str) else v


def slim_card(c):
    out = {k: scrub(c[k]) for k in CARD_KEYS if k in c}
    out['windows'] = [{k: scrub(w[k]) for k in WIN_KEYS if k in w} for w in c.get('windows') or []]
    return out


ROUTES = {
    '/magpie/hello': ('/api/hello', lambda d: {'name': d.get('name'), 'version': d.get('version')}),
    '/magpie/quotas': ('/v1/magpie/quotas?kept=1', lambda d: {'data': [slim_card(c) for c in d.get('data') or []]}),
}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path not in ROUTES:
            return super().do_GET()
        upstream, shape = ROUTES[path]
        try:
            with urllib.request.urlopen(magpie_base() + upstream, timeout=4) as r:
                body, code = shape(json.load(r)), 200
        except (urllib.error.URLError, OSError, ValueError) as e:
            body, code = {'error': f'连不上本机 magpie：{e}'}, 502
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        if not self.path.startswith('/magpie/'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5189
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=ROOT))
    print(f'Pigeon 原型：http://127.0.0.1:{port}  （额度读自 {magpie_base()}）', flush=True)
    server.serve_forever()
