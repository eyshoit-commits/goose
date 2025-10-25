import type { ElectronAPI } from '../preload';

const browserWindow = window as typeof window & {
  electron?: ElectronAPI;
  appConfig?: { get: (key: string) => unknown; getAll: () => Record<string, unknown> };
};

if (!browserWindow.electron) {
  const params = new URLSearchParams(window.location.search);
  const storageBaseUrlKey = 'goose.browser.baseUrl';
  const storageSecretKey = 'goose.browser.secret';
  const storageWorkingDir = 'goose.browser.workingDir';

  const persistIfPresent = (key: string, storageKey: string) => {
    const value = params.get(key);
    if (value) {
      localStorage.setItem(storageKey, value);
      return value;
    }
    return null;
  };

  const detectPlatform = () => {
    const uaData = (navigator as typeof navigator & { userAgentData?: { platform?: string } })
      .userAgentData;
    const platform = uaData?.platform || navigator.platform || '';
    const normalized = platform.toLowerCase();
    if (normalized.includes('mac')) {
      return 'darwin';
    }
    if (normalized.includes('win')) {
      return 'win32';
    }
    return 'linux';
  };

  const baseUrlFromQuery =
    persistIfPresent('gooseBaseUrl', storageBaseUrlKey) ?? localStorage.getItem(storageBaseUrlKey);
  const secretFromQuery =
    persistIfPresent('gooseSecret', storageSecretKey) ?? localStorage.getItem(storageSecretKey);
  const workingDirFromQuery =
    persistIfPresent('gooseWorkingDir', storageWorkingDir) ??
    localStorage.getItem(storageWorkingDir);

  const resolvedMetaEnv: Record<string, string | undefined> =
    (typeof import.meta !== 'undefined'
      ? ((
          import.meta as ImportMeta & {
            env?: Record<string, string | undefined>;
          }
        ).env ?? {})
      : {}) ?? {};

  const fallbackBaseUrl =
    baseUrlFromQuery ??
    resolvedMetaEnv.VITE_GOOSE_BASE_URL ??
    `${window.location.protocol}//${window.location.hostname}:8443`;

  const fallbackSecret = secretFromQuery ?? resolvedMetaEnv.VITE_GOOSE_SECRET ?? '';

  const logger = {
    info: (...args: unknown[]) => console.info('[goose-browser]', ...args),
    warn: (...args: unknown[]) => console.warn('[goose-browser]', ...args),
    error: (...args: unknown[]) => console.error('[goose-browser]', ...args),
  };

  const overrides: Record<string | symbol, unknown> = {
    platform: detectPlatform(),
    reactReady: () => logger.info('react ready (browser mode)'),
    logInfo: (...args: unknown[]) => logger.info(...args),
    logError: (...args: unknown[]) => logger.error(...args),
    logWarn: (...args: unknown[]) => logger.warn(...args),
    createChatWindow: () => logger.warn('createChatWindow is not supported in browser mode'),
    openExternal: (url: string) => window.open(url, '_blank', 'noopener'),
    closeWindow: () => window.close(),
    reloadApp: () => window.location.reload(),
    on: () => undefined,
    off: () => undefined,
    once: () => undefined,
    getSecretKey: async () => fallbackSecret,
    setSecretKey: async (value?: string) => {
      if (typeof value === 'string') {
        localStorage.setItem(storageSecretKey, value);
      }
    },
    getConfig: () => ({
      GOOSE_WORKING_DIR: workingDirFromQuery ?? '',
      GOOSE_DEFAULT_PROVIDER: '',
      GOOSE_VERSION: 'browser',
    }),
    getAllowedExtensions: async () => [],
    getBinaryPath: async () => '',
    getGoosedHostPort: async () => fallbackBaseUrl,
    getSecretToken: async () => fallbackSecret,
    getSettings: async () => null,
    setWakelock: async () => false,
    getWakelockState: async () => false,
    setMenuBarIcon: async () => false,
    getMenuBarIconState: async () => false,
    setDockIcon: async () => false,
    getDockIconState: async () => false,
    startPowerSaveBlocker: () => undefined,
    stopPowerSaveBlocker: () => undefined,
    startGoosed: async () => undefined,
    stopGoosed: async () => undefined,
    getVersion: () => 'browser',
    getTempImage: async () => null,
    saveDataUrlToTemp: async () => ({ filePath: '', success: false }),
    deleteTempFile: async () => undefined,
    writeFile: async () => false,
    readFile: async () => '',
    selectFileOrDirectory: async () => '',
    directoryChooser: async () => undefined,
    getPathForFile: (_file: File) => '',
    listFiles: async () => [],
    getAllowedProviders: async () => [],
    hasAcceptedRecipeBefore: async () => false,
    recordRecipeHash: async () => undefined,
    showMessageBox: async () => ({ response: 0 }),
    getSecretKeyFile: async () => undefined,
    getSecretKeyFilePath: async () => undefined,
    getBinaryVersion: async () => undefined,
    installUpdate: () => logger.warn('installUpdate is not available in browser mode'),
    checkForUpdates: async () => ({ updateAvailable: false }),
    downloadUpdate: async () => ({ success: false }),
    onUpdaterEvent: () => undefined,
    getUpdateState: async () => null,
    getSecretKeyEnv: async () => undefined,
  };

  browserWindow.electron = new Proxy(overrides, {
    get(target, property: string | symbol) {
      if (property in target) {
        return target[property];
      }
      return (...args: unknown[]) => {
        logger.warn(`window.electron.${String(property)} is not implemented in browser mode`, args);
        return undefined;
      };
    },
  }) as unknown as ElectronAPI;
}

if (!browserWindow.appConfig) {
  const config: Record<string, unknown> = {
    GOOSE_WORKING_DIR: localStorage.getItem('goose.browser.workingDir') ?? '',
    GOOSE_BASE_URL_SHARE: localStorage.getItem('goose.browser.baseUrl') ?? '',
  };

  browserWindow.appConfig = {
    get: (key: string) => config[key],
    getAll: () => ({ ...config }),
  };
}
