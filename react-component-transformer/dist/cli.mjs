#!/usr/bin/env node
import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { NodeContext, NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Console, Effect } from "effect";
import { Worker } from "node:worker_threads";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileHashCache } from "fast-fs-hash";
import * as fs from "node:fs";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region src/cache.ts
const CACHE_DIR = "node_modules/.cache/react-component-transformer";
const CACHE_FILE = "transformer-cache.fsh";
let globalCache = null;
let cachedProjectRoot = null;
/**
* Find the project root by walking up from startDir looking for package.json.
* For monorepos, continues walking up to find the workspace root.
*/
function findProjectRoot(startDir) {
	let currentDir = path.resolve(startDir);
	const root = path.parse(currentDir).root;
	let lastPackageJsonDir = null;
	while (currentDir !== root) {
		const packageJsonPath = path.join(currentDir, "package.json");
		if (fs.existsSync(packageJsonPath)) try {
			if (JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).workspaces) return currentDir;
			if (fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml")) || fs.existsSync(path.join(currentDir, "lerna.json"))) return currentDir;
			lastPackageJsonDir = currentDir;
		} catch {}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}
	if (fs.existsSync(path.join(root, "package.json"))) try {
		if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8")).workspaces) return root;
	} catch {}
	if (lastPackageJsonDir) return lastPackageJsonDir;
	throw new Error(`Could not find project root. No package.json found starting from "${startDir}".`);
}
function getCache(targetDir) {
	if (!globalCache) {
		const projectRoot = findProjectRoot(targetDir);
		cachedProjectRoot = projectRoot;
		const cacheDir = path.join(projectRoot, CACHE_DIR);
		fs.mkdirSync(cacheDir, { recursive: true });
		globalCache = new FileHashCache({
			cachePath: path.join(cacheDir, CACHE_FILE),
			rootPath: projectRoot,
			version: 1
		});
	}
	return globalCache;
}
function getProjectRoot() {
	return cachedProjectRoot;
}
async function loadAndFilterFiles(targetDir, files, force, debug) {
	const cache = getCache(targetDir);
	if (force) {
		cache.configure({ files });
		return {
			filesToProcess: files,
			cachedResults: []
		};
	}
	cache.configure({ files });
	const session = await cache.open();
	try {
		if (session.status === "upToDate") {
			const payload = session.compressedPayloads.length > 0 ? JSON.parse(session.compressedPayloads[0].toString()) : null;
			if (payload) return {
				filesToProcess: [],
				cachedResults: files.map((filePath) => ({
					filePath,
					transformed: payload.transformed[filePath] ?? false,
					componentsFound: payload.componentsFound[filePath] ?? 0
				}))
			};
		}
		if (session.status !== "missing" && session.compressedPayloads.length > 0) {
			const entries = await session.resolve();
			const payload = JSON.parse(session.compressedPayloads[0].toString());
			const filesToProcess = [];
			const cachedResults = [];
			for (const entry of entries) if (entry.changed) filesToProcess.push(entry.path);
			else {
				cachedResults.push({
					filePath: entry.path,
					transformed: payload.transformed[entry.path] ?? false,
					componentsFound: payload.componentsFound[entry.path] ?? 0
				});
				if (debug) {
					const projectRoot = getProjectRoot();
					const relativePath = path.relative(projectRoot, entry.path);
					console.log(`  \x1b[90mcached:\x1b[0m ${relativePath}`);
				}
			}
			return {
				filesToProcess,
				cachedResults
			};
		}
		return {
			filesToProcess: files,
			cachedResults: []
		};
	} finally {
		await session.close();
	}
}
async function saveCacheResults(targetDir, files, results) {
	const cache = getCache(targetDir);
	const payload = {
		transformed: {},
		componentsFound: {}
	};
	for (const result of results) {
		payload.transformed[result.filePath] = result.transformed;
		payload.componentsFound[result.filePath] = result.componentsFound;
	}
	cache.configure({ files });
	const session = await cache.open();
	try {
		await session.write({ compressedPayloads: [Buffer.from(JSON.stringify(payload))] });
	} finally {
		await session.close();
	}
}
//#endregion
//#region src/gitignore.ts
var import_ignore = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	function makeArray(subject) {
		return Array.isArray(subject) ? subject : [subject];
	}
	const UNDEFINED = void 0;
	const EMPTY = "";
	const SPACE = " ";
	const ESCAPE = "\\";
	const REGEX_TEST_BLANK_LINE = /^\s+$/;
	const REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
	const REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
	const REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
	const REGEX_SPLITALL_CRLF = /\r?\n/g;
	const REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
	const REGEX_TEST_TRAILING_SLASH = /\/$/;
	const SLASH = "/";
	let TMP_KEY_IGNORE = "node-ignore";
	/* istanbul ignore else */
	if (typeof Symbol !== "undefined") TMP_KEY_IGNORE = Symbol.for("node-ignore");
	const KEY_IGNORE = TMP_KEY_IGNORE;
	const define = (object, key, value) => {
		Object.defineProperty(object, key, { value });
		return value;
	};
	const REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
	const RETURN_FALSE = () => false;
	const sanitizeRange = (range) => range.replace(REGEX_REGEXP_RANGE, (match, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match : EMPTY);
	const negateRange = (range) => range.startsWith("!") || range.startsWith("\\^") ? `^${range.slice(range[0] === "!" ? 1 : 2)}` : range;
	const cleanRangeBackSlash = (slashes) => {
		const { length } = slashes;
		return slashes.slice(0, length - length % 2);
	};
	const REPLACERS = [
		[/^\uFEFF/, () => EMPTY],
		[/((?:\\\\)*?)(\\?\s+)$/, (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)],
		[/(\\+?)\s/g, (_, m1) => {
			const { length } = m1;
			return m1.slice(0, length - length % 2) + SPACE;
		}],
		[/[\\$.|*+(){^]/g, (match) => `\\${match}`],
		[/(?!\\)\?/g, () => "[^/]"],
		[/^\//, () => "^"],
		[/\//g, () => "\\/"],
		[/^\^*(?:\\\*\\\*\\\/)+/, () => "^(?:.*\\/)?"],
		[/^(?=[^^])/, function startingReplacer() {
			return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
		}],
		[/\\\/\\\*\\\*(?=\\\/|$)/g, (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"],
		[/(^|[^\\]+)(\\\*)+(?=.+)/g, (_, p1, p2) => {
			return p1 + p2.replace(/\\\*/g, "[^\\/]*");
		}],
		[/\\\\\\(?=[$.|*+(){^])/g, () => ESCAPE],
		[/\\\\/g, () => ESCAPE],
		[/(\\)?\[([^\]/]*?)(\\*)($|\])/g, (match, leadEscape, range, endEscape, close) => leadEscape === ESCAPE ? `\\[${range}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${negateRange(sanitizeRange(range))}${endEscape}]` : "[]" : "[]"],
		[/(?:[^*])$/, (match) => /\/$/.test(match) ? `${match}$` : `${match}(?=$|\\/$)`]
	];
	const REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
	const MODE_IGNORE = "regex";
	const MODE_CHECK_IGNORE = "checkRegex";
	const TRAILING_WILD_CARD_REPLACERS = {
		[MODE_IGNORE](_, p1) {
			return `${p1 ? `${p1}[^/]+` : "[^/]*"}(?=$|\\/$)`;
		},
		[MODE_CHECK_IGNORE](_, p1) {
			return `${p1 ? `${p1}[^/]*` : "[^/]*"}(?=$|\\/$)`;
		}
	};
	const makeRegexPrefix = (pattern) => REPLACERS.reduce((prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)), pattern);
	const isString = (subject) => typeof subject === "string";
	const checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
	const splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
	var IgnoreRule = class {
		constructor(pattern, mark, body, ignoreCase, negative, prefix) {
			this.pattern = pattern;
			this.mark = mark;
			this.negative = negative;
			define(this, "body", body);
			define(this, "ignoreCase", ignoreCase);
			define(this, "regexPrefix", prefix);
		}
		get regex() {
			const key = "_regex";
			if (this[key]) return this[key];
			return this._make(MODE_IGNORE, key);
		}
		get checkRegex() {
			const key = "_checkRegex";
			if (this[key]) return this[key];
			return this._make(MODE_CHECK_IGNORE, key);
		}
		_make(mode, key) {
			const str = this.regexPrefix.replace(REGEX_REPLACE_TRAILING_WILDCARD, TRAILING_WILD_CARD_REPLACERS[mode]);
			const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
			return define(this, key, regex);
		}
	};
	const createRule = ({ pattern, mark }, ignoreCase) => {
		let negative = false;
		let body = pattern;
		if (body.indexOf("!") === 0) {
			negative = true;
			body = body.substr(1);
		}
		body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
		const regexPrefix = makeRegexPrefix(body);
		return new IgnoreRule(pattern, mark, body, ignoreCase, negative, regexPrefix);
	};
	var RuleManager = class {
		constructor(ignoreCase) {
			this._ignoreCase = ignoreCase;
			this._rules = [];
		}
		_add(pattern) {
			if (pattern && pattern[KEY_IGNORE]) {
				this._rules = this._rules.concat(pattern._rules._rules);
				this._added = true;
				return;
			}
			if (isString(pattern)) pattern = { pattern };
			if (checkPattern(pattern.pattern)) {
				const rule = createRule(pattern, this._ignoreCase);
				this._added = true;
				this._rules.push(rule);
			}
		}
		add(pattern) {
			this._added = false;
			makeArray(isString(pattern) ? splitPattern(pattern) : pattern).forEach(this._add, this);
			return this._added;
		}
		test(path, checkUnignored, mode) {
			let ignored = false;
			let unignored = false;
			let matchedRule;
			this._rules.forEach((rule) => {
				const { negative } = rule;
				if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) return;
				if (!rule[mode].test(path)) return;
				ignored = !negative;
				unignored = negative;
				matchedRule = negative ? UNDEFINED : rule;
			});
			const ret = {
				ignored,
				unignored
			};
			if (matchedRule) ret.rule = matchedRule;
			return ret;
		}
	};
	const throwError = (message, Ctor) => {
		throw new Ctor(message);
	};
	const checkPath = (path, originalPath, doThrow) => {
		if (!isString(path)) return doThrow(`path must be a string, but got \`${originalPath}\``, TypeError);
		if (!path) return doThrow(`path must not be empty`, TypeError);
		if (checkPath.isNotRelative(path)) return doThrow(`path should be a \`path.relative()\`d string, but got "${originalPath}"`, RangeError);
		return true;
	};
	const isNotRelative = (path) => REGEX_TEST_INVALID_PATH.test(path);
	checkPath.isNotRelative = isNotRelative;
	/* istanbul ignore next */
	checkPath.convert = (p) => p;
	var Ignore = class {
		constructor({ ignorecase = true, ignoreCase = ignorecase, allowRelativePaths = false } = {}) {
			define(this, KEY_IGNORE, true);
			this._rules = new RuleManager(ignoreCase);
			this._strictPathCheck = !allowRelativePaths;
			this._initCache();
		}
		_initCache() {
			this._ignoreCache = Object.create(null);
			this._testCache = Object.create(null);
		}
		add(pattern) {
			if (this._rules.add(pattern)) this._initCache();
			return this;
		}
		addPattern(pattern) {
			return this.add(pattern);
		}
		_test(originalPath, cache, checkUnignored, slices) {
			const path = originalPath && checkPath.convert(originalPath);
			checkPath(path, originalPath, this._strictPathCheck ? throwError : RETURN_FALSE);
			return this._t(path, cache, checkUnignored, slices);
		}
		checkIgnore(path) {
			if (!REGEX_TEST_TRAILING_SLASH.test(path)) return this.test(path);
			const slices = path.split(SLASH).filter(Boolean);
			slices.pop();
			if (slices.length) {
				const parent = this._t(slices.join(SLASH) + SLASH, this._testCache, true, slices);
				if (parent.ignored) return parent;
			}
			return this._rules.test(path, false, MODE_CHECK_IGNORE);
		}
		_t(path, cache, checkUnignored, slices) {
			if (path in cache) return cache[path];
			if (!slices) slices = path.split(SLASH).filter(Boolean);
			slices.pop();
			if (!slices.length) return cache[path] = this._rules.test(path, checkUnignored, MODE_IGNORE);
			const parent = this._t(slices.join(SLASH) + SLASH, cache, checkUnignored, slices);
			return cache[path] = parent.ignored ? parent : this._rules.test(path, checkUnignored, MODE_IGNORE);
		}
		ignores(path) {
			return this._test(path, this._ignoreCache, false).ignored;
		}
		createFilter() {
			return (path) => !this.ignores(path);
		}
		filter(paths) {
			return makeArray(paths).filter(this.createFilter());
		}
		test(path) {
			return this._test(path, this._testCache, true);
		}
	};
	const factory = (options) => new Ignore(options);
	const isPathValid = (path) => checkPath(path && checkPath.convert(path), path, RETURN_FALSE);
	/* istanbul ignore next */
	const setupWindows = () => {
		const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
		checkPath.convert = makePosix;
		const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
		checkPath.isNotRelative = (path) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path) || isNotRelative(path);
	};
	/* istanbul ignore next */
	if (typeof process !== "undefined" && process.platform === "win32") setupWindows();
	module.exports = factory;
	factory.default = factory;
	module.exports.isPathValid = isPathValid;
	define(module.exports, Symbol.for("setupWindows"), setupWindows);
})))(), 1);
const DEFAULT_IGNORED = [
	"node_modules",
	".git",
	"dist",
	".next",
	"build",
	".cache",
	".turbo",
	".vercel",
	".netlify",
	"coverage",
	".nyc_output",
	"__pycache__",
	".DS_Store"
];
function createGitignoreFilter(targetDir) {
	const ig = (0, import_ignore.default)();
	ig.add(DEFAULT_IGNORED);
	const gitignoreFiles = findGitignoreFiles(targetDir);
	for (const gitignorePath of gitignoreFiles) {
		const relativeDir = path.dirname(path.relative(targetDir, gitignorePath));
		const lines = fs.readFileSync(gitignorePath, "utf-8").split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			if (relativeDir !== ".") ig.add(path.join(relativeDir, trimmed));
			else ig.add(trimmed);
		}
	}
	return (filePath) => {
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(targetDir, filePath);
		const relativePath = path.relative(targetDir, absolutePath);
		if (!relativePath.endsWith(".tsx")) return false;
		return !ig.ignores(relativePath);
	};
}
function findGitignoreFiles(dir, results = []) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === ".git") continue;
			const gitignorePath = path.join(fullPath, ".gitignore");
			if (fs.existsSync(gitignorePath)) results.push(gitignorePath);
			findGitignoreFiles(fullPath, results);
		}
	}
	return results;
}
//#endregion
//#region src/cli.ts
const __filename = fileURLToPath(import.meta.url);
path.dirname(__filename);
const WORKER_CODE = `
const { parentPort } = require("node:worker_threads");
const { Project } = require("ts-morph");

if (!parentPort) {
  throw new Error("Worker must be run in a worker_threads context");
}

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

parentPort.on("message", (message) => {
  const { filePath } = message;
  const fs = require("node:fs");
  const path = require("node:path");

  const start = performance.now();

  function isReactComponent(name) {
    return /^[A-Z]/.test(name);
  }

  function isTsxFile(filePath) {
    return path.extname(filePath).toLowerCase() === ".tsx";
  }

  if (!isTsxFile(filePath)) {
    parentPort.postMessage({ filePath, success: false, message: "Not a TSX file", componentsFound: 0, duration: 0 });
    return;
  }

  if (!fs.existsSync(filePath)) {
    parentPort.postMessage({ filePath, success: false, message: "File not found", componentsFound: 0, duration: 0 });
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const hasPotentialComponents = /(?:export\\s+)?(?:const|let|var)\\s+[A-Z]/.test(content) ||
    /(?:export\\s+)?function\\s+[A-Z]/.test(content);

  if (!hasPotentialComponents) {
    const duration = performance.now() - start;
    parentPort.postMessage({ filePath, success: true, message: "No components to transform", componentsFound: 0, duration });
    return;
  }

  try {
    const { SyntaxKind } = require("ts-morph");
    const sourceFile = project.addSourceFileAtPath(filePath);

    function isReactComponent(name) {
      return /^[A-Z]/.test(name);
    }

    const variableStatements = sourceFile.getStatements().filter(statement => {
      return statement.isKind(SyntaxKind.VariableStatement);
    });

    let transformedCount = 0;

    for (const statement of variableStatements) {
      const variableStatement = statement.asKindOrThrow(SyntaxKind.VariableStatement);
      const declarationList = variableStatement.getDeclarationList();
      const declarations = declarationList.getDeclarations();

      for (const declaration of declarations) {
        const componentName = declaration.getName();

        if (!isReactComponent(componentName)) {
          continue;
        }

        const initializer = declaration.getInitializer();
        if (!initializer) continue;

        if (!initializer.isKind(SyntaxKind.ArrowFunction)) continue;

        const arrowFunc = initializer.asKindOrThrow(SyntaxKind.ArrowFunction);
        const parameters = arrowFunc.getParameters();

        if (parameters.length > 1) continue;

        const arrowFuncBody = arrowFunc.getBody();
        const bodyText = arrowFuncBody.getText();
        const bodyContent = bodyText.slice(1, -1).trim();

        let functionDeclaration;

        if (parameters.length === 0) {
          functionDeclaration = sourceFile.addFunction({
            name: componentName,
            isExported: variableStatement.isExported(),
          });
        } else {
          const firstParam = parameters[0];
          const typeNode = firstParam.getTypeNode();

          if (!typeNode || !typeNode.isKind(SyntaxKind.TypeLiteral)) continue;

          const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
          const destructuringPattern = firstParam.getName();
          const propsTypeName = componentName + "Props";

          sourceFile.addTypeAlias({
            name: propsTypeName,
            type: typeLiteral.getText(),
            isExported: variableStatement.isExported(),
          });

          functionDeclaration = sourceFile.addFunction({
            name: componentName,
            parameters: [
              {
                name: "props",
                type: propsTypeName,
              },
            ],
            isExported: variableStatement.isExported(),
          });

          functionDeclaration.setBodyText("\\n  const " + destructuringPattern + " = props;\\n\\n  " + bodyContent + "\\n");
        }

        statement.remove();
        transformedCount++;
      }
    }

    const allFuncTransformations = [];

    const functionDeclarations = sourceFile.getFunctions().filter(func => {
      const name = func.getName();
      return name && isReactComponent(name);
    });

    for (const func of functionDeclarations) {
      const parameters = func.getParameters();
      if (parameters.length !== 1) continue;

      const firstParam = parameters[0];
      const typeNode = firstParam.getTypeNode();

      if (!typeNode) continue;

      const componentName = func.getName();
      const destructuringPattern = firstParam.getName();
      const isExported = func.isExported();

      const body = func.getBody();
      if (!body) continue;
      const bodyText = body.getText();
      const bodyContent = bodyText.slice(1, -1).trim();

      if (typeNode.isKind(SyntaxKind.TypeLiteral)) {
        const typeLiteral = typeNode.asKindOrThrow(SyntaxKind.TypeLiteral);
        allFuncTransformations.push({
          componentName,
          typeText: typeLiteral.getText(),
          typeName: "",
          destructuringPattern,
          isExported,
          bodyContent,
          isInlineType: true,
        });
      } else {
        if (firstParam.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern) continue;

        const objectPattern = firstParam.getNameNode().asKindOrThrow(SyntaxKind.ObjectBindingPattern);
        const properties = objectPattern.getElements();

        const hasThreeOrMoreProps = properties.length >= 3;
        const hasDefaultValues = properties.some((prop) => {
          return prop.getInitializer() !== undefined;
        });

        if (!hasThreeOrMoreProps && !hasDefaultValues) continue;

        allFuncTransformations.push({
          componentName,
          typeText: "",
          typeName: typeNode.getText(),
          destructuringPattern,
          isExported,
          bodyContent,
          isInlineType: false,
        });
      }

      func.remove();
    }

    for (const transformation of allFuncTransformations) {
      const { componentName, typeText, typeName, destructuringPattern, isExported, bodyContent, isInlineType } = transformation;

      if (isInlineType) {
        const propsTypeName = componentName + "Props";
        sourceFile.addTypeAlias({
          name: propsTypeName,
          type: typeText,
          isExported,
        });

        const newFunc = sourceFile.addFunction({
          name: componentName,
          parameters: [{
            name: "props",
            type: propsTypeName,
          }],
          isExported,
        });

        if (destructuringPattern !== "props") {
          // Fix rest element naming conflict: ...props -> ...restProps
          const fixedPattern = destructuringPattern.replace(/\\.\\.\\.props\\b/g, "...restProps");
          const fixedBodyContent = fixedPattern !== destructuringPattern 
            ? bodyContent.replace(/\\.\\.\\.props\\b/g, "...restProps")
            : bodyContent;
          newFunc.setBodyText("\\n  const " + fixedPattern + " = props;\\n\\n  " + fixedBodyContent + "\\n");
        } else {
          newFunc.setBodyText("\\n  " + bodyContent + "\\n");
        }
      } else {
        const newFunc = sourceFile.addFunction({
          name: componentName,
          parameters: [{
            name: "props",
            type: typeName,
          }],
          isExported,
        });

        // Fix rest element naming conflict: ...props -> ...restProps
        const fixedPattern = destructuringPattern.replace(/\\.\\.\\.props\\b/g, "...restProps");
        const fixedBodyContent = fixedPattern !== destructuringPattern 
          ? bodyContent.replace(/\\.\\.\\.props\\b/g, "...restProps")
          : bodyContent;
        newFunc.setBodyText("\\n  const " + fixedPattern + " = props;\\n\\n  " + fixedBodyContent + "\\n");
      }

      transformedCount++;
    }

    sourceFile.saveSync();
    const duration = performance.now() - start;

    parentPort.postMessage({
      filePath,
      success: true,
      message: transformedCount > 0 ? "Transformed " + transformedCount + " components" : "No components to transform",
      componentsFound: transformedCount,
      duration,
    });
  } catch (error) {
    const duration = performance.now() - start;
    parentPort.postMessage({
      filePath,
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
      componentsFound: 0,
      duration,
    });
  }
});
`;
const directory = Args.directory({ name: "directory" }).pipe(Args.withDefault("."));
const workers = Options.integer("workers").pipe(Options.withAlias("w"), Options.withDefault(4));
const debug = Options.boolean("debug").pipe(Options.withAlias("d"), Options.withDefault(false));
const force = Options.boolean("force").pipe(Options.withAlias("f"), Options.withDefault(false));
const command = Command.make("react-component-transformer", {
	directory,
	workers,
	debug,
	force
}, ({ directory, workers, debug, force }) => Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const resolvedDir = path.resolve(directory);
	yield* Console.log(`Scanning ${resolvedDir} for .tsx files...`);
	const allFiles = yield* fs.readDirectory(resolvedDir, { recursive: true });
	const filterTsx = createGitignoreFilter(resolvedDir);
	const files = allFiles.filter(filterTsx).map((file) => path.join(resolvedDir, file));
	if (files.length === 0) {
		yield* Console.log("No .tsx files found.");
		return;
	}
	const { filesToProcess, cachedResults } = yield* Effect.tryPromise({
		try: () => loadAndFilterFiles(resolvedDir, files, force, debug),
		catch: (error) => /* @__PURE__ */ new Error(`Cache load failed: ${error}`)
	});
	const cachedTransformResults = cachedResults.map((r) => ({
		filePath: r.filePath,
		success: true,
		message: r.transformed ? `Cached (${r.componentsFound} components)` : "Cached (no components)",
		componentsFound: r.componentsFound,
		duration: 0
	}));
	if (cachedTransformResults.length > 0) yield* Console.log(`${cachedTransformResults.length} files cached (use --force to reprocess)`);
	if (filesToProcess.length === 0) {
		yield* Console.log("All files cached. Nothing to transform.");
		return;
	}
	yield* Console.log(`Found ${filesToProcess.length} files to transform with ${workers} workers...`);
	const results = [...cachedTransformResults];
	const chunkSize = Math.ceil(filesToProcess.length / workers);
	const chunks = [];
	for (let i = 0; i < filesToProcess.length; i += chunkSize) chunks.push(filesToProcess.slice(i, i + chunkSize));
	const green = "\x1B[32m";
	const yellow = "\x1B[33m";
	const red = "\x1B[31m";
	const reset = "\x1B[0m";
	let headerPrinted = false;
	const workerPromises = chunks.map((chunk) => Effect.gen(function* () {
		return yield* Effect.async((resume) => {
			const workerResults = [];
			let completed = 0;
			const worker = new Worker(WORKER_CODE, { eval: true });
			worker.on("message", (result) => {
				const r = result;
				if (debug) {
					if (!headerPrinted) {
						console.log("");
						console.log("  Results:");
						headerPrinted = true;
					}
					const duration = Math.round(r.duration);
					const color = duration > 500 ? red : duration > 200 ? yellow : green;
					const relativePath = r.filePath.replace(resolvedDir + "/", "");
					console.log(`  ${color}${String(duration).padStart(5)}ms${reset}  ${relativePath}`);
				}
				workerResults.push(r);
				completed++;
				if (completed === chunk.length) {
					worker.terminate();
					resume(Effect.succeed(workerResults));
				}
			});
			worker.on("error", (error) => {
				resume(Effect.fail(error));
			});
			for (const filePath of chunk) {
				if (debug) {
					const relativePath = filePath.replace(resolvedDir + "/", "");
					console.log(`  writing: ${relativePath}`);
				}
				worker.postMessage({ filePath });
			}
		});
	}));
	const allResults = yield* Effect.forEach(workerPromises, (effect) => effect, { concurrency: 40 });
	for (const chunkResults of allResults) results.push(...chunkResults);
	const transformed = results.filter((r) => r.success && r.componentsFound > 0);
	const skipped = results.filter((r) => r.success && r.componentsFound === 0);
	const errors = results.filter((r) => !r.success);
	yield* Console.log("");
	yield* Console.log(`Transformed: ${transformed.length} files`);
	yield* Console.log(`Skipped: ${skipped.length} files (no components)`);
	yield* Console.log(`Errors: ${errors.length} files`);
	if (errors.length > 0) {
		yield* Console.log("");
		for (const error of errors) yield* Console.log(`  ${error.filePath}: ${error.message}`);
	}
	const cacheData = results.map((r) => ({
		filePath: r.filePath,
		transformed: r.componentsFound > 0,
		componentsFound: r.componentsFound
	}));
	yield* Effect.tryPromise({
		try: () => saveCacheResults(resolvedDir, files, cacheData),
		catch: (error) => /* @__PURE__ */ new Error(`Cache save failed: ${error}`)
	});
}));
Command.run(command, {
	name: "react-component-transformer",
	version: "1.0.0"
})(process.argv).pipe(Effect.provide(NodeContext.layer), Effect.provide(NodeFileSystem.layer), NodeRuntime.runMain);
//#endregion
export {};
