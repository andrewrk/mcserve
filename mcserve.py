import subprocess
import os
import sys
import re

mcserver = subprocess.Popen(['java', '-Xmx1024M', '-Xms1024M', '-jar', 'minecraft_server.jar', 'nogui'], stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.STDOUT)

from http.server import HTTPServer, BaseHTTPRequestHandler

class GoodServer(HTTPServer):
    def __init__(self, server_address, handler):
        super().__init__(server_address, handler)
        self.stopped = False

    def serve_forever(self):
        while not self.stopped:
            self.handle_request()

    def shutdown(self):
        self.stopped = True

class GoodHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        print("got GET request")
        self.send_response(200)
        self.wfile.write(bytes(
"""HTTP/1.0 200 OK
Content-type: text/html

<!doctype html>
<html>
<head>
<title>MineCraft Server Status</title>
</head>
<body>
""", 'utf8'))

        if len(onliners) > 0:
            self.wfile.write(bytes("<h2>Online players:</h2><ul>", 'utf8'))
            for onliner in onliners:
                self.wfile.write(bytes("<li>{0}</li>".format(onliner), 'utf8'))

            self.wfile.write(bytes("</ul>", 'utf8'))
        else:
            self.wfile.write(bytes("<p>Nobody is online :-(</p>", 'utf8'))


        self.wfile.write(bytes("""
</body>
</html>
""", 'utf8'))

def run_server():
    global httpd
    server_address = ('', 9999)
    httpd = GoodServer(server_address, GoodHandler)
    httpd.serve_forever()

import queue
text_queue = queue.Queue()

def run_read_text():
    while True:
        full_line = mcserver.stdout.readline()
        line = full_line.strip()
        text_queue.put(line.decode('utf8'))


import threading

server_thread = threading.Thread(target=run_server, name="serve")
server_thread.daemon = True
server_thread.start()

read_thread = threading.Thread(target=run_read_text, name="read")
read_thread.daemon = True
read_thread.start()

onliners = set()

login_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+) \[\/(\d+\.\d+.\d+.\d+:\d+)\] logged in with entity id (\d+) at \(.+\)$')
logout_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+) lost connection: .+$')
def got_text(text):
    print("got text from minecraft: {0}".format(text))

    groups = login_re.match(text)
    if groups is not None:
        name = groups.group(2)
        onliners.add(name)
        print("{0} logged in".format(name))
    groups = logout_re.match(text)
    if groups is not None:
        name = groups.group(2)
        try:
            onliners.remove(name)
        except KeyError:
            pass
        print("{0} logged out".format(name))

def put_text(text):
    mcserver.stdin.write(bytes(text, 'utf8'))


# main loop
while True:
    try:
        line = text_queue.get()
    except KeyboardInterrupt:
        print("shutting down")
        httpd.shutdown()
        put_text("stop")
        break

    got_text(line)
