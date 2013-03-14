#!/usr/bin/env node

var childProcess = require('child_process')
  , readline = require('readline')
  , path = require('path')
  , http = require('http')
  , packageJson = require('./package.json')
  , settings = require(path.join(process.cwd(), 'mcserve.json'))
  , assert = require('assert')
  , express = require('express')
  , sse = require('connect-sse')()
  , cors = require('connect-xcors')()
  , noCache = require('connect-nocache')()
  , EventEmitter = require('events').EventEmitter

var SERVER_JAR_PATH = 'minecraft_server.jar';
var EVENT_HISTORY_COUNT = 100;

var onliners = {};
var eventHistory = [];
var bus = new EventEmitter();
bus.setMaxListeners(0);
var mcServer = null;
var mcProxy = null;
var httpServer = null;
var killTimeout = null;
var lastSeen = {};

var lineHandlers = [];

main();

function emitEvent(type, value) {
  var event = {
    type: type,
    date: new Date(),
    value: value,
  };
  if (event.type !== 'userActivity') {
    eventHistory.push(event);
    while (eventHistory.length > EVENT_HISTORY_COUNT) {
      eventHistory.shift();
    }
  }
  bus.emit('event', event);
}

function startServer() {
  var app = express();
  app.use(noCache);
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/events', [sse, cors], httpGetEvents);
  httpServer = http.createServer(app);
  httpServer.listen(settings.webPort, settings.webHost, function() {
    console.info("Listening at http://" + settings.webHost + ":" + settings.webPort);
  });
}

function httpGetEvents(req, resp) {
  resp.setMaxListeners(0);
  function busOn(event, cb){
    bus.on(event, cb);
    resp.on('close', function(){
      bus.removeListener(event, cb);
    });
  }
  resp.json({
    type: "history",
    value: {
      onliners: onliners,
      lastSeen: lastSeen,
      eventHistory: eventHistory,
      version: packageJson.version,
    },
  });
  busOn("event", function(event){
    resp.json({
      type: "event",
      value: event,
    });
  });
}

function startReadingInput() {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on('line', function(line) {
    if (line) mcPut(line);
    rl.prompt();
  });
  rl.on('close', onClose);
  process.once('SIGINT', onClose);
  rl.prompt();

  function onClose() {
    mcServer.removeListener('exit', restartMcServer);
    if (mcProxy) mcProxy.removeListener('exit', restartMcProxy);
    httpServer.close();
    rl.close();
    // if minecraft takes longer than 5 seconds to stop, kill it
    killTimeout = setTimeout(killMc, 5000);
    mcServer.once('exit', function() {
      clearTimeout(killTimeout);
    });
    mcPut("stop");
    if (mcProxy) mcProxy.kill();
  }
}

function restartMcServer() {
  emitEvent('serverRestart');
  onliners = {};
  clearTimeout(killTimeout);
  startMcServer();
}

function restartMcProxy() {
  emitEvent('proxyRestart');
  startMcProxy();
}

var msgHandlers = {
  requestRestart: function(username) {
    emitEvent('requestRestart', username);
  },
  botCreate: function(msg) {
    emitEvent('botCreate', msg);
  },
  tp: function(msg) {
    mcPut("tp " + msg.fromUsername + " " + msg.toUsername);
    emitEvent('tp', msg);
  },
  destroyBot: function(msg) {
    mcPut("kick " + msg.botName + " destroyed bot");
    emitEvent('destroyBot', msg);
  },
  autoDestroyBot: function(botName) {
    emitEvent('autoDestroyBot', botName);
  },
  restart: function() {
    mcPut("stop");
    if (mcProxy) mcProxy.kill();
    // if minecraft takes longer than 5 seconds to restart, kill it
    killTimeout = setTimeout(killMc, 5000);
  },
  userJoin: function(username) {
    onliners[username] = new Date();
    emitEvent('userJoin', username);
  },
  userLeave: function(username) {
    delete onliners[username];
    emitEvent('userLeave', username);
  },
  userActivity: function(username) {
    lastSeen[username] = new Date();
    emitEvent('userActivity', username);
  },
  userDeath: function(username) {
    emitEvent('userDeath', username);
  },
  userChat: function(msg) {
    emitEvent('userChat', msg);
  },
  userChatAction: function(msg) {
    emitEvent('userChatAction', msg);
  },
};

function startMcProxy() {
  mcProxy = childProcess.fork(path.join(__dirname, 'lib', 'proxy.js'));
  mcProxy.on('message', function(msg) {
    var handler = msgHandlers[msg.type];
    assert.ok(handler);
    handler(msg.value);
  });
  mcProxy.on('exit', restartMcProxy);
}

function startMcServer() {
  mcServer = childProcess.spawn('java', ['-Xmx1024M', '-Xms1024M', '-jar', SERVER_JAR_PATH, 'nogui'], {
    stdio: 'pipe',
  });
  var buffer = "";
  mcServer.stdin.setEncoding('utf8');
  mcServer.stdout.setEncoding('utf8');
  mcServer.stdout.on('data', onData);
  mcServer.stderr.setEncoding('utf8');
  mcServer.stderr.on('data', onData);
  function onData(data) {
    buffer += data;
    var lines = buffer.split("\n");
    var len = lines.length - 1;
    for (var i = 0; i < len; ++i) {
      onMcLine(lines[i]);
    }
    buffer = lines[lines.length - 1];
  }
  mcServer.on('exit', restartMcServer);
}

function serverEmpty() {
  for (var onliner in onliners) {
    return false;
  }
  return true;
}

function mcPut(cmd) {
  mcServer.stdin.write(cmd + "\n");
}


function killMc() {
  mcServer.kill();
}

function onMcLine(line) {
  var handler, match;
  for (var i = 0; i < lineHandlers.length; ++i) {
    handler = lineHandlers[i];
    match = line.match(handler.re);
    if (match) {
      handler.fn(match);
      return;
    }
  }
  console.info("[MC]", line);
}


function main() {
  startServer();
  startReadingInput();
  startMcServer();
  if (!settings.disableProxy) startMcProxy();
}

