use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::{
    DownloadModelRequest, DownloadModelResponse, PluginCapability, PluginError, PluginMetadata,
    PluginTaskType, ServerPlugin, StartServiceRequest, StartServiceResponse, StopServiceRequest,
    StopServiceResponse,
};

struct ManagedProcess {
    child: Child,
}

impl ManagedProcess {
    fn new(child: Child) -> Self {
        Self { child }
    command: String,
    args: Vec<String>,
}

impl ManagedProcess {
    fn new(child: Child, command: String, args: Vec<String>) -> Self {
        Self {
            child,
            command,
            args,
        }
    }
}

#[derive(Clone)]
pub struct LlmServerPlugin {
    metadata: PluginMetadata,
    base_dir: PathBuf,
    default_binary: Option<PathBuf>,
    client: reqwest::Client,
    processes: Arc<Mutex<HashMap<PluginTaskType, ManagedProcess>>>,
}

impl LlmServerPlugin {
    pub async fn bootstrap() -> anyhow::Result<Self> {
        let base_dir = match std::env::var("GOOSE_PLUGIN_LLM_BASE_DIR") {
            Ok(value) => PathBuf::from(value),
            Err(_) => std::env::current_dir()?.join("plugins").join("llmserver"),
        };

        fs::create_dir_all(&base_dir).await?;
        fs::create_dir_all(base_dir.join("text")).await?;
        fs::create_dir_all(base_dir.join("tts")).await?;

        let default_binary = std::env::var("GOOSE_PLUGIN_LLM_BINARY")
            .ok()
            .map(PathBuf::from);

        let metadata = PluginMetadata {
            id: "llmserver-rs".to_string(),
            name: "llmserver-rs".to_string(),
            description: "Manage llmserver-rs instances and download models".to_string(),
            capabilities: vec![
                PluginCapability::ModelDownload,
                PluginCapability::ServiceStart,
                PluginCapability::ServiceStop,
            ],
        };

        let client = reqwest::Client::builder()
            .user_agent("goose-llmserver-plugin/1.0")
            .build()?;

        Ok(Self {
            metadata,
            base_dir,
            default_binary,
            client,
            processes: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    fn resolve_destination_dir(&self, request: &DownloadModelRequest) -> PathBuf {
        if let Some(dir) = &request.destination_dir {
            PathBuf::from(dir)
        } else {
            self.base_dir.join(request.task_type.as_directory_suffix())
        }
    }

    fn resolve_binary_path(&self, request: &StartServiceRequest) -> Result<PathBuf, PluginError> {
        if let Some(explicit) = &request.binary_path {
            return Ok(PathBuf::from(explicit));
        }

        if let Some(default) = &self.default_binary {
            return Ok(default.clone());
        }

        Err(PluginError::InvalidRequest(
            "binary_path not provided and GOOSE_PLUGIN_LLM_BINARY unset".to_string(),
        ))
    }

    fn default_args(task: &PluginTaskType, model_path: &str) -> Vec<String> {
        vec![
            "serve".to_string(),
            "--model".to_string(),
            model_path.to_string(),
            "--task".to_string(),
            task.as_directory_suffix().to_string(),
        ]
    }

    async fn store_model(
        &self,
        path: &Path,
        mut response: reqwest::Response,
    ) -> Result<u64, PluginError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let mut file = fs::File::create(path).await?;
        let mut bytes_written: u64 = 0;
        while let Some(chunk) = response.chunk().await? {
            bytes_written += chunk.len() as u64;
            file.write_all(&chunk).await?;
        }

        Ok(bytes_written)
    }

    fn build_download_url(
        &self,
        request: &DownloadModelRequest,
    ) -> Result<reqwest::Url, PluginError> {
        let mut url = reqwest::Url::parse("https://huggingface.co/")
            .map_err(|err| PluginError::InvalidRequest(err.to_string()))?;

        {
            let mut segments = url.path_segments_mut().map_err(|_| {
                PluginError::InvalidRequest("cannot modify URL segments".to_string())
            })?;
            for segment in request.model_id.split('/') {
                if segment.is_empty() {
                    continue;
                }
                segments.push(segment);
            }
            segments.push("resolve");
            segments.push(request.revision.as_str());
            segments.push(request.filename.as_str());
        }

        url.set_query(Some("download=1"));
        Ok(url)
    }
}

#[async_trait::async_trait]
impl ServerPlugin for LlmServerPlugin {
    fn metadata(&self) -> PluginMetadata {
        self.metadata.clone()
    }

    async fn download_model(
        &self,
        request: DownloadModelRequest,
    ) -> Result<DownloadModelResponse, PluginError> {
        if request.model_id.trim().is_empty() {
            return Err(PluginError::InvalidRequest(
                "model_id is required".to_string(),
            ));
        }

        if request.filename.trim().is_empty() {
            return Err(PluginError::InvalidRequest(
                "filename is required".to_string(),
            ));
        }

        let url = self.build_download_url(&request)?;
        let mut builder = self.client.get(url);

        if let Some(token) = &request.auth_token {
            builder = builder.bearer_auth(token);
        }

        let response = builder.send().await?.error_for_status()?;
        let destination_dir = self.resolve_destination_dir(&request);
        let target_path = destination_dir.join(&request.filename);
        let bytes_written = self.store_model(&target_path, response).await?;

        Ok(DownloadModelResponse {
            saved_path: target_path.to_string_lossy().to_string(),
            bytes_written,
        })
    }

    async fn start_service(
        &self,
        request: StartServiceRequest,
    ) -> Result<StartServiceResponse, PluginError> {
        if request.model_path.trim().is_empty() {
            return Err(PluginError::InvalidRequest(
                "model_path is required".to_string(),
            ));
        }

        let binary_path = self.resolve_binary_path(&request)?;
        let args = request
            .args
            .clone()
            .unwrap_or_else(|| Self::default_args(&request.task_type, &request.model_path));
        let mut command = Command::new(&binary_path);
        command.args(&args);
        command.stdin(Stdio::null());
        command.stdout(Stdio::inherit());
        command.stderr(Stdio::inherit());

        if let Some(env) = &request.environment {
            for (key, value) in env {
                command.env(key, value);
            }
        }

        {
            let processes = self.processes.lock().await;
            if processes.contains_key(&request.task_type) {
                return Err(PluginError::ProcessAlreadyRunning(request.task_type));
            }
        }

        let child = command
            .spawn()
            .map_err(|err| PluginError::ProcessStart(err.to_string()))?;

        let pid = child.id().ok_or_else(|| {
            PluginError::ProcessStart("failed to obtain process identifier".to_string())
        })?;

        let mut processes = self.processes.lock().await;
        processes.insert(request.task_type.clone(), ManagedProcess::new(child));
        processes.insert(
            request.task_type.clone(),
            ManagedProcess::new(
                child,
                binary_path.to_string_lossy().to_string(),
                args.clone(),
            ),
        );

        Ok(StartServiceResponse {
            pid,
            command: binary_path.to_string_lossy().to_string(),
            args,
        })
    }

    async fn stop_service(
        &self,
        request: StopServiceRequest,
    ) -> Result<StopServiceResponse, PluginError> {
        let mut processes = self.processes.lock().await;
        let managed = processes
            .remove(&request.task_type)
            .ok_or_else(|| PluginError::ProcessNotRunning(request.task_type.clone()))?;
        let mut child = managed.child;

        if child.id().is_some() {
            child
                .kill()
                .await
                .map_err(|err| PluginError::ProcessStart(err.to_string()))?;
            child
                .wait()
                .await
                .map_err(|err| PluginError::ProcessStart(err.to_string()))?;
        }

        Ok(StopServiceResponse {
            task_type: request.task_type,
            terminated: true,
        })
    }
}

impl LlmServerPlugin {
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}

pub type SharedLlmServerPlugin = Arc<LlmServerPlugin>;
