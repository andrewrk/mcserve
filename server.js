#!/usr/bin/env node

var spawn = require('child_process').spawn
  , readline = require('readline')
  , http = require('http')
  , Batch = require('batch')
  , util = require('util')
  , crypto = require('crypto')
  , zfill = require('zfill')
  , moment = require('moment')
  , packageJson = require('./package.json')

var env = {
  PORT: process.env.PORT || 9999,
  HOST: process.env.HOST || '0.0.0.0',
};

var GRAY_COLOR = "#808080";
var SERVER_JAR_PATH = 'minecraft_server.jar';

var onliners = {};
var messages = [];
var restartRequested = false;
var mcServer = null;
var httpServer = null;
var killTimeout = null;
var lastSeen = {};

function updateLastSeen(name) {
  lastSeen[name] = new Date();
}

var lineHandlers = [
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+)\[\/(\d+\.\d+.\d+.\d+:\d+)\] logged in with entity id (\d+?) at \(.+?\)$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      updateLastSeen(name);
      onUserJoined(name);
      console.info(name, "logged in");
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) lost connection: (.+)$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      updateLastSeen(name);
      onUserLeft(name);
      console.info(name, "logged out");
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] Kicked (.+?) from the game: '(.+?)'$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      var why = match[3];
      updateLastSeen(name);
      console.info(name, "kicked for", why);
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] <(.+?)> (.+)$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      var msg = match[3];
      updateLastSeen(name);
      if (/^\#/.test(msg)) {
        // server command
        tryCmd(name, msg.substring(1));
      } else {
        // chat
        addMessage(new ChatMessage(name, msg));
      }
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) was slain by (.+)$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      var killer = match[3];
      updateLastSeen(name);
      addMessage(new DeathMessage(name, "slain by " + killer));
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) drowned$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      updateLastSeen(name);
      addMessage(new DeathMessage(name, "drowned"));
    },
  },
  {
    re: new RegExp(/^(\d+\-\d+\-\d+ \d+\:\d+\:\d+) \[INFO\] (.+?) hit the ground too hard$/),
    fn: function(match) {
      var date = match[1];
      var name = match[2];
      updateLastSeen(name);
      addMessage(new DeathMessage(name, "hit the ground too hard"));
    },
  },
];

var cmdHandlers = {
  restart: function(cmdUser) {
    if (restartRequested) {
      mcPut("say restart is already requested");
    } else {
      mcPut("say " + cmdUser + " has requested a server restart once everyone logs off");
      addMessage(new ServerRestartRequestMessage(cmdUser));
      restartRequested = true;
    }
  },
  seen: function(cmdUser, args) {
    var name = args[0];
    var date = lastSeen[name];
    if (date) {
      mcPut("say " + name + " was last seen " + moment(date).fromNow());
    } else {
      mcPut("say " + name + " has never been seen.");
    }
  },
};

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
        resp.write("<li>" + htmlFilter(onliner, colorFromName(onliner)) + ", joined " + moment(joinDate).fromNow() + "</li>");
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
  httpServer.listen(env.PORT, env.HOST, function() {
    console.info("Listening at http://" + env.HOST + ":" + env.PORT);
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
    httpServer.close();
    rl.close();
    // if minecraft takes longer than 5 seconds to stop, kill it
    killTimeout = setTimeout(killMc, 5000);
    mcServer.once('exit', function() {
      clearTimeout(killTimeout);
    });
    mcPut("stop");
  }
}

function restartMcServer() {
  addMessage(new ServerRestartMessage());
  onliners = {};
  restartRequested = false;
  clearTimeout(killTimeout);
  startMcServer();
}

function startMcServer() {
  mcServer = spawn('java', ['-Xmx1024M', '-Xms1024M', '-jar', SERVER_JAR_PATH, 'nogui'], {
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

function onUserJoined(name) {
  onliners[name] = new Date();
  addMessage(new JoinLeftMessage(name, true));
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


function tryCmd(name, cmd) {
  console.info("try cmd '" + name + "' '" + cmd + "'");
  var words = cmd.split(/\s+/);
  var fn = cmdHandlers[words[0]];
  if (fn) {
    fn(name, words.slice(1));
  } else {
    console.info("no such command:", cmd);
  }
}

function onUserLeft(name) {
  delete onliners[name];
  addMessage(new JoinLeftMessage(name, false));
  checkRestart();
}

function checkRestart() {
  if (restartRequested && serverEmpty()) {
    mcPut("stop");
    // if minecraft takes longer than 5 seconds to restart, kill it
    killTimeout = setTimeout(killMc, 5000);
  }
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

function DeathMessage(name, cause) {
  Message.call(this);
  this.name = name;
  this.cause = cause;
}
util.inherits(DeathMessage, Message);

DeathMessage.prototype.htmlContent = function() {
  return "* " + htmlFilter(this.name, colorFromName(this.name)) + " died: " + this.cause;
};
