/**
 * Prepare a host-owned tree, rejecting symlinks, linked regular files and
 * concurrent inode changes. Existing regular files requiring restriction are
 * atomically replaced with private copies (bytes retained, inode not retained).
 * Only the root-owned macOS /var -> /private/var alias is accepted.
 */
export function prepareDshStorageRoot(root: string): Promise<string>
export function resolveDshStorageRoot(grant: { profileRoot: string; packageName: string }, packageName: string): Promise<string>
