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


  main.controller('MainCtrl', ['$scope'].concat(function($scope){
    var msgHandlers = {
      event: onEvent,
      history: onHistory,
    };

    var eventHandlers = {
      userJoin: onUserJoin,
      userLeave: onUserLeave,
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
      $scope.connectionStatus = "error";
      $scope.$apply();
    }

    function onHistory(msg) {
      $scope.onliners = msg.onliners;
      $scope.lastSeen = msg.lastSeen;
      $scope.eventHistory = msg.eventHistory;
    }

    function onEvent(event) {
      var handler = eventHandlers[event.type];
      if (handler && handler(event.value) === true) return;
      $scope.eventHistory.push(event);
    }

    function onUserJoin(username) {
      $scope.onliners[username] = new Date();
      $scope.lastSeen[username] = new Date();
    }

    function onUserLeave(username) {
      delete $scope.onliners[username];
    }

    $scope.serverEmpty = function() {
      for (var username in $scope.onliners) {
        return false;
      }
      return true;
    };
  }));

  main.run();

}).call(this);

