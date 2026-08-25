#define __STDC_WANT_LIB_EXT1__ 1

#include <node_api.h>

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include <cstring>
#include <string.h>
#include <string>
#include <vector>

namespace {

constexpr size_t kVaultKeyLength = 64;
constexpr size_t kMaximumSecretBytes = 4096;
constexpr size_t kMinimumSecretBytes = 16;
constexpr NSTimeInterval kPromptTimeoutSeconds = 120.0;

NSString* const kKeychainService = @"cn.sciforge.opencontent-connector.session.v1";
NSString* const kKeychainLabel = @"SciForge OpenContent session";

void ClearBytes(void* bytes, size_t length) {
  if (bytes != nullptr && length > 0) (void)memset_s(bytes, length, 0, length);
}

class ScopedBytes final {
 public:
  explicit ScopedBytes(size_t size) : bytes_(size) {}
  ~ScopedBytes() { ClearBytes(bytes_.data(), bytes_.size()); }

  ScopedBytes(const ScopedBytes&) = delete;
  ScopedBytes& operator=(const ScopedBytes&) = delete;

  char* data() { return bytes_.data(); }
  const char* data() const { return bytes_.data(); }
  size_t size() const { return bytes_.size(); }

 private:
  std::vector<char> bytes_;
};

napi_value ThrowBoundedError(
    napi_env env,
    const char* code,
    const char* message) {
  napi_value message_value;
  napi_value error;
  napi_value code_value;
  napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &message_value);
  napi_create_error(env, nullptr, message_value, &error);
  napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value);
  napi_set_named_property(env, error, "code", code_value);
  napi_throw(env, error);
  return nullptr;
}

napi_value ThrowNativeUnavailable(napi_env env) {
  return ThrowBoundedError(
      env,
      "native_enrollment_unavailable",
      "Native OpenContent account enrollment is unavailable.");
}

napi_value ThrowSecureStorageUnavailable(napi_env env) {
  return ThrowBoundedError(
      env,
      "secure_storage_unavailable",
      "The native OpenContent session vault is unavailable.");
}

bool IsLowerHex(const char* value, size_t length) {
  if (length != kVaultKeyLength) return false;
  for (size_t index = 0; index < length; ++index) {
    const char character = value[index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) {
      return false;
    }
  }
  return true;
}

bool ReadUtf8Argument(
    napi_env env,
    napi_value value,
    size_t minimum_length,
    size_t maximum_length,
    ScopedBytes* output,
    size_t* output_length) {
  napi_valuetype value_type;
  if (napi_typeof(env, value, &value_type) != napi_ok ||
      value_type != napi_string) {
    return false;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length < minimum_length || length > maximum_length ||
      output->size() < length + 1) {
    return false;
  }
  size_t copied = 0;
  if (napi_get_value_string_utf8(
          env, value, output->data(), output->size(), &copied) != napi_ok ||
      copied != length) {
    return false;
  }
  *output_length = copied;
  return true;
}

NSMutableDictionary* BaseKeychainQuery(NSString* account) {
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecAttrSynchronizable: @NO
  } mutableCopy];
}

NSString* VaultAccount(const char* bytes, size_t length) {
  return [[NSString alloc] initWithBytes:bytes
                                  length:length
                                encoding:NSUTF8StringEncoding];
}

napi_value IsAvailable(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, [NSThread isMainThread], &result);
  return result;
}

napi_value PromptCredentials(napi_env env, napi_callback_info info) {
  if (![NSThread isMainThread]) return ThrowNativeUnavailable(env);

  @autoreleasepool {
    [NSApplication sharedApplication];

    NSAlert* alert = [[NSAlert alloc] init];
    alert.alertStyle = NSAlertStyleInformational;
    alert.messageText = @"Connect OpenContent";
    alert.informativeText =
        @"Enter the OpenContent account credentials to store securely on this Mac.";
    [alert addButtonWithTitle:@"Connect"];
    [alert addButtonWithTitle:@"Cancel"];

    NSView* accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 360, 82)];
    NSTextField* username_label =
        [[NSTextField alloc] initWithFrame:NSMakeRect(0, 60, 360, 18)];
    username_label.stringValue = @"Account";
    username_label.editable = NO;
    username_label.bordered = NO;
    username_label.drawsBackground = NO;
    username_label.selectable = NO;
    NSTextField* username_field =
        [[NSTextField alloc] initWithFrame:NSMakeRect(0, 36, 360, 24)];
    username_field.placeholderString = @"OpenContent account";

    NSTextField* password_label =
        [[NSTextField alloc] initWithFrame:NSMakeRect(0, 18, 360, 18)];
    password_label.stringValue = @"Password";
    password_label.editable = NO;
    password_label.bordered = NO;
    password_label.drawsBackground = NO;
    password_label.selectable = NO;
    NSSecureTextField* password_field =
        [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 360, 24)];

    [accessory addSubview:username_label];
    [accessory addSubview:username_field];
    [accessory addSubview:password_label];
    [accessory addSubview:password_field];
    alert.accessoryView = accessory;
    alert.window.initialFirstResponder = username_field;
    [NSApp activateIgnoringOtherApps:YES];

    __block bool prompt_expired = false;
    NSTimer* prompt_timer = [NSTimer
        timerWithTimeInterval:kPromptTimeoutSeconds
        repeats:NO
        block:^(NSTimer*) {
          prompt_expired = true;
          [NSApp abortModal];
          [alert.window orderOut:nil];
        }];
    [[NSRunLoop mainRunLoop] addTimer:prompt_timer forMode:NSModalPanelRunLoopMode];

    while (true) {
      const NSModalResponse response = [alert runModal];
      if (response != NSAlertFirstButtonReturn) {
        [prompt_timer invalidate];
        username_field.stringValue = @"";
        password_field.stringValue = @"";
        napi_value result;
        napi_get_null(env, &result);
        return result;
      }

      NSString* username = [username_field.stringValue
          stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      NSString* password = password_field.stringValue;
      if (username.length < 1 || username.length > 256 ||
          password.length < 1 || password.length > 4096) {
        if (prompt_expired) {
          [prompt_timer invalidate];
          username_field.stringValue = @"";
          password_field.stringValue = @"";
          napi_value result;
          napi_get_null(env, &result);
          return result;
        }
        alert.informativeText =
            @"Enter a non-empty account and password within the supported size limits.";
        continue;
      }

      [prompt_timer invalidate];

      NSMutableData* username_bytes =
          [[username dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
      NSMutableData* password_bytes =
          [[password dataUsingEncoding:NSUTF8StringEncoding] mutableCopy];
      username_field.stringValue = @"";
      password_field.stringValue = @"";
      if (username_bytes == nil || password_bytes == nil ||
          username_bytes.length < 1 || password_bytes.length < 1) {
        if (username_bytes != nil) ClearBytes(username_bytes.mutableBytes, username_bytes.length);
        if (password_bytes != nil) ClearBytes(password_bytes.mutableBytes, password_bytes.length);
        return ThrowNativeUnavailable(env);
      }

      napi_value result;
      napi_value username_value;
      napi_value password_value;
      napi_create_object(env, &result);
      const napi_status username_status = napi_create_string_utf8(
          env,
          static_cast<const char*>(username_bytes.bytes),
          username_bytes.length,
          &username_value);
      const napi_status password_status = napi_create_string_utf8(
          env,
          static_cast<const char*>(password_bytes.bytes),
          password_bytes.length,
          &password_value);
      ClearBytes(username_bytes.mutableBytes, username_bytes.length);
      ClearBytes(password_bytes.mutableBytes, password_bytes.length);
      [username_bytes setLength:0];
      [password_bytes setLength:0];
      if (username_status != napi_ok || password_status != napi_ok) {
        return ThrowNativeUnavailable(env);
      }
      napi_set_named_property(env, result, "username", username_value);
      napi_set_named_property(env, result, "password", password_value);
      return result;
    }
  }
}

napi_value StoreSecret(napi_env env, napi_callback_info info) {
  size_t argument_count = 2;
  napi_value arguments[2];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) !=
          napi_ok ||
      argument_count != 2) {
    return ThrowSecureStorageUnavailable(env);
  }

  ScopedBytes vault_key(kVaultKeyLength + 1);
  ScopedBytes secret(kMaximumSecretBytes + 1);
  size_t vault_key_length = 0;
  size_t secret_length = 0;
  if (!ReadUtf8Argument(
          env, arguments[0], kVaultKeyLength, kVaultKeyLength,
          &vault_key, &vault_key_length) ||
      !IsLowerHex(vault_key.data(), vault_key_length) ||
      !ReadUtf8Argument(
          env, arguments[1], kMinimumSecretBytes, kMaximumSecretBytes,
          &secret, &secret_length)) {
    return ThrowSecureStorageUnavailable(env);
  }

  @autoreleasepool {
    NSString* account = VaultAccount(vault_key.data(), vault_key_length);
    if (account == nil) return ThrowSecureStorageUnavailable(env);
    NSMutableData* secret_data =
        [NSMutableData dataWithBytes:secret.data() length:secret_length];
    NSMutableDictionary* query = BaseKeychainQuery(account);
    NSDictionary* update = @{
      (__bridge id)kSecValueData: secret_data,
      (__bridge id)kSecAttrAccessible:
          (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    };
    OSStatus status = SecItemUpdate(
        (__bridge CFDictionaryRef)query,
        (__bridge CFDictionaryRef)update);
    if (status == errSecItemNotFound) {
      [query addEntriesFromDictionary:update];
      query[(__bridge id)kSecAttrLabel] = kKeychainLabel;
      status = SecItemAdd((__bridge CFDictionaryRef)query, nullptr);
    }
    ClearBytes(secret_data.mutableBytes, secret_data.length);
    [secret_data setLength:0];
    if (status != errSecSuccess) return ThrowSecureStorageUnavailable(env);
  }

  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value HasSecret(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) !=
          napi_ok ||
      argument_count != 1) {
    return ThrowSecureStorageUnavailable(env);
  }

  ScopedBytes vault_key(kVaultKeyLength + 1);
  size_t vault_key_length = 0;
  if (!ReadUtf8Argument(
          env, arguments[0], kVaultKeyLength, kVaultKeyLength,
          &vault_key, &vault_key_length) ||
      !IsLowerHex(vault_key.data(), vault_key_length)) {
    return ThrowSecureStorageUnavailable(env);
  }

  @autoreleasepool {
    NSString* account = VaultAccount(vault_key.data(), vault_key_length);
    if (account == nil) return ThrowSecureStorageUnavailable(env);
    NSMutableDictionary* query = BaseKeychainQuery(account);
    const OSStatus status = SecItemCopyMatching(
        (__bridge CFDictionaryRef)query,
        nullptr);
    napi_value result;
    if (status == errSecSuccess) {
      napi_get_boolean(env, true, &result);
      return result;
    }
    if (status == errSecItemNotFound) {
      napi_get_boolean(env, false, &result);
      return result;
    }
    return ThrowSecureStorageUnavailable(env);
  }
}

napi_value ReadSecret(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) !=
          napi_ok ||
      argument_count != 1) {
    return ThrowSecureStorageUnavailable(env);
  }

  ScopedBytes vault_key(kVaultKeyLength + 1);
  size_t vault_key_length = 0;
  if (!ReadUtf8Argument(
          env, arguments[0], kVaultKeyLength, kVaultKeyLength,
          &vault_key, &vault_key_length) ||
      !IsLowerHex(vault_key.data(), vault_key_length)) {
    return ThrowSecureStorageUnavailable(env);
  }

  @autoreleasepool {
    NSString* account = VaultAccount(vault_key.data(), vault_key_length);
    if (account == nil) return ThrowSecureStorageUnavailable(env);
    NSMutableDictionary* query = BaseKeychainQuery(account);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef raw_result = nullptr;
    const OSStatus status = SecItemCopyMatching(
        (__bridge CFDictionaryRef)query,
        &raw_result);
    if (status == errSecItemNotFound) {
      napi_value result;
      napi_get_null(env, &result);
      return result;
    }
    if (status != errSecSuccess || raw_result == nullptr ||
        CFGetTypeID(raw_result) != CFDataGetTypeID()) {
      if (raw_result != nullptr) CFRelease(raw_result);
      return ThrowSecureStorageUnavailable(env);
    }
    CFDataRef secret_data = static_cast<CFDataRef>(raw_result);
    const CFIndex secret_length = CFDataGetLength(secret_data);
    if (secret_length < static_cast<CFIndex>(kMinimumSecretBytes) ||
        secret_length > static_cast<CFIndex>(kMaximumSecretBytes)) {
      CFRelease(raw_result);
      return ThrowSecureStorageUnavailable(env);
    }
    const UInt8* secret_bytes = CFDataGetBytePtr(secret_data);
    napi_value result;
    const napi_status napi_result = napi_create_string_utf8(
        env,
        reinterpret_cast<const char*>(secret_bytes),
        static_cast<size_t>(secret_length),
        &result);
    CFRelease(raw_result);
    if (napi_result != napi_ok) return ThrowSecureStorageUnavailable(env);
    return result;
  }
}

napi_value DeleteSecret(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &argument_count, arguments, nullptr, nullptr) !=
          napi_ok ||
      argument_count != 1) {
    return ThrowSecureStorageUnavailable(env);
  }

  ScopedBytes vault_key(kVaultKeyLength + 1);
  size_t vault_key_length = 0;
  if (!ReadUtf8Argument(
          env, arguments[0], kVaultKeyLength, kVaultKeyLength,
          &vault_key, &vault_key_length) ||
      !IsLowerHex(vault_key.data(), vault_key_length)) {
    return ThrowSecureStorageUnavailable(env);
  }

  @autoreleasepool {
    NSString* account = VaultAccount(vault_key.data(), vault_key_length);
    if (account == nil) return ThrowSecureStorageUnavailable(env);
    NSMutableDictionary* query = BaseKeychainQuery(account);
    const OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
      return ThrowSecureStorageUnavailable(env);
    }
  }

  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {
    {"isAvailable", nullptr, IsAvailable, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"promptCredentials", nullptr, PromptCredentials, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"storeSecret", nullptr, StoreSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"hasSecret", nullptr, HasSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readSecret", nullptr, ReadSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"deleteSecret", nullptr, DeleteSecret, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(
      env,
      exports,
      sizeof(properties) / sizeof(properties[0]),
      properties);
  return exports;
}
