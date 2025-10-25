use std::sync::Arc;

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use http::StatusCode;
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

use crate::plugins::{
    DownloadModelRequest, DownloadModelResponse, PluginError, PluginMetadata, StartServiceRequest,
    StartServiceResponse, StopServiceRequest, StopServiceResponse,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct PluginErrorResponse {
    pub message: String,
}

impl PluginErrorResponse {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

fn map_error(error: PluginError) -> (StatusCode, Json<PluginErrorResponse>) {
    let status = match error {
        PluginError::UnsupportedOperation => StatusCode::BAD_REQUEST,
        PluginError::InvalidRequest(_) => StatusCode::BAD_REQUEST,
        PluginError::NotReady(_) => StatusCode::SERVICE_UNAVAILABLE,
        PluginError::NotFound(_) => StatusCode::NOT_FOUND,
        PluginError::ProcessAlreadyRunning(_) => StatusCode::CONFLICT,
        PluginError::ProcessNotRunning(_) => StatusCode::CONFLICT,
        PluginError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
        PluginError::Network(_) => StatusCode::BAD_GATEWAY,
        PluginError::ProcessStart(_) => StatusCode::INTERNAL_SERVER_ERROR,
        PluginError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };

    (status, Json(PluginErrorResponse::new(error.to_string())))
}

#[utoipa::path(
    get,
    path = "/plugins",
    responses((status = 200, description = "List registered plugins", body = [PluginMetadata])),
)]
pub async fn list_plugins(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PluginMetadata>>, (StatusCode, Json<PluginErrorResponse>)> {
    let plugins = state.plugins.list_metadata().await;
    Ok(Json(plugins))
}

#[utoipa::path(
    post,
    path = "/plugins/{plugin_id}/models/download",
    params(("plugin_id" = String, Path, description = "Plugin identifier")),
    request_body = DownloadModelRequest,
    responses(
        (status = 200, description = "Model downloaded successfully", body = DownloadModelResponse),
        (status = 400, description = "Invalid request", body = PluginErrorResponse),
        (status = 404, description = "Plugin not found", body = PluginErrorResponse)
    ),
)]
pub async fn download_model(
    State(state): State<Arc<AppState>>,
    Path(plugin_id): Path<String>,
    Json(payload): Json<DownloadModelRequest>,
) -> Result<Json<DownloadModelResponse>, (StatusCode, Json<PluginErrorResponse>)> {
    let plugin = state.plugins.plugin(&plugin_id).await.ok_or((
        StatusCode::NOT_FOUND,
        Json(PluginErrorResponse::new("plugin not found")),
    ))?;
    plugin
        .download_model(payload)
        .await
        .map(Json)
        .map_err(map_error)
}

#[utoipa::path(
    post,
    path = "/plugins/{plugin_id}/services/start",
    params(("plugin_id" = String, Path, description = "Plugin identifier")),
    request_body = StartServiceRequest,
    responses(
        (status = 200, description = "Service started", body = StartServiceResponse),
        (status = 400, description = "Invalid request", body = PluginErrorResponse),
        (status = 404, description = "Plugin not found", body = PluginErrorResponse),
        (status = 409, description = "Service already running", body = PluginErrorResponse)
    ),
)]
pub async fn start_service(
    State(state): State<Arc<AppState>>,
    Path(plugin_id): Path<String>,
    Json(payload): Json<StartServiceRequest>,
) -> Result<Json<StartServiceResponse>, (StatusCode, Json<PluginErrorResponse>)> {
    let plugin = state.plugins.plugin(&plugin_id).await.ok_or((
        StatusCode::NOT_FOUND,
        Json(PluginErrorResponse::new("plugin not found")),
    ))?;
    plugin
        .start_service(payload)
        .await
        .map(Json)
        .map_err(map_error)
}

#[utoipa::path(
    post,
    path = "/plugins/{plugin_id}/services/stop",
    params(("plugin_id" = String, Path, description = "Plugin identifier")),
    request_body = StopServiceRequest,
    responses(
        (status = 200, description = "Service stopped", body = StopServiceResponse),
        (status = 404, description = "Plugin not found", body = PluginErrorResponse),
        (status = 409, description = "Service not running", body = PluginErrorResponse)
    ),
)]
pub async fn stop_service(
    State(state): State<Arc<AppState>>,
    Path(plugin_id): Path<String>,
    Json(payload): Json<StopServiceRequest>,
) -> Result<Json<StopServiceResponse>, (StatusCode, Json<PluginErrorResponse>)> {
    let plugin = state.plugins.plugin(&plugin_id).await.ok_or((
        StatusCode::NOT_FOUND,
        Json(PluginErrorResponse::new("plugin not found")),
    ))?;
    plugin
        .stop_service(payload)
        .await
        .map(Json)
        .map_err(map_error)
}

pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/plugins", get(list_plugins))
        .route("/plugins/:plugin_id/models/download", post(download_model))
        .route("/plugins/:plugin_id/services/start", post(start_service))
        .route("/plugins/:plugin_id/services/stop", post(stop_service))
        .with_state(state)
}
