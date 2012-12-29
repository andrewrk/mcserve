# mcserve

node.js http server and console wrapper for minecraft server.

## Features

 * Web interface with recent chat history and who is online.
 * Automatically restart minecraft server when it crashes.
 * Provide extra commands to users

### Extra Commands for Users

 * `#restart`: Requests a server restart which will happen after everybody
   logs off.
 * `#seen <username>`: Tells how long ago username was seen on the server.

## Installation

1. Install [Java](http://java.com).
2. Install [node.js](http://nodejs.org/).
3. Download `minecraft_server.jar` from [minecraft.net](http://minecraft.net/).
4. `npm install mcserve`
5. `npm start mcserve`

## Configuration

### Port

Http server defaults to port 9999. You can configure this by passing in a
`PORT` environment variable to `npm start`.

## Minecraft Version Support

Supports `minecraft_server.jar` version 1.4.6 at least.
