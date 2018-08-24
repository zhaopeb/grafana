import config from 'app/core/config';
import _ from 'lodash';
import $ from 'jquery';

import coreModule from 'app/core/core_module';
import { profiler } from 'app/core/profiler';
import appEvents from 'app/core/app_events';
import Drop from 'tether-drop';
import { createStore } from 'app/stores/store';
import colors from 'app/core/utils/colors';
import { BackendSrv, setBackendSrv } from 'app/core/services/backend_srv';
import { DatasourceSrv } from 'app/features/plugins/datasource_srv';

export class GrafanaCtrl {
  /** @ngInject */
  constructor(
    $scope,
    alertSrv,
    utilSrv,
    $rootScope,
    $controller,
    contextSrv,
    bridgeSrv,
    backendSrv: BackendSrv,
    datasourceSrv: DatasourceSrv
  ) {
    // sets singleston instances for angular services so react components can access them
    setBackendSrv(backendSrv);
    createStore({ backendSrv, datasourceSrv });

    $scope.init = function() {
      $scope.contextSrv = contextSrv;
      $scope.appSubUrl = config.appSubUrl;
      $scope._ = _;

      profiler.init(config, $rootScope);
      alertSrv.init();
      utilSrv.init();
      bridgeSrv.init();

      $scope.dashAlerts = alertSrv;
    };

    $rootScope.colors = colors;

    $scope.initDashboard = function(dashboardData, viewScope) {
      $scope.appEvent('dashboard-fetch-end', dashboardData);
      $controller('DashboardCtrl', { $scope: viewScope }).init(dashboardData);
    };

    $rootScope.onAppEvent = function(name, callback, localScope) {
      var unbind = $rootScope.$on(name, callback);
      var callerScope = this;
      if (callerScope.$id === 1 && !localScope) {
        console.log('warning rootScope onAppEvent called without localscope');
      }
      if (localScope) {
        callerScope = localScope;
      }
      callerScope.$on('$destroy', unbind);
    };

    $rootScope.appEvent = function(name, payload) {
      $rootScope.$emit(name, payload);
      appEvents.emit(name, payload);
    };

    $scope.init();
  }
}

function setViewModeBodyClass(body, mode, sidemenuOpen: boolean) {
  body.removeClass('view-mode--tv');
  body.removeClass('view-mode--kiosk');
  body.removeClass('view-mode--inactive');

  switch (mode) {
    case 'tv': {
      body.removeClass('sidemenu-open');
      body.addClass('kiosk-mode--tv');
      break;
    }
    // 1 & true for legacy states
    case 1:
    case true: {
      body.removeClass('sidemenu-open');
      body.addClass('view-mode--kiosk');
      break;
    }
    default: {
      body.toggleClass('sidemenu-open', sidemenuOpen);
    }
  }
}

/** @ngInject */
export function grafanaAppDirective(playlistSrv, contextSrv, $timeout, $rootScope, $location) {
  return {
    restrict: 'E',
    controller: GrafanaCtrl,
    link: (scope, elem) => {
      var sidemenuOpen;
      var body = $('body');

      // see https://github.com/zenorocha/clipboard.js/issues/155
      $.fn.modal.Constructor.prototype.enforceFocus = function() {};

      sidemenuOpen = scope.contextSrv.sidemenu;
      body.toggleClass('sidemenu-open', sidemenuOpen);

      appEvents.on('toggle-sidemenu', () => {
        sidemenuOpen = scope.contextSrv.sidemenu;
        body.toggleClass('sidemenu-open');
      });

      appEvents.on('toggle-sidemenu-mobile', () => {
        body.toggleClass('sidemenu-open--xs');
      });

      appEvents.on('toggle-sidemenu-hidden', () => {
        body.toggleClass('sidemenu-hidden');
      });

      scope.$watch(() => playlistSrv.isPlaying, function(newValue) {
        elem.toggleClass('view-mode--playlist', newValue === true);
      });

      // check if we are in server side render
      if (document.cookie.indexOf('renderKey') !== -1) {
        body.addClass('body--phantomjs');
      }

      // tooltip removal fix
      // manage page classes
      var pageClass;
      scope.$on('$routeChangeSuccess', function(evt, data) {
        if (pageClass) {
          body.removeClass(pageClass);
        }

        if (data.$$route) {
          pageClass = data.$$route.pageClass;
          if (pageClass) {
            body.addClass(pageClass);
          }
        }

        // clear body class sidemenu states
        body.removeClass('sidemenu-open--xs');

        $('#tooltip, .tooltip').remove();

        // check for kiosk url param
        setViewModeBodyClass(body, data.params.kiosk, sidemenuOpen);

        // close all drops
        for (let drop of Drop.drops) {
          drop.destroy();
        }
      });

      // handle kiosk mode
      appEvents.on('toggle-kiosk-mode', options => {
        let search = $location.search();

        if (options && options.exit) {
          search.kiosk = 1;
        }

        switch (search.kiosk) {
          case 'tv': {
            search.kiosk = 1;
            appEvents.emit('alert-success', ['Press ESC to exit TV mode']);
            break;
          }
          case 1:
          case true: {
            delete search.kiosk;
            break;
          }
          default: {
            search.kiosk = 'tv';
          }
        }

        $location.search(search);
        setViewModeBodyClass(body, search.kiosk, sidemenuOpen);
      });

      // handle in active view state class
      var lastActivity = new Date().getTime();
      var activeUser = true;
      var inActiveTimeLimit = 60 * 5000;

      function checkForInActiveUser() {
        if (!activeUser) {
          return;
        }
        // only go to activity low mode on dashboard page
        if (!body.hasClass('page-dashboard')) {
          return;
        }

        if (new Date().getTime() - lastActivity > inActiveTimeLimit) {
          activeUser = false;
          body.addClass('view-mode--inactive');
          body.removeClass('sidemenu-open');
        }
      }

      function userActivityDetected() {
        lastActivity = new Date().getTime();
        if (!activeUser) {
          activeUser = true;
          body.removeClass('view-mode--inactive');
          body.toggleClass('sidemenu-open', sidemenuOpen);
        }
      }

      // mouse and keyboard is user activity
      body.mousemove(userActivityDetected);
      body.keydown(userActivityDetected);
      // set useCapture = true to catch event here
      document.addEventListener('wheel', userActivityDetected, { capture: true, passive: true });
      // treat tab change as activity
      document.addEventListener('visibilitychange', userActivityDetected);

      // check every 2 seconds
      setInterval(checkForInActiveUser, 2000);

      appEvents.on('toggle-view-mode', () => {
        lastActivity = 0;
        checkForInActiveUser();
      });

      // handle document clicks that should hide things
      body.click(function(evt) {
        var target = $(evt.target);
        if (target.parents().length === 0) {
          return;
        }

        // for stuff that animates, slides out etc, clicking it needs to
        // hide it right away
        var clickAutoHide = target.closest('[data-click-hide]');
        if (clickAutoHide.length) {
          var clickAutoHideParent = clickAutoHide.parent();
          clickAutoHide.detach();
          setTimeout(function() {
            clickAutoHideParent.append(clickAutoHide);
          }, 100);
        }

        if (target.parents('.navbar-buttons--playlist').length === 0) {
          playlistSrv.stop();
        }

        // hide search
        if (body.find('.search-container').length > 0) {
          if (target.parents('.search-results-container, .search-field-wrapper').length === 0) {
            scope.$apply(function() {
              scope.appEvent('hide-dash-search');
            });
          }
        }

        // hide popovers
        var popover = elem.find('.popover');
        if (popover.length > 0 && target.parents('.graph-legend').length === 0) {
          popover.hide();
        }
      });
    },
  };
}

coreModule.directive('grafanaApp', grafanaAppDirective);
