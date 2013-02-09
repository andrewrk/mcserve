# mcserve

Console wrapper and proxy for Minecraft 1.4.7 server.

## Features

 * Web interface with recent chat history and who is online.
 * Automatically restart minecraft server when it crashes.
 * Provide extra commands to users
 * Sets online-mode for a whitelist or blacklist of people.

### Extra Commands for Users

 * `/restart`: Requests a server restart which will happen after everybody
   logs off.
 * `/seen <username>`: Tells how long ago username was seen on the server.
 * `/bot` - create, destroy, list, tp bots on a
   [mc-bot-server](https://github.com/superjoe30/mc-bot-server)
 * `/version` - get the mcserve version

## Installation

1. Install [Java](http://java.com).
2. Install [node.js](http://nodejs.org/).
3. Download `minecraft_server.jar` from [minecraft.net](http://minecraft.net/).
4. Set `online-mode` to false in `server.properties`. Authentication and
   encryption is handled by this project.
5. `npm install mcserve`
6. Copy `mcserve.json.example` to your minecraft server folder and rename it to
   `mcserve.json`.
7. Change any configuration that you need to (see below)
8. `npm start mcserve`

### mcserve.json

 * `proxyPort` - port that the proxy listens on
 * `proxyHost` - host that the proxy binds to
 * `proxyRemoteHost` - the hostname that the bot server should connect bots to
 * `webPort` - the port that the web interface listens on
 * `webHost` - the host that the web interface binds to
 * `minecraftPort` - the port that the real minecraft server will listen on.
   Make sure this is the same as the `server-port` property in minecraft's
   `server.properties` file.
 * `minecraftHost` - the host that the real minecraft server will listen on.
   Make sure this is the same as the `server-ip` property in minecraft.'s
   `server.properties` file.
 * `online-mode` - whether you want the proxy to authenticate usernames with
   the official server. you can set exceptions with `onlineModeExceptions`.
   No matter what you choose, you must set `online-mode` to `false` in
   minecraft's `server.properties`.
 * `onlineModeExceptions` - in online mode, this is usernames which are not
   checked. in offline mode, this is usernames which are checked.
 * `encryption` - whether to turn on protocol encryption
 * `kickTimeout` - how many milliseconds to wait before kicking a client
   which is failing to send heartbeat messages
 * `motd` - little blurb that is displayed in the server list
 * `max-players` - limit number of people who can connect to the proxy
 * `admins` - these people can add and remove people from `onlineModeExceptions`
 * `botServerEndpoint` - URL to a running
   [mc-bot-server](https://github.com/superjoe30/mc-bot-server) which players
   can use to spawn bots.
 * `botServerApiKey` - the api key that you need to give to mc-bot-server
