use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use utoipa::ToSchema;

pub mod llmserver;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PluginTaskType {
    Text,
    Tts,
}

impl PluginTaskType {
    pub fn as_directory_suffix(&self) -> &'static str {
        match self {
            PluginTaskType::Text => "text",
            PluginTaskType::Tts => "tts",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PluginCapability {
    ModelDownload,
    ServiceStart,
    ServiceStop,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PluginMetadata {
    pub id: String,
    pub name: String,
    pub description: String,
    pub capabilities: Vec<PluginCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DownloadModelRequest {
    pub model_id: String,
    pub filename: String,
    #[serde(default = "default_revision")]
    pub revision: String,
    #[serde(default)]
    pub destination_dir: Option<String>,
    #[serde(default)]
    pub auth_token: Option<String>,
    pub task_type: PluginTaskType,
}

fn default_revision() -> String {
    "main".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DownloadModelResponse {
    pub saved_path: String,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StartServiceRequest {
    pub task_type: PluginTaskType,
    pub model_path: String,
    #[serde(default)]
    pub binary_path: Option<String>,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub environment: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StartServiceResponse {
    pub pid: u32,
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StopServiceRequest {
    pub task_type: PluginTaskType,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StopServiceResponse {
    pub task_type: PluginTaskType,
    pub terminated: bool,
}

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("operation not supported")]
    UnsupportedOperation,
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("process already running for {0:?}")]
    ProcessAlreadyRunning(PluginTaskType),
    #[error("process not running for {0:?}")]
    ProcessNotRunning(PluginTaskType),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Network(#[from] reqwest::Error),
    #[error("failed to start process: {0}")]
    ProcessStart(String),
}

#[async_trait]
pub trait ServerPlugin: Send + Sync {
    fn metadata(&self) -> PluginMetadata;

    async fn download_model(
        &self,
        _request: DownloadModelRequest,
    ) -> Result<DownloadModelResponse, PluginError> {
        Err(PluginError::UnsupportedOperation)
    }

    async fn start_service(
        &self,
        _request: StartServiceRequest,
    ) -> Result<StartServiceResponse, PluginError> {
        Err(PluginError::UnsupportedOperation)
    }

    async fn stop_service(
        &self,
        _request: StopServiceRequest,
    ) -> Result<StopServiceResponse, PluginError> {
        Err(PluginError::UnsupportedOperation)
    }
}

#[derive(Default)]
pub struct PluginManager {
    plugins: HashMap<String, Arc<dyn ServerPlugin>>, // keyed by plugin id
    metadata_cache: HashMap<String, PluginMetadata>,
}

impl PluginManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, plugin: Arc<dyn ServerPlugin>) {
        let metadata = plugin.metadata();
        self.metadata_cache
            .insert(metadata.id.clone(), metadata.clone());
        self.plugins.insert(metadata.id.clone(), plugin);
    }

    pub fn plugin(&self, plugin_id: &str) -> Option<Arc<dyn ServerPlugin>> {
        self.plugins.get(plugin_id).cloned()
    }

    pub fn all_metadata(&self) -> Vec<PluginMetadata> {
        self.metadata_cache.values().cloned().collect()
    }
}

#[derive(Clone)]
pub struct SharedPluginManager {
    inner: Arc<RwLock<PluginManager>>,
}

impl SharedPluginManager {
    pub fn new(manager: PluginManager) -> Self {
        Self {
            inner: Arc::new(RwLock::new(manager)),
        }
    }

    pub async fn list_metadata(&self) -> Vec<PluginMetadata> {
        let guard = self.inner.read().await;
        guard.all_metadata()
    }

    pub async fn plugin(&self, plugin_id: &str) -> Option<Arc<dyn ServerPlugin>> {
        let guard = self.inner.read().await;
        guard.plugin(plugin_id)
    }
}
