#!/usr/bin/env node

var childProcess = require('child_process')
  , readline = require('readline')
  , path = require('path')
  , http = require('http')
  , util = require('util')
  , crypto = require('crypto')
  , zfill = require('zfill')
  , moment = require('moment')
  , packageJson = require('./package.json')
  , settings = require(path.join(process.cwd(), 'mcserve.json'))
  , assert = require('assert')

var GRAY_COLOR = "#808080";
var SERVER_JAR_PATH = 'minecraft_server.jar';

var onliners = {};
var messages = [];
var mcServer = null;
var mcProxy = null;
var httpServer = null;
var killTimeout = null;
var lastSeen = {};

var lineHandlers = [
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] <(.+?)> (.+)$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      var msg = match[3];
      // chat
      addMessage(new ChatMessage(name, msg));
    },
  },
];

main();

function htmlFilter(text, color) {
  text = text.replace(/&/g, '&amp;');
  text = text.replace(/"/g, '&quot;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');
  if (color) text = "<span style=\"color:" + color + "\">" + text + "</span>";
  return text;
}

function dateHeaderHtml(date) {
  return htmlFilter(moment(date).format("YYYY-MM-DD HH:mm:ss"), GRAY_COLOR);
}

function colorFromName(name) {
  var nameHash = parseInt(crypto.createHash('md5').update(name).digest('hex'), 16);
  var color = nameHash & 0xa0a0a0;
  return "#" + zfill(color.toString(16), 6);
}

function startServer() {
  httpServer = http.createServer(function(req, resp) {
    resp.statusCode = 200;
    resp.write(
      "<!doctype html>" +
      "<html>" +
      "<head>" +
      "<title>MineCraft Server Status</title>" +
      "</head>" +
      "<body>"
    );
    var onliner, joinDate;
    if (serverEmpty()) {
      resp.write("<p>Nobody is online :-(</p>");
    } else {
      resp.write("<h2>Online players:</h2><ul>");
      for (onliner in onliners) {
        joinDate = onliners[onliner];
        resp.write("<li>" +
          htmlFilter(onliner, colorFromName(onliner)) +
          ", joined " +
          moment(joinDate).fromNow() +
          ", last seen " + moment(lastSeen[onliner]).fromNow() +
          "</li>");
      }
      resp.write("</ul>");
    }
    resp.write("<h2>latest gibberish</h2>");
    var i, msg;
    for (i = messages.length - 1; i >= 0; --i) {
      msg = messages[i];
      resp.write(msg.html());
    }
    resp.write("<p><a href=\"https://github.com/superjoe30/mcserve\">mcserve</a> version " + packageJson.version + "</p></body></html>");
    resp.end();
  });
  httpServer.listen(settings.webPort, settings.webHost, function() {
    console.info("Listening at http://" + settings.webHost + ":" + settings.webPort);
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
    mcProxy.removeListener('exit', restartMcProxy);
    httpServer.close();
    rl.close();
    // if minecraft takes longer than 5 seconds to stop, kill it
    killTimeout = setTimeout(killMc, 5000);
    mcServer.once('exit', function() {
      clearTimeout(killTimeout);
    });
    mcPut("stop");
    mcProxy.kill();
  }
}

function restartMcServer() {
  addMessage(new ServerRestartMessage());
  onliners = {};
  clearTimeout(killTimeout);
  startMcServer();
}

function restartMcProxy() {
  addMessage(new ProxyCrashedMessage());
  startMcProxy();
}

var msgHandlers = {
  requestRestart: function(username) {
    addMessage(new ServerRestartRequestMessage(username));
  },
  botCreate: function(msg) {
    addMessage(new BotRequestMessage(msg.username, msg.type, msg.botName));
  },
  tp: function(msg) {
    mcPut("tp " + msg.fromUsername + " " + msg.toUsername);
  },
  destroyBot: function(msg) {
    mcPut("kick " + msg.botName + " destroyed bot");
    addMessage(new BotDestroyMessage(msg.username, msg.botName));
  },
  autoDestroyBot: function(botName) {
    addMessage(new BotDestroyMessage("[server]", botName));
  },
  restart: function() {
    mcPut("stop");
    mcProxy.kill();
    // if minecraft takes longer than 5 seconds to restart, kill it
    killTimeout = setTimeout(killMc, 5000);
  },
  userJoin: function(username) {
    onliners[username] = new Date();
    addMessage(new JoinLeftMessage(username, true));
  },
  userLeave: function(username) {
    delete onliners[username];
    addMessage(new JoinLeftMessage(username, false));
  },
  userActivity: function(username) {
    lastSeen[username] = new Date();
  },
  userDeath: function(username) {
    addMessage(new DeathMessage(username));
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

function addMessage(msg) {
  messages.push(msg);
  while (messages.length > 100) {
    messages.shift();
  }
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
  startMcProxy();
}

function Message() {
  this.date = new Date();
}

Message.prototype.html = function() {
  return dateHeaderHtml(this.date) + " " + this.htmlContent() + "<br>";
}

function ChatMessage(name, msg) {
  Message.call(this);
  this.name = name
  this.msg = msg
}
util.inherits(ChatMessage, Message);

ChatMessage.prototype.htmlContent = function() {
  return "&lt;" + htmlFilter(this.name, colorFromName(this.name)) + "&gt; " + htmlFilter(this.msg);
}

function JoinLeftMessage(name, joined) {
  Message.call(this);
  joined = joined == null ? true : joined;
  this.name = name;
  this.joined = joined;
  this.timestamp = new Date();
  if (joined) this.isQuickReturn = false;
  this._whatHappenedHtml = joined ? "joined" : "left";
  // try to find the most recent join/left activity from this person to give more info
  var i, otherMsg, howLongItsBeen;
  for (i = messages.length - 1; i >= 0; --i) {
    otherMsg = messages[i];
    if (! (otherMsg.isJoinLeftMessage && otherMsg.name === name && otherMsg.joined !== joined)) continue;
    howLongItsBeen = this.timestamp - otherMsg.timestamp;
    if (joined) {
      if (howLongItsBeen < 60000) {
        // time spent logged out was too short to count.
        // patch the logout message to indicate it was quick.
        otherMsg._whatHappenedHtml = htmlFilter("logged out briefly", GRAY_COLOR);
        this._whatHappenedHtml = htmlFilter("logged back in", GRAY_COLOR);
        this.isQuickReturn = true;
      } else {
        this._whatHappenedHtml += htmlFilter(" (logged off for " + moment.duration(howLongItsBeen).humanize() + ")", GRAY_COLOR);
      }
      break;
    } else {
      if (otherMsg.isQuickReturn) {
        // skip quick logouts
        continue;
      }
      this._whatHappenedHtml += htmlFilter(" (logged on for " + moment.duration(howLongItsBeen).humanize() + ")", GRAY_COLOR);
      break;
    }
  }
}
util.inherits(JoinLeftMessage, Message);

JoinLeftMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.name, colorFromName(this.name)) + " " + this._whatHappenedHtml;
};

JoinLeftMessage.prototype.isJoinLeftMessage = true;

function ServerRestartRequestMessage(name) {
  Message.call(this);
  this.name = name;
}

util.inherits(ServerRestartRequestMessage, Message);

ServerRestartRequestMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.name, colorFromName(this.name)) + " requested restart";
};

function ServerRestartMessage() {
  Message.call(this);
}
util.inherits(ServerRestartMessage, Message);

ServerRestartMessage.prototype.htmlContent = function() {
  return "server restart";
};

function ProxyCrashedMessage() {
  Message.call(this);
}
util.inherits(ProxyCrashedMessage, Message);

ProxyCrashedMessage.prototype.htmlContent = function() {
  return "proxy restart";
};

function DeathMessage(name) {
  Message.call(this);
  this.name = name;
}
util.inherits(DeathMessage, Message);

DeathMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.name, colorFromName(this.name)) + " died.";
};

function BotDestroyMessage(username, botName) {
  this.username = username;
  this.botName = botName;
  Message.call(this);
}
util.inherits(BotDestroyMessage, Message);

BotDestroyMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.username, colorFromName(this.username)) + " destroyed bot '" + htmlFilter(this.botName) + "'.";
};

function BotRequestMessage(owner, type, botName) {
  this.name = owner;
  this.type = type;
  this.botName = botName;
  Message.call(this);
}
util.inherits(BotRequestMessage, Message);

BotRequestMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.name, colorFromName(this.name)) +
    " created a '" + htmlFilter(this.type) + "' bot named '" +
    htmlFilter(this.botName) + "'.";
};
