use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::Mutex;

use crate::db::{EngineConn, QueryCancel};
use crate::model::Credentials;

pub struct DbState {
    pub sessions: Mutex<HashMap<String, Arc<Session>>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

pub struct Session {
    pub creds: Credentials,
    pub conn: Mutex<EngineConn>,
    pub active_cancel: StdMutex<Option<QueryCancel>>,
    pub cancelled: AtomicBool,
}
