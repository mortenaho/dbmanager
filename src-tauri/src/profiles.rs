use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::model::Profile;

fn profiles_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

pub fn load(app: &AppHandle) -> Result<Vec<Profile>, String> {
    let path = profiles_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub fn save_one(app: &AppHandle, mut profile: Profile) -> Result<Profile, String> {
    if !profile.remember_password {
        profile.password.clear();
    }
    let mut profiles = load(app)?;
    if profile.id.trim().is_empty() {
        if let Some(existing) = profiles.iter().find(|item| same_target(item, &profile)) {
            profile.id = existing.id.clone();
        } else {
            profile.id = uuid::Uuid::new_v4().to_string();
        }
    }
    profiles.retain(|item| item.id != profile.id && !same_target(item, &profile));
    profiles.insert(0, profile.clone());
    write(app, &profiles)?;
    Ok(profile)
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut profiles = load(app)?;
    profiles.retain(|item| item.id != id);
    write(app, &profiles)
}

fn write(app: &AppHandle, profiles: &[Profile]) -> Result<(), String> {
    let path = profiles_path(app)?;
    let json = serde_json::to_vec_pretty(profiles).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn same_target(a: &Profile, b: &Profile) -> bool {
    a.engine == b.engine
        && a.host.eq_ignore_ascii_case(&b.host)
        && a.port == b.port
        && a.username == b.username
        && a.database == b.database
}
