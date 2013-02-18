var path = require('path')
  , mc = require('minecraft-protocol')
  , moment = require('moment')
  , superagent = require('superagent')
  , SETTINGS_PATH = path.join(process.cwd(), 'mcserve.json')
  , settings = require(SETTINGS_PATH)
  , packageJson = require('../package')
  , fs = require('fs')

var bots = {};
var users = {};
var restartRequested = false;

var updateLastSeenPackets = {
  0x03: true, // chat
  0x07: true, // use entity
  0x10: true, // held item change
  0x0e: true, // player digging
  0x0f: true, // player block placement
  0x12: true, // animation
  0x13: true, // entity action
  0x65: true, // close window
  0x66: true, // click window
  0x6c: true, // enchant item
  0x82: true, // update sign
  0xcb: true, // tab complete
  0xcc: true, // client settings
  0xcd: true, // client statuses
};

var adminCmdHandlers = {
  add: function(user, args) {
    var username = args[0];
    if (! username) return adminCmdHandlers.help(user, args);
    settings.admins[username.toLowerCase()] = true;
    saveSettings();
    msgUser(user, username + " is an admin.");
  },
  remove: function(user, args) {
    var username = args[0];
    if (! username) return adminCmdHandlers.help(user, args);
    delete settings.admins[username.toLowerCase()];
    saveSettings();
    msgUser(user, username + " is not an admin.");
  },
  status: function(user, args) {
    var username = args[0];
    if (! username) return adminCmdHandlers.help(user, args);
    var statusStr = settings.admins[username.toLowerCase()] ? "an admin" : "not an admin";
    msgUser(user, username + " is " + statusStr);
  },
  help: function(user, args) {
    msgUser(user, "§9/admin add <username>§f to whitelist somebody");
    msgUser(user, "§9/admin remove <username>§f to unwhitelist somebody");
    msgUser(user, "§9/admin status <username>§f to check if someone is an admin");
  },
};
var whitelistCmdHandlers = {
  add: function(user, args) {
    var username = args[0];
    if (! username) return whitelistCmdHandlers.help(user, args);
    settings.onlineModeExceptions[username.toLowerCase()] = true;
    saveSettings();
    msgUser(user, username + " added to whitelist.");
  },
  remove: function(user, args) {
    var username = args[0];
    if (! username) return whitelistCmdHandlers.help(user, args);
    delete settings.onlineModeExceptions[username.toLowerCase()];
    saveSettings();
    msgUser(user, username + " removed from whitelist.");
  },
  status: function(user, args) {
    var username = args[0];
    if (! username) return whitelistCmdHandlers.help(user, args);
    var statusStr = isProtected(username) ? "protected" : "vulnerable";
    msgUser(user, username + " is " + statusStr);
  },
  help: function(user, args) {
    msgUser(user, "§9/whitelist add <username>§f to whitelist somebody");
    msgUser(user, "§9/whitelist remove <username>§f to unwhitelist somebody");
    msgUser(user, "§9/whitelist status <username>§f to check if someone is on the list");
  },
};

var botCmdHandlers = {
  list: function(user, args) {
    listBotTypes(function(err, types) {
      if (err) {
        console.error(err.stack);
        msgUser(user, "Error getting bot type list: " + err.message.substring(0, 40));
      } else {
        msgUser(user, "Bot types: " + types.join(' '));
      }
    });
  },
  create: function(user, args) {
    var type = args[0]
      , botName = args[1];

    if (! type || ! botName) {
      botCmdHandlers.help(user, args);
      return;
    }

    if (isProtected(botName)) {
      msgUser(user, botName + " is protected. Choose a different name for your bot.");
      return;
    }

    var bot = bots[botName.toLowerCase()];
    if (bot && bot.owner !== user) {
      msgUser(user, "that's not your bot.");
      return;
    }

    requestNewBot(user.name, type, botName, function(err, id) {
      if (err) {
        msgUser(user, "Error creating bot: " + err.message.substring(0, 40));
        return;
      }
      sendMessage('botCreate', {
        username: user.name,
        type: type,
        botName: botName,
      });
      bots[botName.toLowerCase()] = {
        owner: user,
        id: id,
        name: botName,
      };
    });
  },
  tp: function(user, args) {
    var botName = args[0];
    if (! botName) {
      botCmdHandlers.help(user, args);
      return;
    }
    var bot = bots[botName.toLowerCase()];
    if (!bot || bot.owner !== user) {
      msgUser(user, "that's not your bot.");
      return;
    }
    sendMessage('tp', {
      fromUsername: bot.name,
      toUsername: user.name,
    });
  },
  destroy: function(user, args) {
    var botName = args[0];
    if (! botName) {
      botCmdHandlers.help(user, args);
      return;
    }
    var bot = bots[botName.toLowerCase()];
    if (!bot || bot.owner !== user) {
      msgUser(user, "that's not your bot.");
      return;
    }
    requestDestroyBot(bot, function(err) {
      if (err) {
        msgUser(user, "Error destroying bot: " + err.message.substring(0, 40));
      } else {
        sendMessage('destroyBot', {
          username: user.name,
          botName: bot.name,
        });
      }
    });
  },
  help: function(user, args) {
    msgUser(user, "§9/bot create <type> <username>§f to start a new bot");
    msgUser(user, "§9/bot list§f for a list of bot types");
    msgUser(user, "§9/bot tp <botname>§f to teleport your bot to you");
    msgUser(user, "§9/bot destroy <botname>§f to destroy your bot");
  },
};

var cmdHandlers = {
  restart: function(user) {
    if (restartRequested) {
      msgUser(user, "A server restart has already been requested.");
      return;
    }
    broadcastMsg(user.name + " has requested a server restart once everyone logs off.");
    restartRequested = true;
    sendMessage('requestRestart', user.name);
  },
  seen: function(user, args) {
    var name = args[0];
    var otherUser = users[name.toLowerCase()];
    if (otherUser) {
      msgUser(user, name + " was last seen " + moment(otherUser.lastSeen).fromNow());
    } else {
      msgUser(user, name + " has never been seen.");
    }
  },
  bot: function(user, args) {
    var cmd = args[0];
    var handler = botCmdHandlers[cmd] || botCmdHandlers.help;
    handler(user, args.slice(1));
  },
  version: function(user, args) {
    msgUser(user, "mcserve version " + packageJson.version);
  },
  help: function(user, args) {
    if (args[0] === 'mcserve') {
      msgUser(user, "§9/restart§f to request server restart");
      msgUser(user, "§9/seen <username>§f to check when someone was last seen");
      msgUser(user, "§9/bot§f to get help with using bots");
      msgUser(user, "§9/version§f to check mcserve version");
      msgUser(user, "§9/whitelist§f get help with using whitelist");
      msgUser(user, "§9/admin§f get help with using admin");
    } else {
      msgUser(user, "§9See special command help with /help mcserve");
      return true;
    }
  },
  whitelist: function(user, args) {
    if (! isAdmin(user)) {
      msgUser(user, "Command available to admins only.");
      return;
    }
    var cmd = args[0];
    var handler = whitelistCmdHandlers[cmd] || whitelistCmdHandlers.help;
    handler(user, args.slice(1));
  },
  admin: function(user, args) {
    if (! isAdmin(user)) {
      msgUser(user, "Command available to admins only.");
      return;
    }
    var cmd = args[0];
    var handler = adminCmdHandlers[cmd] || adminCmdHandlers.help;
    handler(user, args.slice(1));
  },
};

var myServer = mc.createServer({
  port: settings.proxyPort,
  host: settings.proxyHost,
  'online-mode': settings['online-mode'],
  encryption: settings.encryption,
  kickTimeout: settings.kickTimeout,
  motd: settings.motd,
  'max-players': settings['max-players'],
});
myServer.onlineModeExceptions = settings.onlineModeExceptions;
myServer.on('error', function(err) {
  console.error(err.stack);
});
myServer.on("login", function(realClient) {
  var myClient = mc.createClient({
    host: settings.minecraftHost,
    port: settings.minecraftPort,
    username: realClient.username,
    keepAlive: false,
  });
  var user = null;
  myClient.once(0x01, function(packet) {
    realClient.on('packet', fromRealClient);
    myClient.on('packet', fromMyClient);

    user = {
      realClient: realClient,
      myClient: myClient,
      lastSeen: new Date(),
      name: realClient.username,
    };
    users[realClient.username.toLowerCase()] = user;
    onUserJoin(user);
  });

  myClient.on('error', function(err) {
    removeListeners();
    console.error(err.stack);
  });
  realClient.on('error', function(err) {
    removeListeners();
    console.error(err.stack);
  });
  myClient.on('end', removeListeners);
  realClient.on('end', removeListeners);

  function removeListeners() {
    if (!user) return;
    realClient.removeListener('packet', fromRealClient);
    myClient.removeListener('packet', fromMyClient);
    try {
      user.myClient.write(0xff, { reason: "disconnect.quitting" });
    } catch (err) {
      console.error("Error sending disconnect packet:", err.stack);
    }
    onUserLeft(user);
    user = null;
  }

  function fromRealClient(packet) {
    if (updateLastSeenPackets[packet.id]) {
      user.lastSeen = new Date();
      sendMessage('userActivity', user.name);
    }
    if (packet.id === 0x03) {
      if (handleMsg(user, packet.message)) return;
    }
    myClient.write(packet.id, packet);
  }

  function fromMyClient(packet) {
    if (packet.id === 0x08) {
      if (packet.health <= 0) onDeath(user);
    }
    realClient.write(packet.id, packet);
  }
});

function onUserLeft(user) {
  var key = user.name.toLowerCase();
  delete users[key];
  var bot = bots[key];
  if (bot) {
    delete bots[key];
    requestDestroyBot(bot, function(err) {
      if (err) {
        console.error("Error destroying bot.", err.stack);
      } else {
        sendMessage('autoDestroyBot', bot.name);
      }
    });
  }
  sendMessage('userLeave', user.name);
  checkRestart();
}

function onUserJoin(user) {
  tellIfIsProtected(user);
  sendMessage('userJoin', user.name);
  // reassociate bot ownership
  for (var botKey in bots) {
    var bot = bots[botKey];
    if (bot.owner.name.toLowerCase() === user.name.toLowerCase()) {
      bot.owner = user;
    }
  }
}

function onDeath(user) {
  sendMessage('userDeath', user.name);
}

function tellIfIsProtected(user) {
  if (isProtected(user.name)) {
    user.realClient.write(0x03, {
      message: "Your username is protected from being hijacked as a bot."
    });
  } else {
    user.realClient.write(0x03, {
      message: "Warning: Your username is not protected against being hijacked as a bot."
    });
    user.realClient.write(0x03, {
      message: "Talk to a server admin to get on the whitelist."
    });
  }
}

function checkRestart() {
  if (restartRequested && serverEmpty()) sendMessage("restart", null);
}

function handleMsg(user, msg) {
  if (msg[0] !== '/') {
    sendMessage('userChat', {
      username: user.name,
      msg: msg,
    });
    return false;
  }
  var match = msg.match(/^\/([\S]+)(?:\s+(.*))?$/);
  if (! match) return false;
  var cmd = match[1];
  var argStr = match[2];
  if (cmd === 'me') {
    sendMessage('userChatAction', {
      username: user.name,
      msg: argStr,
    });
    return false;
  }
  var args = argStr ? argStr.split(/\s+/) : [];
  var fn = cmdHandlers[cmd];
  if (! fn) return false;
  return fn(user, args) !== true;
}

function sendMessage(name, value) {
  process.send({
    type: name,
    value: value,
  });
}

function msgUser(user, msg) {
  user.realClient.write(0x03, { message: msg } );
}

function broadcastMsg(msg) {
  for (var key in users) {
    var user = users[key];
    msgUser(user, msg);
  }
}

function listBotTypes(cb) {
  var request = superagent.get(settings.botServerEndpoint + "/list");
  request.end(function(err, resp) {
    if (err) {
      cb(err);
    } else if (! resp.ok) {
      cb(new Error(resp.status + " " + resp.text));
    } else {
      cb(null, resp.body);
    }
  });
}

function requestDestroyBot(bot, cb) {
  var request = superagent.post(settings.botServerEndpoint + "/destroy");
  request.send({
    apiKey: settings.botServerApiKey,
    id: bot.id,
  });
  request.end(function(err, resp) {
    if (err) {
      console.error("Error destroying bot", err.stack);
      cb(err);
    } else if (! resp.ok) {
      console.error("Error destroying bot", resp.status, resp.text);
      cb(new Error("http " + resp.status + " " + resp.text));
    } else {
      cb();
    }
  });
}

function requestNewBot(owner, type, botName, cb) {
  var request = superagent.post(settings.botServerEndpoint + "/create");
  request.send({
    type: type,
    apiKey: settings.botServerApiKey,
    port: settings.proxyPort,
    host: settings.proxyRemoteHost,
    username: botName,
    owner: owner,
  });
  request.end(function(err, resp) {
    if (err) {
      console.error("Error creating bot:", err.stack);
      cb(err);
    } else if (! resp.ok) {
      console.error("Error creating bot.", resp.status, resp.text);
      cb(new Error("http " + resp.status + " " + resp.text));
    } else {
      cb(null, resp.text);
    }
  });
}

function isProtected(username) {
  var isException = !!myServer.onlineModeExceptions[username.toLowerCase()];
  return settings['online-mode'] !== isException;
}

function isAdmin(user) {
  return !!settings.admins[user.name.toLowerCase()];
}

function serverEmpty() {
  for (var key in users) {
    return false;
  }
  return true;
}

function saveSettings() {
  var str = JSON.stringify(settings, null, 2);
  fs.writeFile(SETTINGS_PATH, str, function(err) {
    if (err) console.error("Error saving settings:", err.stack);
  });
}
