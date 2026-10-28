mod commands;
mod db;
mod model;
mod profiles;
mod state;

use state::DbState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::disconnect,
            commands::list_databases,
            commands::list_objects,
            commands::list_columns,
            commands::list_all_columns,
            commands::rename_object,
            commands::script_routine,
            commands::generate_script,
            commands::write_text_file,
            commands::execute_sql,
            commands::parse_sql,
            commands::load_profiles,
            commands::save_profile,
            commands::delete_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
