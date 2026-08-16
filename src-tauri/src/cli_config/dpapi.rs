use super::{
    engine::BackupProtector,
    error::{ConfigError, ConfigErrorCode, ConfigResult},
};

#[derive(Debug, Default)]
pub struct DpapiBackupProtector;

#[cfg(windows)]
impl BackupProtector for DpapiBackupProtector {
    fn protect(&self, plaintext: &[u8]) -> ConfigResult<Vec<u8>> {
        crypt(plaintext, true)
    }

    fn unprotect(&self, ciphertext: &[u8]) -> ConfigResult<Vec<u8>> {
        crypt(ciphertext, false)
    }
}

#[cfg(not(windows))]
impl BackupProtector for DpapiBackupProtector {
    fn protect(&self, _plaintext: &[u8]) -> ConfigResult<Vec<u8>> {
        Err(unavailable())
    }

    fn unprotect(&self, _ciphertext: &[u8]) -> ConfigResult<Vec<u8>> {
        Err(unavailable())
    }
}

#[cfg(not(windows))]
fn unavailable() -> ConfigError {
    ConfigError::new(
        ConfigErrorCode::ProtectionFailed,
        "Windows DPAPI is unavailable on this platform",
    )
}

#[cfg(windows)]
fn crypt(input: &[u8], protect: bool) -> ConfigResult<Vec<u8>> {
    use std::{ptr, slice};

    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input_len = u32::try_from(input.len()).map_err(|_| {
        ConfigError::new(
            ConfigErrorCode::ProtectionFailed,
            "configuration backup is too large for DPAPI",
        )
    })?;
    let input_blob = CRYPT_INTEGER_BLOB {
        cbData: input_len,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        if protect {
            CryptProtectData(
                &input_blob,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        } else {
            CryptUnprotectData(
                &input_blob,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        }
    };
    if result == 0 {
        return Err(ConfigError::new(
            ConfigErrorCode::ProtectionFailed,
            format!(
                "Windows DPAPI operation failed: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    let output = unsafe {
        let bytes = slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec();
        ptr::write_bytes(output_blob.pbData, 0, output_blob.cbData as usize);
        let _ = LocalFree(output_blob.pbData.cast());
        bytes
    };
    Ok(output)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn dpapi_round_trip_does_not_return_plaintext_ciphertext() {
        let protector = DpapiBackupProtector;
        let plaintext = b"canary-cli-config-secret";
        let ciphertext = protector.protect(plaintext).unwrap();
        assert_ne!(ciphertext, plaintext);
        assert_eq!(protector.unprotect(&ciphertext).unwrap(), plaintext);
    }
}
