import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAsarPackageJson,
  assertValidPackageJsonSource,
  refreshElectronAsarIntegrity,
  removeSourceMapFilesInDirectory,
  stripSourceMappingUrlComments,
  stripSourceMappingUrlCommentsInDirectory,
} from "../scripts/packaged-sourcemap-cleanup.mjs";

const asar = createRequire(import.meta.url)("@electron/asar") as typeof import("@electron/asar");

describe("packaged sourcemap cleanup", () => {
  it("应删除 JS/CSS 里的 sourceMappingURL 注释但保留普通内容", () => {
    expect(
      stripSourceMappingUrlComments(
        [
          "const answer = 42;",
          "//# sourceMappingURL=index.js.map",
          "body{color:red}",
          "/*# sourceMappingURL=index.css.map */",
        ].join("\n"),
      ),
    ).toBe(["const answer = 42;", "body{color:red}"].join("\n"));
  });

  it("应递归清理发布资源目录里的 sourcemap 文件和路径注释", () => {
    const rootDir = mkdtempSync(resolve(tmpdir(), "zcode-sourcemap-cleanup-test-"));
    try {
      const nestedDir = resolve(rootDir, "nested");
      mkdirSync(nestedDir, { recursive: true });
      const jsFile = resolve(nestedDir, "index.js");
      const cssFile = resolve(rootDir, "style.css");
      const mapFile = resolve(nestedDir, "index.js.map");
      const jsonFile = resolve(rootDir, "package.json");

      writeFileSync(jsFile, "console.log('ok');\n//# sourceMappingURL=index.js.map\n");
      writeFileSync(cssFile, ".x{color:red}\n/*# sourceMappingURL=style.css.map */");
      writeFileSync(mapFile, "{}");
      writeFileSync(jsonFile, '{"sourceMappingURL":"keep"}');

      expect(stripSourceMappingUrlCommentsInDirectory(rootDir)).toEqual({
        filesChanged: 2,
        referencesRemoved: 2,
      });
      expect(removeSourceMapFilesInDirectory(rootDir)).toEqual({ filesRemoved: 1 });

      expect(readFileSync(jsFile, "utf8")).toBe("console.log('ok');\n");
      expect(readFileSync(cssFile, "utf8")).toBe(".x{color:red}");
      expect(readFileSync(jsonFile, "utf8")).toBe('{"sourceMappingURL":"keep"}');
      expect(existsSync(mapFile)).toBe(false);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it("应拒绝损坏的 package.json，避免打出无法启动的安装包", () => {
    expect(() =>
      assertValidPackageJsonSource(
        '1707],"version":"6.0.2"}{"name":"@zcode/desktop","main":"out/main/index.js"}',
        "fixture",
      ),
    ).toThrow(/invalid package\.json \(fixture\)/);

    expect(
      assertValidPackageJsonSource(
        JSON.stringify({ name: "@zcode/desktop", main: "out/main/index.js" }),
        "fixture",
      ),
    ).toMatchObject({ main: "out/main/index.js" });
  });

  it("应读取每次重打包后的新 package.json 和文件偏移", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "zcode-asar-validation-"));
    try {
      const source = resolve(root, "source");
      mkdirSync(source);
      const archive = resolve(root, "app.asar");
      const manifest = resolve(source, "package.json");
      writeFileSync(manifest, '{"main":"first.js"}');
      await asar.createPackage(source, archive);
      expect(assertAsarPackageJson(archive)).toMatchObject({ main: "first.js" });

      writeFileSync(resolve(source, "a-before-manifest.js"), "preceding bytes");
      writeFileSync(manifest, '{"main":"second-build.js"}');
      await asar.createPackage(source, archive);
      expect(assertAsarPackageJson(archive)).toMatchObject({ main: "second-build.js" });
    } finally {
      asar.uncacheAll();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "darwin")(
    "应更新 ASAR header 哈希并保留其他归档记录",
    async () => {
      const root = mkdtempSync(resolve(tmpdir(), "zcode-asar-integrity-"));
      try {
        const resources = resolve(root, "Contents", "Resources");
        const source = resolve(root, "source");
        mkdirSync(resources, { recursive: true });
        mkdirSync(source);
        const archive = resolve(resources, "app.asar");
        const plist = resolve(resources, "..", "Info.plist");
        const integrity = {
          "Resources/app.asar": { algorithm: "SHA256", hash: "stale" },
          "Resources/other.asar": { algorithm: "SHA256", hash: "other" },
        };
        execFileSync("plutil", ["-create", "xml1", plist]);
        execFileSync("plutil", [
          "-insert",
          "ElectronAsarIntegrity",
          "-json",
          JSON.stringify(integrity),
          plist,
        ]);
        writeFileSync(resolve(source, "package.json"), '{"main":"index.js"}');
        writeFileSync(resolve(source, "index.js"), "console.log('packaged');");
        await asar.createPackage(source, archive);

        expect(refreshElectronAsarIntegrity(resources, archive)).toBe(true);
        const actual = JSON.parse(
          execFileSync("plutil", ["-extract", "ElectronAsarIntegrity", "json", "-o", "-", plist], {
            encoding: "utf8",
          }),
        );
        expect(actual).toEqual({
          ...integrity,
          "Resources/app.asar": {
            algorithm: "SHA256",
            hash: createHash("sha256")
              .update(asar.getRawHeader(archive).headerString)
              .digest("hex"),
          },
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
