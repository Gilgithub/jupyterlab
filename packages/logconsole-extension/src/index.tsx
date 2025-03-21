// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  CommandToolbarButton,
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker
} from '@jupyterlab/apputils';

import { ISettingRegistry } from '@jupyterlab/coreutils';

import {
  ILoggerRegistry,
  LogConsolePanel,
  LoggerRegistry
} from '@jupyterlab/logconsole';

import { IMainMenu } from '@jupyterlab/mainmenu';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

import { IRenderMimeRegistry } from '@jupyterlab/rendermime';

import { IStatusBar } from '@jupyterlab/statusbar';

import { DockLayout, Widget } from '@phosphor/widgets';

import { LogConsoleStatus } from './status';

const LOG_CONSOLE_PLUGIN_ID = '@jupyterlab/logconsole-extension:plugin';

/**
 * The command IDs used by the plugin.
 */
namespace CommandIDs {
  export const addTimestamp = 'logconsole:add-timestamp';
  export const clear = 'logconsole:clear';
  export const open = 'logconsole:open';
}

/**
 * The Log Console extension.
 */
const logConsolePlugin: JupyterFrontEndPlugin<ILoggerRegistry> = {
  activate: activateLogConsole,
  id: LOG_CONSOLE_PLUGIN_ID,
  provides: ILoggerRegistry,
  requires: [ILabShell, IRenderMimeRegistry, INotebookTracker],
  optional: [
    ICommandPalette,
    ILayoutRestorer,
    IMainMenu,
    ISettingRegistry,
    IStatusBar
  ],
  autoStart: true
};

/**
 * Activate the Log Console extension.
 */
function activateLogConsole(
  app: JupyterFrontEnd,
  labShell: ILabShell,
  rendermime: IRenderMimeRegistry,
  nbtracker: INotebookTracker,
  palette: ICommandPalette | null,
  restorer: ILayoutRestorer | null,
  mainMenu: IMainMenu | null,
  settingRegistry: ISettingRegistry | null,
  statusBar: IStatusBar | null
): ILoggerRegistry {
  let logConsoleWidget: MainAreaWidget<LogConsolePanel> = null;
  let logConsolePanel: LogConsolePanel = null;

  const loggerRegistry = new LoggerRegistry({
    defaultRendermime: rendermime,
    // The maxLength is reset below from settings
    maxLength: 1000
  });

  const tracker = new WidgetTracker<MainAreaWidget<LogConsolePanel>>({
    namespace: 'logconsole'
  });

  if (restorer) {
    void restorer.restore(tracker, {
      command: CommandIDs.open,
      name: () => 'logconsole'
    });
  }

  const status = new LogConsoleStatus({
    loggerRegistry: loggerRegistry,
    handleClick: () => {
      if (!logConsoleWidget) {
        createLogConsoleWidget({
          insertMode: 'split-bottom',
          ref: app.shell.currentWidget.id
        });
      } else {
        app.shell.activateById(logConsoleWidget.id);
      }
    }
  });

  interface ILogConsoleOptions {
    source?: string;
    insertMode?: DockLayout.InsertMode;
    ref?: string;
  }

  const createLogConsoleWidget = (options: ILogConsoleOptions = {}) => {
    logConsolePanel = new LogConsolePanel(loggerRegistry);

    logConsolePanel.source =
      options.source !== undefined
        ? options.source
        : nbtracker.currentWidget
        ? nbtracker.currentWidget.context.path
        : null;

    logConsoleWidget = new MainAreaWidget({ content: logConsolePanel });
    logConsoleWidget.addClass('jp-LogConsole');
    logConsoleWidget.title.closable = true;
    logConsoleWidget.title.label = 'Log Console';
    logConsoleWidget.title.iconClass = 'jp-LogConsoleIcon';

    const addTimestampButton = new CommandToolbarButton({
      commands: app.commands,
      id: CommandIDs.addTimestamp
    });

    const clearButton = new CommandToolbarButton({
      commands: app.commands,
      id: CommandIDs.clear
    });

    logConsoleWidget.toolbar.addItem(
      'lab-output-console-add-timestamp',
      addTimestampButton
    );
    logConsoleWidget.toolbar.addItem('lab-output-console-clear', clearButton);

    logConsolePanel.sourceChanged.connect(() => {
      app.commands.notifyCommandChanged();
    });

    logConsolePanel.sourceDisplayed.connect((panel, { source, version }) => {
      status.model.sourceDisplayed(source, version);
    });

    logConsoleWidget.disposed.connect(() => {
      logConsoleWidget = null;
      logConsolePanel = null;
      app.commands.notifyCommandChanged();
    });

    app.shell.add(logConsoleWidget, 'main', {
      ref: options.ref,
      mode: options.insertMode
    });
    void tracker.add(logConsoleWidget);

    logConsoleWidget.update();
    app.commands.notifyCommandChanged();
  };

  app.commands.addCommand(CommandIDs.open, {
    label: 'Show Log Console',
    execute: (options: ILogConsoleOptions = {}) => {
      // Toggle the display
      if (logConsoleWidget) {
        logConsoleWidget.dispose();
      } else {
        createLogConsoleWidget(options);
      }
    },
    isToggled: () => {
      return logConsoleWidget !== null;
    }
  });

  app.commands.addCommand(CommandIDs.addTimestamp, {
    label: 'Add Timestamp',
    execute: () => {
      const logger = loggerRegistry.getLogger(logConsolePanel.source);
      logger.log({ type: 'html', data: '<hr>' });
    },
    isEnabled: () => logConsolePanel && logConsolePanel.source !== null,
    iconClass: 'jp-AddIcon'
  });

  app.commands.addCommand(CommandIDs.clear, {
    label: 'Clear Log',
    execute: () => {
      const logger = loggerRegistry.getLogger(logConsolePanel.source);
      logger.clear();
    },
    isEnabled: () => logConsolePanel && logConsolePanel.source !== null,
    iconClass: 'fa fa-ban clear-icon'
  });

  app.contextMenu.addItem({
    command: CommandIDs.open,
    selector: '.jp-Notebook'
  });
  if (mainMenu) {
    mainMenu.viewMenu.addGroup([{ command: CommandIDs.open }]);
  }
  if (palette) {
    palette.addItem({ command: CommandIDs.open, category: 'Main Area' });
  }
  if (statusBar) {
    statusBar.registerStatusItem('@jupyterlab/logconsole-extension:status', {
      item: status,
      align: 'left',
      isActive: () => true,
      activeStateChanged: status.model!.stateChanged
    });
  }

  function setSource(newValue: Widget) {
    if (logConsoleWidget && newValue === logConsoleWidget) {
      // Do not change anything if we are just focusing on ourselves
      return;
    }

    let source: string | null;
    if (newValue && nbtracker.has(newValue)) {
      source = (newValue as NotebookPanel).context.path;
    } else {
      source = null;
    }
    if (logConsoleWidget) {
      logConsolePanel.source = source;
    }
    status.model.source = source;
  }
  void app.restored.then(() => {
    // Set source only after app is restored in order to allow restorer to
    // restore previous source first, which may set the renderer
    setSource(labShell.currentWidget);
    labShell.currentChanged.connect((_, { newValue }) => setSource(newValue));
  });

  if (settingRegistry) {
    const updateSettings = (settings: ISettingRegistry.ISettings): void => {
      loggerRegistry.maxLength = settings.get('maxLogEntries')
        .composite as number;
      status.model.flashEnabled = settings.get('flash').composite as boolean;
    };

    Promise.all([settingRegistry.load(LOG_CONSOLE_PLUGIN_ID), app.restored])
      .then(([settings]) => {
        updateSettings(settings);
        settings.changed.connect(settings => {
          updateSettings(settings);
        });
      })
      .catch((reason: Error) => {
        console.error(reason.message);
      });
  }

  return loggerRegistry;
}

export default [logConsolePlugin];
