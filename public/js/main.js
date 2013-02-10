(function(){
  var angular = window.angular
    , moment = window.moment
    , EventSource = window.EventSource
    , main = angular.module('main', []);

  main.filter('ago', function(){
    return function(date){
      return moment(date).fromNow();
    };
  });

  main.filter('timestamp', function(){
    return function(date){
      return moment(date).format("YYYY-MM-DD HH:mm:ss");
    };
  });

  main.controller('MainCtrl', ['$scope'].concat(function($scope){
    var msgHandlers = {
      event: onEvent,
      history: onHistory,
    };

    var eventHandlers = {
      userJoin: onUserJoin,
      userLeave: onUserLeave,
      userActivity: onUserActivity,
    };

    var eventRenderers = {
      userChat: function(msg) {
        return "<" + msg.username + "> " + msg.msg;
      },
      userJoin: function(username) {
        return "* " + username + " joined";
      },
      userLeave: function(username) {
        return "* " + username + " left";
      },
      serverRestart: function() {
        return "* server restart";
      },
      proxyRestart: function() {
        return "* proxy restart";
      },
      requestRestart: function(username) {
        return "* requested restart";
      },
      botCreate: function(msg) {
        return "* " + msg.username + " created a '" +
          msg.type + "' bot named '" + msg.botName + "'";
      },
      destroyBot: function(msg) {
        return "* " + msg.username + " destroyed bot '" + msg.botName + "'";
      },
      autoDestroyBot: function(botName) {
        return "! bot '" + botName + "' automatically destroyed";
      },
      tp: function(msg) {
        return "* " + msg.fromUsername + " was teleported to " + msg.toUsername;
      },
      userDeath: function(username) {
        return "* " + username + " died";
      },
    };

    var source = new EventSource("/events");
    $scope.connectionStatus = "connecting";
    source.addEventListener('message', onMessage, false);
    source.addEventListener('error', onError, false);

    function onMessage(e){
      var msg, id, job;
      $scope.connectionStatus = "connected";
      msg = JSON.parse(e.data);
      var handler = msgHandlers[msg.type];
      handler(msg.value);
      $scope.$apply();
    }

    function onError(e){
      $scope.connectionStatus = "disconnected";
      $scope.$apply();
    }

    function onHistory(msg) {
      $scope.onliners = msg.onliners;
      $scope.lastSeen = msg.lastSeen;
      $scope.eventHistory = msg.eventHistory;
      $scope.version = msg.version;
      $scope.activity = {};
      for (var player in $scope.onliners) {
        $scope.activity[player] = 0;
      }
      scrollBottom();
    }

    function onEvent(event) {
      var handler = eventHandlers[event.type];
      if (handler && handler(event.value) === true) return;
      $scope.eventHistory.push(event);
      scrollBottom();
    }

    function scrollBottom() {
      setTimeout(function() {
        var elem = document.getElementById('history');
        elem.scrollTop = elem.scrollHeight;
      }, 10);
    }

    function onUserJoin(username) {
      $scope.onliners[username] = new Date();
      $scope.lastSeen[username] = new Date();
    }

    function onUserLeave(username) {
      delete $scope.onliners[username];
    }

    function onUserActivity(username) {
      $scope.lastSeen[username] = new Date();
      $scope.activity[username] = $scope.activity[username] == null ? 1 :
        $scope.activity[username] + 1;
      return true;
    }

    $scope.serverEmpty = function() {
      for (var username in $scope.onliners) {
        return false;
      }
      return true;
    };

    $scope.eventHtml = function(event) {
      var renderEvent = eventRenderers[event.type];
      if (renderEvent) {
        return renderEvent(event.value);
      } else {
        return event.type;
      }
    };
  }));

  main.run();

}).call(this);

