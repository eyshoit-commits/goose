use goose_server::openapi;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let schema = openapi::generate_schema();

    let package_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let ui_output_path = PathBuf::from(&package_dir)
        .join("..")
        .join("..")
        .join("ui")
        .join("desktop")
        .join("openapi.json");

    // Ensure parent directory exists for UI file
    if let Some(parent) = ui_output_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }

    fs::write(&ui_output_path, &schema).unwrap();
    eprintln!(
        "Successfully generated OpenAPI schema at {}",
        ui_output_path.canonicalize().unwrap().display()
    );

    // Also write a copy at the repository root for tooling that expects ./openapi.json
    let root_output_path = PathBuf::from(&package_dir).join("..").join("..").join("openapi.json");
    if let Some(parent) = root_output_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&root_output_path, &schema).unwrap();
    eprintln!(
        "Successfully generated OpenAPI schema at {}",
        root_output_path.canonicalize().unwrap().display()
    );

    // Output the schema to stdout for piping
    println!("{}", schema);
}
