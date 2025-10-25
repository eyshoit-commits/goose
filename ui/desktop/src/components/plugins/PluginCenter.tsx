import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';

import { MainPanelLayout } from '../Layout/MainPanelLayout';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { client } from '../../api/client.gen';
import { jsonBodySerializer } from '../../api/client';

type PluginCapability = 'model_download' | 'service_start' | 'service_stop';

type PluginTaskType = 'text' | 'tts';

type PluginMetadata = {
  id: string;
  name: string;
  description: string;
  capabilities: PluginCapability[];
};

type DownloadModelResponse = {
  saved_path: string;
  bytes_written: number;
};

type StartServiceResponse = {
  pid: number;
  command: string;
  args: string[];
};

type StopServiceResponse = {
  task_type: PluginTaskType;
  terminated: boolean;
};

type DownloadFormState = {
  pluginId: string;
  modelId: string;
  filename: string;
  revision: string;
  destinationDir: string;
  authToken: string;
  taskType: PluginTaskType;
};

type StartFormState = {
  pluginId: string;
  modelPath: string;
  binaryPath: string;
  args: string;
  environment: string;
  taskType: PluginTaskType;
};

type StopFormState = {
  pluginId: string;
  taskType: PluginTaskType;
};

const DEFAULT_PLUGIN_ID = 'llmserver-rs';

const initialDownloadState: DownloadFormState = {
  pluginId: DEFAULT_PLUGIN_ID,
  modelId: '',
  filename: '',
  revision: 'main',
  destinationDir: '',
  authToken: '',
  taskType: 'text',
};

const initialStartState: StartFormState = {
  pluginId: DEFAULT_PLUGIN_ID,
  modelPath: '',
  binaryPath: '',
  args: '',
  environment: '',
  taskType: 'text',
};

const initialStopState: StopFormState = {
  pluginId: DEFAULT_PLUGIN_ID,
  taskType: 'text',
};

const capabilityLabels: Record<PluginCapability, string> = {
  model_download: 'Model downloads',
  service_start: 'Service start',
  service_stop: 'Service stop',
};

const capabilityDescriptions: Record<PluginCapability, string> = {
  model_download: 'Pull model artifacts directly from Hugging Face repositories.',
  service_start: 'Launch a managed inference process for text or TTS tasks.',
  service_stop: 'Stop a running inference process.',
};

const parseArgs = (value: string): string[] => {
  if (!value.trim()) {
    return [];
  }
  return value
    .split(/\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
};

const parseEnvironment = (value: string): Record<string, string> | undefined => {
  const entries = value
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split('=');
      const trimmedKey = key?.trim();
      const trimmedValue = rest.join('=').trim();
      if (!trimmedKey) {
        return null;
      }
      return [trimmedKey, trimmedValue] as [string, string];
    })
    .filter((item): item is [string, string] => Array.isArray(item));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const formatTaskLabel = (task: PluginTaskType) => {
  switch (task) {
    case 'text':
      return 'Text generation';
    case 'tts':
      return 'Text to speech';
    default:
      return task;
  }
};

async function requestJson<T>(options: {
  method: 'GET' | 'POST';
  url: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const result = await client.request<T, unknown, true, 'data'>({
    method: options.method,
    url: options.url,
    body: options.body,
    responseStyle: 'data',
    bodySerializer: options.body ? jsonBodySerializer.bodySerializer : undefined,
    headers: options.body
      ? new globalThis.Headers({ 'Content-Type': 'application/json' })
      : undefined,
    parseAs: 'json',
    throwOnError: true,
  });

  if (!result) {
    throw new Error('Empty response from server');
  }

  return result as T;
}

export default function PluginCenter() {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadFormState>(initialDownloadState);
  const [startState, setStartState] = useState<StartFormState>(initialStartState);
  const [stopState, setStopState] = useState<StopFormState>(initialStopState);
  const [pendingAction, setPendingAction] = useState<'download' | 'start' | 'stop' | null>(null);

  useEffect(() => {
    const fetchPlugins = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await requestJson<PluginMetadata[]>({ method: 'GET', url: '/plugins' });
        setPlugins(response);
      } catch (err) {
        console.error('Failed to load plugin metadata', err);
        setError('Unable to load plugins from the goose backend.');
      } finally {
        setLoading(false);
      }
    };

    void fetchPlugins();
  }, []);

  const llmPlugin = useMemo(
    () => plugins.find((plugin) => plugin.id === DEFAULT_PLUGIN_ID),
    [plugins]
  );

  useEffect(() => {
    if (plugins.length > 0 && !llmPlugin) {
      setDownloadState((prev) => ({ ...prev, pluginId: plugins[0]?.id ?? DEFAULT_PLUGIN_ID }));
      setStartState((prev) => ({ ...prev, pluginId: plugins[0]?.id ?? DEFAULT_PLUGIN_ID }));
      setStopState((prev) => ({ ...prev, pluginId: plugins[0]?.id ?? DEFAULT_PLUGIN_ID }));
    }
  }, [plugins, llmPlugin]);

  const handleDownload = useCallback(async () => {
    try {
      setPendingAction('download');
      const body = {
        model_id: downloadState.modelId.trim(),
        filename: downloadState.filename.trim(),
        revision: downloadState.revision.trim() || 'main',
        destination_dir: downloadState.destinationDir.trim() || undefined,
        auth_token: downloadState.authToken.trim() || undefined,
        task_type: downloadState.taskType,
      };

      if (!body.model_id || !body.filename) {
        toast.error('Model ID and filename are required');
        return;
      }

      const response = await requestJson<DownloadModelResponse>({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(downloadState.pluginId)}/models/download`,
        body,
      });

      toast.success(
        `Model saved to ${response.saved_path} (${(response.bytes_written / (1024 * 1024)).toFixed(2)} MiB)`
      );
    } catch (err) {
      console.error('Failed to download model', err);
      toast.error('Download request failed. Check model details and try again.');
    } finally {
      setPendingAction(null);
    }
  }, [downloadState]);

  const handleStart = useCallback(async () => {
    try {
      setPendingAction('start');

      if (!startState.modelPath.trim()) {
        toast.error('Model path is required to start the service');
        return;
      }

      const body = {
        model_path: startState.modelPath.trim(),
        binary_path: startState.binaryPath.trim() || undefined,
        task_type: startState.taskType,
        args: parseArgs(startState.args),
        environment: parseEnvironment(startState.environment),
      };

      const response = await requestJson<StartServiceResponse>({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(startState.pluginId)}/services/start`,
        body,
      });

      toast.success(`Service started (pid ${response.pid}) using ${response.command}`);
    } catch (err) {
      console.error('Failed to start plugin service', err);
      toast.error('Failed to start the service. Verify binary path, args, and permissions.');
    } finally {
      setPendingAction(null);
    }
  }, [startState]);

  const handleStop = useCallback(async () => {
    try {
      setPendingAction('stop');
      const body = {
        task_type: stopState.taskType,
      };

      const response = await requestJson<StopServiceResponse>({
        method: 'POST',
        url: `/plugins/${encodeURIComponent(stopState.pluginId)}/services/stop`,
        body,
      });

      if (response.terminated) {
        toast.success(`Stopped ${formatTaskLabel(response.task_type)} service.`);
      } else {
        toast.info('No running service found to stop.');
      }
    } catch (err) {
      console.error('Failed to stop plugin service', err);
      toast.error('Failed to stop the service. It may not be running.');
    } finally {
      setPendingAction(null);
    }
  }, [stopState]);

  return (
    <MainPanelLayout>
      <div className="flex flex-1 flex-col min-w-0 overflow-y-auto">
        <div className="px-8 pt-16 pb-6">
          <h1 className="text-4xl font-light mb-2">Plugins</h1>
          <p className="text-sm text-text-muted">
            Manage goose plugin integrations. Installations can expose administrative actions such
            as downloading models from Hugging Face and orchestrating local inference services.
          </p>
        </div>

        <div className="px-8 pb-16 space-y-6">
          {loading ? (
            <div className="text-sm text-text-muted">Loading plugins…</div>
          ) : error ? (
            <div className="text-sm text-background-danger">{error}</div>
          ) : plugins.length === 0 ? (
            <div className="text-sm text-text-muted">No plugins are currently registered.</div>
          ) : null}

          {plugins.map((plugin) => (
            <Card key={plugin.id}>
              <CardHeader>
                <div>
                  <CardTitle className="text-2xl font-semibold">{plugin.name}</CardTitle>
                  <CardDescription className="mt-1 text-sm text-text-muted">
                    {plugin.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pb-6">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                    Capabilities
                  </h2>
                  <ul className="mt-2 grid gap-2 md:grid-cols-2">
                    {plugin.capabilities.map((capability) => (
                      <li
                        key={`${plugin.id}-${capability}`}
                        className="rounded-lg border border-border-subtle bg-background-subtle px-4 py-3"
                      >
                        <div className="text-sm font-medium text-text-default">
                          {capabilityLabels[capability] ?? capability}
                        </div>
                        <div className="text-xs text-text-muted">
                          {capabilityDescriptions[capability] ?? 'Plugin capability'}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {plugin.id === DEFAULT_PLUGIN_ID && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="text-lg font-semibold">Download model from Hugging Face</h3>
                      <p className="text-xs text-text-muted mb-4">
                        Provide the repository and file that you would like goose to cache locally.
                        Authentication tokens are optional and only required for private models.
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Model repository
                          </label>
                          <Input
                            placeholder="org/model"
                            value={downloadState.modelId}
                            onChange={(event) =>
                              setDownloadState((prev) => ({ ...prev, modelId: event.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Filename
                          </label>
                          <Input
                            placeholder="model.gguf"
                            value={downloadState.filename}
                            onChange={(event) =>
                              setDownloadState((prev) => ({
                                ...prev,
                                filename: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Revision
                          </label>
                          <Input
                            placeholder="main"
                            value={downloadState.revision}
                            onChange={(event) =>
                              setDownloadState((prev) => ({
                                ...prev,
                                revision: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Destination directory
                          </label>
                          <Input
                            placeholder="Optional override"
                            value={downloadState.destinationDir}
                            onChange={(event) =>
                              setDownloadState((prev) => ({
                                ...prev,
                                destinationDir: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Access token
                          </label>
                          <Input
                            placeholder="Optional Hugging Face token"
                            value={downloadState.authToken}
                            onChange={(event) =>
                              setDownloadState((prev) => ({
                                ...prev,
                                authToken: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Task type
                          </label>
                          <select
                            className="h-9 w-full rounded-md border border-border-subtle bg-background-default px-3 text-sm"
                            value={downloadState.taskType}
                            onChange={(event) =>
                              setDownloadState((prev) => ({
                                ...prev,
                                taskType: event.target.value as PluginTaskType,
                              }))
                            }
                          >
                            <option value="text">Text generation</option>
                            <option value="tts">Text to speech</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-4">
                        <Button
                          onClick={() => void handleDownload()}
                          disabled={pendingAction === 'download'}
                        >
                          {pendingAction === 'download' ? 'Downloading…' : 'Download model'}
                        </Button>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-lg font-semibold">Start inference service</h3>
                      <p className="text-xs text-text-muted mb-4">
                        Launch the llmserver-rs runtime with the selected model. Additional
                        arguments are separated by spaces. Environment variables can be provided as
                        comma or newline separated KEY=VALUE pairs.
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Model path
                          </label>
                          <Input
                            placeholder="/path/to/model.gguf"
                            value={startState.modelPath}
                            onChange={(event) =>
                              setStartState((prev) => ({ ...prev, modelPath: event.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Binary path
                          </label>
                          <Input
                            placeholder="Optional path to llmserver-rs"
                            value={startState.binaryPath}
                            onChange={(event) =>
                              setStartState((prev) => ({ ...prev, binaryPath: event.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Additional arguments
                          </label>
                          <Input
                            placeholder="--listen 0.0.0.0:9550"
                            value={startState.args}
                            onChange={(event) =>
                              setStartState((prev) => ({ ...prev, args: event.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Environment variables
                          </label>
                          <Input
                            placeholder="VAR=value, OTHER=value"
                            value={startState.environment}
                            onChange={(event) =>
                              setStartState((prev) => ({
                                ...prev,
                                environment: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Task type
                          </label>
                          <select
                            className="h-9 w-full rounded-md border border-border-subtle bg-background-default px-3 text-sm"
                            value={startState.taskType}
                            onChange={(event) =>
                              setStartState((prev) => ({
                                ...prev,
                                taskType: event.target.value as PluginTaskType,
                              }))
                            }
                          >
                            <option value="text">Text generation</option>
                            <option value="tts">Text to speech</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-4">
                        <Button
                          onClick={() => void handleStart()}
                          disabled={pendingAction === 'start'}
                        >
                          {pendingAction === 'start' ? 'Starting…' : 'Start service'}
                        </Button>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-lg font-semibold">Stop inference service</h3>
                      <p className="text-xs text-text-muted mb-4">
                        Gracefully terminates the managed llmserver-rs process for the selected task
                        type.
                      </p>
                      <div className="flex flex-col gap-3 md:flex-row md:items-end">
                        <div className="flex-1 space-y-1 max-w-xs">
                          <label className="text-xs font-semibold uppercase tracking-wide">
                            Task type
                          </label>
                          <select
                            className="h-9 w-full rounded-md border border-border-subtle bg-background-default px-3 text-sm"
                            value={stopState.taskType}
                            onChange={(event) =>
                              setStopState((prev) => ({
                                ...prev,
                                taskType: event.target.value as PluginTaskType,
                              }))
                            }
                          >
                            <option value="text">Text generation</option>
                            <option value="tts">Text to speech</option>
                          </select>
                        </div>
                        <Button
                          onClick={() => void handleStop()}
                          disabled={pendingAction === 'stop'}
                        >
                          {pendingAction === 'stop' ? 'Stopping…' : 'Stop service'}
                        </Button>
                      </div>
                    </section>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between items-center text-xs text-text-muted">
                <span>Plugin identifier: {plugin.id}</span>
                <span>Capabilities: {plugin.capabilities.length}</span>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </MainPanelLayout>
  );
}
