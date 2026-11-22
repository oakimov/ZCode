import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, resolve } from "node:path";

const require = createRequire(import.meta.url);

const SOURCEMAP_REFERENCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".css"]);
// 只清理位于行首的 sourceMappingURL 注释。压缩后的 bundle 可能在模板字符串里内嵌
// 这段文本（例如内嵌 TypeScript 编译器的 emitter 源码），行中匹配会把该行剩余内容整段
// 吞掉，直接产出语法损坏的产物；真实的 sourcemap 注释总是由构建工具单独成行输出。
const SOURCE_MAPPING_URL_LINE_RE = /(?:^|\r?\n)[ \t]*\/\/[#@][ \t]*sourceMappingURL=[^\r\n]*/g;
const SOURCE_MAPPING_URL_BLOCK_RE =
  /(?:^|\r?\n)[ \t]*\/\*[#@][ \t]*sourceMappingURL=[\s\S]*?\*\/[ \t]*/g;

export function stripSourceMappingUrlComments(source) {
  return source.replace(SOURCE_MAPPING_URL_LINE_RE, "").replace(SOURCE_MAPPING_URL_BLOCK_RE, "");
}

function walkFiles(rootDir, visitor) {
  if (!existsSync(rootDir)) {
    return;
  }

  for (const entry of readdirSync(rootDir)) {
    const entryPath = resolve(rootDir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      walkFiles(entryPath, visitor);
      continue;
    }
    if (stat.isFile()) {
      visitor(entryPath);
    }
  }
}

export function stripSourceMappingUrlCommentsInDirectory(rootDir) {
  const summary = { filesChanged: 0, referencesRemoved: 0 };
  walkFiles(rootDir, (filePath) => {
    if (!SOURCEMAP_REFERENCE_EXTENSIONS.has(extname(filePath))) {
      return;
    }
    const source = readFileSync(filePath, "utf8");
    const lineReferenceCount = source.match(SOURCE_MAPPING_URL_LINE_RE)?.length ?? 0;
    const blockReferenceCount = source.match(SOURCE_MAPPING_URL_BLOCK_RE)?.length ?? 0;
    const referencesRemoved = lineReferenceCount + blockReferenceCount;
    if (referencesRemoved === 0) {
      return;
    }

    writeFileSync(filePath, stripSourceMappingUrlComments(source));
    summary.filesChanged += 1;
    summary.referencesRemoved += referencesRemoved;
  });
  return summary;
}

export function removeSourceMapFilesInDirectory(rootDir) {
  const summary = { filesRemoved: 0 };
  walkFiles(rootDir, (filePath) => {
    if (extname(filePath) !== ".map") {
      return;
    }

    unlinkSync(filePath);
    summary.filesRemoved += 1;
  });
  return summary;
}

export function assertValidPackageJsonSource(source, label) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    // 损坏的 app.asar package.json 会让 Electron 在启动时直接退出（ERR_INVALID_PACKAGE_CONFIG），
    // afterPack 必须在出包前失败，不能把无法启动的安装包交给 CI/本地验收。
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid package.json (${label}): ${detail}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid package.json (${label}): expected a JSON object`);
  }
  if (typeof parsed.main !== "string" || parsed.main.trim() === "") {
    throw new Error(`invalid package.json (${label}): missing main`);
  }
  return parsed;
}

export function assertStagingPackageJson(stagingDir) {
  const packageJsonPath = resolve(stagingDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`invalid package.json (${packageJsonPath}): file missing`);
  }
  return assertValidPackageJsonSource(readFileSync(packageJsonPath, "utf8"), packageJsonPath);
}

export function assertAsarPackageJson(appAsarPath) {
  // 不要用 asar CLI extract-file：它会把文件写到 cwd，曾经误覆盖仓库根 package.json。
  const asar = require("@electron/asar");
  const source = asar.extractFile(appAsarPath, "package.json").toString("utf8");
  return assertValidPackageJsonSource(source, `${appAsarPath}:package.json`);
}

export function refreshElectronAsarIntegrity(resourcesDir, appAsarPath, logger = console) {
  const infoPlistPath = resolve(dirname(resourcesDir), "Info.plist");
  if (!existsSync(infoPlistPath) || !existsSync(appAsarPath)) {
    return false;
  }

  const hash = createHash("sha256").update(readFileSync(appAsarPath)).digest("hex");
  const integrity = {
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash,
    },
  };

  // plutil 比手写二进制 plist 更稳；afterPack 改写 asar 后必须同步 ElectronAsarIntegrity，
  // 否则 macOS 包装态会在 JS 启动前因完整性校验失败而静默退出。
  const { execFileSync } = require("node:child_process");
  execFileSync(
    "plutil",
    ["-replace", "ElectronAsarIntegrity", "-json", JSON.stringify(integrity), infoPlistPath],
    { stdio: "pipe" },
  );
  logger.log(`[afterPack] refreshed ElectronAsarIntegrity hash=${hash}`);
  return true;
}

export async function cleanupPackagedSourcemaps({
  appAsarPath,
  resourcesDir,
  runAsarCommand,
  runTimedSync,
  runTimedAsync,
  replaceAppAsarFromStaging,
  pruneStagingDirectory = null,
  logger = console,
}) {
  let asarRewritten = false;
  if (existsSync(appAsarPath)) {
    mkdirSync(tmpdir(), { recursive: true });
    const stagingDir = mkdtempSync(resolve(tmpdir(), "zcode-app-asar-sourcemap-"));
    try {
      runTimedSync("afterPack:sourcemap-cleanup:asar-extract", () =>
        runAsarCommand(["extract", appAsarPath, stagingDir]),
      );
      runTimedSync("afterPack:sourcemap-cleanup:assert-staging-package-json", () =>
        assertStagingPackageJson(stagingDir),
      );
      const stripSummary = stripSourceMappingUrlCommentsInDirectory(stagingDir);
      const mapSummary = removeSourceMapFilesInDirectory(stagingDir);
      const pruneSummary = pruneStagingDirectory ? await pruneStagingDirectory(stagingDir) : null;
      if (
        stripSummary.referencesRemoved > 0 ||
        mapSummary.filesRemoved > 0 ||
        (pruneSummary?.packagesRemoved ?? 0) > 0
      ) {
        if (pruneSummary?.packagesRemoved > 0) {
          logger.log(
            `[afterPack] removed incompatible platform packages count=${pruneSummary.packagesRemoved}: ${pruneSummary.removedNames.join(", ")}`,
          );
        }
        logger.log(
          `[afterPack] stripped sourceMappingURL references=${stripSummary.referencesRemoved} files=${stripSummary.filesChanged} maps=${mapSummary.filesRemoved}`,
        );
        runTimedSync("afterPack:sourcemap-cleanup:assert-staging-package-json-before-pack", () =>
          assertStagingPackageJson(stagingDir),
        );
        await runTimedAsync("afterPack:sourcemap-cleanup:asar-pack", () =>
          replaceAppAsarFromStaging({ sourceDir: stagingDir, appAsarPath }),
        );
        runTimedSync("afterPack:sourcemap-cleanup:assert-asar-package-json", () =>
          assertAsarPackageJson(appAsarPath),
        );
        asarRewritten = true;
      } else {
        logger.log("[afterPack] app.asar sourcemap cleanup found no references");
      }
    } finally {
      rmSync(stagingDir, { force: true, recursive: true });
    }
  }

  const stripSummary = stripSourceMappingUrlCommentsInDirectory(resourcesDir);
  const mapSummary = removeSourceMapFilesInDirectory(resourcesDir);
  logger.log(
    `[afterPack] resources sourcemap cleanup references=${stripSummary.referencesRemoved} files=${stripSummary.filesChanged} maps=${mapSummary.filesRemoved}`,
  );

  if (asarRewritten) {
    runTimedSync("afterPack:sourcemap-cleanup:refresh-asar-integrity", () =>
      refreshElectronAsarIntegrity(resourcesDir, appAsarPath, logger),
    );
  }
}
