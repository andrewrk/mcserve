#!/usr/bin/env python3

import sys, os, subprocess
import re
import time, threading
import queue
from http.server import HTTPServer, BaseHTTPRequestHandler
import optparse

__version__ = "0.0"

def html_filter(text, color=None):
    text = text.replace('&', '&amp;')
    text = text.replace('"', '&quot;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    if color != None:
        text = "<span style=\"color:" + color + "\">" + text + "</span>"
    return text

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
                self.wfile.write(bytes("<li>{}</li>".format(html_filter(onliner, color_from_name(onliner))), 'utf8'))

            self.wfile.write(bytes("</ul>", 'utf8'))
        else:
            self.wfile.write(bytes("<p>Nobody is online :-(</p>", 'utf8'))

        self.wfile.write(bytes("<h2>latest gibberish</h2>", 'utf8'))
        for message in reversed(messages):
            self.wfile.write(bytes(message.html(), 'utf8'))

        self.wfile.write(bytes("""
</body>
</html>
""", 'utf8'))

gray_color = "#808080"
def color_from_name(name):
    name_hash = hash(name)
    color = name_hash & 0xa0a0a0
    return "#" + hex(color)[2:].zfill(6)
class ChatMessage:
    def __init__(self, date, name, msg):
        self.date = date
        self.name = name
        self.msg = msg
    def html(self):
        return "{} &lt;{}&gt; {}<br/>".format(html_filter(self.date, gray_color), html_filter(self.name, color_from_name(self.name)), html_filter(self.msg))
class JoinLeftMessage:
    def __init__(self, date, name, joined=True):
        self.date = date
        self.name = name
        self.joined = joined
    def html(self):
        if self.joined:
            joined_left_html = "joined"
        else:
            joined_left_html = "left"
        return "{} *{} {}<br/>".format(html_filter(self.date, gray_color), html_filter(self.name, color_from_name(self.name)), joined_left_html)

def run_server():
    global httpd
    server_address = ('', 9999)
    httpd = GoodServer(server_address, GoodHandler)
    httpd.serve_forever()

def run_read_text():
    for full_line in mcserver.stdout:
        line = full_line.rstrip()
        text_queue.put(line.decode('utf8'))
    else:
        text_queue.put(None) # shutdown somehow

def run_input():
    try:
        while True:
            line = input()
            put_text(line)
    except EOFError:
        text_queue.put(None)


text_queue = queue.Queue()

server_thread = threading.Thread(target=run_server, name="serve")
server_thread.daemon = True

read_thread = threading.Thread(target=run_read_text, name="read")
read_thread.daemon = True

input_thread = threading.Thread(target=run_input, name="input")
input_thread.daemon = True

onliners = set()
messages = []

def user_joined(date, name):
    onliners.add(name)
    add_message(JoinLeftMessage(date, name, joined=True))
def user_left(date, name):
    try:
        onliners.remove(name)
    except KeyError:
        return
    add_message(JoinLeftMessage(date, name, joined=False))

def add_message(message):
    messages.append(message)
    if len(messages) > 100:
        messages.pop(0)

login_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+) \[\/(\d+\.\d+.\d+.\d+:\d+)\] logged in with entity id (\d+?) at \(.+?\)$')
logout_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) lost connection: (.+)$')
kicked_float_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[WARNING\] (.+?) was kicked for (.+?)$')
kicked_op_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?)\: Kicking (.+?)$')
chat_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] \<(.+?)\> (.+)$')
op_command_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) issued server command\: (.+)$')
nonop_command_re = re.compile(r'^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) tried command\: (.+)$')
def got_text(text):
    print("[out] {0}".format(text))

    match = login_re.match(text)
    if match is not None:
        date = match.group(1)
        name = match.group(2)
        user_joined(date, name)
        print("{0} logged in".format(name))
    match = logout_re.match(text)
    if match is not None:
        date = match.group(1)
        name = match.group(2)
        user_left(date, name)
        print("{0} logged out".format(name))
    match = kicked_float_re.match(text)
    if match is not None:
        date = match.group(1)
        name = match.group(2)
        why = match.group(3)
        user_left(date, name)
        print("{0} kicked for {1}".format(name, why))
    match = kicked_op_re.match(text)
    if match is not None:
        date = match.group(1)
        kicker = match.group(2)
        name = match.group(3)
        user_left(date, name)
        print("{0} kicked by {1}".format(name, kicker))

    match = chat_re.match(text)
    if match is not None:
        date = match.group(1)
        name = match.group(2)
        msg = match.group(3)
        add_message(ChatMessage(date, name, msg))

    match = op_command_re.match(text)
    if match is not None:
        name = match.group(2)
        cmd = match.group(3)
        try_cmd(name, cmd, op=True)

    match = nonop_command_re.match(text)
    if match is not None:
        name = match.group(2)
        cmd = match.group(3)
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

def main(server_jar_path):
    global mcserver
    mcserver = subprocess.Popen(['java', '-Xmx1024M', '-Xms1024M', '-jar', server_jar_path, 'nogui'], stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.STDOUT)

    server_thread.start()
    read_thread.start()
    input_thread.start()

    # main loop
    try:
        while True:
            line = text_queue.get()
            if line == None:
                break # eof
            got_text(line)
    except KeyboardInterrupt:
        pass
    print("shutting down")
    httpd.shutdown()
    put_text("stop")
    # wait a little for minecraft to shutdown
    poll_interval = 0.1
    for _ in range(int(5 / poll_interval)):
        if mcserver.poll() != None:
            break # done
        time.sleep(poll_interval)
    else:
        # too long to wait. send a ctrl+c in case we didn't already.
        mcserver.terminate()


if __name__ == "__main__":
    parser = optparse.OptionParser(version=__version__)
    (options, args) = parser.parse_args()
    if len(args) == 0:
        server_jar_path = 'minecraft_server.jar'
    else:
        server_jar_path = args[0]

    main(server_jar_path)

