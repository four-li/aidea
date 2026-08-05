use crate::error::{AppError, AppResult};
use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::NSString;
use objc2_local_authentication::{LAContext, LAPolicy};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const CACHE_DURATION: Duration = Duration::from_secs(5 * 60);

struct CachedContext(objc2::rc::Retained<LAContext>);

// LAContext 由互斥锁串行访问，避免跨线程并发调用其 Objective-C 方法。
unsafe impl Send for CachedContext {}
unsafe impl Sync for CachedContext {}

static AUTHENTICATION: OnceLock<Mutex<Option<(Instant, CachedContext)>>> = OnceLock::new();

pub fn authenticate_local_user(reason: &str) -> AppResult<objc2::rc::Retained<LAContext>> {
    let cache = AUTHENTICATION.get_or_init(|| Mutex::new(None));
    let mut cached = cache
        .lock()
        .map_err(|_| AppError::Config("身份验证状态异常".to_string()))?;
    if let Some((authenticated_at, context)) = cached.as_ref() {
        if authenticated_at.elapsed() < CACHE_DURATION {
            return Ok(context.0.clone());
        }
    }

    let context = unsafe { LAContext::new() };
    let reason = NSString::from_str(reason);
    let (sender, receiver) = std::sync::mpsc::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let context_for_reply = context.clone();
    let sender_for_reply = Arc::clone(&sender);
    let reply = RcBlock::new(move |success: Bool, _error| {
        let _context = &context_for_reply;
        if let Some(sender) = sender_for_reply
            .lock()
            .ok()
            .and_then(|mut value| value.take())
        {
            let _ = sender.send(success.as_bool());
        }
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &reason,
            &reply,
        );
    }
    match receiver.recv() {
        Ok(true) => {
            *cached = Some((Instant::now(), CachedContext(context.clone())));
            Ok(context)
        }
        Ok(false) => Err(AppError::Config("macOS 身份验证未通过".to_string())),
        Err(_) => Err(AppError::Config("macOS 身份验证被中断".to_string())),
    }
}
