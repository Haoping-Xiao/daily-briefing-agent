import { describe, expect, it } from "vitest";
import {
  resetTraceRootGitContextWarningsForTests,
  resolveTraceRootGitContext,
  warnIfTraceRootGitContextIncomplete,
} from "../src/observability/providers/traceroot-git-context.js";

describe("resolveTraceRootGitContext", () => {
  it("prefers explicit env vars over CI metadata", () => {
    const context = resolveTraceRootGitContext({
      TRACEROOT_GIT_REPO: "owner/repo",
      TRACEROOT_GIT_REF: "abc123",
      GITHUB_REPOSITORY: "ci/repo",
      GITHUB_SHA: "def456",
    });

    expect(context).toEqual({
      gitRepo: "owner/repo",
      gitRef: "abc123",
    });
  });

  it("falls back to GitHub Actions env vars", () => {
    const context = resolveTraceRootGitContext({
      GITHUB_REPOSITORY: "Haoping-Xiao/daily-briefing-agent",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    });

    expect(context).toEqual({
      gitRepo: "Haoping-Xiao/daily-briefing-agent",
      gitRef: "0123456789abcdef0123456789abcdef01234567",
    });
  });

  it("resolves repo and ref independently from mixed sources", () => {
    const context = resolveTraceRootGitContext({
      TRACEROOT_GIT_REPO: "owner/repo",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    });

    expect(context).toEqual({
      gitRepo: "owner/repo",
      gitRef: "0123456789abcdef0123456789abcdef01234567",
    });
  });
});

describe("warnIfTraceRootGitContextIncomplete", () => {
  it("warns once when git context is incomplete", () => {
    resetTraceRootGitContextWarningsForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfTraceRootGitContextIncomplete({ gitRepo: "owner/repo" });
    warnIfTraceRootGitContextIncomplete({ gitRepo: "owner/repo" });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
