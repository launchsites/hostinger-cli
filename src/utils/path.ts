import path from "path";

export function normalizeRemotePath(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, "/");
  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }
  return normalized;
}

export function resolveRemotePath(remoteRoot: string, targetPath: string): string {
  const base = normalizeRemotePath(remoteRoot || "/public_html");
  const target = targetPath.replace(/\\/g, "/");

  if (target.startsWith("/")) {
    return target;
  }

  return path.posix.join(base, target);
}

export function resolveFromCwd(remoteRoot: string, remoteCwd: string, targetPath: string): string {
  const baseRoot = normalizeRemotePath(remoteRoot || "/public_html");
  const cwd = normalizeRemotePath(remoteCwd || baseRoot);
  const target = targetPath.replace(/\\/g, "/");

  if (target.startsWith("/")) {
    return normalizeRemotePath(target);
  }

  return path.posix.normalize(path.posix.join(cwd, target));
}

export function ensureWithinRoot(remoteRoot: string, targetPath: string): string {
  const baseRoot = normalizeRemotePath(remoteRoot || "/public_html");
  const normalized = normalizeRemotePath(targetPath);
  if (!normalized.startsWith(baseRoot)) {
    throw new Error(`Remote path must stay within ${baseRoot}.`);
  }
  return normalized;
}
