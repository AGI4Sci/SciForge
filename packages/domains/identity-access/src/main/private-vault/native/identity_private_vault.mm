#define __STDC_WANT_LIB_EXT1__ 1

#include <node_api.h>

#import <Foundation/Foundation.h>
#import <Security/Security.h>

#include <cstring>
#include <string.h>
#include <vector>

namespace {

constexpr size_t kVaultKeyLength = 64;
constexpr size_t kMaximumSecretBytes = 262144;
constexpr size_t kMinimumSecretBytes = 1;
NSString* const kKeychainService = @"cn.sciforge.identity-access.private-vault.v1";
NSString* const kKeychainLabel = @"SciForge Identity private material";

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
  size_t size() const { return bytes_.size(); }
 private:
  std::vector<char> bytes_;
};

napi_value ThrowBoundedError(napi_env env, const char* code, const char* message) {
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

napi_value ThrowUnavailable(napi_env env) {
  return ThrowBoundedError(
      env,
      "secure_storage_unavailable",
      "The native Identity private vault is unavailable.");
}

bool IsLowerHex(const char* value, size_t length) {
  if (length != kVaultKeyLength) return false;
  for (size_t index = 0; index < length; ++index) {
    const char character = value[index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) return false;
  }
  return true;
}

bool ReadUtf8(
    napi_env env,
    napi_value value,
    size_t minimum,
    size_t maximum,
    ScopedBytes* output,
    size_t* output_length) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) return false;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length < minimum || length > maximum || output->size() < length + 1) return false;
  size_t copied = 0;
  if (napi_get_value_string_utf8(
          env, value, output->data(), output->size(), &copied) != napi_ok ||
      copied != length) return false;
  *output_length = copied;
  return true;
}

NSMutableDictionary* BaseQuery(NSString* account) {
  return [@{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: kKeychainService,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecAttrSynchronizable: @NO
  } mutableCopy];
}

NSString* ReadAccount(napi_env env, napi_value value) {
  ScopedBytes key(kVaultKeyLength + 1);
  size_t length = 0;
  if (!ReadUtf8(env, value, kVaultKeyLength, kVaultKeyLength, &key, &length) ||
      !IsLowerHex(key.data(), length)) return nil;
  return [[NSString alloc] initWithBytes:key.data()
                                  length:length
                                encoding:NSUTF8StringEncoding];
}

napi_value IsAvailable(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, true, &result);
  return result;
}

napi_value StoreSecret(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value arguments[2];
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, nullptr) != napi_ok || count != 2) {
    return ThrowUnavailable(env);
  }
  NSString* account = ReadAccount(env, arguments[0]);
  ScopedBytes secret(kMaximumSecretBytes + 1);
  size_t secret_length = 0;
  if (account == nil || !ReadUtf8(
      env, arguments[1], kMinimumSecretBytes, kMaximumSecretBytes,
      &secret, &secret_length)) return ThrowUnavailable(env);
  @autoreleasepool {
    NSMutableData* data = [NSMutableData dataWithBytes:secret.data() length:secret_length];
    NSMutableDictionary* query = BaseQuery(account);
    NSDictionary* update = @{
      (__bridge id)kSecValueData: data,
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
    ClearBytes(data.mutableBytes, data.length);
    [data setLength:0];
    if (status != errSecSuccess) return ThrowUnavailable(env);
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value HasSecret(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, nullptr) != napi_ok || count != 1) {
    return ThrowUnavailable(env);
  }
  NSString* account = ReadAccount(env, arguments[0]);
  if (account == nil) return ThrowUnavailable(env);
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)BaseQuery(account), nullptr);
  napi_value result;
  if (status == errSecSuccess) napi_get_boolean(env, true, &result);
  else if (status == errSecItemNotFound) napi_get_boolean(env, false, &result);
  else return ThrowUnavailable(env);
  return result;
}

// Security.framework can wait for securityd/Keychain. Never run the read on
// Electron's main event loop; only create the JS value on completion.
struct SecretRead {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  __strong NSString* account;
  std::vector<char> bytes;
  bool missing = false;
  bool failed = false;
  ~SecretRead() { ClearBytes(bytes.data(), bytes.size()); }
};

void ExecuteSecretRead(napi_env env, void* raw_context) {
  SecretRead* context = static_cast<SecretRead*>(raw_context);
  @autoreleasepool {
    NSMutableDictionary* query = BaseQuery(context->account);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef raw = nullptr;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &raw);
    context->missing = status == errSecItemNotFound;
    if (!context->missing) {
      if (status != errSecSuccess || raw == nullptr || CFGetTypeID(raw) != CFDataGetTypeID()) {
        context->failed = true;
      } else {
        CFDataRef data = static_cast<CFDataRef>(raw);
        CFIndex length = CFDataGetLength(data);
        if (length < static_cast<CFIndex>(kMinimumSecretBytes) ||
            length > static_cast<CFIndex>(kMaximumSecretBytes)) {
          context->failed = true;
        } else {
          const char* bytes = reinterpret_cast<const char*>(CFDataGetBytePtr(data));
          context->bytes.assign(bytes, bytes + length);
        }
      }
    }
    if (raw != nullptr) CFRelease(raw);
  }
}

void CompleteSecretRead(napi_env env, napi_status status, void* raw_context) {
  SecretRead* context = static_cast<SecretRead*>(raw_context);
  napi_value result;
  napi_status converted = napi_ok;
  if (context->missing) converted = napi_get_null(env, &result);
  else if (!context->failed && status == napi_ok) converted = napi_create_string_utf8(
      env, context->bytes.data(), context->bytes.size(), &result);
  if (context->failed || status != napi_ok || converted != napi_ok) {
    napi_value message;
    napi_value code;
    napi_create_string_utf8(env, "The native Identity private vault is unavailable.", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &result);
    napi_create_string_utf8(env, "secure_storage_unavailable", NAPI_AUTO_LENGTH, &code);
    napi_set_named_property(env, result, "code", code);
    napi_reject_deferred(env, context->deferred, result);
  } else {
    napi_resolve_deferred(env, context->deferred, result);
  }
  napi_delete_async_work(env, context->work);
  delete context;
}

napi_value ReadSecret(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, nullptr) != napi_ok || count != 1) {
    return ThrowUnavailable(env);
  }
  NSString* account = ReadAccount(env, arguments[0]);
  if (account == nil) return ThrowUnavailable(env);
  auto* context = new SecretRead();
  context->account = account;
  napi_value promise;
  napi_value name;
  if (napi_create_promise(env, &context->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "IdentityPrivateVaultRead", NAPI_AUTO_LENGTH, &name) != napi_ok ||
      napi_create_async_work(env, nullptr, name, ExecuteSecretRead, CompleteSecretRead,
          context, &context->work) != napi_ok ||
      napi_queue_async_work(env, context->work) != napi_ok) {
    if (context->work != nullptr) napi_delete_async_work(env, context->work);
    delete context;
    return ThrowUnavailable(env);
  }
  return promise;
}

napi_value DeleteSecret(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value arguments[1];
  if (napi_get_cb_info(env, info, &count, arguments, nullptr, nullptr) != napi_ok || count != 1) {
    return ThrowUnavailable(env);
  }
  NSString* account = ReadAccount(env, arguments[0]);
  if (account == nil) return ThrowUnavailable(env);
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)BaseQuery(account));
  if (status != errSecSuccess && status != errSecItemNotFound) return ThrowUnavailable(env);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

}  // namespace

NAPI_MODULE_INIT() {
  const napi_property_descriptor properties[] = {
    {"isAvailable", nullptr, IsAvailable, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"storeSecret", nullptr, StoreSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"hasSecret", nullptr, HasSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readSecret", nullptr, ReadSecret, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"deleteSecret", nullptr, DeleteSecret, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

