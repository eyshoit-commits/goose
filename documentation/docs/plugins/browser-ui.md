# goose browser ui and plugin administration

This guide explains how to launch the goose desktop interface in a regular browser and how to
manage the new plugin administration workflows that ship with the `llmserver-rs` integration.

## run the desktop ui inside a browser

Running the interface in a browser is helpful on development workstations where you want to test
changes without packaging an Electron application. The helper script shipped in
`scripts/run-browser-ui.sh` wraps the
[reference gist](https://gist.github.com/khronokernel/122dc28114d3a3b1673fa0423b5a9b39) and prepares
the correct environment variables before starting the secure Vite development server on port `8448`.

```bash
./scripts/run-browser-ui.sh --base-url https://127.0.0.1:4010 --secret dev-secret
```

The script accepts optional flags to override the backend base URL, provide an authentication token,
skip dependency installation, and forward extra arguments to Vite. It installs dependencies on the
first run so that new contributors can launch the UI with a single command.

Under the hood the script runs:

```bash
cd ui/desktop
npm run start-browser
```

The `start-browser` command will:

- Regenerate the OpenAPI client before every run to stay aligned with the backend API.
- Start a Vite dev server bound to `0.0.0.0:8448` so that it is reachable from virtual machines and
  remote browsers.
- Enforce the use of a production-safe port (8448) instead of the usual insecure development
  defaults (3000/8000).

### configure the backend connection

The browser mode cannot rely on Electron's preload APIs. A light-weight shim automatically injects a
`window.electron` object when the application detects that it is running in a pure browser
environment. The shim looks for backend connection details in the following order:

1. URL query parameters: `?gooseBaseUrl=https://server:443&gooseSecret=<token>`
2. Environment variables exposed to Vite at build time (`VITE_GOOSE_BASE_URL`,
   `VITE_GOOSE_SECRET`, and `VITE_GOOSE_WORKING_DIR`).
3. Values cached in `localStorage` from earlier runs.
4. A default fallback of `https://<current-host>:8443` with an empty secret.

For most local development sessions you can start the backend with:

```bash
cargo run -p goose-server --bin goosed
```

Then launch the browser UI and pass the backend address and secret (if you configured one) via the
URL:

```
http://127.0.0.1:8448/?gooseBaseUrl=http://127.0.0.1:4010&gooseSecret=dev-secret
```

The shim stores the values in `localStorage`, so subsequent refreshes reuse the provided details.
This approach keeps secrets out of source control while supporting secure testing flows.

## plugin system overview

The goose server now ships with a runtime plugin manager. Each plugin advertises capabilities so
that the UI can expose the right administrative actions. Plugins register themselves at startup and
are queryable through the `/plugins` endpoint.

The initial release bundles an adapter for the
[`llmserver-rs`](https://github.com/eyshoit-commits/llmserver-rs) runtime. It supports the following
capabilities:

- **Model downloads**: Stream artifacts directly from Hugging Face, optionally using a private token
  and a custom destination path.
- **Service lifecycle**: Start and stop `llmserver-rs` processes for text generation or text-to-
  speech workloads.

### plugin api endpoints

All plugin endpoints follow the `/plugins/{plugin_id}` namespace:

- `GET /plugins`: list plugin metadata.
- `POST /plugins/{plugin_id}/models/download`: download a model artifact from Hugging Face.
- `POST /plugins/{plugin_id}/services/start`: launch a managed inference process.
- `POST /plugins/{plugin_id}/services/stop`: stop the running process for the selected task type.

Requests accept JSON payloads that closely mirror the UI forms. The download endpoint accepts the
Hugging Face repository (`model_id`), the file name (`filename`), optional `revision`, optional
`destination_dir`, optional `auth_token`, and the desired `task_type` (`text` or `tts`). The start
endpoint allows overriding the binary path, specifying additional CLI arguments, and injecting
environment variables.

### plugin administration tab

A new “Plugins” tab is available in the sidebar. The tab provides:

- A capability overview for every registered plugin.
- A guided form to download models from Hugging Face through the llmserver plugin.
- Controls to start and stop llmserver services for text and text-to-speech use cases.
- Inline validation and toast notifications for success and error states.

The tab interacts with the backend through the shared OpenAPI client so that all requests inherit
the authenticated session headers configured in the shim.

## security considerations

- The plugin manager records running processes and prevents multiple concurrent services from
  colliding on the same task type.
- Hugging Face downloads run through the backend using the Rust `reqwest` client and stream directly
  to disk to avoid storing large assets in memory.
- All browser tooling uses secure defaults: HTTPS-ready URLs, strict port selection, and optional
  bearer tokens for private models.

With these additions goose can be operated entirely from a browser while still exposing advanced
administrative flows for custom plugin runtimes.
