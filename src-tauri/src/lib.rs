mod ask;
mod commands;
mod db;
mod history;
mod model;
mod profiles;
mod state;

use state::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState::default())
        .setup(|app| {
            app.manage(history::open_app(app.handle())?);
            Ok(())
        })
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
            commands::read_text_file,
            commands::write_binary_file,
            commands::execute_sql,
            commands::parse_sql,
            commands::load_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::list_history,
            commands::get_history,
            commands::delete_history,
            commands::clear_history,
            commands::list_events,
            commands::log_event,
            commands::load_settings,
            commands::save_settings,
            commands::ask_sql
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
