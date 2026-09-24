use serde::{Deserialize, Serialize};

/// What was last uploaded, kept in the item's developer metadata.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadedState {
    pub version: String,
    pub preview: String,
    pub carousel: Vec<String>,
}

impl UploadedState {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("the state serialises")
    }

    pub fn from_json(json: &str) -> Result<UploadedState, String> {
        serde_json::from_str(json).map_err(|e| format!("the item's metadata is not valid: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let state = UploadedState {
            version: "0.12.0".into(),
            preview: "ab".repeat(32),
            carousel: vec!["01".repeat(32), "02".repeat(32)],
        };
        let json = state.to_json();
        assert_eq!(
            json,
            format!(
                r#"{{"version":"0.12.0","preview":"{}","carousel":["{}","{}"]}}"#,
                "ab".repeat(32),
                "01".repeat(32),
                "02".repeat(32)
            )
        );
        assert_eq!(UploadedState::from_json(&json).unwrap(), state);
    }

    #[test]
    fn reads_an_empty_carousel() {
        let state =
            UploadedState::from_json(r#"{"version":"0.1.0","preview":"x","carousel":[]}"#).unwrap();
        assert!(state.carousel.is_empty());
    }

    #[test]
    fn rejects_metadata_that_is_not_the_state() {
        assert!(UploadedState::from_json("hello").is_err());
        assert!(UploadedState::from_json(r#"{"version":"0.1.0"}"#).is_err());
    }
}
