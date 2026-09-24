use std::ffi::{CString, c_char, c_void};
use std::mem::{self, MaybeUninit};
use std::path::{Path, PathBuf};
use std::ptr::addr_of;
use std::time::{Duration, Instant};

use steamworks::sys;

pub const STELLARIS_APP_ID: u32 = 281990;

const QUERY_TIMEOUT: Duration = Duration::from_secs(60);
const SUBMIT_TIMEOUT: Duration = Duration::from_secs(600);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const RESULT_OK: i32 = sys::EResult::k_EResultOK as i32;

pub struct Steam {
    _client: steamworks::Client,
    ugc: *mut sys::ISteamUGC,
    pipe: sys::HSteamPipe,
}

pub struct LiveItem {
    pub description: String,
    pub preview_url: Option<String>,
    pub metadata: Option<String>,
    pub previews: Vec<AdditionalPreview>,
}

pub struct AdditionalPreview {
    pub index: u32,
    pub url: String,
    pub is_image: bool,
}

#[derive(Default)]
pub struct Update {
    pub description: Option<String>,
    pub preview: Option<PathBuf>,
    pub remove_previews: Vec<u32>,
    pub add_previews: Vec<PathBuf>,
    pub metadata: String,
    pub change_note: Option<String>,
}

pub struct Submitted {
    pub result: i32,
    pub needs_legal_agreement: bool,
}

impl Submitted {
    pub fn is_ok(&self) -> bool {
        self.result == RESULT_OK
    }
}

impl Steam {
    pub fn connect() -> Result<Steam, String> {
        let client = steamworks::Client::init_app(STELLARIS_APP_ID)
            .map_err(|e| format!("cannot reach Steam (is the client open and logged in?): {e}"))?;
        let ugc = unsafe { sys::SteamAPI_SteamUGC_v021() };
        if ugc.is_null() {
            return Err("Steam has no workshop interface".into());
        }
        let pipe = unsafe { sys::SteamAPI_GetHSteamPipe() };
        Ok(Steam {
            _client: client,
            ugc,
            pipe,
        })
    }

    pub fn fetch_item(&self, item: u64) -> Result<LiveItem, String> {
        let mut ids = [item];
        let handle = unsafe {
            sys::SteamAPI_ISteamUGC_CreateQueryUGCDetailsRequest(self.ugc, ids.as_mut_ptr(), 1)
        };
        if handle == sys::k_UGCQueryHandleInvalid {
            return Err("Steam refused to create the item query".into());
        }
        let query = Query {
            ugc: self.ugc,
            handle,
        };
        query.ask_for_everything()?;

        let call = unsafe { sys::SteamAPI_ISteamUGC_SendQueryUGCRequest(self.ugc, handle) };
        let completed = self.wait_for::<sys::SteamUGCQueryCompleted_t>(
            call,
            sys::SteamUGCQueryCompleted_t_k_iCallback as i32,
            QUERY_TIMEOUT,
        )?;
        let completed = completed.as_ptr();
        let result = unsafe { read_enum(addr_of!((*completed).m_eResult)) };
        if result != RESULT_OK {
            return Err(format!("the item query failed: EResult {result}"));
        }
        let returned = unsafe { addr_of!((*completed).m_unNumResultsReturned).read_unaligned() };
        if returned == 0 {
            return Err(format!("Steam returned no item {item}"));
        }
        query.item()
    }

    pub fn submit(&self, item: u64, update: &Update) -> Result<Submitted, String> {
        let handle =
            unsafe { sys::SteamAPI_ISteamUGC_StartItemUpdate(self.ugc, STELLARIS_APP_ID, item) };
        if handle == sys::k_UGCUpdateHandleInvalid {
            return Err("Steam refused to start the item update".into());
        }
        let ugc = self.ugc;
        if let Some(description) = &update.description {
            let text = c_string(description)?;
            check("SetItemDescription", unsafe {
                sys::SteamAPI_ISteamUGC_SetItemDescription(ugc, handle, text.as_ptr())
            })?;
        }
        if let Some(preview) = &update.preview {
            let path = c_path(preview)?;
            check("SetItemPreview", unsafe {
                sys::SteamAPI_ISteamUGC_SetItemPreview(ugc, handle, path.as_ptr())
            })?;
        }
        for &index in &update.remove_previews {
            check("RemoveItemPreview", unsafe {
                sys::SteamAPI_ISteamUGC_RemoveItemPreview(ugc, handle, index)
            })?;
        }
        for preview in &update.add_previews {
            let path = c_path(preview)?;
            check("AddItemPreviewFile", unsafe {
                sys::SteamAPI_ISteamUGC_AddItemPreviewFile(
                    ugc,
                    handle,
                    path.as_ptr(),
                    sys::EItemPreviewType::k_EItemPreviewType_Image,
                )
            })?;
        }
        let metadata = c_string(&update.metadata)?;
        check("SetItemMetadata", unsafe {
            sys::SteamAPI_ISteamUGC_SetItemMetadata(ugc, handle, metadata.as_ptr())
        })?;

        let change_note = update.change_note.as_deref().map(c_string).transpose()?;
        let note_ptr = change_note
            .as_ref()
            .map_or(std::ptr::null(), |note| note.as_ptr());
        let call = unsafe { sys::SteamAPI_ISteamUGC_SubmitItemUpdate(ugc, handle, note_ptr) };
        let submitted = self.wait_for::<sys::SubmitItemUpdateResult_t>(
            call,
            sys::SubmitItemUpdateResult_t_k_iCallback as i32,
            SUBMIT_TIMEOUT,
        )?;
        let submitted = submitted.as_ptr();
        let (result, needs_legal_agreement) = unsafe {
            (
                read_enum(addr_of!((*submitted).m_eResult)),
                addr_of!((*submitted).m_bUserNeedsToAcceptWorkshopLegalAgreement)
                    .cast::<u8>()
                    .read_unaligned(),
            )
        };
        Ok(Submitted {
            result,
            needs_legal_agreement: needs_legal_agreement != 0,
        })
    }

    // The steamworks crate runs Steam in manual-dispatch mode, and its own
    // run_callbacks fetches (and so consumes) every call result, registered
    // or not, so raw calls are pumped here instead.
    fn wait_for<T>(
        &self,
        call: sys::SteamAPICall_t,
        expected_callback: i32,
        timeout: Duration,
    ) -> Result<MaybeUninit<T>, String> {
        if call == sys::k_uAPICallInvalid {
            return Err("Steam refused the request".into());
        }
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(result) = self.poll_for(call, expected_callback)? {
                return Ok(result);
            }
            if Instant::now() > deadline {
                return Err(format!(
                    "Steam did not answer within {}s",
                    timeout.as_secs()
                ));
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    fn poll_for<T>(
        &self,
        call: sys::SteamAPICall_t,
        expected_callback: i32,
    ) -> Result<Option<MaybeUninit<T>>, String> {
        let mut found = None;
        unsafe {
            sys::SteamAPI_ManualDispatch_RunFrame(self.pipe);
            let mut message: sys::CallbackMsg_t = mem::zeroed();
            while sys::SteamAPI_ManualDispatch_GetNextCallback(self.pipe, &mut message) {
                if message.m_iCallback == sys::SteamAPICallCompleted_t_k_iCallback as i32 {
                    let completed = message
                        .m_pubParam
                        .cast::<sys::SteamAPICallCompleted_t>()
                        .read_unaligned();
                    if { completed.m_hAsyncCall } == call {
                        found = Some(self.call_result::<T>(call, expected_callback));
                    }
                }
                sys::SteamAPI_ManualDispatch_FreeLastCallback(self.pipe);
            }
        }
        found.transpose()
    }

    // The result stays a MaybeUninit so that its enum fields are only ever
    // read as integers, through read_enum.
    unsafe fn call_result<T>(
        &self,
        call: sys::SteamAPICall_t,
        expected_callback: i32,
    ) -> Result<MaybeUninit<T>, String> {
        let mut result = MaybeUninit::<T>::zeroed();
        let mut failed = false;
        let ok = unsafe {
            sys::SteamAPI_ManualDispatch_GetAPICallResult(
                self.pipe,
                call,
                result.as_mut_ptr().cast::<c_void>(),
                mem::size_of::<T>() as i32,
                expected_callback,
                &mut failed,
            )
        };
        if !ok || failed {
            return Err("Steam lost the answer to the request (I/O failure)".into());
        }
        Ok(result)
    }
}

struct Query {
    ugc: *mut sys::ISteamUGC,
    handle: sys::UGCQueryHandle_t,
}

impl Drop for Query {
    fn drop(&mut self) {
        unsafe { sys::SteamAPI_ISteamUGC_ReleaseQueryUGCRequest(self.ugc, self.handle) };
    }
}

impl Query {
    fn ask_for_everything(&self) -> Result<(), String> {
        let (ugc, handle) = (self.ugc, self.handle);
        unsafe {
            check(
                "SetReturnLongDescription",
                sys::SteamAPI_ISteamUGC_SetReturnLongDescription(ugc, handle, true),
            )?;
            check(
                "SetReturnMetadata",
                sys::SteamAPI_ISteamUGC_SetReturnMetadata(ugc, handle, true),
            )?;
            check(
                "SetReturnAdditionalPreviews",
                sys::SteamAPI_ISteamUGC_SetReturnAdditionalPreviews(ugc, handle, true),
            )?;
            check(
                "SetAllowCachedResponse",
                sys::SteamAPI_ISteamUGC_SetAllowCachedResponse(ugc, handle, 0),
            )?;
        }
        Ok(())
    }

    fn item(&self) -> Result<LiveItem, String> {
        Ok(LiveItem {
            description: self.description()?,
            preview_url: self.preview_url(),
            metadata: self.metadata(),
            previews: self.additional_previews()?,
        })
    }

    // The details stay a MaybeUninit: they hold enums (result, file type,
    // visibility) that a newer Steam may fill with values the bindings lack.
    fn description(&self) -> Result<String, String> {
        let mut details = Box::new(MaybeUninit::<sys::SteamUGCDetails_t>::zeroed());
        let ok = unsafe {
            sys::SteamAPI_ISteamUGC_GetQueryUGCResult(
                self.ugc,
                self.handle,
                0,
                details.as_mut_ptr(),
            )
        };
        let details = details.as_ptr();
        let result = unsafe { read_enum(addr_of!((*details).m_eResult)) };
        if !ok || result != RESULT_OK {
            return Err(format!("Steam could not read the item: EResult {result}"));
        }
        Ok(from_c(unsafe { &*addr_of!((*details).m_rgchDescription) }))
    }

    fn preview_url(&self) -> Option<String> {
        let mut url = [0 as c_char; 2048];
        let ok = unsafe {
            sys::SteamAPI_ISteamUGC_GetQueryUGCPreviewURL(
                self.ugc,
                self.handle,
                0,
                url.as_mut_ptr(),
                url.len() as u32,
            )
        };
        let url = from_c(&url);
        (ok && !url.is_empty()).then_some(url)
    }

    fn metadata(&self) -> Option<String> {
        let mut metadata = vec![0 as c_char; sys::k_cchDeveloperMetadataMax as usize + 1];
        let ok = unsafe {
            sys::SteamAPI_ISteamUGC_GetQueryUGCMetadata(
                self.ugc,
                self.handle,
                0,
                metadata.as_mut_ptr(),
                metadata.len() as u32,
            )
        };
        let metadata = from_c(&metadata);
        (ok && !metadata.is_empty()).then_some(metadata)
    }

    fn additional_previews(&self) -> Result<Vec<AdditionalPreview>, String> {
        let count = unsafe {
            sys::SteamAPI_ISteamUGC_GetQueryUGCNumAdditionalPreviews(self.ugc, self.handle, 0)
        };
        (0..count)
            .map(|index| self.additional_preview(index))
            .collect()
    }

    fn additional_preview(&self, index: u32) -> Result<AdditionalPreview, String> {
        let mut url = [0 as c_char; 2048];
        let mut file_name = [0 as c_char; 1024];
        // Read as a plain integer: Steam may return a kind the bindings' enum lacks.
        let mut kind: i32 = -1;
        let ok = unsafe {
            sys::SteamAPI_ISteamUGC_GetQueryUGCAdditionalPreview(
                self.ugc,
                self.handle,
                0,
                index,
                url.as_mut_ptr(),
                url.len() as u32,
                file_name.as_mut_ptr(),
                file_name.len() as u32,
                (&mut kind as *mut i32).cast::<sys::EItemPreviewType>(),
            )
        };
        if !ok {
            return Err(format!("Steam could not read additional preview {index}"));
        }
        Ok(AdditionalPreview {
            index,
            url: from_c(&url),
            is_image: kind == sys::EItemPreviewType::k_EItemPreviewType_Image as i32,
        })
    }
}

/// Reads a bindgen enum field as the integer Steam wrote: a newer Steam may
/// write a value the enum lacks.
unsafe fn read_enum<E>(field: *const E) -> i32 {
    const { assert!(mem::size_of::<E>() == mem::size_of::<i32>()) };
    unsafe { field.cast::<i32>().read_unaligned() }
}

fn check(setter: &str, ok: bool) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(format!("Steam refused {setter}"))
    }
}

fn from_c(buffer: &[c_char]) -> String {
    let bytes: Vec<u8> = buffer
        .iter()
        .take_while(|&&c| c != 0)
        .map(|&c| c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn c_string(text: &str) -> Result<CString, String> {
    CString::new(text).map_err(|_| "text for Steam contains a NUL byte".to_string())
}

fn c_path(path: &Path) -> Result<CString, String> {
    let absolute =
        std::path::absolute(path).map_err(|e| format!("cannot resolve {}: {e}", path.display()))?;
    let text = absolute
        .to_str()
        .ok_or_else(|| format!("{} is not a valid UTF-8 path", absolute.display()))?;
    c_string(text)
}
