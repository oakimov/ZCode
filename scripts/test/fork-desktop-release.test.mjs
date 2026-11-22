import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../../.github/workflows/release-desktop.yml", import.meta.url), "utf8"),
);
const publish = workflow.jobs["publish-release"];
const releaseStep = (name) => publish.steps.find((step) => step.name === name);

test("release uploads only the installer formats built for each platform", () => {
  const artifactGlobs = Object.fromEntries(
    workflow.jobs["build-desktop"].strategy.matrix.include.map(({ os, artifact_glob: globs }) => [
      os,
      globs.trim().split("\n"),
    ]),
  );
  assert.deepEqual(artifactGlobs, {
    mac: ["packages/desktop/dist/*.dmg", "packages/desktop/dist/*.zip"],
    win: ["packages/desktop/dist/*.exe"],
    linux: [
      "packages/desktop/dist/*.AppImage",
      "packages/desktop/dist/*.deb",
      "packages/desktop/dist/*.rpm",
      "packages/desktop/dist/*.pkg.tar.zst",
    ],
  });
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(publish.permissions, { contents: "write" });
  assert.equal(publish.concurrency.queue, "max");
  assert.equal(
    releaseStep("Create or update GitHub Release").with.target_commitish,
    "${{ github.sha }}",
  );
});

test("release tag selection and provenance checks run against a local Git repository", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "zcode-release-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  git("commit", "--quiet", "--allow-empty", "-m", "first");
  git("tag", "v-old");
  git("commit", "--quiet", "--allow-empty", "-m", "second");
  const sha = git("rev-parse", "HEAD");
  git("tag", "v-current");
  git("tag", "-a", "v-annotated", "-m", "current");
  git("remote", "add", "origin", ".");

  const output = join(cwd, "output");
  const run = (step, env) =>
    spawnSync("bash", ["-eo", "pipefail", "-c", releaseStep(step).run], {
      cwd,
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_SHA: sha, ...env },
      encoding: "utf8",
    });
  for (const [requested, refType, refName, expected] of [
    ["v-override", "branch", "main", "v-override"],
    ["v/3.18.2+build", "branch", "main", "v/3.18.2+build"],
    ["", "tag", "v-current", "v-current"],
    ["", "branch", "main", `desktop-${sha}`],
  ]) {
    await writeFile(output, "");
    const result = run("Resolve release tag", {
      REQUESTED_TAG: requested,
      GITHUB_REF_TYPE: refType,
      GITHUB_REF_NAME: refName,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, "utf8"), `name=${expected}\n`);
  }
  for (const requested of ["v-bad\nextra=value", "v..bad", "refs/tags/v-current"]) {
    await writeFile(output, "");
    assert.equal(run("Resolve release tag", { REQUESTED_TAG: requested }).status, 1);
    assert.equal(await readFile(output, "utf8"), "");
  }
  for (const tag of ["v-current", "v-annotated", "v-new"]) {
    const result = run("Verify release tag matches build commit", { RELEASE_TAG: tag });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(run("Verify release tag matches build commit", { RELEASE_TAG: "v-old" }).status, 1);
});
