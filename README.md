# mcserve

Console wrapper and proxy for Minecraft 1.4.7 server.

## Features

 * Web interface with recent chat history and who is online.
 * Automatically restart minecraft server when it crashes.
 * Provide extra commands to users
 * Sets online-mode for a whitelist or blacklist of people.

### Extra Commands for Users

 * `#restart`: Requests a server restart which will happen after everybody
   logs off.
 * `#seen <username>`: Tells how long ago username was seen on the server.
 * `#bot` - create, destroy, list, tp bots on a
   [mc-bot-server](https://github.com/superjoe30/mc-bot-server)

## Installation

1. Install [Java](http://java.com).
2. Install [node.js](http://nodejs.org/).
3. Download `minecraft_server.jar` from [minecraft.net](http://minecraft.net/).
4. Set `online-mode` to false in `server.properties`. Authentication and
   encryption is handled by this project.
5. `npm install mcserve`
6. Figure out and set your configuration environment variables (see below).
7. `npm start mcserve`

## Configuration Environment Variables

 * `PORT` - port the web interface listens on. Defaults to `9999`
 * `HOST` - host the web interface listens on. Defaults to `0.0.0.0`
 * `BOT_SERVER_ENDPOINT` - a running
   [mc-bot-server](https://github.com/superjoe30/mc-bot-server) which players
   can use to spawn bots.
 * `BOT_SERVER_API_KEY`: the api key that you need to give to mc-bot-server
 * `MC_PORT`: port that minecraft server is listening on. this should be the
   same as `server-port` in `server.properties`.

