use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, RwLock,
    },
};

use crate::session::Session;

/// Global registry of active PTY sessions.
///
/// IDs are monotonically incrementing u32 values starting at 1 (never 0 —
/// 0 is reserved as sentinel for "no session"). Per NFR-006.
pub struct PtyState {
    sessions: RwLock<HashMap<u32, Arc<Session>>>,
    next_id: AtomicU32,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            // Start at 1; 0 is the "no session" sentinel.
            next_id: AtomicU32::new(1),
        }
    }

    /// Fetch the next ID, insert the session, and return the assigned ID.
    pub fn insert(&self, session: Arc<Session>) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.sessions.write().unwrap().insert(id, session);
        id
    }

    /// Look up a session by ID. Returns `None` if not found.
    pub fn get(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.read().unwrap().get(&id).cloned()
    }

    /// Remove and return a session by ID. Returns `None` if not found.
    pub fn remove(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.write().unwrap().remove(&id)
    }
}

impl Default for PtyState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_state() -> PtyState {
        PtyState::new()
    }

    #[test]
    fn id_starts_at_one() {
        let state = make_state();
        let id = state.insert(Arc::new(Session::new_stub(0)));
        assert_eq!(id, 1, "first session ID must be 1 (0 is reserved)");
    }

    #[test]
    fn id_is_monotonic() {
        let state = make_state();
        let id1 = state.insert(Arc::new(Session::new_stub(0)));
        let id2 = state.insert(Arc::new(Session::new_stub(0)));
        let id3 = state.insert(Arc::new(Session::new_stub(0)));
        assert!(id1 < id2 && id2 < id3, "IDs must be strictly increasing");
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
    }

    #[test]
    fn insert_get_remove_roundtrip() {
        let state = make_state();
        let session = Arc::new(Session::new_stub(0));
        let id = state.insert(session);

        // ID is assigned by insert, not by the stub constructor.
        let got = state.get(id).expect("session must be present after insert");
        assert_eq!(got.id, 0); // stub's own field; insert doesn't mutate it

        let removed = state.remove(id).expect("remove must return the session");
        assert_eq!(removed.id, 0);

        assert!(
            state.get(id).is_none(),
            "session must be absent after remove"
        );
    }

    #[test]
    fn get_missing_returns_none() {
        let state = make_state();
        assert!(state.get(42).is_none());
    }

    #[test]
    fn never_assigns_zero() {
        let state = make_state();
        for _ in 0..10 {
            let id = state.insert(Arc::new(Session::new_stub(0)));
            assert_ne!(id, 0, "session ID 0 must never be assigned");
        }
    }
}
