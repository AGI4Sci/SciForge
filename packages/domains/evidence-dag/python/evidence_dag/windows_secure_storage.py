"""Win32 storage: pinned directories, no reparse points, private inherited ACLs.

Use handles for identity, ownership and permission checks. Directory handles deny
delete sharing while an operation runs, so an ancestor cannot be renamed away.
"""
from __future__ import annotations
import ctypes as c
from ctypes import wintypes as w
from contextlib import contextmanager
import msvcrt
import os
import uuid

kernel = c.WinDLL('kernel32', use_last_error=True)
security = c.WinDLL('advapi32', use_last_error=True)
kernel.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
kernel.CreateFileW.restype = w.HANDLE
kernel.CloseHandle.argtypes = [w.HANDLE]
kernel.LocalFree.argtypes = [c.c_void_p]
security.GetSecurityInfo.argtypes = [w.HANDLE, c.c_int, w.DWORD] + [c.POINTER(c.c_void_p)] * 5
security.GetSecurityInfo.restype = w.DWORD
security.SetSecurityInfo.argtypes = [w.HANDLE, c.c_int, w.DWORD] + [c.c_void_p] * 4
security.SetSecurityInfo.restype = w.DWORD
security.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
security.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
security.EqualSid.argtypes = [c.c_void_p, c.c_void_p]
security.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
security.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(c.c_void_p), c.c_void_p]
security.GetSecurityDescriptorDacl.argtypes = [c.c_void_p, c.POINTER(w.BOOL), c.POINTER(c.c_void_p), c.POINTER(w.BOOL)]
security.GetSecurityDescriptorControl.argtypes = [c.c_void_p, c.POINTER(w.WORD), c.POINTER(w.DWORD)]
kernel.GetCurrentProcess.restype = w.HANDLE


class FileInfo(c.Structure):
    _fields_ = [('attributes', w.DWORD), ('creation', w.FILETIME),
                ('access', w.FILETIME), ('write', w.FILETIME),
                ('volume', w.DWORD), ('size_high', w.DWORD), ('size_low', w.DWORD),
                ('links', w.DWORD), ('index_high', w.DWORD), ('index_low', w.DWORD)]


kernel.GetFileInformationByHandle.argtypes = [w.HANDLE, c.POINTER(FileInfo)]


def check(ok):
    if not ok:
        raise c.WinError(c.get_last_error())


def error(code):
    if code:
        raise c.WinError(code)


def private(handle, directory, *, verify_only=False):
    token = w.HANDLE()
    check(security.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)))
    try:
        size = w.DWORD()
        security.GetTokenInformation(token, 1, None, 0, c.byref(size))
        user = c.create_string_buffer(size.value)
        check(security.GetTokenInformation(token, 1, user, size, c.byref(size)))
        sid = c.cast(user, c.POINTER(c.c_void_p))[0]
        owner, group, dacl, sacl, descriptor = (c.c_void_p() for _ in range(5))
        error(security.GetSecurityInfo(handle, 1, 1, c.byref(owner), c.byref(group),
                                      c.byref(dacl), c.byref(sacl), c.byref(descriptor)))
        try:
            if not owner or not security.EqualSid(owner, sid):
                raise PermissionError('Evidence storage is not owned by the current user')
        finally:
            kernel.LocalFree(descriptor)
        if verify_only:
            return
        text = w.LPWSTR()
        check(security.ConvertSidToStringSidW(sid, c.byref(text)))
        try:
            inheritance = 'OICI' if directory else ''
            acl = ''.join('(A;' + inheritance + ';FA;;;' + account + ')'
                          for account in ('SY', 'BA', text.value))
        finally:
            kernel.LocalFree(c.cast(text, c.c_void_p))
        desired = c.c_void_p()
        check(security.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            'D:P' + acl, 1, c.byref(desired), None))
        try:
            present, defaulted, desired_acl = w.BOOL(), w.BOOL(), c.c_void_p()
            check(security.GetSecurityDescriptorDacl(desired, c.byref(present),
                                                     c.byref(desired_acl), c.byref(defaulted)))
            error(security.SetSecurityInfo(handle, 1, 0x80000004, None, None, desired_acl, None))
            verified = c.c_void_p()
            error(security.GetSecurityInfo(handle, 1, 4, c.byref(owner), c.byref(group),
                                          c.byref(dacl), c.byref(sacl), c.byref(verified)))
            try:
                control, revision = w.WORD(), w.DWORD()
                check(security.GetSecurityDescriptorControl(verified, c.byref(control), c.byref(revision)))
                check(security.GetSecurityDescriptorDacl(verified, c.byref(present), c.byref(dacl), c.byref(defaulted)))
                # ACL headers contain a 16-bit total size at offset two.
                expected_size = c.c_ushort.from_address(desired_acl.value + 2).value
                actual_size = c.c_ushort.from_address(dacl.value + 2).value if dacl else 0
                if (not present or defaulted or not control.value & 0x1000 or
                        actual_size != expected_size or
                        c.string_at(dacl, actual_size) != c.string_at(desired_acl, expected_size)):
                    raise PermissionError('Windows did not apply the private storage ACL')
            finally:
                kernel.LocalFree(verified)
        finally:
            kernel.LocalFree(desired)
    finally:
        kernel.CloseHandle(token)


def native(path):
    path = os.path.abspath(path)
    return path if path.startswith('\\\\?\\') else (
        '\\\\?\\UNC\\' + path[2:] if path.startswith('\\\\') else '\\\\?\\' + path)


def open_handle(path, *, directory=False, access=0x60080, creation=3, allow_hardlinks=False):
    handle = kernel.CreateFileW(native(path), access, 3, None, creation,
                                0x00200000 | (0x02000000 if directory else 0), None)
    if handle == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        info = FileInfo()
        check(kernel.GetFileInformationByHandle(handle, c.byref(info)))
        if info.attributes & 0x400 or bool(info.attributes & 0x10) != directory:
            raise PermissionError('Evidence storage rejects reparse points and nonregular files')
        if not directory and not allow_hardlinks and info.links != 1:
            raise PermissionError('Evidence storage rejects hardlinks')
        return handle, (info.volume, info.index_high, info.index_low)
    except BaseException:
        kernel.CloseHandle(handle)
        raise


class WindowsEvidenceStorage:
    def __init__(self, root, *, readonly=False):
        self.root = os.path.abspath(root)
        self.readonly = readonly
        if not os.path.splitdrive(self.root)[1].strip(os.sep):
            raise PermissionError('Evidence storage requires a dedicated root')
        self.identity = None
        with self.directory(self.root, create=not readonly):
            pass

    def _parts(self, path):
        path = os.path.abspath(path)
        if os.path.normcase(os.path.commonpath((self.root, path))) != os.path.normcase(self.root):
            raise PermissionError('Evidence storage path escapes the granted root')
        return path

    @contextmanager
    def directory(self, path, *, create=False):
        if create and self.readonly:
            raise PermissionError('Evidence committed storage is readonly')
        path = self._parts(path)
        drive, tail = os.path.splitdrive(path)
        cursor = drive + os.sep
        handles = []
        try:
            for part in tail.strip(os.sep).split(os.sep):
                cursor = os.path.join(cursor, part)
                owned = os.path.normcase(cursor) == os.path.normcase(self.root) or os.path.normcase(cursor).startswith(os.path.normcase(self.root + os.sep))
                # A cold writer may receive a nested dedicated root. Build the
                # missing path components before applying the private ACL at
                # the granted root and below; readonly readers never create.
                if create:
                    try:
                        os.mkdir(native(cursor))
                    except FileExistsError:
                        pass
                handle, identity = open_handle(cursor, directory=True, access=(0x20080 if self.readonly else 0x60080) if owned else 0x80)
                handles.append(handle)
                if os.path.normcase(cursor) == os.path.normcase(self.root):
                    if self.identity is not None and self.identity != identity:
                        raise PermissionError('Evidence storage root identity changed')
                    self.identity = identity
                if owned:
                    private(handle, True, verify_only=self.readonly)
            yield path
        finally:
            for handle in reversed(handles):
                kernel.CloseHandle(handle)

    def mkdir(self, path):
        with self.directory(path, create=True):
            pass

    def _check_target(self, path):
        if self.readonly:
            raise PermissionError('Evidence committed storage is readonly')
        try:
            handle, _ = open_handle(path)
        except FileNotFoundError:
            return
        try:
            private(handle, False)
        finally:
            kernel.CloseHandle(handle)

    def open(self, path, mode='r', *, encoding=None):
        if self.readonly and mode not in ('r', 'rb'):
            raise PermissionError('Evidence committed storage is readonly')
        modes = {'r': (0x80060080, 3, os.O_RDONLY), 'rb': (0x80060080, 3, os.O_RDONLY | os.O_BINARY),
                 'a': (0x40060080, 4, os.O_WRONLY | os.O_APPEND),
                 'x': (0x40060080, 1, os.O_WRONLY), 'xb': (0x40060080, 1, os.O_WRONLY | os.O_BINARY)}
        access, creation, flags = modes[mode]
        if self.readonly:
            access &= ~0x40000
        with self.directory(os.path.dirname(path), create=mode in ('a', 'x', 'xb')):
            handle, _ = open_handle(path, access=access, creation=creation)
            try:
                private(handle, False, verify_only=self.readonly)
                fd = msvcrt.open_osfhandle(handle, flags)
            except BaseException:
                kernel.CloseHandle(handle)
                raise
            try:
                if mode == 'a':
                    os.lseek(fd, 0, os.SEEK_END)
                return os.fdopen(fd, mode, encoding=encoding)
            except BaseException:
                os.close(fd)
                raise

    def atomic_write(self, path, content):
        with self.directory(os.path.dirname(path), create=True):
            self._check_target(path)
            temporary = path + '.' + uuid.uuid4().hex + '.tmp'
            try:
                with self.open(temporary, 'xb') as handle:
                    handle.write(content.encode('utf-8') if isinstance(content, str) else content)
                    handle.flush()
                    os.fsync(handle.fileno())
                self._check_target(path)
                os.replace(native(temporary), native(path))
            finally:
                try:
                    os.unlink(native(temporary))
                except FileNotFoundError:
                    pass

    def unlink(self, path):
        with self.directory(os.path.dirname(path)):
            self._check_target(path)
            os.unlink(native(path))

    def listdir(self, path):
        with self.directory(path):
            return os.listdir(native(path))

    def sync_directory(self, path):
        # Windows does not support POSIX directory fsync. File data is flushed
        # before publication; still validate and pin the containing directory.
        with self.directory(path):
            pass

    def stat(self, path):
        with self.directory(os.path.dirname(path)):
            return os.stat(native(path), follow_symlinks=False)

    @staticmethod
    def stat_at(parent, name):
        path = os.path.join(parent, name)
        handle, identity = open_handle(path, access=0x20080, allow_hardlinks=True)
        try:
            private(handle, False, verify_only=True)
            info = os.stat(native(path), follow_symlinks=False)
            if (info.st_dev, info.st_ino >> 32, info.st_ino & 0xffffffff) != identity:
                raise PermissionError('Evidence storage file identity changed')
            return info
        finally:
            kernel.CloseHandle(handle)

    @staticmethod
    def open_alias_at(parent, name):
        handle, _ = open_handle(os.path.join(parent, name), access=0x80020080, allow_hardlinks=True)
        try:
            private(handle, False, verify_only=True)
            return msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            kernel.CloseHandle(handle)
            raise

    @staticmethod
    def create_at(parent, name):
        handle, _ = open_handle(os.path.join(parent, name), access=0x40060080, creation=1)
        try:
            private(handle, False)
            return msvcrt.open_osfhandle(handle, os.O_WRONLY | os.O_BINARY)
        except BaseException:
            kernel.CloseHandle(handle)
            raise

    @staticmethod
    def replace_at(source, name, target, destination):
        os.replace(native(os.path.join(source, name)), native(os.path.join(target, destination)))

    @staticmethod
    def unlink_at(parent, name):
        os.unlink(native(os.path.join(parent, name)))

    @staticmethod
    def list_at(parent):
        return os.listdir(native(parent))

    @staticmethod
    def sync_at(parent):
        pass  # Windows has no directory fsync; staged file data is fsynced.
