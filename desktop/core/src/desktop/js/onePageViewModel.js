// Licensed to Cloudera, Inc. under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  Cloudera, Inc. licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import $ from 'jquery';
import _ from 'lodash';
import * as ko from 'knockout';
import page from 'page';

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CONFIG_REFRESHED_TOPIC, GET_KNOWN_CONFIG_TOPIC } from 'config/events';
import huePubSub from 'utils/huePubSub';
import I18n from 'utils/i18n';
import waitForObservable from 'utils/timing/waitForObservable';
import waitForVariable from 'utils/timing/waitForVariable';
import getParameter from 'utils/url/getParameter';
import getSearchParameter from 'utils/url/getSearchParameter';
import { ASSIST_GET_DATABASE_EVENT, ASSIST_GET_SOURCE_EVENT } from 'ko/components/assist/events';
import { GLOBAL_ERROR_TOPIC } from 'reactComponents/GlobalAlert/events';
import ImporterPage from '../js/apps/newimporter/ImporterPage';
import StorageBrowserPage from '../js/apps/storageBrowser/StorageBrowserPage';

class OnePageViewModel {
  constructor() {
    const self = this;

    self.embeddable_cache = {};
    self.currentApp = ko.observable();
    self.currentContextParams = ko.observable(null);
    self.currentQueryString = ko.observable(null);
    self.isLoadingEmbeddable = ko.observable(false);
    self.extraEmbeddableURLParams = ko.observable('');

    self.getActiveAppViewModel = function (callback) {
      const checkInterval = window.setInterval(() => {
        const $koElement = $('#' + self.currentApp() + 'Components');
        if (
          $koElement.length > 0 &&
          ko.dataFor($koElement[0]) &&
          !(ko.dataFor($koElement[0]) instanceof OnePageViewModel)
        ) {
          window.clearInterval(checkInterval);
          callback(ko.dataFor($koElement[0]));
        }
      }, 25);
    };

    self.changeEditorType = function (type) {
      self.getActiveAppViewModel(viewModel => {
        if (viewModel && viewModel.selectedNotebook) {
          waitForObservable(viewModel.selectedNotebook, () => {
            if (viewModel.editorType() !== type) {
              viewModel.selectedNotebook().selectedSnippet(type);
              if (!window.ENABLE_HUE_5) {
                viewModel.editorType(type);
              }
              viewModel.newNotebook(type);
            }
          });
        }
      });
    };

    self.currentApp.subscribe(newApp => {
      huePubSub.publish('set.current.app.name', newApp);
      self.getActiveAppViewModel(viewModel => {
        huePubSub.publish('set.current.app.view.model', viewModel);
      });
    });

    huePubSub.subscribe('get.current.app.view.model', () => {
      self.getActiveAppViewModel(viewModel => {
        huePubSub.publish('set.current.app.view.model', viewModel);
      });
    });

    huePubSub.subscribe('get.current.app.name', callback => {
      callback(self.currentApp());
    });

    huePubSub.subscribe('open.editor.query', resp => {
      self.loadApp('editor');
      const data = { uuid: resp.history_uuid };
      if (resp.handle && resp.handle.session_id) {
        data['session'] = {
          type: resp.handle.session_type,
          id: resp.handle.session_id,
          session_id: resp.handle.session_guid,
          properties: []
        };
      }
      self.getActiveAppViewModel(viewModel => {
        viewModel.openNotebook(data.uuid, null, null, null, data.session);
      });
    });

    huePubSub.subscribe('open.importer.query', data => {
      self.loadApp('importer');
      self.getActiveAppViewModel(viewModel => {
        waitForVariable(viewModel.createWizard, () => {
          waitForVariable(viewModel.createWizard.prefill, () => {
            viewModel.createWizard.prefill.source_type(data['source_type']);
            viewModel.createWizard.prefill.target_type(data['target_type']);
            viewModel.createWizard.prefill.target_path(data['target_path']);
            viewModel.createWizard.destination.outputFormat(data['target_type']);
          });
          waitForVariable(viewModel.createWizard.source.query, () => {
            viewModel.createWizard.source.query({ id: data.id, name: data.name });
          });
          waitForVariable(viewModel.createWizard.loadSampleData, () => {
            viewModel.createWizard.loadSampleData(data);
          });
        });
      });
    });

    huePubSub.subscribe('resize.form.actions', () => {
      document.styleSheets[0].addRule(
        '.form-actions',
        'width: ' + $('.page-content').width() + 'px'
      );
      if ($('.content-panel:visible').length > 0) {
        document.styleSheets[0].addRule('.form-actions', 'margin-left: -11px !important');
      }
    });

    huePubSub.subscribe('split.panel.resized', () => {
      huePubSub.publish('resize.form.actions');
      huePubSub.publish('resize.plotly.chart');
    });

    huePubSub.publish('resize.form.actions');

    huePubSub.subscribe('open.editor.new.query', statementOptions => {
      self.loadApp('editor'); // Should open in Default

      self.getActiveAppViewModel(viewModel => {
        const editorType = statementOptions['type'] || 'hive'; // Next: use file extensions and default type of Editor for SQL
        viewModel.newNotebook(editorType, () => {
          self.changeEditorType(editorType);

          if (statementOptions['statementPath']) {
            viewModel
              .selectedNotebook()
              .snippets()[0]
              .statementType(statementOptions['statementType']);
            viewModel
              .selectedNotebook()
              .snippets()[0]
              .statementPath(statementOptions['statementPath']);
          }
          if (statementOptions['directoryUuid']) {
            viewModel.selectedNotebook().directoryUuid(statementOptions['directoryUuid']);
          }
        });
      });
    });

    const loadedJs = [];
    const loadedCss = [];
    const loadedApps = [];

    $('script[src]').each(function () {
      loadedJs.push($(this).attr('src'));
    });

    $('link[href]').each(function () {
      loadedCss.push($(this).attr('href'));
    });

    const addGlobalCss = function ($el) {
      const cssFile = $el.attr('href').split('?')[0];
      if (loadedCss.indexOf(cssFile) === -1) {
        loadedCss.push(cssFile);
        $.ajaxSetup({ cache: true });
        if (window.DEV) {
          $el.attr('href', $el.attr('href') + '?dev=' + Math.random());
        }
        $el.clone().appendTo($('head'));
        $.ajaxSetup({ cache: false });
      }
      $el.remove();
    };

    self.scriptQueue = [];
    self.currentlyLoadingScript = false;

    self.loadScript_nonce = function (scriptSrc) {
      const deferred = $.Deferred();

      self.scriptQueue.push({ scriptSrc, deferred });

      const loadNextScript = function () {
        if (self.currentlyLoadingScript || self.scriptQueue.length === 0) {
          // Either a script is currently being loaded or no scripts are left to load
          return;
        }

        // Get and remove the first script from the queue
        const { scriptSrc, deferred } = self.scriptQueue.shift();
        self.currentlyLoadingScript = true;

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = scriptSrc;
        script.onload = script.onerror = function () {
          // Clean up
          document.body.removeChild(script);
          // Resolve the promise for this script
          deferred.resolve();
          // Mark as no longer loading so the next script can load
          self.currentlyLoadingScript = false;
          // Attempt to load the next script
          loadNextScript();
        };
        document.body.appendChild(script);
      };

      loadNextScript(); // Start loading if no other scripts are currently being loaded
      return deferred.promise();
    };

    // Only load CSS and JS files that are not loaded before
    self.processHeaders = function (response) {
      const promise = $.Deferred();
      const $rawHtml = $('<span>').html(response);

      const $allScripts = $rawHtml.find('script[src]');

      const $jsonScript = $rawHtml.find("script[type='application/json']");
      $jsonScript.each(function () {
        document.head.appendChild(this);
      });

      const scriptsToLoad = $allScripts
        .map(function () {
          return $(this).attr('src');
        })
        .toArray();
      $allScripts.remove();

      $rawHtml.find('link[href]').each(function () {
        addGlobalCss($(this));
      });

      $rawHtml.find('a[href]').each(function () {
        let link = $(this).attr('href');
        if (link.startsWith('/') && !link.startsWith('/hue')) {
          link = window.HUE_BASE_URL + '/hue' + link;
        }
        $(this).attr('href', link);
      });

      const loadScript = function (scriptUrl) {
        const deferred = $.Deferred();
        $.ajax({
          url: scriptUrl,
          converters: {
            'text script': text => text
          }
        })
          .done(contents => {
            loadedJs.push(scriptUrl);
            deferred.resolve({ url: scriptUrl, contents });
          })
          .fail(() => {
            deferred.resolve('');
          });
        return deferred.promise();
      };

      const loadScripts = function (scriptUrls) {
        const promises = [];
        while (scriptUrls.length) {
          const scriptUrl = scriptUrls.shift();
          if (loadedJs.indexOf(scriptUrl) !== -1) {
            continue;
          }
          promises.push(loadScript(scriptUrl));
        }
        return promises;
      };

      const scriptPromises = loadScripts(scriptsToLoad);

      const evalScriptSync = function () {
        if (scriptPromises.length) {
          // Evaluate the scripts in the order they were defined in the page
          const nextScriptPromise = scriptPromises.shift();
          nextScriptPromise.done(scriptDetails => {
            if (scriptDetails.contents) {
              $.globalEval(scriptDetails.contents);
            }
            evalScriptSync();
          });
        } else {
          promise.resolve($rawHtml.children());
        }
      };

      evalScriptSync();
      return promise;
    };

    self.processHeadersSecure = function (response) {
      const promise = $.Deferred();
      const $rawHtml = $('<span>').html(response);

      // Since we're not executing scripts here, we simply collect them
      const $allScripts = $rawHtml.find('script[src]');
      const scriptsToLoad = $allScripts
        .map(function () {
          return $(this).attr('src');
        })
        .toArray();

      // Remove the script elements to avoid duplicating them when $rawHtml is inserted into the document
      $allScripts.remove();

      // Process other elements (link, a, etc.)
      $rawHtml.find('link[href]').each(function () {
        addGlobalCss($(this)); // Also removes the element
      });

      $rawHtml.find('a[href]').each(function () {
        let link = $(this).attr('href');
        if (link.startsWith('/') && !link.startsWith('/hue')) {
          link = window.HUE_BASE_URL + '/hue' + link;
        }
        $(this).attr('href', link);
      });

      // Pass the array of script sources along with $rawHtml to the calling code
      promise.resolve({ $rawHtml: $rawHtml, scriptsToLoad: scriptsToLoad });

      return promise;
    };

    huePubSub.subscribe('hue4.process.headers', opts => {
      self.processHeaders(opts.response).done(rawHtml => {
        opts.callback(rawHtml);
      });
    });

    let loadAppTimeout = -1;
    self.loadApp = (app, loadDeep) => {
      // This prevents loading an app twice when the URL is changed multiple times in one operation
      window.clearTimeout(loadAppTimeout);
      loadAppTimeout = window.setTimeout(() => {
        self.loadAppThrottled(app, loadDeep);
      }, 0);
    };

    self.loadAppThrottled = (app, loadDeep, options) => {
      if (self.currentApp() === 'editor' && $('#editorComponents').length) {
        const vm = ko.dataFor($('#editorComponents')[0]);
        if (vm.isPresentationMode()) {
          vm.selectedNotebook().isPresentationMode(false);
        }
      }

      if (
        self.currentApp() === 'editor' &&
        self.embeddable_cache['editor'] &&
        !$('#editorComponents').length
      ) {
        self.embeddable_cache['editor'] = undefined;
      }

      self.currentApp(app);
      if (!app.startsWith('security')) {
        self.lastContext = null;
      }
      window.SKIP_CACHE.forEach(skipped => {
        huePubSub.publish('app.dom.unload', skipped);
        $('#embeddable_' + skipped).html('');
      });
      self.isLoadingEmbeddable(true);
      loadedApps.forEach(loadedApp => {
        window.pauseAppIntervals(loadedApp);
        huePubSub.pauseAppSubscribers(loadedApp);
      });
      $('.tooltip').hide();
      huePubSub.publish('hue.datatable.search.hide');
      huePubSub.publish('hue.scrollleft.hide');
      huePubSub.publish('context.panel.visible', false);
      if (app.startsWith('oozie')) {
        huePubSub.clearAppSubscribers('oozie');
      }
      if (app.startsWith('security')) {
        $('#embeddable_security_hive').html('');
        $('#embeddable_security_hdfs').html('');
        $('#embeddable_security_hive2').html('');
        $('#embeddable_security_solr').html('');
      }
      if (!options?.isFullyFrontend && typeof self.embeddable_cache[app] === 'undefined') {
        if (loadedApps.indexOf(app) === -1) {
          loadedApps.push(app);
        }
        let baseURL = window.EMBEDDABLE_PAGE_URLS[app].url;
        if (self.currentContextParams() !== null) {
          if (loadDeep && self.currentContextParams()[0]) {
            baseURL += self.currentContextParams()[0];
          } else {
            const route = new page.Route(baseURL);
            route.keys.forEach(key => {
              if (key.name === 0) {
                if (typeof self.currentContextParams()[key.name] !== 'undefined') {
                  if (app === 'filebrowser') {
                    baseURL = baseURL
                      .replace('*', encodeURIComponent(self.currentContextParams()[key.name]))
                      .replace(/#/g, '%23');
                  } else {
                    baseURL = baseURL.replace(
                      '*',
                      encodeURI(self.currentContextParams()[key.name])
                    ); // We have some really funky stuff in here, this should be encodeURIComponent
                  }
                } else {
                  baseURL = baseURL.replace('*', '');
                }
              } else {
                baseURL = baseURL.replace(
                  ':' + key.name,
                  encodeURI(self.currentContextParams()[key.name])
                ); // We have some really funky stuff in here, this should be encodeURIComponent
              }
            });
          }
          self.currentContextParams(null);
        }
        if (self.currentQueryString() !== null) {
          baseURL += (baseURL.indexOf('?') > -1 ? '&' : '?') + encodeURI(self.currentQueryString());
          self.currentQueryString(null);
        }

        $.ajax({
          url:
            baseURL +
            (baseURL.indexOf('?') > -1 ? '&' : '?') +
            'is_embeddable=true' +
            self.extraEmbeddableURLParams(),
          beforeSend: function (xhr) {
            xhr.setRequestHeader('X-Requested-With', 'Hue');
          },
          dataType: 'html',
          success: function (response, status, xhr) {
            const type = xhr.getResponseHeader('Content-Type');
            if (type.indexOf('text/') > -1) {
              window.clearAppIntervals(app);
              huePubSub.clearAppSubscribers(app);
              self.extraEmbeddableURLParams('');
              const currentPath = window.location.pathname; // Retrieve the current path from the window location
              const basePath = currentPath.split('=')[0];
              const inlineScriptsUrls = ['oozie', 'beeswax', 'jobsub'].some(segment =>
                basePath.includes(segment)
              );
              if (inlineScriptsUrls) {
                self.processHeaders(response).done($rawHtml => {
                  if (window.SKIP_CACHE.indexOf(app) === -1) {
                    self.embeddable_cache[app] = $rawHtml;
                  }
                  $('#embeddable_' + app).html($rawHtml);
                  huePubSub.publish('app.dom.loaded', app);
                  window.setTimeout(() => {
                    self.isLoadingEmbeddable(false);
                  }, 0);
                });
              } else {
                self.processHeadersSecure(response).done(({ $rawHtml, scriptsToLoad }) => {
                  if (window.SKIP_CACHE.indexOf(app) === -1) {
                    self.embeddable_cache[app] = $rawHtml;
                  }
                  $('#embeddable_' + app).html($rawHtml);
                  // Now load the scripts
                  const loadScripts = scriptsToLoad.map(src => self.loadScript_nonce(src)); // Assumes loadScript_nonce is defined somewhere
                  Promise.all(loadScripts).then(() => {
                    huePubSub.publish('app.dom.loaded', app);
                    window.setTimeout(() => {
                      self.isLoadingEmbeddable(false);
                    }, 0);
                  });
                });
              }
            } else {
              if (type.indexOf('json') > -1) {
                const presponse = JSON.parse(response);
                if (presponse && presponse.url) {
                  window.location.href = window.HUE_BASE_URL + presponse.url;
                  return;
                }
              }
              window.location.href = window.HUE_BASE_URL + baseURL;
            }
          },
          error: function (xhr) {
            console.error('Route loading problem', xhr);
            if ((xhr.status === 401 || xhr.status === 403) && app !== '403') {
              self.loadApp('403');
            } else if (app !== '500') {
              self.loadApp('500');
            } else {
              huePubSub.publish(GLOBAL_ERROR_TOPIC, {
                message: I18n(
                  'It looks like you are offline or an unknown error happened. Please refresh the page.'
                )
              });
            }
          }
        });
      } else {
        self.isLoadingEmbeddable(false);
      }
      const title = options?.title || window.EMBEDDABLE_PAGE_URLS[app].title;
      window.document.title = 'Hue - ' + title;
      window.resumeAppIntervals(app);
      huePubSub.resumeAppSubscribers(app);
      $('.embeddable').hide();
      $('#embeddable_' + app).show();
      huePubSub.publish('app.gained.focus', app);
      huePubSub.publish('resize.form.actions');
    };

    self.dropzoneError = function (filename) {
      self.loadApp('importer');
      self.getActiveAppViewModel(vm => {
        vm.createWizard.source.path(DROPZONE_HOME_DIR + '/' + filename);
      });
      $('.dz-drag-hover').removeClass('dz-drag-hover');
    };

    const openImporter = function (path) {
      let databasename = '';
      let interpreter = '';
      const table = path
        .substring(path.lastIndexOf(':') + 1, path.lastIndexOf(';'))
        .slice(0, -4)
        .replace(/[^a-zA-Z0-9]/g, '_');
      self.loadApp('importer');
      huePubSub.publish(ASSIST_GET_SOURCE_EVENT, source => {
        interpreter = source;
      });
      huePubSub.publish(ASSIST_GET_DATABASE_EVENT, {
        connector: { id: interpreter },
        callback: databaseDef => {
          databasename = databaseDef.name;
        }
      });
      self.getActiveAppViewModel(vm => {
        vm.createWizard.source.path(path);
        vm.currentStep(2);
        vm.createWizard.source.interpreter(interpreter);
        vm.createWizard.destination.name(databasename + '.' + table);
        waitForObservable(vm.createWizard.destination.name, () => {
          vm.createWizard.indexFile();
        });
      });
    };

    const openImporterFilebrowser = function (path) {
      self.loadApp('importer');
      self.getActiveAppViewModel(vm => {
        vm.createWizard.source.inputFormat('file');
        window.setTimeout(() => {
          vm.createWizard.source.path(path);
        }, 0);
      });
    };

    self.dropzoneComplete = function (path) {
      if (path.toLowerCase().endsWith('.csv')) {
        openImporter(path);
      } else {
        huePubSub.publish('open.link', '/filebrowser/view=' + path);
      }
      $('.dz-drag-hover').removeClass('dz-drag-hover');
    };

    huePubSub.subscribe('open.in.importer', openImporterFilebrowser);

    huePubSub.subscribe('assist.dropzone.complete', self.dropzoneComplete);

    // prepend /hue to all the link on this page
    $('a[href]').each(function () {
      let link = $(this).attr('href');
      if (link.startsWith('/') && !link.startsWith('/hue')) {
        link = window.HUE_BASE_URL + '/hue' + link;
      }
      $(this).attr('href', link);
    });

    page.base(window.HUE_BASE_URL + '/hue');

    const getUrlParameter = name => getParameter(name) || '';

    self.lastContext = null;

    const camelToDash = camelCaseString => {
      return camelCaseString.replace(/[A-Z]/g, match => '-' + match.toLowerCase());
    };
    const createNewReactEmbeddable = (containerName, Component) => {
      const containerDiv = document.createElement('div');
      containerDiv.classList.add('embeddable', containerName, 'cuix', 'antd');
      document.querySelector('.page-content').appendChild(containerDiv);
      const root = createRoot(containerDiv);
      root.render(createElement(Component, {}));
      return containerDiv;
    };

    /* 
    Use this function if you want to show a React based application page 
    for a specific url without the need to use legacy mako templates.
    1. Add a new appsItem in HueSidebar.vue that links to the new url
    2. Import the new React component at the top of this file.
    3. Add a new object to the pageMapping array below as examplified here:    

      {
        url: '/my-new-url', 
        app: function () {
          showReactAppPage({
            appName: 'myNewAppName',
            component: MyNewReactComponent,
            title: 'My new APP title'
          });
        }
      }
    */
    // eslint-disable-next-line
    const showReactAppPage = ({
      appName,
      title,
      component,
      hideLeftAssist = true,
      hideRightAssist = true
    }) => {
      if (hideLeftAssist) {
        huePubSub.publish('left.assist.hide', true);
      }
      if (hideRightAssist) {
        huePubSub.publish('right.assist.hide', true);
      }
      const containerName = `${camelToDash(appName)}-container`;

      const appContainer =
        document.querySelector(`.page-content .${containerName}`) ||
        createNewReactEmbeddable(containerName, component);

      self.loadAppThrottled(appName, false, { isFullyFrontend: true, title });
      appContainer.style.display = 'block';
    };

    const pageMapping = [
      { url: '/403', app: '403' },
      { url: '/500', app: '500' },
      { url: '/about/', app: 'admin_wizard' },
      { url: '/about/admin_wizard', app: 'admin_wizard' },
      {
        url: '/accounts/logout',
        app: function () {
          location.href = window.HUE_BASE_URL + '/accounts/logout';
        }
      },
      {
        url: '/dashboard/admin/collections',
        app: function (ctx) {
          page('/home/?type=search-dashboard');
        }
      },
      { url: '/dashboard/*', app: 'dashboard' },
      {
        url: '/desktop/api/desktop/api2/doc/export*',
        app: function () {
          const documents = getUrlParameter('documents');
          location.href = window.HUE_BASE_URL + '/desktop/api2/doc/export?documents=' + documents;
        }
      },
      { url: '/desktop/dump_config', app: 'dump_config' },
      {
        url: '/gist',
        app: function () {
          const uuid = getUrlParameter('uuid');
          location.href = '/desktop/api2/gist/open?uuid=' + uuid;
        }
      },
      {
        url: '/desktop/metrics',
        app: function () {
          self.loadApp('metrics');
        }
      },
      {
        url: '/task_server',
        app: function () {
          self.loadApp('taskserver');
        }
      },
      {
        url: '/desktop/connectors',
        app: function () {
          self.loadApp('connectors');
        }
      },
      {
        url: '/desktop/analytics',
        app: function () {
          self.loadApp('analytics');
          self.getActiveAppViewModel(viewModel => {
            viewModel.fetchAnalytics();
          });
        }
      },
      {
        url: '/desktop/download_logs',
        app: function () {
          location.href = window.HUE_BASE_URL + '/desktop/download_logs';
        }
      },
      {
        url: '/editor',
        app: function () {
          // Defer to allow window.location param update
          _.defer(() => {
            if (typeof self.embeddable_cache['editor'] === 'undefined') {
              if (getUrlParameter('editor') !== '') {
                self.extraEmbeddableURLParams('&editor=' + getUrlParameter('editor'));
              } else if (getUrlParameter('type') !== '' && getUrlParameter('type') !== 'notebook') {
                self.extraEmbeddableURLParams('&type=' + getUrlParameter('type'));
              }
              self.loadApp('editor');
            } else {
              self.loadApp('editor');
              if (getUrlParameter('editor') !== '') {
                self.getActiveAppViewModel(viewModel => {
                  self.isLoadingEmbeddable(true);
                  viewModel
                    .openNotebook(getUrlParameter('editor'))
                    [window.ENABLE_HUE_5 ? 'finally' : 'always'](() => {
                      self.isLoadingEmbeddable(false);
                    });
                });
              } else if (getUrlParameter('type') !== '') {
                self.changeEditorType(getUrlParameter('type'));
              }
            }
          });
        }
      },
      {
        url: '/notebook/editor',
        app: function (ctx) {
          page('/editor?' + ctx.querystring);
        }
      },
      { url: '/filebrowser/view=*', app: 'filebrowser' },
      {
        url: '/filebrowser/*',
        app: function () {
          page('/filebrowser/view=' + DROPZONE_HOME_DIR);
        }
      },
      { url: '/hbase/', app: 'hbase' },
      { url: '/help', app: 'help' },
      {
        url: '/home2*',
        app: function (ctx) {
          page(ctx.path.replace(/home2/gi, 'home'));
        }
      },
      { url: '/home*', app: 'home' },
      { url: '/catalog', app: 'catalog' },
      { url: '/kafka/', app: 'kafka' },
      { url: '/indexer/topics/*', app: 'kafka' },
      { url: '/indexer/indexes', app: 'indexes' },
      { url: '/indexer/indexes/*', app: 'indexes' },
      { url: '/indexer/', app: 'indexes' },
      { url: '/indexer/importer/', app: 'importer' },
      {
        url: '/newimporter/',
        app: function () {
          showReactAppPage({
            appName: 'newimporter',
            component: ImporterPage,
            title: 'New Importer'
          });
        }
      },
      {
        url: '/storagebrowser/',
        app: function () {
          showReactAppPage({
            appName: 'storagebrowser',
            component: StorageBrowserPage,
            title: 'Storage Browser'
          });
        }
      },
      {
        url: '/indexer/importer/prefill/*',
        app: function (ctx) {
          self.loadApp('importer');
          self.getActiveAppViewModel(viewModel => {
            const _params = ctx.path.match(
              /\/indexer\/importer\/prefill\/?([^/]+)\/?([^/]+)\/?([^/]+)?/
            );
            if (!_params) {
              console.warn('Could not match ' + ctx.path);
            }
            waitForVariable(viewModel.createWizard, () => {
              waitForVariable(viewModel.createWizard.prefill, () => {
                viewModel.createWizard.prefill.source_type(_params && _params[1] ? _params[1] : '');
                viewModel.createWizard.prefill.target_type(_params && _params[2] ? _params[2] : '');
                viewModel.createWizard.prefill.target_path(_params && _params[3] ? _params[3] : '');
              });
            });
          });
        }
      },
      {
        url: '/jobbrowser/jobs/job_*',
        app: function (ctx) {
          page.redirect(
            '/jobbrowser#!id=application_' + _.trimEnd(ctx.params[0], '/').split('/')[0]
          );
        }
      },
      {
        url: '/jobbrowser/jobs/application_*',
        app: function (ctx) {
          page.redirect(
            '/jobbrowser#!id=application_' + _.trimEnd(ctx.params[0], '/').split('/')[0]
          );
        }
      },
      { url: '/jobbrowser*', app: 'jobbrowser' },
      { url: '/logs', app: 'logs' },
      {
        url: '/metastore',
        app: function () {
          page('/metastore/tables');
        }
      },
      { url: '/metastore/*', app: 'metastore' },
      {
        url: '/notebook',
        app: function (ctx) {
          self.loadApp('notebook');
          const notebookId = getSearchParameter('?' + ctx.querystring, 'notebook');
          if (notebookId !== '') {
            self.getActiveAppViewModel(viewModel => {
              self.isLoadingEmbeddable(true);
              viewModel.openNotebook(notebookId)[window.ENABLE_HUE_5 ? 'finally' : 'always'](() => {
                self.isLoadingEmbeddable(false);
              });
            });
          } else {
            self.getActiveAppViewModel(viewModel => {
              viewModel.newNotebook('notebook');
            });
          }
        }
      },
      {
        url: '/notebook/notebook',
        app: function (ctx) {
          page('/notebook?' + ctx.querystring);
        }
      },
      {
        url: '/notebook/notebooks',
        app: function (ctx) {
          page('/home/?' + ctx.querystring);
        }
      },
      {
        url: '/oozie/editor/bundle/list',
        app: function (ctx) {
          page('/home/?type=oozie-bundle');
        }
      },
      { url: '/oozie/editor/bundle/*', app: 'oozie_bundle' },
      {
        url: '/oozie/editor/coordinator/list',
        app: function (ctx) {
          page('/home/?type=oozie-coordinator');
        }
      },
      { url: '/oozie/editor/coordinator/*', app: 'oozie_coordinator' },
      {
        url: '/oozie/editor/workflow/list',
        app: function (ctx) {
          page('/home/?type=oozie-workflow');
        }
      },
      { url: '/oozie/editor/workflow/*', app: 'oozie_workflow' },
      { url: '/oozie/list_oozie_info', app: 'oozie_info' },
      {
        url: '/oozie/list_oozie_sla',
        app: function () {
          page.redirect('/jobbrowser/#!slas');
        }
      },
      {
        url: '/pig',
        app: function () {
          self.loadApp('editor');
          self.changeEditorType('pig');
        }
      },
      { url: '/search/*', app: 'dashboard' },
      {
        url: '/security/hdfs',
        app: function (ctx) {
          if (self.lastContext == null || ctx.path !== self.lastContext.path) {
            self.loadApp('security_hdfs');
          }
          self.lastContext = ctx;
        }
      },
      {
        url: '/security/hive',
        app: function (ctx) {
          if (self.lastContext == null || ctx.path !== self.lastContext.path) {
            self.loadApp('security_hive');
          }
          self.lastContext = ctx;
        }
      },
      {
        url: '/security/hive2',
        app: function (ctx) {
          if (self.lastContext == null || ctx.path !== self.lastContext.path) {
            self.loadApp('security_hive2');
          }
          self.lastContext = ctx;
        }
      },
      {
        url: '/security/solr',
        app: function (ctx) {
          if (self.lastContext == null || ctx.path !== self.lastContext.path) {
            self.loadApp('security_solr');
          }
          self.lastContext = ctx;
        }
      },
      {
        url: '/security',
        app: function () {
          page('/security/hive');
        }
      },
      { url: '/sqoop', app: 'sqoop' },
      { url: '/jobsub', app: 'jobsub' },
      { url: '/useradmin/configurations/', app: 'useradmin_configurations' },
      { url: '/useradmin/organizations/', app: 'useradmin_organizations' },
      { url: '/useradmin/groups/', app: 'useradmin_groups' },
      { url: '/useradmin/groups/new', app: 'useradmin_newgroup' },
      { url: '/useradmin/groups/edit/:group', app: 'useradmin_editgroup' },
      { url: '/useradmin/permissions/', app: 'useradmin_permissions' },
      { url: '/useradmin/permissions/edit/*', app: 'useradmin_editpermission' },
      { url: '/useradmin/users/', app: 'useradmin_users' },
      { url: '/useradmin/users/add_ldap_users', app: 'useradmin_addldapusers' },
      { url: '/useradmin/users/add_ldap_groups', app: 'useradmin_addldapgroups' },
      { url: '/useradmin/users/edit/:user', app: 'useradmin_edituser' },
      { url: '/useradmin/users/new', app: 'useradmin_newuser' },
      { url: '/useradmin', app: 'useradmin_users' }
    ];

    window.OTHER_APPS.forEach(otherApp => {
      pageMapping.push({
        url: '/' + otherApp + '*',
        app: ctx => {
          self.currentContextParams(ctx.params);
          self.currentQueryString(ctx.querystring);
          self.loadApp(otherApp, true);
        }
      });
    });

    const getModifiedCtxParamForFilePath = (ctx, mappingUrl) => {
      // FIX. The page library decodes the ctx.params differently than it decodes
      // the ctx.path, e.g. '+' is turned into ' ' which we don't want. Therefore we use
      // the path to extract the params manually and get the correct characters.
      const pathWithoutParams = mappingUrl.slice(0, -1);
      const paramsOnly = ctx.path.replace(pathWithoutParams, '');
      const filePathParam = decodeURIComponent(paramsOnly);

      // Unfortunate hack needed since % has to be double encoded since the page library
      // decodes it twice. This is temporarily double encoding only between the
      // huePubSub.publish('open.link', fullUrl); and the onePgeViewModel.js.
      return filePathParam.replaceAll('%25', '%');
    };

    pageMapping.forEach(mapping => {
      page(
        mapping.url,
        _.isFunction(mapping.app)
          ? mapping.app
          : ctx => {
              const ctxParams =
                mapping.app === 'filebrowser'
                  ? { 0: getModifiedCtxParamForFilePath(ctx, mapping.url) }
                  : ctx.params;
              self.currentContextParams(ctxParams);
              self.currentQueryString(ctx.querystring);
              self.loadApp(mapping.app);
            }
      );
    });

    const configUpdated = clusterConfig => {
      page('/', () => {
        page(clusterConfig['main_button_action'].page);
      });
      page('*', ctx => {
        console.error('Route not found', ctx);
        self.loadApp('404');
      });
      page();
    };

    huePubSub.publish(GET_KNOWN_CONFIG_TOPIC, configUpdated);
    huePubSub.subscribe(CONFIG_REFRESHED_TOPIC, configUpdated);

    huePubSub.subscribe('open.link', href => {
      if (href) {
        const prefix = '/hue';
        if (href.startsWith('/')) {
          if (window.HUE_BASE_URL.length && href.startsWith(window.HUE_BASE_URL)) {
            page(href);
          } else if (href.startsWith(prefix)) {
            page(window.HUE_BASE_URL + href);
          } else {
            page(window.HUE_BASE_URL + prefix + href);
          }
        } else if (href.indexOf('#') == 0) {
          // Only place that seem to use this is hbase onclick row
          window.location.hash = href;
        } else {
          page(href);
        }
      } else {
        console.warn('Received an open.link without href.');
      }
    });

    huePubSub.subscribe(
      'open.filebrowserlink',
      ({ pathPrefix, decodedPath, fileBrowserModel, browserTarget }) => {
        if (pathPrefix.includes('download=')) {
          // The download view on the backend requires the slashes not to
          // be encoded in order for the file to be correctly named.
          const encodedPath = encodeURIComponent(decodedPath).replaceAll('%2F', '/');
          const possibleKnoxUrlPathPrefix = window.HUE_BASE_URL;
          window.location = possibleKnoxUrlPathPrefix + pathPrefix + encodedPath;
          return;
        }

        const appPrefix = '/hue';
        const urlEncodedPercentage = '%25';
        // Fix. The '%' character needs to be encoded twice due to a bug in the page library
        // that decodes the url twice. Even when we don't directly call page() we still need this
        // fix since the user can reload the page which will trigger a call to page().
        const pageFixedEncodedPath = encodeURIComponent(
          decodedPath.replaceAll('%', urlEncodedPercentage)
        );
        const href = window.HUE_BASE_URL + appPrefix + pathPrefix + pageFixedEncodedPath;

        if (browserTarget) {
          window.open(href, browserTarget);
          return;
        }

        // We don't want reload the entire filebrowser when navigating between folders
        // and already on the listdir_components page.
        if (fileBrowserModel) {
          fileBrowserModel.targetPath(pathPrefix + encodeURIComponent(decodedPath));
          window.history.pushState(null, '', href);
          fileBrowserModel.retrieveData();
        } else {
          page(href);
        }
      }
    );
  }
}

export default OnePageViewModel;
