import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TraceRootGitContext = {
  gitRepo?: string;
  gitRef?: string;
};

const REPO_URL_RE = /(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[:/](.+?)(?:\.git)?$/;
const SHA_RE = /^[0-9a-f]{40}$/;

let warnedIncomplete = false;

export function resolveTraceRootGitContext(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): TraceRootGitContext {
  let gitRepo = env.TRACEROOT_GIT_REPO?.trim() || undefined;
  let gitRef = env.TRACEROOT_GIT_REF?.trim() || undefined;

  if (gitRepo === undefined || gitRef === undefined) {
    const ci = harvestCiGitContext(env);
    gitRepo ??= ci.gitRepo;
    gitRef ??= ci.gitRef;
  }

  if (gitRepo === undefined || gitRef === undefined) {
    const fromFiles = gitContextFromFiles(cwd);
    gitRepo ??= fromFiles.gitRepo;
    gitRef ??= fromFiles.gitRef;
  }

  if (gitRepo === undefined || gitRef === undefined) {
    const autoGit = autoDetectGitContext();
    gitRepo ??= autoGit.gitRepo;
    gitRef ??= autoGit.gitRef;
  }

  return { gitRepo, gitRef };
}

export function warnIfTraceRootGitContextIncomplete(context: TraceRootGitContext): void {
  if (warnedIncomplete) return;
  if (context.gitRepo && context.gitRef) return;

  warnedIncomplete = true;
  console.warn(
    `[TraceRoot] git context incomplete (repo=${context.gitRepo ?? "unset"}, ref=${context.gitRef ?? "unset"}). ` +
      "The AI agent needs both to correlate traces to source. " +
      "Set TRACEROOT_GIT_REPO / TRACEROOT_GIT_REF — see https://traceroot.ai/docs/tracing/git-context",
  );
}

/** @internal */
export function resetTraceRootGitContextWarningsForTests(): void {
  warnedIncomplete = false;
}

function harvestCiGitContext(env: NodeJS.ProcessEnv): TraceRootGitContext {
  return {
    gitRepo: env.GITHUB_REPOSITORY?.trim() || undefined,
    gitRef: env.GITHUB_SHA?.trim() || undefined,
  };
}

function gitContextFromFiles(cwd: string): TraceRootGitContext {
  const gitDir = join(cwd, ".git");
  let gitRepo: string | undefined;
  let gitRef: string | undefined;

  try {
    const config = readFileSync(join(gitDir, "config"), "utf8");
    let seenOrigin = false;
    for (const line of config.split(/\r?\n/)) {
      if (/^\[remote "origin"\]/.test(line)) {
        seenOrigin = true;
        continue;
      }
      if (seenOrigin && line.startsWith("[")) break;
      if (seenOrigin) {
        const match = line.match(/\burl\s*=\s*(.+)$/);
        if (match) {
          const repoMatch = match[1].trim().match(REPO_URL_RE);
          if (repoMatch) gitRepo = repoMatch[1].replace(/\/$/, "");
          break;
        }
      }
    }
  } catch {
    /* no .git/config */
  }

  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (SHA_RE.test(head)) {
      gitRef = head;
    } else {
      const refMatch = head.match(/ref:\s+(\S+)/);
      if (refMatch) {
        const refPath = refMatch[1];
        try {
          const loose = readFileSync(join(gitDir, refPath), "utf8").trim();
          if (SHA_RE.test(loose)) gitRef = loose;
        } catch {
          /* loose ref missing */
        }
        if (gitRef === undefined) {
          try {
            const packed = readFileSync(join(gitDir, "packed-refs"), "utf8");
            for (const line of packed.split(/\r?\n/)) {
              if (!line || line[0] === "#" || line[0] === "^") continue;
              const match = line.match(/^([0-9a-f]{40}|[0-9a-f]{64})\s+(.+)$/);
              if (match && match[2] === refPath) {
                gitRef = match[1];
                break;
              }
            }
          } catch {
            /* no packed-refs */
          }
        }
      }
    }
  } catch {
    /* no .git/HEAD */
  }

  return { gitRepo, gitRef };
}

function autoDetectGitContext(): TraceRootGitContext {
  let gitRepo: string | undefined;
  let gitRef: string | undefined;

  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(REPO_URL_RE);
    if (match) gitRepo = match[1].replace(/\/$/, "");
  } catch {
    /* git unavailable */
  }

  try {
    gitRef =
      execSync("git rev-parse HEAD", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || undefined;
  } catch {
    /* git unavailable */
  }

  return { gitRepo, gitRef };
}
