from http.server import BaseHTTPRequestHandler, HTTPServer
import pathlib, urllib.parse, os
BASE=pathlib.Path(__file__).parent
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        path=urllib.parse.urlparse(self.path).path
        if path.endswith('/'): path=path.rstrip('/')
        f=BASE/path.lstrip('/')/'index.html'
        if f.exists():
            d=f.read_bytes(); self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Content-Length',str(len(d))); self.end_headers(); self.wfile.write(d)
        else:
            self.send_response(404); self.end_headers(); self.wfile.write(b'not found')
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1',8933),H).serve_forever()
