import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'

// Use the inbox Win32 bridge to lock and validate the full tree before changing any DACL.
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Security.Principal;

public static class PrivateStorageAcl {
    const uint ReadControl = 0x00020000;
    const uint WriteDac = 0x00040000;
    const uint FileReadAttributes = 0x00000080;
    const uint FileShareRead = 0x00000001;
    const uint OpenExisting = 3;
    const uint OpenReparsePoint = 0x00200000;
    const uint BackupSemantics = 0x02000000;
    const uint DirectoryAttribute = 0x00000010;
    const uint ReparsePointAttribute = 0x00000400;
    const uint DaclSecurityInformation = 0x00000004;
    const uint OwnerSecurityInformation = 0x00000001;
    const uint ProtectedDaclSecurityInformation = 0x80000000;
    const int SeFileObject = 1;
    const int AclSizeInfoClass = 2;
    const ushort DaclProtected = 0x1000;

    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] struct ByHandleFileInformation {
        public uint Attributes;
        public FileTime CreationTime;
        public FileTime LastAccessTime;
        public FileTime LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }
    [StructLayout(LayoutKind.Sequential)] struct AclSizeInformation { public uint AceCount; public uint AclBytesInUse; public uint AclBytesFree; }
    sealed class PendingEntry { public SafeFileHandle Handle; public bool Directory; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out ByHandleFileInformation info);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, IntPtr size);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint GetSecurityInfo(SafeFileHandle handle, int type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern uint SetSecurityInfo(SafeFileHandle handle, int type, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorControl(IntPtr descriptor, out ushort control, out uint revision);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetAclInformation(IntPtr acl, out AclSizeInformation info, uint length, int informationClass);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr LocalFree(IntPtr memory);

    static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Check(uint error) { if (error != 0) throw new Win32Exception((int)error); }
    static byte[] AclBytes(IntPtr descriptor, out bool present, out bool defaulted) {
        IntPtr acl;
        Check(GetSecurityDescriptorDacl(descriptor, out present, out acl, out defaulted));
        if (!present || acl == IntPtr.Zero) return new byte[0];
        AclSizeInformation size;
        Check(GetAclInformation(acl, out size, (uint)Marshal.SizeOf(typeof(AclSizeInformation)), AclSizeInfoClass));
        byte[] bytes = new byte[size.AclBytesInUse];
        Marshal.Copy(acl, bytes, 0, bytes.Length);
        return bytes;
    }

    static string NativePath(string path) {
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) return path;
        if (path.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + path.Substring(2);
        return @"\\?\" + path;
    }

    static SafeFileHandle OpenValidated(string path, string expectedVolume, string expectedFileIndex, bool directory) {
        uint flags = OpenReparsePoint | (directory ? BackupSemantics : 0);
        SafeFileHandle handle = CreateFileW(NativePath(path), ReadControl | WriteDac | FileReadAttributes, FileShareRead, IntPtr.Zero, OpenExisting, flags, IntPtr.Zero);
        if (handle.IsInvalid) {
            handle.Dispose();
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open private storage entry by handle.");
        }
        try {
            ByHandleFileInformation info;
            Check(GetFileInformationByHandle(handle, out info));
            bool isDirectory = (info.Attributes & DirectoryAttribute) != 0;
            if ((info.Attributes & ReparsePointAttribute) != 0 || isDirectory != directory)
                throw new InvalidOperationException("private storage tree changed during preparation.");
            ulong fileIndex = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;
            if (info.VolumeSerialNumber != UInt32.Parse(expectedVolume, System.Globalization.CultureInfo.InvariantCulture) || fileIndex != UInt64.Parse(expectedFileIndex, System.Globalization.CultureInfo.InvariantCulture))
                throw new InvalidOperationException("private storage tree changed during preparation.");
            if (!directory && info.NumberOfLinks != 1)
                throw new InvalidOperationException("private storage tree contains a hardlink.");
            IntPtr owner, group, dacl, sacl, descriptor;
            Check(GetSecurityInfo(handle, SeFileObject, OwnerSecurityInformation, out owner, out group, out dacl, out sacl, out descriptor));
            try {
                if (owner == IntPtr.Zero || !new SecurityIdentifier(owner).Equals(WindowsIdentity.GetCurrent().User))
                    throw new InvalidOperationException("private storage is not owned by the current user.");
            } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
            return handle;
        } catch {
            handle.Dispose();
            throw;
        }
    }

    static void ApplyAcl(SafeFileHandle handle, bool directory) {
        string userSid = WindowsIdentity.GetCurrent().User.Value;
        string inheritance = directory ? "OICI" : "";
        string sddl = "D:P(A;" + inheritance + ";FA;;;SY)(A;" + inheritance + ";FA;;;BA)(A;" + inheritance + ";FA;;;" + userSid + ")";
        IntPtr desiredDescriptor = IntPtr.Zero;
        IntPtr currentDescriptor = IntPtr.Zero;
        try {
            Check(ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out desiredDescriptor, IntPtr.Zero));
            IntPtr owner, group, currentDacl, sacl;
            Check(GetSecurityInfo(handle, SeFileObject, DaclSecurityInformation, out owner, out group, out currentDacl, out sacl, out currentDescriptor));
            bool desiredPresent, desiredDefaulted, currentPresent, currentDefaulted;
            byte[] desiredBytes = AclBytes(desiredDescriptor, out desiredPresent, out desiredDefaulted);
            byte[] currentBytes = AclBytes(currentDescriptor, out currentPresent, out currentDefaulted);
            ushort control;
            uint revision;
            Check(GetSecurityDescriptorControl(currentDescriptor, out control, out revision));
            bool isAlreadyPrivate = currentPresent && !currentDefaulted && (control & DaclProtected) != 0 && currentBytes.SequenceEqual(desiredBytes);
            if (!isAlreadyPrivate) {
                IntPtr desiredDacl;
                bool ignoredPresent, ignoredDefaulted;
                AclBytes(desiredDescriptor, out ignoredPresent, out desiredDacl, out ignoredDefaulted);
                Check(SetSecurityInfo(handle, SeFileObject, DaclSecurityInformation | ProtectedDaclSecurityInformation, IntPtr.Zero, IntPtr.Zero, desiredDacl, IntPtr.Zero));
                IntPtr verifyDescriptor;
                Check(GetSecurityInfo(handle, SeFileObject, DaclSecurityInformation, out owner, out group, out currentDacl, out sacl, out verifyDescriptor));
                try {
                    byte[] verifiedBytes = AclBytes(verifyDescriptor, out currentPresent, out currentDefaulted);
                    Check(GetSecurityDescriptorControl(verifyDescriptor, out control, out revision));
                    if (!currentPresent || currentDefaulted || (control & DaclProtected) == 0 || !verifiedBytes.SequenceEqual(desiredBytes))
                        throw new InvalidOperationException("Windows did not apply the private storage ACL.");
                } finally { LocalFree(verifyDescriptor); }
            }
        } finally {
            if (currentDescriptor != IntPtr.Zero) LocalFree(currentDescriptor);
            if (desiredDescriptor != IntPtr.Zero) LocalFree(desiredDescriptor);
        }
    }

    public static void RestrictAll(string[] paths, string[] volumes, string[] indexes, bool[] directories) {
        List<PendingEntry> pending = new List<PendingEntry>();
        try {
            for (int i = 0; i < paths.Length; i++) {
                pending.Add(new PendingEntry { Handle = OpenValidated(paths[i], volumes[i], indexes[i], directories[i]), Directory = directories[i] });
            }
            foreach (PendingEntry entry in pending) ApplyAcl(entry.Handle, entry.Directory);
        } finally {
            foreach (PendingEntry entry in pending) entry.Handle.Dispose();
        }
    }

    static byte[] AclBytes(IntPtr descriptor, out bool present, out IntPtr acl, out bool defaulted) {
        Check(GetSecurityDescriptorDacl(descriptor, out present, out acl, out defaulted));
        return AclBytes(descriptor, out present, out defaulted);
    }
}
'@
try {
  Add-Type -TypeDefinition $source -Language CSharp
  $entries = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $paths = [string[]]@($entries | ForEach-Object { [string]$_.path })
  $volumes = [string[]]@($entries | ForEach-Object { [string]$_.dev })
  $indexes = [string[]]@($entries | ForEach-Object { [string]$_.ino })
  $directories = [bool[]]@($entries | ForEach-Object { [bool]$_.directory })
  [PrivateStorageAcl]::RestrictAll($paths, $volumes, $indexes, $directories)
} catch {
  [Console]::Out.WriteLine('STORAGE_ACL_ERROR:' + $_.Exception.GetBaseException().Message)
  exit 1
}
`

function invocation(entries) {
  return {
    executable: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WINDOWS_ACL_SCRIPT, 'utf16le').toString('base64')],
    input: JSON.stringify(entries.map(entry => ({ ...entry, dev: String(entry.dev), ino: String(entry.ino) })))
  }
}

/** Lock all inspected entries, reject reparse points/hardlinks/foreign owners,
 * then apply and verify a protected current-user/SYSTEM/Administrators DACL. */
export function restrictWindowsStorageSync(entries) {
  const { executable, args, input } = invocation(entries)
  const result = spawnSync(executable, args, { input, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Windows private storage ACL enforcement failed: ${(result.stdout || result.stderr).trim() || `exit ${result.status}`}`)
}

export async function restrictWindowsStorage(entries) {
  const { executable, args, input } = invocation(entries)
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.stdin.on('error', reject)
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Windows private storage ACL enforcement failed: ${(stdout || stderr).trim() || `exit ${code}`}`))
    })
    child.stdin.end(input)
  })
}
