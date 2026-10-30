"""Evidence-owned storage. POSIX I/O walks no-follow directory FDs.

Only the granted root and descendants are chmodded. No global monkey-patches,
process cwd changes, or trust in an earlier startup scan.
"""
from __future__ import annotations
import os
import stat
import uuid
from contextlib import contextmanager


class EvidenceStorage:
    def __init__(self, root: str):
        self.root = os.path.abspath(root)
        # Walk from / using directory-relative no-follow opens; ancestors are
        # never chmodded, and an arbitrary symlink is not a canonical grant.
        fd = os.open(os.sep, os.O_RDONLY | os.O_DIRECTORY)
        try:
            parts = self.root.split(os.sep)[1:]
            if not parts or not all(parts):
                raise PermissionError('Evidence storage requires a dedicated root')
            for index, part in enumerate(parts):
                if index == len(parts) - 1:
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            info = os.fstat(fd)
            self._owned(info, directory=True)
            self.identity = (info.st_dev, info.st_ino)
            os.fchmod(fd, 0o700)
        finally:
            os.close(fd)

    @staticmethod
    def _owned(info, *, directory=False):
        if info.st_uid != os.getuid():
            raise PermissionError('Evidence storage is not owned by the current user')
        if directory:
            if not stat.S_ISDIR(info.st_mode):
                raise PermissionError('Evidence storage directory is invalid')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise PermissionError('Evidence storage rejects nonregular files and hardlinks')

    def _parts(self, path):
        path = os.path.abspath(path)
        if os.path.commonpath((self.root, path)) != self.root:
            raise PermissionError('Evidence storage path escapes the granted root')
        relative = os.path.relpath(path, self.root)
        return [] if relative == '.' else relative.split(os.sep)

    @contextmanager
    def directory(self, path, *, create=False):
        parts = self._parts(path)
        fd = os.open(os.sep, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in self.root.split(os.sep)[1:]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            info = os.fstat(fd)
            self._owned(info, directory=True)
            if (info.st_dev, info.st_ino) != self.identity:
                raise PermissionError('Evidence storage root identity changed')
            os.fchmod(fd, 0o700)
            for part in parts:
                if create:
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    self._owned(os.fstat(child), directory=True)
                    os.fchmod(child, 0o700)
                except BaseException:
                    os.close(child)
                    raise
                os.close(fd)
                fd = child
            yield fd
        finally:
            os.close(fd)

    def mkdir(self, path):
        with self.directory(path, create=True):
            pass

    def _check_target(self, fd, name):
        try:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return
        self._owned(info)

    def open(self, path, mode='r', *, encoding=None):
        flags = {'r': os.O_RDONLY, 'rb': os.O_RDONLY,
                 'a': os.O_WRONLY | os.O_CREAT | os.O_APPEND,
                 'x': os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                 'xb': os.O_WRONLY | os.O_CREAT | os.O_EXCL}[mode]
        with self.directory(os.path.dirname(path), create=mode in ('a', 'x', 'xb')) as parent:
            fd = os.open(os.path.basename(path), flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
            try:
                self._owned(os.fstat(fd))
                os.fchmod(fd, 0o600)
                return os.fdopen(fd, mode, encoding=encoding)
            except BaseException:
                os.close(fd)
                raise

    def atomic_write(self, path, content):
        with self.directory(os.path.dirname(path), create=True) as parent:
            name = os.path.basename(path)
            self._check_target(parent, name)
            temporary = name + '.' + uuid.uuid4().hex + '.tmp'
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                with os.fdopen(fd, 'wb') as handle:
                    self._owned(os.fstat(handle.fileno()))
                    os.fchmod(handle.fileno(), 0o600)
                    handle.write(content.encode('utf-8') if isinstance(content, str) else content)
                    handle.flush()
                    os.fsync(handle.fileno())
                self._check_target(parent, name)
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
                os.fsync(parent)
            finally:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass

    def unlink(self, path):
        with self.directory(os.path.dirname(path)) as parent:
            self._check_target(parent, os.path.basename(path))
            os.unlink(os.path.basename(path), dir_fd=parent)

    def listdir(self, path):
        with self.directory(path) as fd:
            return os.listdir(fd)

    def sync_directory(self, path):
        with self.directory(path) as fd:
            os.fsync(fd)

    def stat(self, path):
        with self.directory(os.path.dirname(path)) as fd:
            return os.stat(os.path.basename(path), dir_fd=fd, follow_symlinks=False)

    @staticmethod
    def stat_at(parent, name):
        info = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if info.st_uid != os.getuid():
            raise PermissionError('Evidence storage is not owned by the current user')
        return info

    @staticmethod
    def open_alias_at(parent, name):
        return os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)

    @staticmethod
    def create_at(parent, name):
        return os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)

    @staticmethod
    def replace_at(source, name, target, destination):
        os.replace(name, destination, src_dir_fd=source, dst_dir_fd=target)

    @staticmethod
    def unlink_at(parent, name):
        os.unlink(name, dir_fd=parent)

    list_at = staticmethod(os.listdir)
    sync_at = staticmethod(os.fsync)


if os.name == 'nt':
    from .windows_secure_storage import WindowsEvidenceStorage as EvidenceStorage
