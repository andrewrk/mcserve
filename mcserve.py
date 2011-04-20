import subprocess
import os
import sys
import re

mcserver = subprocess.Popen(['java', '-Xmx1024M', '-Xms1024M', '-jar', 'minecraft_server.jar', 'nogui'], stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.STDOUT)

from http.server import HTTPServer, BaseHTTPRequestHandler

def html_filter(in_txt):
    filtered = in_txt.replace('&', '&amp;')
    filtered = filtered.replace('"', '&quot;')
    filtered = filtered.replace('<', '&lt;')
    filtered = filtered.replace('>', '&gt;')
    return filtered

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
                self.wfile.write(bytes("<li>{0}</li>".format(html_filter(onliner)), 'utf8'))

            self.wfile.write(bytes("</ul>", 'utf8'))
        else:
            self.wfile.write(bytes("<p>Nobody is online :-(</p>", 'utf8'))

        self.wfile.write(bytes("<h2>latest gibberish</h2>", 'utf8'))
        for date, name, msg in chat_msgs:
            self.wfile.write(bytes("{0} &lt;{1}&gt; {2} <br/>".format(html_filter(date), html_filter(name), html_filter(msg)), 'utf8'))



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

def run_input():
    while True:
        line = input()
        put_text(line)

import threading

server_thread = threading.Thread(target=run_server, name="serve")
server_thread.daemon = True
server_thread.start()

read_thread = threading.Thread(target=run_read_text, name="read")
read_thread.daemon = True
read_thread.start()

input_thread = threading.Thread(target=run_input, name="input")
input_thread .daemon = True
input_thread .start()

onliners = set()
chat_msgs = []

login_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+) \[\/(\d+\.\d+.\d+.\d+:\d+)\] logged in with entity id (\d+?) at \(.+?\)$')
logout_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) lost connection: (.+)$')
kicked_float_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[WARNING\] (.+?) was kicked for (.+?)$')
kicked_op_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?)\: Kicking (.+?)$')
chat_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] \<(.+?)\> (.+)$')
op_command_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) issued server command\: (.+)$')
nonop_command_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) tried command\: (.+)$')
def got_text(text):
    print("[out] {0}".format(text))

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
    groups = kicked_float_re.match(text)
    if groups is not None:
        name = groups.group(2)
        why = groups.group(3)
        try:
            onliners.remove(name)
        except KeyError:
            pass
        print("{0} kicked for {1}".format(name, why))
    groups = kicked_op_re.match(text)
    if groups is not None:
        kicker = groups.group(1)
        name = groups.group(2)
        try:
            onliners.remove(name)
        except KeyError:
            pass
        print("{0} kicked by {1}".format(name, kicker))

    groups = chat_re.match(text)
    if groups is not None:
        date = groups.group(1)
        name = groups.group(2)
        msg = groups.group(3)
        chat_msgs.append((date, name, msg))
        if len(chat_msgs) > 100:
            chat_msgs.pop(0)

    groups = op_command_re.match(text)
    if groups is not None:
        name = groups.group(2)
        cmd = groups.group(3)
        try_cmd(name, cmd, op=True)

    groups = nonop_command_re.match(text)
    if groups is not None:
        name = groups.group(2)
        cmd = groups.group(3)
        try_cmd(name, cmd, op=False)

def try_cmd(name, cmd, op=False):
    print("try cmd '{0}' '{1}'".format(name, cmd))
    if cmd == 'list':
        if not op:
            put_text("tell {0} {1}".format(name, ', '.join(onliners)))


def put_text(text):
    print("[in] {0}".format(text))
    mcserver.stdin.write(bytes(text+'\n', 'utf8'))
    mcserver.stdin.flush()


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
