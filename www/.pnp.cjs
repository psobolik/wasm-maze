#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["copy-webpack-plugin", new Map([
    ["11.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-copy-webpack-plugin-11.0.0-96d4dbdb5f73d02dd72d0528d1958721ab72e04a-integrity/node_modules/copy-webpack-plugin/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["fast-glob", "3.3.1"],
        ["glob-parent", "6.0.2"],
        ["globby", "13.2.2"],
        ["normalize-path", "3.0.0"],
        ["schema-utils", "4.2.0"],
        ["serialize-javascript", "6.0.1"],
        ["copy-webpack-plugin", "11.0.0"],
      ]),
    }],
  ])],
  ["fast-glob", new Map([
    ["3.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-glob-3.3.1-784b4e897340f3dbbef17413b3f11acf03c874c4-integrity/node_modules/fast-glob/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
        ["@nodelib/fs.walk", "1.2.8"],
        ["glob-parent", "5.1.2"],
        ["merge2", "1.4.1"],
        ["micromatch", "4.0.5"],
        ["fast-glob", "3.3.1"],
      ]),
    }],
  ])],
  ["@nodelib/fs.stat", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-stat-2.0.5-5bd262af94e9d25bd1e71b05deed44876a222e8b-integrity/node_modules/@nodelib/fs.stat/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
      ]),
    }],
  ])],
  ["@nodelib/fs.walk", new Map([
    ["1.2.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-walk-1.2.8-e95737e8bb6746ddedf69c556953494f196fe69a-integrity/node_modules/@nodelib/fs.walk/"),
      packageDependencies: new Map([
        ["@nodelib/fs.scandir", "2.1.5"],
        ["fastq", "1.15.0"],
        ["@nodelib/fs.walk", "1.2.8"],
      ]),
    }],
  ])],
  ["@nodelib/fs.scandir", new Map([
    ["2.1.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-scandir-2.1.5-7619c2eb21b25483f6d167548b4cfd5a7488c3d5-integrity/node_modules/@nodelib/fs.scandir/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
        ["run-parallel", "1.2.0"],
        ["@nodelib/fs.scandir", "2.1.5"],
      ]),
    }],
  ])],
  ["run-parallel", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-run-parallel-1.2.0-66d1368da7bdf921eb9d95bd1a9229e7f21a43ee-integrity/node_modules/run-parallel/"),
      packageDependencies: new Map([
        ["queue-microtask", "1.2.3"],
        ["run-parallel", "1.2.0"],
      ]),
    }],
  ])],
  ["queue-microtask", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-queue-microtask-1.2.3-4929228bbc724dfac43e0efb058caf7b6cfb6243-integrity/node_modules/queue-microtask/"),
      packageDependencies: new Map([
        ["queue-microtask", "1.2.3"],
      ]),
    }],
  ])],
  ["fastq", new Map([
    ["1.15.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fastq-1.15.0-d04d07c6a2a68fe4599fea8d2e103a937fae6b3a-integrity/node_modules/fastq/"),
      packageDependencies: new Map([
        ["reusify", "1.0.4"],
        ["fastq", "1.15.0"],
      ]),
    }],
  ])],
  ["reusify", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-reusify-1.0.4-90da382b1e126efc02146e90845a88db12925d76-integrity/node_modules/reusify/"),
      packageDependencies: new Map([
        ["reusify", "1.0.4"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.2-869832c58034fe68a4093c17dc15e8340d8401c4-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.3"],
        ["glob-parent", "5.1.2"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-6.0.2-6d237d99083950c79290f24c7642a3de9a28f9e3-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.3"],
        ["glob-parent", "6.0.2"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.3-64f61e42cbbb2eec2071a9dac0b28ba1e65d5084-integrity/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.3"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["merge2", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-merge2-1.4.1-4368892f885e907455a6fd7dc55c0c9d404990ae-integrity/node_modules/merge2/"),
      packageDependencies: new Map([
        ["merge2", "1.4.1"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["4.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.5-bc8999a7cbbf77cdc89f132f6e467051b49090c6-integrity/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["braces", "3.0.2"],
        ["picomatch", "2.3.1"],
        ["micromatch", "4.0.5"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/"),
      packageDependencies: new Map([
        ["fill-range", "7.0.1"],
        ["braces", "3.0.2"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["to-regex-range", "5.0.1"],
        ["fill-range", "7.0.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
        ["to-regex-range", "5.0.1"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
      ]),
    }],
  ])],
  ["picomatch", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-picomatch-2.3.1-3ba3833733646d9d3e4995946c1365a67fb07a42-integrity/node_modules/picomatch/"),
      packageDependencies: new Map([
        ["picomatch", "2.3.1"],
      ]),
    }],
  ])],
  ["globby", new Map([
    ["13.2.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-globby-13.2.2-63b90b1bf68619c2135475cbd4e71e66aa090592-integrity/node_modules/globby/"),
      packageDependencies: new Map([
        ["dir-glob", "3.0.1"],
        ["fast-glob", "3.3.1"],
        ["ignore", "5.2.4"],
        ["merge2", "1.4.1"],
        ["slash", "4.0.0"],
        ["globby", "13.2.2"],
      ]),
    }],
  ])],
  ["dir-glob", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-dir-glob-3.0.1-56dbf73d992a4a93ba1584f4534063fd2e41717f-integrity/node_modules/dir-glob/"),
      packageDependencies: new Map([
        ["path-type", "4.0.0"],
        ["dir-glob", "3.0.1"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-type-4.0.0-84ed01c0a7ba380afe09d90a8c180dcd9d03043b-integrity/node_modules/path-type/"),
      packageDependencies: new Map([
        ["path-type", "4.0.0"],
      ]),
    }],
  ])],
  ["ignore", new Map([
    ["5.2.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ignore-5.2.4-a291c0c6178ff1b960befe47fcdec301674a6324-integrity/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "5.2.4"],
      ]),
    }],
  ])],
  ["slash", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-slash-4.0.0-2422372176c4c6c5addb5e2ada885af984b396a7-integrity/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "4.0.0"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
      ]),
    }],
  ])],
  ["schema-utils", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-schema-utils-4.2.0-70d7c93e153a273a805801882ebd3bff20d89c8b-integrity/node_modules/schema-utils/"),
      packageDependencies: new Map([
        ["@types/json-schema", "7.0.14"],
        ["ajv", "8.12.0"],
        ["ajv-formats", "2.1.1"],
        ["ajv-keywords", "5.1.0"],
        ["schema-utils", "4.2.0"],
      ]),
    }],
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-schema-utils-3.3.0-f50a88877c3c01652a15b622ae9e9795df7a60fe-integrity/node_modules/schema-utils/"),
      packageDependencies: new Map([
        ["@types/json-schema", "7.0.14"],
        ["ajv", "6.12.6"],
        ["ajv-keywords", "3.5.2"],
        ["schema-utils", "3.3.0"],
      ]),
    }],
  ])],
  ["@types/json-schema", new Map([
    ["7.0.14", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-json-schema-7.0.14-74a97a5573980802f32c8e47b663530ab3b6b7d1-integrity/node_modules/@types/json-schema/"),
      packageDependencies: new Map([
        ["@types/json-schema", "7.0.14"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["8.12.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-8.12.0-d1a0527323e22f53562c567c00991577dfbe19d1-integrity/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
        ["json-schema-traverse", "1.0.0"],
        ["require-from-string", "2.0.2"],
        ["uri-js", "4.4.1"],
        ["ajv", "8.12.0"],
      ]),
    }],
    ["6.12.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4-integrity/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
        ["fast-json-stable-stringify", "2.1.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.4.1"],
        ["ajv", "6.12.6"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525-integrity/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-1.0.0-ae7bcb3656ab77a73ba5c49bf654f38e6b6860e2-integrity/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "1.0.0"],
      ]),
    }],
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["require-from-string", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-require-from-string-2.0.2-89a7fdd938261267318eafe14f9c32e598c36909-integrity/node_modules/require-from-string/"),
      packageDependencies: new Map([
        ["require-from-string", "2.0.2"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-uri-js-4.4.1-9b1a52595225859e55f669d928f88c6c57f2a77e-integrity/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.3.1"],
        ["uri-js", "4.4.1"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-punycode-2.3.1-027422e2faec0b25e1549c3e1bd8309b9133b6e5-integrity/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.3.1"],
      ]),
    }],
  ])],
  ["ajv-formats", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-formats-2.1.1-6e669400659eb74973bbf2e33327180a0996b520-integrity/node_modules/ajv-formats/"),
      packageDependencies: new Map([
        ["ajv", "8.12.0"],
        ["ajv-formats", "2.1.1"],
      ]),
    }],
  ])],
  ["ajv-keywords", new Map([
    ["5.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-5.1.0-69d4d385a4733cdbeab44964a1170a88f87f0e16-integrity/node_modules/ajv-keywords/"),
      packageDependencies: new Map([
        ["ajv", "8.12.0"],
        ["fast-deep-equal", "3.1.3"],
        ["ajv-keywords", "5.1.0"],
      ]),
    }],
    ["3.5.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-3.5.2-31f29da5ab6e00d1c2d329acf7b5929614d5014d-integrity/node_modules/ajv-keywords/"),
      packageDependencies: new Map([
        ["ajv", "6.12.6"],
        ["ajv-keywords", "3.5.2"],
      ]),
    }],
  ])],
  ["serialize-javascript", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.1-b206efb27c3da0b0ab6b52f48d170b7996458e5c-integrity/node_modules/serialize-javascript/"),
      packageDependencies: new Map([
        ["randombytes", "2.1.0"],
        ["serialize-javascript", "6.0.1"],
      ]),
    }],
  ])],
  ["randombytes", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a-integrity/node_modules/randombytes/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
        ["randombytes", "2.1.0"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
      ]),
    }],
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["webpack", new Map([
    ["5.89.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-5.89.0-56b8bf9a34356e93a6625770006490bf3a7f32dc-integrity/node_modules/webpack/"),
      packageDependencies: new Map([
        ["@types/eslint-scope", "3.7.6"],
        ["@types/estree", "1.0.4"],
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/wasm-edit", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["acorn", "8.11.2"],
        ["acorn-import-assertions", "1.9.0"],
        ["browserslist", "4.22.1"],
        ["chrome-trace-event", "1.0.3"],
        ["enhanced-resolve", "5.15.0"],
        ["es-module-lexer", "1.3.1"],
        ["eslint-scope", "5.1.1"],
        ["events", "3.3.0"],
        ["glob-to-regexp", "0.4.1"],
        ["graceful-fs", "4.2.11"],
        ["json-parse-even-better-errors", "2.3.1"],
        ["loader-runner", "4.3.0"],
        ["mime-types", "2.1.35"],
        ["neo-async", "2.6.2"],
        ["schema-utils", "3.3.0"],
        ["tapable", "2.2.1"],
        ["terser-webpack-plugin", "5.3.9"],
        ["watchpack", "2.4.0"],
        ["webpack-sources", "3.2.3"],
        ["webpack", "5.89.0"],
      ]),
    }],
  ])],
  ["@types/eslint-scope", new Map([
    ["3.7.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-eslint-scope-3.7.6-585578b368ed170e67de8aae7b93f54a1b2fdc26-integrity/node_modules/@types/eslint-scope/"),
      packageDependencies: new Map([
        ["@types/eslint", "8.44.6"],
        ["@types/estree", "1.0.4"],
        ["@types/eslint-scope", "3.7.6"],
      ]),
    }],
  ])],
  ["@types/eslint", new Map([
    ["8.44.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-eslint-8.44.6-60e564551966dd255f4c01c459f0b4fb87068603-integrity/node_modules/@types/eslint/"),
      packageDependencies: new Map([
        ["@types/estree", "1.0.4"],
        ["@types/json-schema", "7.0.14"],
        ["@types/eslint", "8.44.6"],
      ]),
    }],
  ])],
  ["@types/estree", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-1.0.4-d9748f5742171b26218516cf1828b8eafaf8a9fa-integrity/node_modules/@types/estree/"),
      packageDependencies: new Map([
        ["@types/estree", "1.0.4"],
      ]),
    }],
  ])],
  ["@webassemblyjs/ast", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ast-1.11.6-db046555d3c413f8966ca50a95176a0e2c642e24-integrity/node_modules/@webassemblyjs/ast/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-numbers", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ast", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-numbers", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-numbers-1.11.6-cbce5e7e0c1bd32cf4905ae444ef64cea919f1b5-integrity/node_modules/@webassemblyjs/helper-numbers/"),
      packageDependencies: new Map([
        ["@webassemblyjs/floating-point-hex-parser", "1.11.6"],
        ["@webassemblyjs/helper-api-error", "1.11.6"],
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/helper-numbers", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/floating-point-hex-parser", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-floating-point-hex-parser-1.11.6-dacbcb95aff135c8260f77fa3b4c5fea600a6431-integrity/node_modules/@webassemblyjs/floating-point-hex-parser/"),
      packageDependencies: new Map([
        ["@webassemblyjs/floating-point-hex-parser", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-api-error", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-api-error-1.11.6-6132f68c4acd59dcd141c44b18cbebbd9f2fa768-integrity/node_modules/@webassemblyjs/helper-api-error/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-api-error", "1.11.6"],
      ]),
    }],
  ])],
  ["@xtuc/long", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@xtuc-long-4.2.2-d291c6a4e97989b5c61d9acf396ae4fe133a718d-integrity/node_modules/@xtuc/long/"),
      packageDependencies: new Map([
        ["@xtuc/long", "4.2.2"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-wasm-bytecode", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-bytecode-1.11.6-bb2ebdb3b83aa26d9baad4c46d4315283acd51e9-integrity/node_modules/@webassemblyjs/helper-wasm-bytecode/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-edit", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-edit-1.11.6-c72fa8220524c9b416249f3d94c2958dfe70ceab-integrity/node_modules/@webassemblyjs/wasm-edit/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/helper-wasm-section", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/wasm-opt", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["@webassemblyjs/wast-printer", "1.11.6"],
        ["@webassemblyjs/wasm-edit", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-buffer", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-buffer-1.11.6-b66d73c43e296fd5e88006f18524feb0f2c7c093-integrity/node_modules/@webassemblyjs/helper-buffer/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-buffer", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-wasm-section", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-section-1.11.6-ff97f3863c55ee7f580fd5c41a381e9def4aa577-integrity/node_modules/@webassemblyjs/helper-wasm-section/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/helper-wasm-section", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-gen", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-gen-1.11.6-fb5283e0e8b4551cc4e9c3c0d7184a65faf7c268-integrity/node_modules/@webassemblyjs/wasm-gen/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ieee754", "1.11.6"],
        ["@webassemblyjs/leb128", "1.11.6"],
        ["@webassemblyjs/utf8", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/ieee754", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ieee754-1.11.6-bb665c91d0b14fffceb0e38298c329af043c6e3a-integrity/node_modules/@webassemblyjs/ieee754/"),
      packageDependencies: new Map([
        ["@xtuc/ieee754", "1.2.0"],
        ["@webassemblyjs/ieee754", "1.11.6"],
      ]),
    }],
  ])],
  ["@xtuc/ieee754", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@xtuc-ieee754-1.2.0-eef014a3145ae477a1cbc00cd1e552336dceb790-integrity/node_modules/@xtuc/ieee754/"),
      packageDependencies: new Map([
        ["@xtuc/ieee754", "1.2.0"],
      ]),
    }],
  ])],
  ["@webassemblyjs/leb128", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-leb128-1.11.6-70e60e5e82f9ac81118bc25381a0b283893240d7-integrity/node_modules/@webassemblyjs/leb128/"),
      packageDependencies: new Map([
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/leb128", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/utf8", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-utf8-1.11.6-90f8bc34c561595fe156603be7253cdbcd0fab5a-integrity/node_modules/@webassemblyjs/utf8/"),
      packageDependencies: new Map([
        ["@webassemblyjs/utf8", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-opt", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-opt-1.11.6-d9a22d651248422ca498b09aa3232a81041487c2-integrity/node_modules/@webassemblyjs/wasm-opt/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["@webassemblyjs/wasm-opt", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-parser", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-parser-1.11.6-bb85378c527df824004812bbdb784eea539174a1-integrity/node_modules/@webassemblyjs/wasm-parser/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-api-error", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ieee754", "1.11.6"],
        ["@webassemblyjs/leb128", "1.11.6"],
        ["@webassemblyjs/utf8", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wast-printer", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wast-printer-1.11.6-a7bf8dd7e362aeb1668ff43f35cb849f188eff20-integrity/node_modules/@webassemblyjs/wast-printer/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/wast-printer", "1.11.6"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["8.11.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-8.11.2-ca0d78b51895be5390a5903c5b3bdcdaf78ae40b-integrity/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "8.11.2"],
      ]),
    }],
  ])],
  ["acorn-import-assertions", new Map([
    ["1.9.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-import-assertions-1.9.0-507276249d684797c84e0734ef84860334cfb1ac-integrity/node_modules/acorn-import-assertions/"),
      packageDependencies: new Map([
        ["acorn", "8.11.2"],
        ["acorn-import-assertions", "1.9.0"],
      ]),
    }],
  ])],
  ["browserslist", new Map([
    ["4.22.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-browserslist-4.22.1-ba91958d1a59b87dab6fed8dfbcb3da5e2e9c619-integrity/node_modules/browserslist/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30001561"],
        ["electron-to-chromium", "1.4.576"],
        ["node-releases", "2.0.13"],
        ["update-browserslist-db", "1.0.13"],
        ["browserslist", "4.22.1"],
      ]),
    }],
  ])],
  ["caniuse-lite", new Map([
    ["1.0.30001561", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-caniuse-lite-1.0.30001561-752f21f56f96f1b1a52e97aae98c57c562d5d9da-integrity/node_modules/caniuse-lite/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30001561"],
      ]),
    }],
  ])],
  ["electron-to-chromium", new Map([
    ["1.4.576", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-electron-to-chromium-1.4.576-0c6940fdc0d60f7e34bd742b29d8fa847c9294d1-integrity/node_modules/electron-to-chromium/"),
      packageDependencies: new Map([
        ["electron-to-chromium", "1.4.576"],
      ]),
    }],
  ])],
  ["node-releases", new Map([
    ["2.0.13", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-node-releases-2.0.13-d5ed1627c23e3461e819b02e57b75e4899b1c81d-integrity/node_modules/node-releases/"),
      packageDependencies: new Map([
        ["node-releases", "2.0.13"],
      ]),
    }],
  ])],
  ["update-browserslist-db", new Map([
    ["1.0.13", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-update-browserslist-db-1.0.13-3c5e4f5c083661bd38ef64b6328c26ed6c8248c4-integrity/node_modules/update-browserslist-db/"),
      packageDependencies: new Map([
        ["escalade", "3.1.1"],
        ["picocolors", "1.0.0"],
        ["update-browserslist-db", "1.0.13"],
      ]),
    }],
  ])],
  ["escalade", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-escalade-3.1.1-d8cfdc7000965c5a0174b4a82eaa5c0552742e40-integrity/node_modules/escalade/"),
      packageDependencies: new Map([
        ["escalade", "3.1.1"],
      ]),
    }],
  ])],
  ["picocolors", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-picocolors-1.0.0-cb5bdc74ff3f51892236eaf79d68bc44564ab81c-integrity/node_modules/picocolors/"),
      packageDependencies: new Map([
        ["picocolors", "1.0.0"],
      ]),
    }],
  ])],
  ["chrome-trace-event", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-chrome-trace-event-1.0.3-1015eced4741e15d06664a957dbbf50d041e26ac-integrity/node_modules/chrome-trace-event/"),
      packageDependencies: new Map([
        ["chrome-trace-event", "1.0.3"],
      ]),
    }],
  ])],
  ["enhanced-resolve", new Map([
    ["5.15.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-enhanced-resolve-5.15.0-1af946c7d93603eb88e9896cee4904dc012e9c35-integrity/node_modules/enhanced-resolve/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.11"],
        ["tapable", "2.2.1"],
        ["enhanced-resolve", "5.15.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.11", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-graceful-fs-4.2.11-4183e4e8bf08bb6e05bbb2f7d2e0c8f712ca40e3-integrity/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.11"],
      ]),
    }],
  ])],
  ["tapable", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-tapable-2.2.1-1967a73ef4060a82f12ab96af86d52fdb76eeca0-integrity/node_modules/tapable/"),
      packageDependencies: new Map([
        ["tapable", "2.2.1"],
      ]),
    }],
  ])],
  ["es-module-lexer", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-es-module-lexer-1.3.1-c1b0dd5ada807a3b3155315911f364dc4e909db1-integrity/node_modules/es-module-lexer/"),
      packageDependencies: new Map([
        ["es-module-lexer", "1.3.1"],
      ]),
    }],
  ])],
  ["eslint-scope", new Map([
    ["5.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-eslint-scope-5.1.1-e786e59a66cb92b3f6c1fb0d508aab174848f48c-integrity/node_modules/eslint-scope/"),
      packageDependencies: new Map([
        ["esrecurse", "4.3.0"],
        ["estraverse", "4.3.0"],
        ["eslint-scope", "5.1.1"],
      ]),
    }],
  ])],
  ["esrecurse", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-esrecurse-4.3.0-7ad7964d679abb28bee72cec63758b1c5d2c9921-integrity/node_modules/esrecurse/"),
      packageDependencies: new Map([
        ["estraverse", "5.3.0"],
        ["esrecurse", "4.3.0"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-estraverse-5.3.0-2eea5290702f26ab8fe5370370ff86c965d21123-integrity/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "5.3.0"],
      ]),
    }],
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
      ]),
    }],
  ])],
  ["events", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-events-3.3.0-31a95ad0a924e2d2c419a813aeb2c4e878ea7400-integrity/node_modules/events/"),
      packageDependencies: new Map([
        ["events", "3.3.0"],
      ]),
    }],
  ])],
  ["glob-to-regexp", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-to-regexp-0.4.1-c75297087c851b9a578bd217dd59a92f59fe546e-integrity/node_modules/glob-to-regexp/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.4.1"],
      ]),
    }],
  ])],
  ["json-parse-even-better-errors", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d-integrity/node_modules/json-parse-even-better-errors/"),
      packageDependencies: new Map([
        ["json-parse-even-better-errors", "2.3.1"],
      ]),
    }],
  ])],
  ["loader-runner", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-loader-runner-4.3.0-c1b4a163b99f614830353b16755e7149ac2314e1-integrity/node_modules/loader-runner/"),
      packageDependencies: new Map([
        ["loader-runner", "4.3.0"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.35", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-types-2.1.35-381a871b62a734450660ae3deee44813f70d959a-integrity/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.52.0"],
        ["mime-types", "2.1.35"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.52.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-db-1.52.0-bbabcdc02859f4987301c856e3387ce5ec43bf70-integrity/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.52.0"],
      ]),
    }],
  ])],
  ["neo-async", new Map([
    ["2.6.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-neo-async-2.6.2-b4aafb93e3aeb2d8174ca53cf163ab7d7308305f-integrity/node_modules/neo-async/"),
      packageDependencies: new Map([
        ["neo-async", "2.6.2"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.1.0"],
      ]),
    }],
  ])],
  ["terser-webpack-plugin", new Map([
    ["5.3.9", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-terser-webpack-plugin-5.3.9-832536999c51b46d468067f9e37662a3b96adfe1-integrity/node_modules/terser-webpack-plugin/"),
      packageDependencies: new Map([
        ["@jridgewell/trace-mapping", "0.3.20"],
        ["jest-worker", "27.5.1"],
        ["schema-utils", "3.3.0"],
        ["serialize-javascript", "6.0.1"],
        ["terser", "5.24.0"],
        ["terser-webpack-plugin", "5.3.9"],
      ]),
    }],
  ])],
  ["@jridgewell/trace-mapping", new Map([
    ["0.3.20", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-trace-mapping-0.3.20-72e45707cf240fa6b081d0366f8265b0cd10197f-integrity/node_modules/@jridgewell/trace-mapping/"),
      packageDependencies: new Map([
        ["@jridgewell/resolve-uri", "3.1.1"],
        ["@jridgewell/sourcemap-codec", "1.4.15"],
        ["@jridgewell/trace-mapping", "0.3.20"],
      ]),
    }],
  ])],
  ["@jridgewell/resolve-uri", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-resolve-uri-3.1.1-c08679063f279615a3326583ba3a90d1d82cc721-integrity/node_modules/@jridgewell/resolve-uri/"),
      packageDependencies: new Map([
        ["@jridgewell/resolve-uri", "3.1.1"],
      ]),
    }],
  ])],
  ["@jridgewell/sourcemap-codec", new Map([
    ["1.4.15", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-sourcemap-codec-1.4.15-d7c6e6755c78567a951e04ab52ef0fd26de59f32-integrity/node_modules/@jridgewell/sourcemap-codec/"),
      packageDependencies: new Map([
        ["@jridgewell/sourcemap-codec", "1.4.15"],
      ]),
    }],
  ])],
  ["jest-worker", new Map([
    ["27.5.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-jest-worker-27.5.1-8d146f0900e8973b106b6f73cc1e9a8cb86f8db0-integrity/node_modules/jest-worker/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["merge-stream", "2.0.0"],
        ["supports-color", "8.1.1"],
        ["jest-worker", "27.5.1"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["20.8.10", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-20.8.10-a5448b895c753ae929c26ce85cab557c6d4a365e-integrity/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["undici-types", "5.26.5"],
        ["@types/node", "20.8.10"],
      ]),
    }],
  ])],
  ["undici-types", new Map([
    ["5.26.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-undici-types-5.26.5-bcd539893d00b56e964fd2657a4866b221a65617-integrity/node_modules/undici-types/"),
      packageDependencies: new Map([
        ["undici-types", "5.26.5"],
      ]),
    }],
  ])],
  ["merge-stream", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/"),
      packageDependencies: new Map([
        ["merge-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["8.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-8.1.1-cd6fc17e28500cff56c1b86c0a7fd4a54a73005c-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
        ["supports-color", "8.1.1"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b-integrity/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
      ]),
    }],
  ])],
  ["terser", new Map([
    ["5.24.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-terser-5.24.0-4ae50302977bca4831ccc7b4fef63a3c04228364-integrity/node_modules/terser/"),
      packageDependencies: new Map([
        ["@jridgewell/source-map", "0.3.5"],
        ["acorn", "8.11.2"],
        ["commander", "2.20.3"],
        ["source-map-support", "0.5.21"],
        ["terser", "5.24.0"],
      ]),
    }],
  ])],
  ["@jridgewell/source-map", new Map([
    ["0.3.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-source-map-0.3.5-a3bb4d5c6825aab0d281268f47f6ad5853431e91-integrity/node_modules/@jridgewell/source-map/"),
      packageDependencies: new Map([
        ["@jridgewell/gen-mapping", "0.3.3"],
        ["@jridgewell/trace-mapping", "0.3.20"],
        ["@jridgewell/source-map", "0.3.5"],
      ]),
    }],
  ])],
  ["@jridgewell/gen-mapping", new Map([
    ["0.3.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-gen-mapping-0.3.3-7e02e6eb5df901aaedb08514203b096614024098-integrity/node_modules/@jridgewell/gen-mapping/"),
      packageDependencies: new Map([
        ["@jridgewell/set-array", "1.1.2"],
        ["@jridgewell/sourcemap-codec", "1.4.15"],
        ["@jridgewell/trace-mapping", "0.3.20"],
        ["@jridgewell/gen-mapping", "0.3.3"],
      ]),
    }],
  ])],
  ["@jridgewell/set-array", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-set-array-1.1.2-7c6cf998d6d20b914c0a55a91ae928ff25965e72-integrity/node_modules/@jridgewell/set-array/"),
      packageDependencies: new Map([
        ["@jridgewell/set-array", "1.1.2"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.3"],
      ]),
    }],
    ["10.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-commander-10.0.1-881ee46b4f77d1c1dccc5823433aa39b022cbe06-integrity/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "10.0.1"],
      ]),
    }],
  ])],
  ["source-map-support", new Map([
    ["0.5.21", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.21-04fe7c7f9e1ed2d662233c28cb2b35b9f63f6e4f-integrity/node_modules/source-map-support/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.2"],
        ["source-map", "0.6.1"],
        ["source-map-support", "0.5.21"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.2-2b146a6fd72e80b4f55d255f35ed59a3a9a41bd5-integrity/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.2"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
  ])],
  ["watchpack", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-watchpack-2.4.0-fa33032374962c78113f93c7f2fb4c54c9862a5d-integrity/node_modules/watchpack/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.4.1"],
        ["graceful-fs", "4.2.11"],
        ["watchpack", "2.4.0"],
      ]),
    }],
  ])],
  ["webpack-sources", new Map([
    ["3.2.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-sources-3.2.3-2d4daab8451fd4b240cc27055ff6a0c2ccea0cde-integrity/node_modules/webpack-sources/"),
      packageDependencies: new Map([
        ["webpack-sources", "3.2.3"],
      ]),
    }],
  ])],
  ["webpack-cli", new Map([
    ["5.1.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-cli-5.1.4-c8e046ba7eaae4911d7e71e2b25b776fcc35759b-integrity/node_modules/webpack-cli/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@discoveryjs/json-ext", "0.5.7"],
        ["@webpack-cli/configtest", "2.1.1"],
        ["@webpack-cli/info", "2.0.2"],
        ["@webpack-cli/serve", "2.0.5"],
        ["colorette", "2.0.20"],
        ["commander", "10.0.1"],
        ["cross-spawn", "7.0.3"],
        ["envinfo", "7.11.0"],
        ["fastest-levenshtein", "1.0.16"],
        ["import-local", "3.1.0"],
        ["interpret", "3.1.1"],
        ["rechoir", "0.8.0"],
        ["webpack-merge", "5.10.0"],
        ["webpack-cli", "5.1.4"],
      ]),
    }],
  ])],
  ["@discoveryjs/json-ext", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@discoveryjs-json-ext-0.5.7-1d572bfbbe14b7704e0ba0f39b74815b84870d70-integrity/node_modules/@discoveryjs/json-ext/"),
      packageDependencies: new Map([
        ["@discoveryjs/json-ext", "0.5.7"],
      ]),
    }],
  ])],
  ["@webpack-cli/configtest", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-configtest-2.1.1-3b2f852e91dac6e3b85fb2a314fb8bef46d94646-integrity/node_modules/@webpack-cli/configtest/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/configtest", "2.1.1"],
      ]),
    }],
  ])],
  ["@webpack-cli/info", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-info-2.0.2-cc3fbf22efeb88ff62310cf885c5b09f44ae0fdd-integrity/node_modules/@webpack-cli/info/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/info", "2.0.2"],
      ]),
    }],
  ])],
  ["@webpack-cli/serve", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-serve-2.0.5-325db42395cd49fe6c14057f9a900e427df8810e-integrity/node_modules/@webpack-cli/serve/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/serve", "2.0.5"],
      ]),
    }],
  ])],
  ["colorette", new Map([
    ["2.0.20", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-colorette-2.0.20-9eb793e6833067f7235902fcd3b09917a000a95a-integrity/node_modules/colorette/"),
      packageDependencies: new Map([
        ["colorette", "2.0.20"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6-integrity/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
        ["shebang-command", "2.0.0"],
        ["which", "2.0.2"],
        ["cross-spawn", "7.0.3"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375-integrity/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea-integrity/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
        ["shebang-command", "2.0.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172-integrity/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1-integrity/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "2.0.2"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["envinfo", new Map([
    ["7.11.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-envinfo-7.11.0-c3793f44284a55ff8c82faf1ffd91bc6478ea01f-integrity/node_modules/envinfo/"),
      packageDependencies: new Map([
        ["envinfo", "7.11.0"],
      ]),
    }],
  ])],
  ["fastest-levenshtein", new Map([
    ["1.0.16", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fastest-levenshtein-1.0.16-210e61b6ff181de91ea9b3d1b84fdedd47e034e5-integrity/node_modules/fastest-levenshtein/"),
      packageDependencies: new Map([
        ["fastest-levenshtein", "1.0.16"],
      ]),
    }],
  ])],
  ["import-local", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-import-local-3.1.0-b4479df8a5fd44f6cdce24070675676063c95cb4-integrity/node_modules/import-local/"),
      packageDependencies: new Map([
        ["pkg-dir", "4.2.0"],
        ["resolve-cwd", "3.0.0"],
        ["import-local", "3.1.0"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3-integrity/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["pkg-dir", "4.2.0"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19-integrity/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "5.0.0"],
        ["path-exists", "4.0.0"],
        ["find-up", "4.1.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0-integrity/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "4.1.0"],
        ["locate-path", "5.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07-integrity/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "2.3.0"],
        ["p-locate", "4.1.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1-integrity/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
        ["p-limit", "2.3.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6-integrity/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3-integrity/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "4.0.0"],
      ]),
    }],
  ])],
  ["resolve-cwd", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d-integrity/node_modules/resolve-cwd/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
        ["resolve-cwd", "3.0.0"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69-integrity/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
      ]),
    }],
  ])],
  ["interpret", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-interpret-3.1.1-5be0ceed67ca79c6c4bc5cf0d7ee843dcea110c4-integrity/node_modules/interpret/"),
      packageDependencies: new Map([
        ["interpret", "3.1.1"],
      ]),
    }],
  ])],
  ["rechoir", new Map([
    ["0.8.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-rechoir-0.8.0-49f866e0d32146142da3ad8f0eff352b3215ff22-integrity/node_modules/rechoir/"),
      packageDependencies: new Map([
        ["resolve", "1.22.8"],
        ["rechoir", "0.8.0"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.22.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-1.22.8-b6c87a9f2aa06dfab52e3d70ac8cde321fa5a48d-integrity/node_modules/resolve/"),
      packageDependencies: new Map([
        ["is-core-module", "2.13.1"],
        ["path-parse", "1.0.7"],
        ["supports-preserve-symlinks-flag", "1.0.0"],
        ["resolve", "1.22.8"],
      ]),
    }],
  ])],
  ["is-core-module", new Map([
    ["2.13.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-core-module-2.13.1-ad0d7532c6fea9da1ebdc82742d74525c6273384-integrity/node_modules/is-core-module/"),
      packageDependencies: new Map([
        ["hasown", "2.0.0"],
        ["is-core-module", "2.13.1"],
      ]),
    }],
  ])],
  ["hasown", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-hasown-2.0.0-f4c513d454a57b7c7e1650778de226b11700546c-integrity/node_modules/hasown/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
        ["hasown", "2.0.0"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-function-bind-1.1.2-2c02d864d97f3ea6c8830c464cbd11ab6eab7a1c-integrity/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.7-fbc114b60ca42b30d9daf5858e4bd68bbedb6735-integrity/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.7"],
      ]),
    }],
  ])],
  ["supports-preserve-symlinks-flag", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-supports-preserve-symlinks-flag-1.0.0-6eda4bd344a3c94aea376d4cc31bc77311039e09-integrity/node_modules/supports-preserve-symlinks-flag/"),
      packageDependencies: new Map([
        ["supports-preserve-symlinks-flag", "1.0.0"],
      ]),
    }],
  ])],
  ["webpack-merge", new Map([
    ["5.10.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-merge-5.10.0-a3ad5d773241e9c682803abf628d4cd62b8a4177-integrity/node_modules/webpack-merge/"),
      packageDependencies: new Map([
        ["clone-deep", "4.0.1"],
        ["flat", "5.0.2"],
        ["wildcard", "2.0.1"],
        ["webpack-merge", "5.10.0"],
      ]),
    }],
  ])],
  ["clone-deep", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-clone-deep-4.0.1-c19fd9bdbbf85942b4fd979c84dcf7d5f07c2387-integrity/node_modules/clone-deep/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["kind-of", "6.0.3"],
        ["shallow-clone", "3.0.1"],
        ["clone-deep", "4.0.1"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677-integrity/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df-integrity/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["6.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd-integrity/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
      ]),
    }],
  ])],
  ["shallow-clone", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-shallow-clone-3.0.1-8f2981ad92531f55035b01fb230769a40e02efa3-integrity/node_modules/shallow-clone/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
        ["shallow-clone", "3.0.1"],
      ]),
    }],
  ])],
  ["flat", new Map([
    ["5.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-flat-5.0.2-8ca6fe332069ffa9d324c327198c598259ceb241-integrity/node_modules/flat/"),
      packageDependencies: new Map([
        ["flat", "5.0.2"],
      ]),
    }],
  ])],
  ["wildcard", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-wildcard-2.0.1-5ab10d02487198954836b6349f74fff961e10f67-integrity/node_modules/wildcard/"),
      packageDependencies: new Map([
        ["wildcard", "2.0.1"],
      ]),
    }],
  ])],
  ["webpack-dev-server", new Map([
    ["4.15.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-dev-server-4.15.1-8944b29c12760b3a45bdaa70799b17cb91b03df7-integrity/node_modules/webpack-dev-server/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@types/bonjour", "3.5.12"],
        ["@types/connect-history-api-fallback", "1.5.2"],
        ["@types/express", "4.17.20"],
        ["@types/serve-index", "1.9.3"],
        ["@types/serve-static", "1.15.4"],
        ["@types/sockjs", "0.3.35"],
        ["@types/ws", "8.5.8"],
        ["ansi-html-community", "0.0.8"],
        ["bonjour-service", "1.1.1"],
        ["chokidar", "3.5.3"],
        ["colorette", "2.0.20"],
        ["compression", "1.7.4"],
        ["connect-history-api-fallback", "2.0.0"],
        ["default-gateway", "6.0.3"],
        ["express", "4.18.2"],
        ["graceful-fs", "4.2.11"],
        ["html-entities", "2.4.0"],
        ["http-proxy-middleware", "2.0.6"],
        ["ipaddr.js", "2.1.0"],
        ["launch-editor", "2.6.1"],
        ["open", "8.4.2"],
        ["p-retry", "4.6.2"],
        ["rimraf", "3.0.2"],
        ["schema-utils", "4.2.0"],
        ["selfsigned", "2.4.1"],
        ["serve-index", "1.9.1"],
        ["sockjs", "0.3.24"],
        ["spdy", "4.0.2"],
        ["webpack-dev-middleware", "5.3.3"],
        ["ws", "8.14.2"],
        ["webpack-dev-server", "4.15.1"],
      ]),
    }],
  ])],
  ["@types/bonjour", new Map([
    ["3.5.12", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-bonjour-3.5.12-49badafb988e6c433ca675a5fd769b93b7649fc8-integrity/node_modules/@types/bonjour/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/bonjour", "3.5.12"],
      ]),
    }],
  ])],
  ["@types/connect-history-api-fallback", new Map([
    ["1.5.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-connect-history-api-fallback-1.5.2-acf51e088b3bb6507f7b093bd2b0de20940179cc-integrity/node_modules/@types/connect-history-api-fallback/"),
      packageDependencies: new Map([
        ["@types/express-serve-static-core", "4.17.39"],
        ["@types/node", "20.8.10"],
        ["@types/connect-history-api-fallback", "1.5.2"],
      ]),
    }],
  ])],
  ["@types/express-serve-static-core", new Map([
    ["4.17.39", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-express-serve-static-core-4.17.39-2107afc0a4b035e6cb00accac3bdf2d76ae408c8-integrity/node_modules/@types/express-serve-static-core/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/qs", "6.9.9"],
        ["@types/range-parser", "1.2.6"],
        ["@types/send", "0.17.3"],
        ["@types/express-serve-static-core", "4.17.39"],
      ]),
    }],
  ])],
  ["@types/qs", new Map([
    ["6.9.9", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-qs-6.9.9-66f7b26288f6799d279edf13da7ccd40d2fa9197-integrity/node_modules/@types/qs/"),
      packageDependencies: new Map([
        ["@types/qs", "6.9.9"],
      ]),
    }],
  ])],
  ["@types/range-parser", new Map([
    ["1.2.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-range-parser-1.2.6-7cb33992049fd7340d5b10c0098e104184dfcd2a-integrity/node_modules/@types/range-parser/"),
      packageDependencies: new Map([
        ["@types/range-parser", "1.2.6"],
      ]),
    }],
  ])],
  ["@types/send", new Map([
    ["0.17.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-send-0.17.3-81b2ea5a3a18aad357405af2d643ccbe5a09020b-integrity/node_modules/@types/send/"),
      packageDependencies: new Map([
        ["@types/mime", "1.3.4"],
        ["@types/node", "20.8.10"],
        ["@types/send", "0.17.3"],
      ]),
    }],
  ])],
  ["@types/mime", new Map([
    ["1.3.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-mime-1.3.4-a4ed836e069491414bab92c31fdea9e557aca0d9-integrity/node_modules/@types/mime/"),
      packageDependencies: new Map([
        ["@types/mime", "1.3.4"],
      ]),
    }],
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-mime-3.0.3-886674659ce55fe7c6c06ec5ca7c0eb276a08f91-integrity/node_modules/@types/mime/"),
      packageDependencies: new Map([
        ["@types/mime", "3.0.3"],
      ]),
    }],
  ])],
  ["@types/express", new Map([
    ["4.17.20", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-express-4.17.20-e7c9b40276d29e38a4e3564d7a3d65911e2aa433-integrity/node_modules/@types/express/"),
      packageDependencies: new Map([
        ["@types/body-parser", "1.19.4"],
        ["@types/express-serve-static-core", "4.17.39"],
        ["@types/qs", "6.9.9"],
        ["@types/serve-static", "1.15.4"],
        ["@types/express", "4.17.20"],
      ]),
    }],
  ])],
  ["@types/body-parser", new Map([
    ["1.19.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-body-parser-1.19.4-78ad68f1f79eb851aa3634db0c7f57f6f601b462-integrity/node_modules/@types/body-parser/"),
      packageDependencies: new Map([
        ["@types/connect", "3.4.37"],
        ["@types/node", "20.8.10"],
        ["@types/body-parser", "1.19.4"],
      ]),
    }],
  ])],
  ["@types/connect", new Map([
    ["3.4.37", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-connect-3.4.37-c66a96689fd3127c8772eb3e9e5c6028ec1a9af5-integrity/node_modules/@types/connect/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/connect", "3.4.37"],
      ]),
    }],
  ])],
  ["@types/serve-static", new Map([
    ["1.15.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-serve-static-1.15.4-44b5895a68ca637f06c229119e1c774ca88f81b2-integrity/node_modules/@types/serve-static/"),
      packageDependencies: new Map([
        ["@types/http-errors", "2.0.3"],
        ["@types/mime", "3.0.3"],
        ["@types/node", "20.8.10"],
        ["@types/serve-static", "1.15.4"],
      ]),
    }],
  ])],
  ["@types/http-errors", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-http-errors-2.0.3-c54e61f79b3947d040f150abd58f71efb422ff62-integrity/node_modules/@types/http-errors/"),
      packageDependencies: new Map([
        ["@types/http-errors", "2.0.3"],
      ]),
    }],
  ])],
  ["@types/serve-index", new Map([
    ["1.9.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-serve-index-1.9.3-af9403916eb6fbf7d6ec6f47b2a4c46eb3222cc9-integrity/node_modules/@types/serve-index/"),
      packageDependencies: new Map([
        ["@types/express", "4.17.20"],
        ["@types/serve-index", "1.9.3"],
      ]),
    }],
  ])],
  ["@types/sockjs", new Map([
    ["0.3.35", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-sockjs-0.3.35-f4a568c73d2a8071944bd6ffdca0d4e66810cd21-integrity/node_modules/@types/sockjs/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/sockjs", "0.3.35"],
      ]),
    }],
  ])],
  ["@types/ws", new Map([
    ["8.5.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-ws-8.5.8-13efec7bd439d0bdf2af93030804a94f163b1430-integrity/node_modules/@types/ws/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/ws", "8.5.8"],
      ]),
    }],
  ])],
  ["ansi-html-community", new Map([
    ["0.0.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ansi-html-community-0.0.8-69fbc4d6ccbe383f9736934ae34c3f8290f1bf41-integrity/node_modules/ansi-html-community/"),
      packageDependencies: new Map([
        ["ansi-html-community", "0.0.8"],
      ]),
    }],
  ])],
  ["bonjour-service", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-bonjour-service-1.1.1-960948fa0e0153f5d26743ab15baf8e33752c135-integrity/node_modules/bonjour-service/"),
      packageDependencies: new Map([
        ["array-flatten", "2.1.2"],
        ["dns-equal", "1.0.0"],
        ["fast-deep-equal", "3.1.3"],
        ["multicast-dns", "7.2.5"],
        ["bonjour-service", "1.1.1"],
      ]),
    }],
  ])],
  ["array-flatten", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-array-flatten-2.1.2-24ef80a28c1a893617e2149b0c6d0d788293b099-integrity/node_modules/array-flatten/"),
      packageDependencies: new Map([
        ["array-flatten", "2.1.2"],
      ]),
    }],
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-array-flatten-1.1.1-9a5f699051b1e7073328f2a008968b64ea2955d2-integrity/node_modules/array-flatten/"),
      packageDependencies: new Map([
        ["array-flatten", "1.1.1"],
      ]),
    }],
  ])],
  ["dns-equal", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-dns-equal-1.0.0-b39e7f1da6eb0a75ba9c17324b34753c47e0654d-integrity/node_modules/dns-equal/"),
      packageDependencies: new Map([
        ["dns-equal", "1.0.0"],
      ]),
    }],
  ])],
  ["multicast-dns", new Map([
    ["7.2.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-multicast-dns-7.2.5-77eb46057f4d7adbd16d9290fa7299f6fa64cced-integrity/node_modules/multicast-dns/"),
      packageDependencies: new Map([
        ["dns-packet", "5.6.1"],
        ["thunky", "1.1.0"],
        ["multicast-dns", "7.2.5"],
      ]),
    }],
  ])],
  ["dns-packet", new Map([
    ["5.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-dns-packet-5.6.1-ae888ad425a9d1478a0674256ab866de1012cf2f-integrity/node_modules/dns-packet/"),
      packageDependencies: new Map([
        ["@leichtgewicht/ip-codec", "2.0.4"],
        ["dns-packet", "5.6.1"],
      ]),
    }],
  ])],
  ["@leichtgewicht/ip-codec", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@leichtgewicht-ip-codec-2.0.4-b2ac626d6cb9c8718ab459166d4bb405b8ffa78b-integrity/node_modules/@leichtgewicht/ip-codec/"),
      packageDependencies: new Map([
        ["@leichtgewicht/ip-codec", "2.0.4"],
      ]),
    }],
  ])],
  ["thunky", new Map([
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-thunky-1.1.0-5abaf714a9405db0504732bbccd2cedd9ef9537d-integrity/node_modules/thunky/"),
      packageDependencies: new Map([
        ["thunky", "1.1.0"],
      ]),
    }],
  ])],
  ["chokidar", new Map([
    ["3.5.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-chokidar-3.5.3-1cf37c8707b932bd1af1ae22c0432e2acd1903bd-integrity/node_modules/chokidar/"),
      packageDependencies: new Map([
        ["anymatch", "3.1.3"],
        ["braces", "3.0.2"],
        ["glob-parent", "5.1.2"],
        ["is-binary-path", "2.1.0"],
        ["is-glob", "4.0.3"],
        ["normalize-path", "3.0.0"],
        ["readdirp", "3.6.0"],
        ["chokidar", "3.5.3"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.3-790c58b19ba1720a84205b57c618d5ad8524973e-integrity/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
        ["picomatch", "2.3.1"],
        ["anymatch", "3.1.3"],
      ]),
    }],
  ])],
  ["is-binary-path", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.2.0"],
        ["is-binary-path", "2.1.0"],
      ]),
    }],
  ])],
  ["binary-extensions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.2.0-75f502eeaf9ffde42fc98829645be4ea76bd9e2d-integrity/node_modules/binary-extensions/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.2.0"],
      ]),
    }],
  ])],
  ["readdirp", new Map([
    ["3.6.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-readdirp-3.6.0-74a370bd857116e245b29cc97340cd431a02a6c7-integrity/node_modules/readdirp/"),
      packageDependencies: new Map([
        ["picomatch", "2.3.1"],
        ["readdirp", "3.6.0"],
      ]),
    }],
  ])],
  ["compression", new Map([
    ["1.7.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-compression-1.7.4-95523eff170ca57c29a0ca41e6fe131f41e5bb8f-integrity/node_modules/compression/"),
      packageDependencies: new Map([
        ["accepts", "1.3.8"],
        ["bytes", "3.0.0"],
        ["compressible", "2.0.18"],
        ["debug", "2.6.9"],
        ["on-headers", "1.0.2"],
        ["safe-buffer", "5.1.2"],
        ["vary", "1.1.2"],
        ["compression", "1.7.4"],
      ]),
    }],
  ])],
  ["accepts", new Map([
    ["1.3.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-accepts-1.3.8-0bf0be125b67014adcb0b0921e62db7bffe16b2e-integrity/node_modules/accepts/"),
      packageDependencies: new Map([
        ["mime-types", "2.1.35"],
        ["negotiator", "0.6.3"],
        ["accepts", "1.3.8"],
      ]),
    }],
  ])],
  ["negotiator", new Map([
    ["0.6.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-negotiator-0.6.3-58e323a72fedc0d6f9cd4d31fe49f51479590ccd-integrity/node_modules/negotiator/"),
      packageDependencies: new Map([
        ["negotiator", "0.6.3"],
      ]),
    }],
  ])],
  ["bytes", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048-integrity/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "3.0.0"],
      ]),
    }],
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-bytes-3.1.2-8b0beeb98605adf1b128fa4386403c009e0221a5-integrity/node_modules/bytes/"),
      packageDependencies: new Map([
        ["bytes", "3.1.2"],
      ]),
    }],
  ])],
  ["compressible", new Map([
    ["2.0.18", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-compressible-2.0.18-af53cca6b070d4c3c0750fbd77286a6d7cc46fba-integrity/node_modules/compressible/"),
      packageDependencies: new Map([
        ["mime-db", "1.52.0"],
        ["compressible", "2.0.18"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["2.6.9", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
        ["debug", "2.6.9"],
      ]),
    }],
    ["4.3.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-debug-4.3.4-1319f6579357f2338d3337d2cdd4914bb5dcc865-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.3.4"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.0.0"],
      ]),
    }],
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.1.3-574c8138ce1d2b5861f0b44579dbadd60c6615b2-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.3"],
      ]),
    }],
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
  ])],
  ["on-headers", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-on-headers-1.0.2-772b0ae6aaa525c399e489adfad90c403eb3c28f-integrity/node_modules/on-headers/"),
      packageDependencies: new Map([
        ["on-headers", "1.0.2"],
      ]),
    }],
  ])],
  ["vary", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc-integrity/node_modules/vary/"),
      packageDependencies: new Map([
        ["vary", "1.1.2"],
      ]),
    }],
  ])],
  ["connect-history-api-fallback", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-connect-history-api-fallback-2.0.0-647264845251a0daf25b97ce87834cace0f5f1c8-integrity/node_modules/connect-history-api-fallback/"),
      packageDependencies: new Map([
        ["connect-history-api-fallback", "2.0.0"],
      ]),
    }],
  ])],
  ["default-gateway", new Map([
    ["6.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-default-gateway-6.0.3-819494c888053bdb743edbf343d6cdf7f2943a71-integrity/node_modules/default-gateway/"),
      packageDependencies: new Map([
        ["execa", "5.1.1"],
        ["default-gateway", "6.0.3"],
      ]),
    }],
  ])],
  ["execa", new Map([
    ["5.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-execa-5.1.1-f80ad9cbf4298f7bd1d4c9555c21e93741c411dd-integrity/node_modules/execa/"),
      packageDependencies: new Map([
        ["cross-spawn", "7.0.3"],
        ["get-stream", "6.0.1"],
        ["human-signals", "2.1.0"],
        ["is-stream", "2.0.1"],
        ["merge-stream", "2.0.0"],
        ["npm-run-path", "4.0.1"],
        ["onetime", "5.1.2"],
        ["signal-exit", "3.0.7"],
        ["strip-final-newline", "2.0.0"],
        ["execa", "5.1.1"],
      ]),
    }],
  ])],
  ["get-stream", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-get-stream-6.0.1-a262d8eef67aced57c2852ad6167526a43cbf7b7-integrity/node_modules/get-stream/"),
      packageDependencies: new Map([
        ["get-stream", "6.0.1"],
      ]),
    }],
  ])],
  ["human-signals", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-human-signals-2.1.0-dc91fcba42e4d06e4abaed33b3e7a3c02f514ea0-integrity/node_modules/human-signals/"),
      packageDependencies: new Map([
        ["human-signals", "2.1.0"],
      ]),
    }],
  ])],
  ["is-stream", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-stream-2.0.1-fac1e3d53b97ad5a9d0ae9cef2389f5810a5c077-integrity/node_modules/is-stream/"),
      packageDependencies: new Map([
        ["is-stream", "2.0.1"],
      ]),
    }],
  ])],
  ["npm-run-path", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-npm-run-path-4.0.1-b7ecd1e5ed53da8e37a55e1c2269e0b97ed748ea-integrity/node_modules/npm-run-path/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
        ["npm-run-path", "4.0.1"],
      ]),
    }],
  ])],
  ["onetime", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-onetime-5.1.2-d0e96ebb56b07476df1dd9c4806e5237985ca45e-integrity/node_modules/onetime/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
        ["onetime", "5.1.2"],
      ]),
    }],
  ])],
  ["mimic-fn", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b-integrity/node_modules/mimic-fn/"),
      packageDependencies: new Map([
        ["mimic-fn", "2.1.0"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["3.0.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-signal-exit-3.0.7-a9a1767f8af84155114eaabd73f99273c8f59ad9-integrity/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "3.0.7"],
      ]),
    }],
  ])],
  ["strip-final-newline", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-strip-final-newline-2.0.0-89b852fb2fcbe936f6f4b3187afb0a12c1ab58ad-integrity/node_modules/strip-final-newline/"),
      packageDependencies: new Map([
        ["strip-final-newline", "2.0.0"],
      ]),
    }],
  ])],
  ["express", new Map([
    ["4.18.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-express-4.18.2-3fabe08296e930c796c19e3c516979386ba9fd59-integrity/node_modules/express/"),
      packageDependencies: new Map([
        ["accepts", "1.3.8"],
        ["array-flatten", "1.1.1"],
        ["body-parser", "1.20.1"],
        ["content-disposition", "0.5.4"],
        ["content-type", "1.0.5"],
        ["cookie", "0.5.0"],
        ["cookie-signature", "1.0.6"],
        ["debug", "2.6.9"],
        ["depd", "2.0.0"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["etag", "1.8.1"],
        ["finalhandler", "1.2.0"],
        ["fresh", "0.5.2"],
        ["http-errors", "2.0.0"],
        ["merge-descriptors", "1.0.1"],
        ["methods", "1.1.2"],
        ["on-finished", "2.4.1"],
        ["parseurl", "1.3.3"],
        ["path-to-regexp", "0.1.7"],
        ["proxy-addr", "2.0.7"],
        ["qs", "6.11.0"],
        ["range-parser", "1.2.1"],
        ["safe-buffer", "5.2.1"],
        ["send", "0.18.0"],
        ["serve-static", "1.15.0"],
        ["setprototypeof", "1.2.0"],
        ["statuses", "2.0.1"],
        ["type-is", "1.6.18"],
        ["utils-merge", "1.0.1"],
        ["vary", "1.1.2"],
        ["express", "4.18.2"],
      ]),
    }],
  ])],
  ["body-parser", new Map([
    ["1.20.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-body-parser-1.20.1-b1812a8912c195cd371a3ee5e66faa2338a5c668-integrity/node_modules/body-parser/"),
      packageDependencies: new Map([
        ["bytes", "3.1.2"],
        ["content-type", "1.0.5"],
        ["debug", "2.6.9"],
        ["depd", "2.0.0"],
        ["destroy", "1.2.0"],
        ["http-errors", "2.0.0"],
        ["iconv-lite", "0.4.24"],
        ["on-finished", "2.4.1"],
        ["qs", "6.11.0"],
        ["raw-body", "2.5.1"],
        ["type-is", "1.6.18"],
        ["unpipe", "1.0.0"],
        ["body-parser", "1.20.1"],
      ]),
    }],
  ])],
  ["content-type", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-content-type-1.0.5-8b773162656d1d1086784c8f23a54ce6d73d7918-integrity/node_modules/content-type/"),
      packageDependencies: new Map([
        ["content-type", "1.0.5"],
      ]),
    }],
  ])],
  ["depd", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-depd-2.0.0-b696163cc757560d09cf22cc8fad1571b79e76df-integrity/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "2.0.0"],
      ]),
    }],
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9-integrity/node_modules/depd/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
      ]),
    }],
  ])],
  ["destroy", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-destroy-1.2.0-4803735509ad8be552934c67df614f94e66fa015-integrity/node_modules/destroy/"),
      packageDependencies: new Map([
        ["destroy", "1.2.0"],
      ]),
    }],
  ])],
  ["http-errors", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-errors-2.0.0-b7774a1486ef73cf7667ac9ae0858c012c57b9d3-integrity/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "2.0.0"],
        ["inherits", "2.0.4"],
        ["setprototypeof", "1.2.0"],
        ["statuses", "2.0.1"],
        ["toidentifier", "1.0.1"],
        ["http-errors", "2.0.0"],
      ]),
    }],
    ["1.6.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d-integrity/node_modules/http-errors/"),
      packageDependencies: new Map([
        ["depd", "1.1.2"],
        ["inherits", "2.0.3"],
        ["setprototypeof", "1.1.0"],
        ["statuses", "1.5.0"],
        ["http-errors", "1.6.3"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de-integrity/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.3"],
      ]),
    }],
  ])],
  ["setprototypeof", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-setprototypeof-1.2.0-66c9a24a73f9fc28cbe66b09fed3d33dcaf1b424-integrity/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.2.0"],
      ]),
    }],
    ["1.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656-integrity/node_modules/setprototypeof/"),
      packageDependencies: new Map([
        ["setprototypeof", "1.1.0"],
      ]),
    }],
  ])],
  ["statuses", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-statuses-2.0.1-55cb000ccf1d48728bd23c685a063998cf1a1b63-integrity/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "2.0.1"],
      ]),
    }],
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c-integrity/node_modules/statuses/"),
      packageDependencies: new Map([
        ["statuses", "1.5.0"],
      ]),
    }],
  ])],
  ["toidentifier", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-toidentifier-1.0.1-3be34321a88a820ed1bd80dfaa33e479fbb8dd35-integrity/node_modules/toidentifier/"),
      packageDependencies: new Map([
        ["toidentifier", "1.0.1"],
      ]),
    }],
  ])],
  ["iconv-lite", new Map([
    ["0.4.24", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b-integrity/node_modules/iconv-lite/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
        ["iconv-lite", "0.4.24"],
      ]),
    }],
  ])],
  ["safer-buffer", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a-integrity/node_modules/safer-buffer/"),
      packageDependencies: new Map([
        ["safer-buffer", "2.1.2"],
      ]),
    }],
  ])],
  ["on-finished", new Map([
    ["2.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-on-finished-2.4.1-58c8c44116e54845ad57f14ab10b03533184ac3f-integrity/node_modules/on-finished/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
        ["on-finished", "2.4.1"],
      ]),
    }],
  ])],
  ["ee-first", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d-integrity/node_modules/ee-first/"),
      packageDependencies: new Map([
        ["ee-first", "1.1.1"],
      ]),
    }],
  ])],
  ["qs", new Map([
    ["6.11.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-qs-6.11.0-fd0d963446f7a65e1367e01abd85429453f0c37a-integrity/node_modules/qs/"),
      packageDependencies: new Map([
        ["side-channel", "1.0.4"],
        ["qs", "6.11.0"],
      ]),
    }],
  ])],
  ["side-channel", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-side-channel-1.0.4-efce5c8fdc104ee751b25c58d4290011fa5ea2cf-integrity/node_modules/side-channel/"),
      packageDependencies: new Map([
        ["call-bind", "1.0.5"],
        ["get-intrinsic", "1.2.2"],
        ["object-inspect", "1.13.1"],
        ["side-channel", "1.0.4"],
      ]),
    }],
  ])],
  ["call-bind", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-call-bind-1.0.5-6fa2b7845ce0ea49bf4d8b9ef64727a2c2e2e513-integrity/node_modules/call-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
        ["get-intrinsic", "1.2.2"],
        ["set-function-length", "1.1.1"],
        ["call-bind", "1.0.5"],
      ]),
    }],
  ])],
  ["get-intrinsic", new Map([
    ["1.2.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-get-intrinsic-1.2.2-281b7622971123e1ef4b3c90fd7539306da93f3b-integrity/node_modules/get-intrinsic/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
        ["has-proto", "1.0.1"],
        ["has-symbols", "1.0.3"],
        ["hasown", "2.0.0"],
        ["get-intrinsic", "1.2.2"],
      ]),
    }],
  ])],
  ["has-proto", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-has-proto-1.0.1-1885c1305538958aff469fef37937c22795408e0-integrity/node_modules/has-proto/"),
      packageDependencies: new Map([
        ["has-proto", "1.0.1"],
      ]),
    }],
  ])],
  ["has-symbols", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-has-symbols-1.0.3-bb7b2c4349251dce87b125f7bdf874aa7c8b39f8-integrity/node_modules/has-symbols/"),
      packageDependencies: new Map([
        ["has-symbols", "1.0.3"],
      ]),
    }],
  ])],
  ["set-function-length", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-set-function-length-1.1.1-4bc39fafb0307224a33e106a7d35ca1218d659ed-integrity/node_modules/set-function-length/"),
      packageDependencies: new Map([
        ["define-data-property", "1.1.1"],
        ["get-intrinsic", "1.2.2"],
        ["gopd", "1.0.1"],
        ["has-property-descriptors", "1.0.1"],
        ["set-function-length", "1.1.1"],
      ]),
    }],
  ])],
  ["define-data-property", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-define-data-property-1.1.1-c35f7cd0ab09883480d12ac5cb213715587800b3-integrity/node_modules/define-data-property/"),
      packageDependencies: new Map([
        ["get-intrinsic", "1.2.2"],
        ["gopd", "1.0.1"],
        ["has-property-descriptors", "1.0.1"],
        ["define-data-property", "1.1.1"],
      ]),
    }],
  ])],
  ["gopd", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-gopd-1.0.1-29ff76de69dac7489b7c0918a5788e56477c332c-integrity/node_modules/gopd/"),
      packageDependencies: new Map([
        ["get-intrinsic", "1.2.2"],
        ["gopd", "1.0.1"],
      ]),
    }],
  ])],
  ["has-property-descriptors", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-has-property-descriptors-1.0.1-52ba30b6c5ec87fd89fa574bc1c39125c6f65340-integrity/node_modules/has-property-descriptors/"),
      packageDependencies: new Map([
        ["get-intrinsic", "1.2.2"],
        ["has-property-descriptors", "1.0.1"],
      ]),
    }],
  ])],
  ["object-inspect", new Map([
    ["1.13.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-object-inspect-1.13.1-b96c6109324ccfef6b12216a956ca4dc2ff94bc2-integrity/node_modules/object-inspect/"),
      packageDependencies: new Map([
        ["object-inspect", "1.13.1"],
      ]),
    }],
  ])],
  ["raw-body", new Map([
    ["2.5.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-raw-body-2.5.1-fe1b1628b181b700215e5fd42389f98b71392857-integrity/node_modules/raw-body/"),
      packageDependencies: new Map([
        ["bytes", "3.1.2"],
        ["http-errors", "2.0.0"],
        ["iconv-lite", "0.4.24"],
        ["unpipe", "1.0.0"],
        ["raw-body", "2.5.1"],
      ]),
    }],
  ])],
  ["unpipe", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec-integrity/node_modules/unpipe/"),
      packageDependencies: new Map([
        ["unpipe", "1.0.0"],
      ]),
    }],
  ])],
  ["type-is", new Map([
    ["1.6.18", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131-integrity/node_modules/type-is/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
        ["mime-types", "2.1.35"],
        ["type-is", "1.6.18"],
      ]),
    }],
  ])],
  ["media-typer", new Map([
    ["0.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748-integrity/node_modules/media-typer/"),
      packageDependencies: new Map([
        ["media-typer", "0.3.0"],
      ]),
    }],
  ])],
  ["content-disposition", new Map([
    ["0.5.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-content-disposition-0.5.4-8b82b4efac82512a02bb0b1dcec9d2c5e8eb5bfe-integrity/node_modules/content-disposition/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
        ["content-disposition", "0.5.4"],
      ]),
    }],
  ])],
  ["cookie", new Map([
    ["0.5.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-cookie-0.5.0-d1f5d71adec6558c58f389987c366aa47e994f8b-integrity/node_modules/cookie/"),
      packageDependencies: new Map([
        ["cookie", "0.5.0"],
      ]),
    }],
  ])],
  ["cookie-signature", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-cookie-signature-1.0.6-e303a882b342cc3ee8ca513a79999734dab3ae2c-integrity/node_modules/cookie-signature/"),
      packageDependencies: new Map([
        ["cookie-signature", "1.0.6"],
      ]),
    }],
  ])],
  ["encodeurl", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59-integrity/node_modules/encodeurl/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
      ]),
    }],
  ])],
  ["escape-html", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988-integrity/node_modules/escape-html/"),
      packageDependencies: new Map([
        ["escape-html", "1.0.3"],
      ]),
    }],
  ])],
  ["etag", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887-integrity/node_modules/etag/"),
      packageDependencies: new Map([
        ["etag", "1.8.1"],
      ]),
    }],
  ])],
  ["finalhandler", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-finalhandler-1.2.0-7d23fe5731b207b4640e4fcd00aec1f9207a7b32-integrity/node_modules/finalhandler/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["on-finished", "2.4.1"],
        ["parseurl", "1.3.3"],
        ["statuses", "2.0.1"],
        ["unpipe", "1.0.0"],
        ["finalhandler", "1.2.0"],
      ]),
    }],
  ])],
  ["parseurl", new Map([
    ["1.3.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4-integrity/node_modules/parseurl/"),
      packageDependencies: new Map([
        ["parseurl", "1.3.3"],
      ]),
    }],
  ])],
  ["fresh", new Map([
    ["0.5.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7-integrity/node_modules/fresh/"),
      packageDependencies: new Map([
        ["fresh", "0.5.2"],
      ]),
    }],
  ])],
  ["merge-descriptors", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-merge-descriptors-1.0.1-b00aaa556dd8b44568150ec9d1b953f3f90cbb61-integrity/node_modules/merge-descriptors/"),
      packageDependencies: new Map([
        ["merge-descriptors", "1.0.1"],
      ]),
    }],
  ])],
  ["methods", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee-integrity/node_modules/methods/"),
      packageDependencies: new Map([
        ["methods", "1.1.2"],
      ]),
    }],
  ])],
  ["path-to-regexp", new Map([
    ["0.1.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-to-regexp-0.1.7-df604178005f522f15eb4490e7247a1bfaa67f8c-integrity/node_modules/path-to-regexp/"),
      packageDependencies: new Map([
        ["path-to-regexp", "0.1.7"],
      ]),
    }],
  ])],
  ["proxy-addr", new Map([
    ["2.0.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-proxy-addr-2.0.7-f19fe69ceab311eeb94b42e70e8c2070f9ba1025-integrity/node_modules/proxy-addr/"),
      packageDependencies: new Map([
        ["forwarded", "0.2.0"],
        ["ipaddr.js", "1.9.1"],
        ["proxy-addr", "2.0.7"],
      ]),
    }],
  ])],
  ["forwarded", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-forwarded-0.2.0-2269936428aad4c15c7ebe9779a84bf0b2a81811-integrity/node_modules/forwarded/"),
      packageDependencies: new Map([
        ["forwarded", "0.2.0"],
      ]),
    }],
  ])],
  ["ipaddr.js", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ipaddr-js-1.9.1-bff38543eeb8984825079ff3a2a8e6cbd46781b3-integrity/node_modules/ipaddr.js/"),
      packageDependencies: new Map([
        ["ipaddr.js", "1.9.1"],
      ]),
    }],
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ipaddr-js-2.1.0-2119bc447ff8c257753b196fc5f1ce08a4cdf39f-integrity/node_modules/ipaddr.js/"),
      packageDependencies: new Map([
        ["ipaddr.js", "2.1.0"],
      ]),
    }],
  ])],
  ["range-parser", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-range-parser-1.2.1-3cf37023d199e1c24d1a55b84800c2f3e6468031-integrity/node_modules/range-parser/"),
      packageDependencies: new Map([
        ["range-parser", "1.2.1"],
      ]),
    }],
  ])],
  ["send", new Map([
    ["0.18.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-send-0.18.0-670167cc654b05f5aa4a767f9113bb371bc706be-integrity/node_modules/send/"),
      packageDependencies: new Map([
        ["debug", "2.6.9"],
        ["depd", "2.0.0"],
        ["destroy", "1.2.0"],
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["etag", "1.8.1"],
        ["fresh", "0.5.2"],
        ["http-errors", "2.0.0"],
        ["mime", "1.6.0"],
        ["ms", "2.1.3"],
        ["on-finished", "2.4.1"],
        ["range-parser", "1.2.1"],
        ["statuses", "2.0.1"],
        ["send", "0.18.0"],
      ]),
    }],
  ])],
  ["mime", new Map([
    ["1.6.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-1.6.0-32cd9e5c64553bd58d19a568af452acff04981b1-integrity/node_modules/mime/"),
      packageDependencies: new Map([
        ["mime", "1.6.0"],
      ]),
    }],
  ])],
  ["serve-static", new Map([
    ["1.15.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-serve-static-1.15.0-faaef08cffe0a1a62f60cad0c4e513cff0ac9540-integrity/node_modules/serve-static/"),
      packageDependencies: new Map([
        ["encodeurl", "1.0.2"],
        ["escape-html", "1.0.3"],
        ["parseurl", "1.3.3"],
        ["send", "0.18.0"],
        ["serve-static", "1.15.0"],
      ]),
    }],
  ])],
  ["utils-merge", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713-integrity/node_modules/utils-merge/"),
      packageDependencies: new Map([
        ["utils-merge", "1.0.1"],
      ]),
    }],
  ])],
  ["html-entities", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-html-entities-2.4.0-edd0cee70402584c8c76cc2c0556db09d1f45061-integrity/node_modules/html-entities/"),
      packageDependencies: new Map([
        ["html-entities", "2.4.0"],
      ]),
    }],
  ])],
  ["http-proxy-middleware", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-proxy-middleware-2.0.6-e1a4dd6979572c7ab5a4e4b55095d1f32a74963f-integrity/node_modules/http-proxy-middleware/"),
      packageDependencies: new Map([
        ["@types/express", "4.17.20"],
        ["@types/http-proxy", "1.17.13"],
        ["http-proxy", "1.18.1"],
        ["is-glob", "4.0.3"],
        ["is-plain-obj", "3.0.0"],
        ["micromatch", "4.0.5"],
        ["http-proxy-middleware", "2.0.6"],
      ]),
    }],
  ])],
  ["@types/http-proxy", new Map([
    ["1.17.13", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-http-proxy-1.17.13-dd3a4da550580eb0557d4c7128a2ff1d1a38d465-integrity/node_modules/@types/http-proxy/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/http-proxy", "1.17.13"],
      ]),
    }],
  ])],
  ["http-proxy", new Map([
    ["1.18.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-proxy-1.18.1-401541f0534884bbf95260334e72f88ee3976549-integrity/node_modules/http-proxy/"),
      packageDependencies: new Map([
        ["eventemitter3", "4.0.7"],
        ["follow-redirects", "1.15.3"],
        ["requires-port", "1.0.0"],
        ["http-proxy", "1.18.1"],
      ]),
    }],
  ])],
  ["eventemitter3", new Map([
    ["4.0.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-eventemitter3-4.0.7-2de9b68f6528d5644ef5c59526a1b4a07306169f-integrity/node_modules/eventemitter3/"),
      packageDependencies: new Map([
        ["eventemitter3", "4.0.7"],
      ]),
    }],
  ])],
  ["follow-redirects", new Map([
    ["1.15.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-follow-redirects-1.15.3-fe2f3ef2690afce7e82ed0b44db08165b207123a-integrity/node_modules/follow-redirects/"),
      packageDependencies: new Map([
        ["follow-redirects", "1.15.3"],
      ]),
    }],
  ])],
  ["requires-port", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff-integrity/node_modules/requires-port/"),
      packageDependencies: new Map([
        ["requires-port", "1.0.0"],
      ]),
    }],
  ])],
  ["is-plain-obj", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-plain-obj-3.0.0-af6f2ea14ac5a646183a5bbdb5baabbc156ad9d7-integrity/node_modules/is-plain-obj/"),
      packageDependencies: new Map([
        ["is-plain-obj", "3.0.0"],
      ]),
    }],
  ])],
  ["launch-editor", new Map([
    ["2.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-launch-editor-2.6.1-f259c9ef95cbc9425620bbbd14b468fcdb4ffe3c-integrity/node_modules/launch-editor/"),
      packageDependencies: new Map([
        ["picocolors", "1.0.0"],
        ["shell-quote", "1.8.1"],
        ["launch-editor", "2.6.1"],
      ]),
    }],
  ])],
  ["shell-quote", new Map([
    ["1.8.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-shell-quote-1.8.1-6dbf4db75515ad5bac63b4f1894c3a154c766680-integrity/node_modules/shell-quote/"),
      packageDependencies: new Map([
        ["shell-quote", "1.8.1"],
      ]),
    }],
  ])],
  ["open", new Map([
    ["8.4.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-open-8.4.2-5b5ffe2a8f793dcd2aad73e550cb87b59cb084f9-integrity/node_modules/open/"),
      packageDependencies: new Map([
        ["define-lazy-prop", "2.0.0"],
        ["is-docker", "2.2.1"],
        ["is-wsl", "2.2.0"],
        ["open", "8.4.2"],
      ]),
    }],
  ])],
  ["define-lazy-prop", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-define-lazy-prop-2.0.0-3f7ae421129bcaaac9bc74905c98a0009ec9ee7f-integrity/node_modules/define-lazy-prop/"),
      packageDependencies: new Map([
        ["define-lazy-prop", "2.0.0"],
      ]),
    }],
  ])],
  ["is-docker", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-docker-2.2.1-33eeabe23cfe86f14bde4408a02c0cfb853acdaa-integrity/node_modules/is-docker/"),
      packageDependencies: new Map([
        ["is-docker", "2.2.1"],
      ]),
    }],
  ])],
  ["is-wsl", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-is-wsl-2.2.0-74a4c76e77ca9fd3f932f290c17ea326cd157271-integrity/node_modules/is-wsl/"),
      packageDependencies: new Map([
        ["is-docker", "2.2.1"],
        ["is-wsl", "2.2.0"],
      ]),
    }],
  ])],
  ["p-retry", new Map([
    ["4.6.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-p-retry-4.6.2-9baae7184057edd4e17231cee04264106e092a16-integrity/node_modules/p-retry/"),
      packageDependencies: new Map([
        ["@types/retry", "0.12.0"],
        ["retry", "0.13.1"],
        ["p-retry", "4.6.2"],
      ]),
    }],
  ])],
  ["@types/retry", new Map([
    ["0.12.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-retry-0.12.0-2b35eccfcee7d38cd72ad99232fbd58bffb3c84d-integrity/node_modules/@types/retry/"),
      packageDependencies: new Map([
        ["@types/retry", "0.12.0"],
      ]),
    }],
  ])],
  ["retry", new Map([
    ["0.13.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-retry-0.13.1-185b1587acf67919d63b357349e03537b2484658-integrity/node_modules/retry/"),
      packageDependencies: new Map([
        ["retry", "0.13.1"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a-integrity/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.2.3"],
        ["rimraf", "3.0.2"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.2.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-7.2.3-b8df0fb802bbfa8e89bd1d938b4e16578ed44f2b-integrity/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.1.2"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.2.3"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-minimatch-3.1.2-19cd194bfd3e428f049a70817c038d89ab4be35b-integrity/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.1.2"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.2"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-balanced-match-1.0.2-e83e3a7e3f300b34cb9d87f615fa0cbf357690ee-integrity/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.2"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["selfsigned", new Map([
    ["2.4.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-selfsigned-2.4.1-560d90565442a3ed35b674034cec4e95dceb4ae0-integrity/node_modules/selfsigned/"),
      packageDependencies: new Map([
        ["@types/node-forge", "1.3.8"],
        ["node-forge", "1.3.1"],
        ["selfsigned", "2.4.1"],
      ]),
    }],
  ])],
  ["@types/node-forge", new Map([
    ["1.3.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-forge-1.3.8-044ad98354ff309a031a55a40ad122f3be1ac2bb-integrity/node_modules/@types/node-forge/"),
      packageDependencies: new Map([
        ["@types/node", "20.8.10"],
        ["@types/node-forge", "1.3.8"],
      ]),
    }],
  ])],
  ["node-forge", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-node-forge-1.3.1-be8da2af243b2417d5f646a770663a92b7e9ded3-integrity/node_modules/node-forge/"),
      packageDependencies: new Map([
        ["node-forge", "1.3.1"],
      ]),
    }],
  ])],
  ["serve-index", new Map([
    ["1.9.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239-integrity/node_modules/serve-index/"),
      packageDependencies: new Map([
        ["accepts", "1.3.8"],
        ["batch", "0.6.1"],
        ["debug", "2.6.9"],
        ["escape-html", "1.0.3"],
        ["http-errors", "1.6.3"],
        ["mime-types", "2.1.35"],
        ["parseurl", "1.3.3"],
        ["serve-index", "1.9.1"],
      ]),
    }],
  ])],
  ["batch", new Map([
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16-integrity/node_modules/batch/"),
      packageDependencies: new Map([
        ["batch", "0.6.1"],
      ]),
    }],
  ])],
  ["sockjs", new Map([
    ["0.3.24", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-sockjs-0.3.24-c9bc8995f33a111bea0395ec30aa3206bdb5ccce-integrity/node_modules/sockjs/"),
      packageDependencies: new Map([
        ["faye-websocket", "0.11.4"],
        ["uuid", "8.3.2"],
        ["websocket-driver", "0.7.4"],
        ["sockjs", "0.3.24"],
      ]),
    }],
  ])],
  ["faye-websocket", new Map([
    ["0.11.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-faye-websocket-0.11.4-7f0d9275cfdd86a1c963dc8b65fcc451edcbb1da-integrity/node_modules/faye-websocket/"),
      packageDependencies: new Map([
        ["websocket-driver", "0.7.4"],
        ["faye-websocket", "0.11.4"],
      ]),
    }],
  ])],
  ["websocket-driver", new Map([
    ["0.7.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-websocket-driver-0.7.4-89ad5295bbf64b480abcba31e4953aca706f5760-integrity/node_modules/websocket-driver/"),
      packageDependencies: new Map([
        ["http-parser-js", "0.5.8"],
        ["safe-buffer", "5.2.1"],
        ["websocket-extensions", "0.1.4"],
        ["websocket-driver", "0.7.4"],
      ]),
    }],
  ])],
  ["http-parser-js", new Map([
    ["0.5.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-parser-js-0.5.8-af23090d9ac4e24573de6f6aecc9d84a48bf20e3-integrity/node_modules/http-parser-js/"),
      packageDependencies: new Map([
        ["http-parser-js", "0.5.8"],
      ]),
    }],
  ])],
  ["websocket-extensions", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-websocket-extensions-0.1.4-7f8473bc839dfd87608adb95d7eb075211578a42-integrity/node_modules/websocket-extensions/"),
      packageDependencies: new Map([
        ["websocket-extensions", "0.1.4"],
      ]),
    }],
  ])],
  ["uuid", new Map([
    ["8.3.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-uuid-8.3.2-80d5b5ced271bb9af6c445f21a1a04c606cefbe2-integrity/node_modules/uuid/"),
      packageDependencies: new Map([
        ["uuid", "8.3.2"],
      ]),
    }],
  ])],
  ["spdy", new Map([
    ["4.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-spdy-4.0.2-b74f466203a3eda452c02492b91fb9e84a27677b-integrity/node_modules/spdy/"),
      packageDependencies: new Map([
        ["debug", "4.3.4"],
        ["handle-thing", "2.0.1"],
        ["http-deceiver", "1.2.7"],
        ["select-hose", "2.0.0"],
        ["spdy-transport", "3.0.0"],
        ["spdy", "4.0.2"],
      ]),
    }],
  ])],
  ["handle-thing", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-handle-thing-2.0.1-857f79ce359580c340d43081cc648970d0bb234e-integrity/node_modules/handle-thing/"),
      packageDependencies: new Map([
        ["handle-thing", "2.0.1"],
      ]),
    }],
  ])],
  ["http-deceiver", new Map([
    ["1.2.7", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-http-deceiver-1.2.7-fa7168944ab9a519d337cb0bec7284dc3e723d87-integrity/node_modules/http-deceiver/"),
      packageDependencies: new Map([
        ["http-deceiver", "1.2.7"],
      ]),
    }],
  ])],
  ["select-hose", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-select-hose-2.0.0-625d8658f865af43ec962bfc376a37359a4994ca-integrity/node_modules/select-hose/"),
      packageDependencies: new Map([
        ["select-hose", "2.0.0"],
      ]),
    }],
  ])],
  ["spdy-transport", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-spdy-transport-3.0.0-00d4863a6400ad75df93361a1608605e5dcdcf31-integrity/node_modules/spdy-transport/"),
      packageDependencies: new Map([
        ["debug", "4.3.4"],
        ["detect-node", "2.1.0"],
        ["hpack.js", "2.1.6"],
        ["obuf", "1.1.2"],
        ["readable-stream", "3.6.2"],
        ["wbuf", "1.7.3"],
        ["spdy-transport", "3.0.0"],
      ]),
    }],
  ])],
  ["detect-node", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-detect-node-2.1.0-c9c70775a49c3d03bc2c06d9a73be550f978f8b1-integrity/node_modules/detect-node/"),
      packageDependencies: new Map([
        ["detect-node", "2.1.0"],
      ]),
    }],
  ])],
  ["hpack.js", new Map([
    ["2.1.6", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-hpack-js-2.1.6-87774c0949e513f42e84575b3c45681fade2a0b2-integrity/node_modules/hpack.js/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["obuf", "1.1.2"],
        ["readable-stream", "2.3.8"],
        ["wbuf", "1.7.3"],
        ["hpack.js", "2.1.6"],
      ]),
    }],
  ])],
  ["obuf", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-obuf-1.1.2-09bea3343d41859ebd446292d11c9d4db619084e-integrity/node_modules/obuf/"),
      packageDependencies: new Map([
        ["obuf", "1.1.2"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-readable-stream-2.3.8-91125e8042bba1b9887f49345f6277027ce8be9b-integrity/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.3"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.8"],
      ]),
    }],
    ["3.6.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-readable-stream-3.6.2-56a9b36ea965c00c5a93ef31eb111a0f11056967-integrity/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
        ["string_decoder", "1.3.0"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "3.6.2"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-core-util-is-1.0.3-a6042d3634c2b27e9328f837b965fac83808db85-integrity/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.3"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
    ["1.3.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.3.0-42f114594a46cf1a8e30b0a84f56c78c3edac21e-integrity/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
        ["string_decoder", "1.3.0"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["wbuf", new Map([
    ["1.7.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-wbuf-1.7.3-c1d8d149316d3ea852848895cb6a0bfe887b87df-integrity/node_modules/wbuf/"),
      packageDependencies: new Map([
        ["minimalistic-assert", "1.0.1"],
        ["wbuf", "1.7.3"],
      ]),
    }],
  ])],
  ["minimalistic-assert", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-minimalistic-assert-1.0.1-2e194de044626d4a10e7f7fbc00ce73e83e4d5c7-integrity/node_modules/minimalistic-assert/"),
      packageDependencies: new Map([
        ["minimalistic-assert", "1.0.1"],
      ]),
    }],
  ])],
  ["webpack-dev-middleware", new Map([
    ["5.3.3", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-dev-middleware-5.3.3-efae67c2793908e7311f1d9b06f2a08dcc97e51f-integrity/node_modules/webpack-dev-middleware/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["colorette", "2.0.20"],
        ["memfs", "3.6.0"],
        ["mime-types", "2.1.35"],
        ["range-parser", "1.2.1"],
        ["schema-utils", "4.2.0"],
        ["webpack-dev-middleware", "5.3.3"],
      ]),
    }],
  ])],
  ["memfs", new Map([
    ["3.6.0", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-memfs-3.6.0-d7a2110f86f79dd950a8b6df6d57bc984aa185f6-integrity/node_modules/memfs/"),
      packageDependencies: new Map([
        ["fs-monkey", "1.0.5"],
        ["memfs", "3.6.0"],
      ]),
    }],
  ])],
  ["fs-monkey", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-fs-monkey-1.0.5-fe450175f0db0d7ea758102e1d84096acb925788-integrity/node_modules/fs-monkey/"),
      packageDependencies: new Map([
        ["fs-monkey", "1.0.5"],
      ]),
    }],
  ])],
  ["ws", new Map([
    ["8.14.2", {
      packageLocation: path.resolve(__dirname, "../../../../../AppData/Local/Yarn/Cache/v6/npm-ws-8.14.2-6c249a806eb2db7a20d26d51e7709eab7b2e6c7f-integrity/node_modules/ws/"),
      packageDependencies: new Map([
        ["ws", "8.14.2"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["copy-webpack-plugin", "11.0.0"],
        ["webpack", "5.89.0"],
        ["webpack-cli", "5.1.4"],
        ["webpack-dev-server", "4.15.1"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-copy-webpack-plugin-11.0.0-96d4dbdb5f73d02dd72d0528d1958721ab72e04a-integrity/node_modules/copy-webpack-plugin/", {"name":"copy-webpack-plugin","reference":"11.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-glob-3.3.1-784b4e897340f3dbbef17413b3f11acf03c874c4-integrity/node_modules/fast-glob/", {"name":"fast-glob","reference":"3.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-stat-2.0.5-5bd262af94e9d25bd1e71b05deed44876a222e8b-integrity/node_modules/@nodelib/fs.stat/", {"name":"@nodelib/fs.stat","reference":"2.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-walk-1.2.8-e95737e8bb6746ddedf69c556953494f196fe69a-integrity/node_modules/@nodelib/fs.walk/", {"name":"@nodelib/fs.walk","reference":"1.2.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-scandir-2.1.5-7619c2eb21b25483f6d167548b4cfd5a7488c3d5-integrity/node_modules/@nodelib/fs.scandir/", {"name":"@nodelib/fs.scandir","reference":"2.1.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-run-parallel-1.2.0-66d1368da7bdf921eb9d95bd1a9229e7f21a43ee-integrity/node_modules/run-parallel/", {"name":"run-parallel","reference":"1.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-queue-microtask-1.2.3-4929228bbc724dfac43e0efb058caf7b6cfb6243-integrity/node_modules/queue-microtask/", {"name":"queue-microtask","reference":"1.2.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fastq-1.15.0-d04d07c6a2a68fe4599fea8d2e103a937fae6b3a-integrity/node_modules/fastq/", {"name":"fastq","reference":"1.15.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-reusify-1.0.4-90da382b1e126efc02146e90845a88db12925d76-integrity/node_modules/reusify/", {"name":"reusify","reference":"1.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.2-869832c58034fe68a4093c17dc15e8340d8401c4-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"5.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-parent-6.0.2-6d237d99083950c79290f24c7642a3de9a28f9e3-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"6.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.3-64f61e42cbbb2eec2071a9dac0b28ba1e65d5084-integrity/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-merge2-1.4.1-4368892f885e907455a6fd7dc55c0c9d404990ae-integrity/node_modules/merge2/", {"name":"merge2","reference":"1.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.5-bc8999a7cbbf77cdc89f132f6e467051b49090c6-integrity/node_modules/micromatch/", {"name":"micromatch","reference":"4.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/", {"name":"braces","reference":"3.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/", {"name":"fill-range","reference":"7.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"5.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/", {"name":"is-number","reference":"7.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-picomatch-2.3.1-3ba3833733646d9d3e4995946c1365a67fb07a42-integrity/node_modules/picomatch/", {"name":"picomatch","reference":"2.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-globby-13.2.2-63b90b1bf68619c2135475cbd4e71e66aa090592-integrity/node_modules/globby/", {"name":"globby","reference":"13.2.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-dir-glob-3.0.1-56dbf73d992a4a93ba1584f4534063fd2e41717f-integrity/node_modules/dir-glob/", {"name":"dir-glob","reference":"3.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-type-4.0.0-84ed01c0a7ba380afe09d90a8c180dcd9d03043b-integrity/node_modules/path-type/", {"name":"path-type","reference":"4.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ignore-5.2.4-a291c0c6178ff1b960befe47fcdec301674a6324-integrity/node_modules/ignore/", {"name":"ignore","reference":"5.2.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-slash-4.0.0-2422372176c4c6c5addb5e2ada885af984b396a7-integrity/node_modules/slash/", {"name":"slash","reference":"4.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/", {"name":"normalize-path","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-schema-utils-4.2.0-70d7c93e153a273a805801882ebd3bff20d89c8b-integrity/node_modules/schema-utils/", {"name":"schema-utils","reference":"4.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-schema-utils-3.3.0-f50a88877c3c01652a15b622ae9e9795df7a60fe-integrity/node_modules/schema-utils/", {"name":"schema-utils","reference":"3.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-json-schema-7.0.14-74a97a5573980802f32c8e47b663530ab3b6b7d1-integrity/node_modules/@types/json-schema/", {"name":"@types/json-schema","reference":"7.0.14"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-8.12.0-d1a0527323e22f53562c567c00991577dfbe19d1-integrity/node_modules/ajv/", {"name":"ajv","reference":"8.12.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4-integrity/node_modules/ajv/", {"name":"ajv","reference":"6.12.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525-integrity/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"3.1.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-1.0.0-ae7bcb3656ab77a73ba5c49bf654f38e6b6860e2-integrity/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-require-from-string-2.0.2-89a7fdd938261267318eafe14f9c32e598c36909-integrity/node_modules/require-from-string/", {"name":"require-from-string","reference":"2.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-uri-js-4.4.1-9b1a52595225859e55f669d928f88c6c57f2a77e-integrity/node_modules/uri-js/", {"name":"uri-js","reference":"4.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-punycode-2.3.1-027422e2faec0b25e1549c3e1bd8309b9133b6e5-integrity/node_modules/punycode/", {"name":"punycode","reference":"2.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-formats-2.1.1-6e669400659eb74973bbf2e33327180a0996b520-integrity/node_modules/ajv-formats/", {"name":"ajv-formats","reference":"2.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-5.1.0-69d4d385a4733cdbeab44964a1170a88f87f0e16-integrity/node_modules/ajv-keywords/", {"name":"ajv-keywords","reference":"5.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-3.5.2-31f29da5ab6e00d1c2d329acf7b5929614d5014d-integrity/node_modules/ajv-keywords/", {"name":"ajv-keywords","reference":"3.5.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.1-b206efb27c3da0b0ab6b52f48d170b7996458e5c-integrity/node_modules/serialize-javascript/", {"name":"serialize-javascript","reference":"6.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a-integrity/node_modules/randombytes/", {"name":"randombytes","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-5.89.0-56b8bf9a34356e93a6625770006490bf3a7f32dc-integrity/node_modules/webpack/", {"name":"webpack","reference":"5.89.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-eslint-scope-3.7.6-585578b368ed170e67de8aae7b93f54a1b2fdc26-integrity/node_modules/@types/eslint-scope/", {"name":"@types/eslint-scope","reference":"3.7.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-eslint-8.44.6-60e564551966dd255f4c01c459f0b4fb87068603-integrity/node_modules/@types/eslint/", {"name":"@types/eslint","reference":"8.44.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-estree-1.0.4-d9748f5742171b26218516cf1828b8eafaf8a9fa-integrity/node_modules/@types/estree/", {"name":"@types/estree","reference":"1.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ast-1.11.6-db046555d3c413f8966ca50a95176a0e2c642e24-integrity/node_modules/@webassemblyjs/ast/", {"name":"@webassemblyjs/ast","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-numbers-1.11.6-cbce5e7e0c1bd32cf4905ae444ef64cea919f1b5-integrity/node_modules/@webassemblyjs/helper-numbers/", {"name":"@webassemblyjs/helper-numbers","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-floating-point-hex-parser-1.11.6-dacbcb95aff135c8260f77fa3b4c5fea600a6431-integrity/node_modules/@webassemblyjs/floating-point-hex-parser/", {"name":"@webassemblyjs/floating-point-hex-parser","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-api-error-1.11.6-6132f68c4acd59dcd141c44b18cbebbd9f2fa768-integrity/node_modules/@webassemblyjs/helper-api-error/", {"name":"@webassemblyjs/helper-api-error","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@xtuc-long-4.2.2-d291c6a4e97989b5c61d9acf396ae4fe133a718d-integrity/node_modules/@xtuc/long/", {"name":"@xtuc/long","reference":"4.2.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-bytecode-1.11.6-bb2ebdb3b83aa26d9baad4c46d4315283acd51e9-integrity/node_modules/@webassemblyjs/helper-wasm-bytecode/", {"name":"@webassemblyjs/helper-wasm-bytecode","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-edit-1.11.6-c72fa8220524c9b416249f3d94c2958dfe70ceab-integrity/node_modules/@webassemblyjs/wasm-edit/", {"name":"@webassemblyjs/wasm-edit","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-buffer-1.11.6-b66d73c43e296fd5e88006f18524feb0f2c7c093-integrity/node_modules/@webassemblyjs/helper-buffer/", {"name":"@webassemblyjs/helper-buffer","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-section-1.11.6-ff97f3863c55ee7f580fd5c41a381e9def4aa577-integrity/node_modules/@webassemblyjs/helper-wasm-section/", {"name":"@webassemblyjs/helper-wasm-section","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-gen-1.11.6-fb5283e0e8b4551cc4e9c3c0d7184a65faf7c268-integrity/node_modules/@webassemblyjs/wasm-gen/", {"name":"@webassemblyjs/wasm-gen","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ieee754-1.11.6-bb665c91d0b14fffceb0e38298c329af043c6e3a-integrity/node_modules/@webassemblyjs/ieee754/", {"name":"@webassemblyjs/ieee754","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@xtuc-ieee754-1.2.0-eef014a3145ae477a1cbc00cd1e552336dceb790-integrity/node_modules/@xtuc/ieee754/", {"name":"@xtuc/ieee754","reference":"1.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-leb128-1.11.6-70e60e5e82f9ac81118bc25381a0b283893240d7-integrity/node_modules/@webassemblyjs/leb128/", {"name":"@webassemblyjs/leb128","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-utf8-1.11.6-90f8bc34c561595fe156603be7253cdbcd0fab5a-integrity/node_modules/@webassemblyjs/utf8/", {"name":"@webassemblyjs/utf8","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-opt-1.11.6-d9a22d651248422ca498b09aa3232a81041487c2-integrity/node_modules/@webassemblyjs/wasm-opt/", {"name":"@webassemblyjs/wasm-opt","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-parser-1.11.6-bb85378c527df824004812bbdb784eea539174a1-integrity/node_modules/@webassemblyjs/wasm-parser/", {"name":"@webassemblyjs/wasm-parser","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wast-printer-1.11.6-a7bf8dd7e362aeb1668ff43f35cb849f188eff20-integrity/node_modules/@webassemblyjs/wast-printer/", {"name":"@webassemblyjs/wast-printer","reference":"1.11.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-8.11.2-ca0d78b51895be5390a5903c5b3bdcdaf78ae40b-integrity/node_modules/acorn/", {"name":"acorn","reference":"8.11.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-acorn-import-assertions-1.9.0-507276249d684797c84e0734ef84860334cfb1ac-integrity/node_modules/acorn-import-assertions/", {"name":"acorn-import-assertions","reference":"1.9.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-browserslist-4.22.1-ba91958d1a59b87dab6fed8dfbcb3da5e2e9c619-integrity/node_modules/browserslist/", {"name":"browserslist","reference":"4.22.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-caniuse-lite-1.0.30001561-752f21f56f96f1b1a52e97aae98c57c562d5d9da-integrity/node_modules/caniuse-lite/", {"name":"caniuse-lite","reference":"1.0.30001561"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-electron-to-chromium-1.4.576-0c6940fdc0d60f7e34bd742b29d8fa847c9294d1-integrity/node_modules/electron-to-chromium/", {"name":"electron-to-chromium","reference":"1.4.576"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-node-releases-2.0.13-d5ed1627c23e3461e819b02e57b75e4899b1c81d-integrity/node_modules/node-releases/", {"name":"node-releases","reference":"2.0.13"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-update-browserslist-db-1.0.13-3c5e4f5c083661bd38ef64b6328c26ed6c8248c4-integrity/node_modules/update-browserslist-db/", {"name":"update-browserslist-db","reference":"1.0.13"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-escalade-3.1.1-d8cfdc7000965c5a0174b4a82eaa5c0552742e40-integrity/node_modules/escalade/", {"name":"escalade","reference":"3.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-picocolors-1.0.0-cb5bdc74ff3f51892236eaf79d68bc44564ab81c-integrity/node_modules/picocolors/", {"name":"picocolors","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-chrome-trace-event-1.0.3-1015eced4741e15d06664a957dbbf50d041e26ac-integrity/node_modules/chrome-trace-event/", {"name":"chrome-trace-event","reference":"1.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-enhanced-resolve-5.15.0-1af946c7d93603eb88e9896cee4904dc012e9c35-integrity/node_modules/enhanced-resolve/", {"name":"enhanced-resolve","reference":"5.15.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-graceful-fs-4.2.11-4183e4e8bf08bb6e05bbb2f7d2e0c8f712ca40e3-integrity/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.11"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-tapable-2.2.1-1967a73ef4060a82f12ab96af86d52fdb76eeca0-integrity/node_modules/tapable/", {"name":"tapable","reference":"2.2.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-es-module-lexer-1.3.1-c1b0dd5ada807a3b3155315911f364dc4e909db1-integrity/node_modules/es-module-lexer/", {"name":"es-module-lexer","reference":"1.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-eslint-scope-5.1.1-e786e59a66cb92b3f6c1fb0d508aab174848f48c-integrity/node_modules/eslint-scope/", {"name":"eslint-scope","reference":"5.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-esrecurse-4.3.0-7ad7964d679abb28bee72cec63758b1c5d2c9921-integrity/node_modules/esrecurse/", {"name":"esrecurse","reference":"4.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-estraverse-5.3.0-2eea5290702f26ab8fe5370370ff86c965d21123-integrity/node_modules/estraverse/", {"name":"estraverse","reference":"5.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/", {"name":"estraverse","reference":"4.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-events-3.3.0-31a95ad0a924e2d2c419a813aeb2c4e878ea7400-integrity/node_modules/events/", {"name":"events","reference":"3.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-to-regexp-0.4.1-c75297087c851b9a578bd217dd59a92f59fe546e-integrity/node_modules/glob-to-regexp/", {"name":"glob-to-regexp","reference":"0.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d-integrity/node_modules/json-parse-even-better-errors/", {"name":"json-parse-even-better-errors","reference":"2.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-loader-runner-4.3.0-c1b4a163b99f614830353b16755e7149ac2314e1-integrity/node_modules/loader-runner/", {"name":"loader-runner","reference":"4.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-types-2.1.35-381a871b62a734450660ae3deee44813f70d959a-integrity/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.35"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-db-1.52.0-bbabcdc02859f4987301c856e3387ce5ec43bf70-integrity/node_modules/mime-db/", {"name":"mime-db","reference":"1.52.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-neo-async-2.6.2-b4aafb93e3aeb2d8174ca53cf163ab7d7308305f-integrity/node_modules/neo-async/", {"name":"neo-async","reference":"2.6.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-terser-webpack-plugin-5.3.9-832536999c51b46d468067f9e37662a3b96adfe1-integrity/node_modules/terser-webpack-plugin/", {"name":"terser-webpack-plugin","reference":"5.3.9"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-trace-mapping-0.3.20-72e45707cf240fa6b081d0366f8265b0cd10197f-integrity/node_modules/@jridgewell/trace-mapping/", {"name":"@jridgewell/trace-mapping","reference":"0.3.20"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-resolve-uri-3.1.1-c08679063f279615a3326583ba3a90d1d82cc721-integrity/node_modules/@jridgewell/resolve-uri/", {"name":"@jridgewell/resolve-uri","reference":"3.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-sourcemap-codec-1.4.15-d7c6e6755c78567a951e04ab52ef0fd26de59f32-integrity/node_modules/@jridgewell/sourcemap-codec/", {"name":"@jridgewell/sourcemap-codec","reference":"1.4.15"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-jest-worker-27.5.1-8d146f0900e8973b106b6f73cc1e9a8cb86f8db0-integrity/node_modules/jest-worker/", {"name":"jest-worker","reference":"27.5.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-20.8.10-a5448b895c753ae929c26ce85cab557c6d4a365e-integrity/node_modules/@types/node/", {"name":"@types/node","reference":"20.8.10"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-undici-types-5.26.5-bcd539893d00b56e964fd2657a4866b221a65617-integrity/node_modules/undici-types/", {"name":"undici-types","reference":"5.26.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/", {"name":"merge-stream","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-supports-color-8.1.1-cd6fc17e28500cff56c1b86c0a7fd4a54a73005c-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"8.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b-integrity/node_modules/has-flag/", {"name":"has-flag","reference":"4.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-terser-5.24.0-4ae50302977bca4831ccc7b4fef63a3c04228364-integrity/node_modules/terser/", {"name":"terser","reference":"5.24.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-source-map-0.3.5-a3bb4d5c6825aab0d281268f47f6ad5853431e91-integrity/node_modules/@jridgewell/source-map/", {"name":"@jridgewell/source-map","reference":"0.3.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-gen-mapping-0.3.3-7e02e6eb5df901aaedb08514203b096614024098-integrity/node_modules/@jridgewell/gen-mapping/", {"name":"@jridgewell/gen-mapping","reference":"0.3.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@jridgewell-set-array-1.1.2-7c6cf998d6d20b914c0a55a91ae928ff25965e72-integrity/node_modules/@jridgewell/set-array/", {"name":"@jridgewell/set-array","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/", {"name":"commander","reference":"2.20.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-commander-10.0.1-881ee46b4f77d1c1dccc5823433aa39b022cbe06-integrity/node_modules/commander/", {"name":"commander","reference":"10.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.21-04fe7c7f9e1ed2d662233c28cb2b35b9f63f6e4f-integrity/node_modules/source-map-support/", {"name":"source-map-support","reference":"0.5.21"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.2-2b146a6fd72e80b4f55d255f35ed59a3a9a41bd5-integrity/node_modules/buffer-from/", {"name":"buffer-from","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-watchpack-2.4.0-fa33032374962c78113f93c7f2fb4c54c9862a5d-integrity/node_modules/watchpack/", {"name":"watchpack","reference":"2.4.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-sources-3.2.3-2d4daab8451fd4b240cc27055ff6a0c2ccea0cde-integrity/node_modules/webpack-sources/", {"name":"webpack-sources","reference":"3.2.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-cli-5.1.4-c8e046ba7eaae4911d7e71e2b25b776fcc35759b-integrity/node_modules/webpack-cli/", {"name":"webpack-cli","reference":"5.1.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@discoveryjs-json-ext-0.5.7-1d572bfbbe14b7704e0ba0f39b74815b84870d70-integrity/node_modules/@discoveryjs/json-ext/", {"name":"@discoveryjs/json-ext","reference":"0.5.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-configtest-2.1.1-3b2f852e91dac6e3b85fb2a314fb8bef46d94646-integrity/node_modules/@webpack-cli/configtest/", {"name":"@webpack-cli/configtest","reference":"2.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-info-2.0.2-cc3fbf22efeb88ff62310cf885c5b09f44ae0fdd-integrity/node_modules/@webpack-cli/info/", {"name":"@webpack-cli/info","reference":"2.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-serve-2.0.5-325db42395cd49fe6c14057f9a900e427df8810e-integrity/node_modules/@webpack-cli/serve/", {"name":"@webpack-cli/serve","reference":"2.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-colorette-2.0.20-9eb793e6833067f7235902fcd3b09917a000a95a-integrity/node_modules/colorette/", {"name":"colorette","reference":"2.0.20"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6-integrity/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"7.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375-integrity/node_modules/path-key/", {"name":"path-key","reference":"3.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea-integrity/node_modules/shebang-command/", {"name":"shebang-command","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172-integrity/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1-integrity/node_modules/which/", {"name":"which","reference":"2.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-envinfo-7.11.0-c3793f44284a55ff8c82faf1ffd91bc6478ea01f-integrity/node_modules/envinfo/", {"name":"envinfo","reference":"7.11.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fastest-levenshtein-1.0.16-210e61b6ff181de91ea9b3d1b84fdedd47e034e5-integrity/node_modules/fastest-levenshtein/", {"name":"fastest-levenshtein","reference":"1.0.16"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-import-local-3.1.0-b4479df8a5fd44f6cdce24070675676063c95cb4-integrity/node_modules/import-local/", {"name":"import-local","reference":"3.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3-integrity/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"4.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19-integrity/node_modules/find-up/", {"name":"find-up","reference":"4.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0-integrity/node_modules/locate-path/", {"name":"locate-path","reference":"5.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07-integrity/node_modules/p-locate/", {"name":"p-locate","reference":"4.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1-integrity/node_modules/p-limit/", {"name":"p-limit","reference":"2.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6-integrity/node_modules/p-try/", {"name":"p-try","reference":"2.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3-integrity/node_modules/path-exists/", {"name":"path-exists","reference":"4.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d-integrity/node_modules/resolve-cwd/", {"name":"resolve-cwd","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69-integrity/node_modules/resolve-from/", {"name":"resolve-from","reference":"5.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-interpret-3.1.1-5be0ceed67ca79c6c4bc5cf0d7ee843dcea110c4-integrity/node_modules/interpret/", {"name":"interpret","reference":"3.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-rechoir-0.8.0-49f866e0d32146142da3ad8f0eff352b3215ff22-integrity/node_modules/rechoir/", {"name":"rechoir","reference":"0.8.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-resolve-1.22.8-b6c87a9f2aa06dfab52e3d70ac8cde321fa5a48d-integrity/node_modules/resolve/", {"name":"resolve","reference":"1.22.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-core-module-2.13.1-ad0d7532c6fea9da1ebdc82742d74525c6273384-integrity/node_modules/is-core-module/", {"name":"is-core-module","reference":"2.13.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-hasown-2.0.0-f4c513d454a57b7c7e1650778de226b11700546c-integrity/node_modules/hasown/", {"name":"hasown","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-function-bind-1.1.2-2c02d864d97f3ea6c8830c464cbd11ab6eab7a1c-integrity/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.7-fbc114b60ca42b30d9daf5858e4bd68bbedb6735-integrity/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-supports-preserve-symlinks-flag-1.0.0-6eda4bd344a3c94aea376d4cc31bc77311039e09-integrity/node_modules/supports-preserve-symlinks-flag/", {"name":"supports-preserve-symlinks-flag","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-merge-5.10.0-a3ad5d773241e9c682803abf628d4cd62b8a4177-integrity/node_modules/webpack-merge/", {"name":"webpack-merge","reference":"5.10.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-clone-deep-4.0.1-c19fd9bdbbf85942b4fd979c84dcf7d5f07c2387-integrity/node_modules/clone-deep/", {"name":"clone-deep","reference":"4.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677-integrity/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df-integrity/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd-integrity/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-shallow-clone-3.0.1-8f2981ad92531f55035b01fb230769a40e02efa3-integrity/node_modules/shallow-clone/", {"name":"shallow-clone","reference":"3.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-flat-5.0.2-8ca6fe332069ffa9d324c327198c598259ceb241-integrity/node_modules/flat/", {"name":"flat","reference":"5.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-wildcard-2.0.1-5ab10d02487198954836b6349f74fff961e10f67-integrity/node_modules/wildcard/", {"name":"wildcard","reference":"2.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-dev-server-4.15.1-8944b29c12760b3a45bdaa70799b17cb91b03df7-integrity/node_modules/webpack-dev-server/", {"name":"webpack-dev-server","reference":"4.15.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-bonjour-3.5.12-49badafb988e6c433ca675a5fd769b93b7649fc8-integrity/node_modules/@types/bonjour/", {"name":"@types/bonjour","reference":"3.5.12"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-connect-history-api-fallback-1.5.2-acf51e088b3bb6507f7b093bd2b0de20940179cc-integrity/node_modules/@types/connect-history-api-fallback/", {"name":"@types/connect-history-api-fallback","reference":"1.5.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-express-serve-static-core-4.17.39-2107afc0a4b035e6cb00accac3bdf2d76ae408c8-integrity/node_modules/@types/express-serve-static-core/", {"name":"@types/express-serve-static-core","reference":"4.17.39"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-qs-6.9.9-66f7b26288f6799d279edf13da7ccd40d2fa9197-integrity/node_modules/@types/qs/", {"name":"@types/qs","reference":"6.9.9"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-range-parser-1.2.6-7cb33992049fd7340d5b10c0098e104184dfcd2a-integrity/node_modules/@types/range-parser/", {"name":"@types/range-parser","reference":"1.2.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-send-0.17.3-81b2ea5a3a18aad357405af2d643ccbe5a09020b-integrity/node_modules/@types/send/", {"name":"@types/send","reference":"0.17.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-mime-1.3.4-a4ed836e069491414bab92c31fdea9e557aca0d9-integrity/node_modules/@types/mime/", {"name":"@types/mime","reference":"1.3.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-mime-3.0.3-886674659ce55fe7c6c06ec5ca7c0eb276a08f91-integrity/node_modules/@types/mime/", {"name":"@types/mime","reference":"3.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-express-4.17.20-e7c9b40276d29e38a4e3564d7a3d65911e2aa433-integrity/node_modules/@types/express/", {"name":"@types/express","reference":"4.17.20"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-body-parser-1.19.4-78ad68f1f79eb851aa3634db0c7f57f6f601b462-integrity/node_modules/@types/body-parser/", {"name":"@types/body-parser","reference":"1.19.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-connect-3.4.37-c66a96689fd3127c8772eb3e9e5c6028ec1a9af5-integrity/node_modules/@types/connect/", {"name":"@types/connect","reference":"3.4.37"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-serve-static-1.15.4-44b5895a68ca637f06c229119e1c774ca88f81b2-integrity/node_modules/@types/serve-static/", {"name":"@types/serve-static","reference":"1.15.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-http-errors-2.0.3-c54e61f79b3947d040f150abd58f71efb422ff62-integrity/node_modules/@types/http-errors/", {"name":"@types/http-errors","reference":"2.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-serve-index-1.9.3-af9403916eb6fbf7d6ec6f47b2a4c46eb3222cc9-integrity/node_modules/@types/serve-index/", {"name":"@types/serve-index","reference":"1.9.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-sockjs-0.3.35-f4a568c73d2a8071944bd6ffdca0d4e66810cd21-integrity/node_modules/@types/sockjs/", {"name":"@types/sockjs","reference":"0.3.35"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-ws-8.5.8-13efec7bd439d0bdf2af93030804a94f163b1430-integrity/node_modules/@types/ws/", {"name":"@types/ws","reference":"8.5.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ansi-html-community-0.0.8-69fbc4d6ccbe383f9736934ae34c3f8290f1bf41-integrity/node_modules/ansi-html-community/", {"name":"ansi-html-community","reference":"0.0.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-bonjour-service-1.1.1-960948fa0e0153f5d26743ab15baf8e33752c135-integrity/node_modules/bonjour-service/", {"name":"bonjour-service","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-array-flatten-2.1.2-24ef80a28c1a893617e2149b0c6d0d788293b099-integrity/node_modules/array-flatten/", {"name":"array-flatten","reference":"2.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-array-flatten-1.1.1-9a5f699051b1e7073328f2a008968b64ea2955d2-integrity/node_modules/array-flatten/", {"name":"array-flatten","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-dns-equal-1.0.0-b39e7f1da6eb0a75ba9c17324b34753c47e0654d-integrity/node_modules/dns-equal/", {"name":"dns-equal","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-multicast-dns-7.2.5-77eb46057f4d7adbd16d9290fa7299f6fa64cced-integrity/node_modules/multicast-dns/", {"name":"multicast-dns","reference":"7.2.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-dns-packet-5.6.1-ae888ad425a9d1478a0674256ab866de1012cf2f-integrity/node_modules/dns-packet/", {"name":"dns-packet","reference":"5.6.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@leichtgewicht-ip-codec-2.0.4-b2ac626d6cb9c8718ab459166d4bb405b8ffa78b-integrity/node_modules/@leichtgewicht/ip-codec/", {"name":"@leichtgewicht/ip-codec","reference":"2.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-thunky-1.1.0-5abaf714a9405db0504732bbccd2cedd9ef9537d-integrity/node_modules/thunky/", {"name":"thunky","reference":"1.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-chokidar-3.5.3-1cf37c8707b932bd1af1ae22c0432e2acd1903bd-integrity/node_modules/chokidar/", {"name":"chokidar","reference":"3.5.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.3-790c58b19ba1720a84205b57c618d5ad8524973e-integrity/node_modules/anymatch/", {"name":"anymatch","reference":"3.1.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/", {"name":"is-binary-path","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.2.0-75f502eeaf9ffde42fc98829645be4ea76bd9e2d-integrity/node_modules/binary-extensions/", {"name":"binary-extensions","reference":"2.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-readdirp-3.6.0-74a370bd857116e245b29cc97340cd431a02a6c7-integrity/node_modules/readdirp/", {"name":"readdirp","reference":"3.6.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-compression-1.7.4-95523eff170ca57c29a0ca41e6fe131f41e5bb8f-integrity/node_modules/compression/", {"name":"compression","reference":"1.7.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-accepts-1.3.8-0bf0be125b67014adcb0b0921e62db7bffe16b2e-integrity/node_modules/accepts/", {"name":"accepts","reference":"1.3.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-negotiator-0.6.3-58e323a72fedc0d6f9cd4d31fe49f51479590ccd-integrity/node_modules/negotiator/", {"name":"negotiator","reference":"0.6.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-bytes-3.0.0-d32815404d689699f85a4ea4fa8755dd13a96048-integrity/node_modules/bytes/", {"name":"bytes","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-bytes-3.1.2-8b0beeb98605adf1b128fa4386403c009e0221a5-integrity/node_modules/bytes/", {"name":"bytes","reference":"3.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-compressible-2.0.18-af53cca6b070d4c3c0750fbd77286a6d7cc46fba-integrity/node_modules/compressible/", {"name":"compressible","reference":"2.0.18"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-debug-2.6.9-5d128515df134ff327e90a4c93f4e077a536341f-integrity/node_modules/debug/", {"name":"debug","reference":"2.6.9"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-debug-4.3.4-1319f6579357f2338d3337d2cdd4914bb5dcc865-integrity/node_modules/debug/", {"name":"debug","reference":"4.3.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.0.0-5608aeadfc00be6c2901df5f9861788de0d597c8-integrity/node_modules/ms/", {"name":"ms","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.1.3-574c8138ce1d2b5861f0b44579dbadd60c6615b2-integrity/node_modules/ms/", {"name":"ms","reference":"2.1.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-on-headers-1.0.2-772b0ae6aaa525c399e489adfad90c403eb3c28f-integrity/node_modules/on-headers/", {"name":"on-headers","reference":"1.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-vary-1.1.2-2299f02c6ded30d4a5961b0b9f74524a18f634fc-integrity/node_modules/vary/", {"name":"vary","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-connect-history-api-fallback-2.0.0-647264845251a0daf25b97ce87834cace0f5f1c8-integrity/node_modules/connect-history-api-fallback/", {"name":"connect-history-api-fallback","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-default-gateway-6.0.3-819494c888053bdb743edbf343d6cdf7f2943a71-integrity/node_modules/default-gateway/", {"name":"default-gateway","reference":"6.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-execa-5.1.1-f80ad9cbf4298f7bd1d4c9555c21e93741c411dd-integrity/node_modules/execa/", {"name":"execa","reference":"5.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-get-stream-6.0.1-a262d8eef67aced57c2852ad6167526a43cbf7b7-integrity/node_modules/get-stream/", {"name":"get-stream","reference":"6.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-human-signals-2.1.0-dc91fcba42e4d06e4abaed33b3e7a3c02f514ea0-integrity/node_modules/human-signals/", {"name":"human-signals","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-stream-2.0.1-fac1e3d53b97ad5a9d0ae9cef2389f5810a5c077-integrity/node_modules/is-stream/", {"name":"is-stream","reference":"2.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-npm-run-path-4.0.1-b7ecd1e5ed53da8e37a55e1c2269e0b97ed748ea-integrity/node_modules/npm-run-path/", {"name":"npm-run-path","reference":"4.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-onetime-5.1.2-d0e96ebb56b07476df1dd9c4806e5237985ca45e-integrity/node_modules/onetime/", {"name":"onetime","reference":"5.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-mimic-fn-2.1.0-7ed2c2ccccaf84d3ffcb7a69b57711fc2083401b-integrity/node_modules/mimic-fn/", {"name":"mimic-fn","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-signal-exit-3.0.7-a9a1767f8af84155114eaabd73f99273c8f59ad9-integrity/node_modules/signal-exit/", {"name":"signal-exit","reference":"3.0.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-strip-final-newline-2.0.0-89b852fb2fcbe936f6f4b3187afb0a12c1ab58ad-integrity/node_modules/strip-final-newline/", {"name":"strip-final-newline","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-express-4.18.2-3fabe08296e930c796c19e3c516979386ba9fd59-integrity/node_modules/express/", {"name":"express","reference":"4.18.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-body-parser-1.20.1-b1812a8912c195cd371a3ee5e66faa2338a5c668-integrity/node_modules/body-parser/", {"name":"body-parser","reference":"1.20.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-content-type-1.0.5-8b773162656d1d1086784c8f23a54ce6d73d7918-integrity/node_modules/content-type/", {"name":"content-type","reference":"1.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-depd-2.0.0-b696163cc757560d09cf22cc8fad1571b79e76df-integrity/node_modules/depd/", {"name":"depd","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-depd-1.1.2-9bcd52e14c097763e749b274c4346ed2e560b5a9-integrity/node_modules/depd/", {"name":"depd","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-destroy-1.2.0-4803735509ad8be552934c67df614f94e66fa015-integrity/node_modules/destroy/", {"name":"destroy","reference":"1.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-errors-2.0.0-b7774a1486ef73cf7667ac9ae0858c012c57b9d3-integrity/node_modules/http-errors/", {"name":"http-errors","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-errors-1.6.3-8b55680bb4be283a0b5bf4ea2e38580be1d9320d-integrity/node_modules/http-errors/", {"name":"http-errors","reference":"1.6.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.3-633c2c83e3da42a502f52466022480f4208261de-integrity/node_modules/inherits/", {"name":"inherits","reference":"2.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-setprototypeof-1.2.0-66c9a24a73f9fc28cbe66b09fed3d33dcaf1b424-integrity/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-setprototypeof-1.1.0-d0bd85536887b6fe7c0d818cb962d9d91c54e656-integrity/node_modules/setprototypeof/", {"name":"setprototypeof","reference":"1.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-statuses-2.0.1-55cb000ccf1d48728bd23c685a063998cf1a1b63-integrity/node_modules/statuses/", {"name":"statuses","reference":"2.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-statuses-1.5.0-161c7dac177659fd9811f43771fa99381478628c-integrity/node_modules/statuses/", {"name":"statuses","reference":"1.5.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-toidentifier-1.0.1-3be34321a88a820ed1bd80dfaa33e479fbb8dd35-integrity/node_modules/toidentifier/", {"name":"toidentifier","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-iconv-lite-0.4.24-2022b4b25fbddc21d2f524974a474aafe733908b-integrity/node_modules/iconv-lite/", {"name":"iconv-lite","reference":"0.4.24"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-safer-buffer-2.1.2-44fa161b0187b9549dd84bb91802f9bd8385cd6a-integrity/node_modules/safer-buffer/", {"name":"safer-buffer","reference":"2.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-on-finished-2.4.1-58c8c44116e54845ad57f14ab10b03533184ac3f-integrity/node_modules/on-finished/", {"name":"on-finished","reference":"2.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ee-first-1.1.1-590c61156b0ae2f4f0255732a158b266bc56b21d-integrity/node_modules/ee-first/", {"name":"ee-first","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-qs-6.11.0-fd0d963446f7a65e1367e01abd85429453f0c37a-integrity/node_modules/qs/", {"name":"qs","reference":"6.11.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-side-channel-1.0.4-efce5c8fdc104ee751b25c58d4290011fa5ea2cf-integrity/node_modules/side-channel/", {"name":"side-channel","reference":"1.0.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-call-bind-1.0.5-6fa2b7845ce0ea49bf4d8b9ef64727a2c2e2e513-integrity/node_modules/call-bind/", {"name":"call-bind","reference":"1.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-get-intrinsic-1.2.2-281b7622971123e1ef4b3c90fd7539306da93f3b-integrity/node_modules/get-intrinsic/", {"name":"get-intrinsic","reference":"1.2.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-has-proto-1.0.1-1885c1305538958aff469fef37937c22795408e0-integrity/node_modules/has-proto/", {"name":"has-proto","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-has-symbols-1.0.3-bb7b2c4349251dce87b125f7bdf874aa7c8b39f8-integrity/node_modules/has-symbols/", {"name":"has-symbols","reference":"1.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-set-function-length-1.1.1-4bc39fafb0307224a33e106a7d35ca1218d659ed-integrity/node_modules/set-function-length/", {"name":"set-function-length","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-define-data-property-1.1.1-c35f7cd0ab09883480d12ac5cb213715587800b3-integrity/node_modules/define-data-property/", {"name":"define-data-property","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-gopd-1.0.1-29ff76de69dac7489b7c0918a5788e56477c332c-integrity/node_modules/gopd/", {"name":"gopd","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-has-property-descriptors-1.0.1-52ba30b6c5ec87fd89fa574bc1c39125c6f65340-integrity/node_modules/has-property-descriptors/", {"name":"has-property-descriptors","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-object-inspect-1.13.1-b96c6109324ccfef6b12216a956ca4dc2ff94bc2-integrity/node_modules/object-inspect/", {"name":"object-inspect","reference":"1.13.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-raw-body-2.5.1-fe1b1628b181b700215e5fd42389f98b71392857-integrity/node_modules/raw-body/", {"name":"raw-body","reference":"2.5.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-unpipe-1.0.0-b2bf4ee8514aae6165b4817829d21b2ef49904ec-integrity/node_modules/unpipe/", {"name":"unpipe","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-type-is-1.6.18-4e552cd05df09467dcbc4ef739de89f2cf37c131-integrity/node_modules/type-is/", {"name":"type-is","reference":"1.6.18"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-media-typer-0.3.0-8710d7af0aa626f8fffa1ce00168545263255748-integrity/node_modules/media-typer/", {"name":"media-typer","reference":"0.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-content-disposition-0.5.4-8b82b4efac82512a02bb0b1dcec9d2c5e8eb5bfe-integrity/node_modules/content-disposition/", {"name":"content-disposition","reference":"0.5.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-cookie-0.5.0-d1f5d71adec6558c58f389987c366aa47e994f8b-integrity/node_modules/cookie/", {"name":"cookie","reference":"0.5.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-cookie-signature-1.0.6-e303a882b342cc3ee8ca513a79999734dab3ae2c-integrity/node_modules/cookie-signature/", {"name":"cookie-signature","reference":"1.0.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-encodeurl-1.0.2-ad3ff4c86ec2d029322f5a02c3a9a606c95b3f59-integrity/node_modules/encodeurl/", {"name":"encodeurl","reference":"1.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-escape-html-1.0.3-0258eae4d3d0c0974de1c169188ef0051d1d1988-integrity/node_modules/escape-html/", {"name":"escape-html","reference":"1.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-etag-1.8.1-41ae2eeb65efa62268aebfea83ac7d79299b0887-integrity/node_modules/etag/", {"name":"etag","reference":"1.8.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-finalhandler-1.2.0-7d23fe5731b207b4640e4fcd00aec1f9207a7b32-integrity/node_modules/finalhandler/", {"name":"finalhandler","reference":"1.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-parseurl-1.3.3-9da19e7bee8d12dff0513ed5b76957793bc2e8d4-integrity/node_modules/parseurl/", {"name":"parseurl","reference":"1.3.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fresh-0.5.2-3d8cadd90d976569fa835ab1f8e4b23a105605a7-integrity/node_modules/fresh/", {"name":"fresh","reference":"0.5.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-merge-descriptors-1.0.1-b00aaa556dd8b44568150ec9d1b953f3f90cbb61-integrity/node_modules/merge-descriptors/", {"name":"merge-descriptors","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-methods-1.1.2-5529a4d67654134edcc5266656835b0f851afcee-integrity/node_modules/methods/", {"name":"methods","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-to-regexp-0.1.7-df604178005f522f15eb4490e7247a1bfaa67f8c-integrity/node_modules/path-to-regexp/", {"name":"path-to-regexp","reference":"0.1.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-proxy-addr-2.0.7-f19fe69ceab311eeb94b42e70e8c2070f9ba1025-integrity/node_modules/proxy-addr/", {"name":"proxy-addr","reference":"2.0.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-forwarded-0.2.0-2269936428aad4c15c7ebe9779a84bf0b2a81811-integrity/node_modules/forwarded/", {"name":"forwarded","reference":"0.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ipaddr-js-1.9.1-bff38543eeb8984825079ff3a2a8e6cbd46781b3-integrity/node_modules/ipaddr.js/", {"name":"ipaddr.js","reference":"1.9.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ipaddr-js-2.1.0-2119bc447ff8c257753b196fc5f1ce08a4cdf39f-integrity/node_modules/ipaddr.js/", {"name":"ipaddr.js","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-range-parser-1.2.1-3cf37023d199e1c24d1a55b84800c2f3e6468031-integrity/node_modules/range-parser/", {"name":"range-parser","reference":"1.2.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-send-0.18.0-670167cc654b05f5aa4a767f9113bb371bc706be-integrity/node_modules/send/", {"name":"send","reference":"0.18.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-mime-1.6.0-32cd9e5c64553bd58d19a568af452acff04981b1-integrity/node_modules/mime/", {"name":"mime","reference":"1.6.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-serve-static-1.15.0-faaef08cffe0a1a62f60cad0c4e513cff0ac9540-integrity/node_modules/serve-static/", {"name":"serve-static","reference":"1.15.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-utils-merge-1.0.1-9f95710f50a267947b2ccc124741c1028427e713-integrity/node_modules/utils-merge/", {"name":"utils-merge","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-html-entities-2.4.0-edd0cee70402584c8c76cc2c0556db09d1f45061-integrity/node_modules/html-entities/", {"name":"html-entities","reference":"2.4.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-proxy-middleware-2.0.6-e1a4dd6979572c7ab5a4e4b55095d1f32a74963f-integrity/node_modules/http-proxy-middleware/", {"name":"http-proxy-middleware","reference":"2.0.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-http-proxy-1.17.13-dd3a4da550580eb0557d4c7128a2ff1d1a38d465-integrity/node_modules/@types/http-proxy/", {"name":"@types/http-proxy","reference":"1.17.13"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-proxy-1.18.1-401541f0534884bbf95260334e72f88ee3976549-integrity/node_modules/http-proxy/", {"name":"http-proxy","reference":"1.18.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-eventemitter3-4.0.7-2de9b68f6528d5644ef5c59526a1b4a07306169f-integrity/node_modules/eventemitter3/", {"name":"eventemitter3","reference":"4.0.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-follow-redirects-1.15.3-fe2f3ef2690afce7e82ed0b44db08165b207123a-integrity/node_modules/follow-redirects/", {"name":"follow-redirects","reference":"1.15.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-requires-port-1.0.0-925d2601d39ac485e091cf0da5c6e694dc3dcaff-integrity/node_modules/requires-port/", {"name":"requires-port","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-plain-obj-3.0.0-af6f2ea14ac5a646183a5bbdb5baabbc156ad9d7-integrity/node_modules/is-plain-obj/", {"name":"is-plain-obj","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-launch-editor-2.6.1-f259c9ef95cbc9425620bbbd14b468fcdb4ffe3c-integrity/node_modules/launch-editor/", {"name":"launch-editor","reference":"2.6.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-shell-quote-1.8.1-6dbf4db75515ad5bac63b4f1894c3a154c766680-integrity/node_modules/shell-quote/", {"name":"shell-quote","reference":"1.8.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-open-8.4.2-5b5ffe2a8f793dcd2aad73e550cb87b59cb084f9-integrity/node_modules/open/", {"name":"open","reference":"8.4.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-define-lazy-prop-2.0.0-3f7ae421129bcaaac9bc74905c98a0009ec9ee7f-integrity/node_modules/define-lazy-prop/", {"name":"define-lazy-prop","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-docker-2.2.1-33eeabe23cfe86f14bde4408a02c0cfb853acdaa-integrity/node_modules/is-docker/", {"name":"is-docker","reference":"2.2.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-is-wsl-2.2.0-74a4c76e77ca9fd3f932f290c17ea326cd157271-integrity/node_modules/is-wsl/", {"name":"is-wsl","reference":"2.2.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-p-retry-4.6.2-9baae7184057edd4e17231cee04264106e092a16-integrity/node_modules/p-retry/", {"name":"p-retry","reference":"4.6.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-retry-0.12.0-2b35eccfcee7d38cd72ad99232fbd58bffb3c84d-integrity/node_modules/@types/retry/", {"name":"@types/retry","reference":"0.12.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-retry-0.13.1-185b1587acf67919d63b357349e03537b2484658-integrity/node_modules/retry/", {"name":"retry","reference":"0.13.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a-integrity/node_modules/rimraf/", {"name":"rimraf","reference":"3.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-glob-7.2.3-b8df0fb802bbfa8e89bd1d938b4e16578ed44f2b-integrity/node_modules/glob/", {"name":"glob","reference":"7.2.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-minimatch-3.1.2-19cd194bfd3e428f049a70817c038d89ab4be35b-integrity/node_modules/minimatch/", {"name":"minimatch","reference":"3.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-balanced-match-1.0.2-e83e3a7e3f300b34cb9d87f615fa0cbf357690ee-integrity/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-selfsigned-2.4.1-560d90565442a3ed35b674034cec4e95dceb4ae0-integrity/node_modules/selfsigned/", {"name":"selfsigned","reference":"2.4.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-@types-node-forge-1.3.8-044ad98354ff309a031a55a40ad122f3be1ac2bb-integrity/node_modules/@types/node-forge/", {"name":"@types/node-forge","reference":"1.3.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-node-forge-1.3.1-be8da2af243b2417d5f646a770663a92b7e9ded3-integrity/node_modules/node-forge/", {"name":"node-forge","reference":"1.3.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-serve-index-1.9.1-d3768d69b1e7d82e5ce050fff5b453bea12a9239-integrity/node_modules/serve-index/", {"name":"serve-index","reference":"1.9.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-batch-0.6.1-dc34314f4e679318093fc760272525f94bf25c16-integrity/node_modules/batch/", {"name":"batch","reference":"0.6.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-sockjs-0.3.24-c9bc8995f33a111bea0395ec30aa3206bdb5ccce-integrity/node_modules/sockjs/", {"name":"sockjs","reference":"0.3.24"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-faye-websocket-0.11.4-7f0d9275cfdd86a1c963dc8b65fcc451edcbb1da-integrity/node_modules/faye-websocket/", {"name":"faye-websocket","reference":"0.11.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-websocket-driver-0.7.4-89ad5295bbf64b480abcba31e4953aca706f5760-integrity/node_modules/websocket-driver/", {"name":"websocket-driver","reference":"0.7.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-parser-js-0.5.8-af23090d9ac4e24573de6f6aecc9d84a48bf20e3-integrity/node_modules/http-parser-js/", {"name":"http-parser-js","reference":"0.5.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-websocket-extensions-0.1.4-7f8473bc839dfd87608adb95d7eb075211578a42-integrity/node_modules/websocket-extensions/", {"name":"websocket-extensions","reference":"0.1.4"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-uuid-8.3.2-80d5b5ced271bb9af6c445f21a1a04c606cefbe2-integrity/node_modules/uuid/", {"name":"uuid","reference":"8.3.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-spdy-4.0.2-b74f466203a3eda452c02492b91fb9e84a27677b-integrity/node_modules/spdy/", {"name":"spdy","reference":"4.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-handle-thing-2.0.1-857f79ce359580c340d43081cc648970d0bb234e-integrity/node_modules/handle-thing/", {"name":"handle-thing","reference":"2.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-http-deceiver-1.2.7-fa7168944ab9a519d337cb0bec7284dc3e723d87-integrity/node_modules/http-deceiver/", {"name":"http-deceiver","reference":"1.2.7"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-select-hose-2.0.0-625d8658f865af43ec962bfc376a37359a4994ca-integrity/node_modules/select-hose/", {"name":"select-hose","reference":"2.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-spdy-transport-3.0.0-00d4863a6400ad75df93361a1608605e5dcdcf31-integrity/node_modules/spdy-transport/", {"name":"spdy-transport","reference":"3.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-detect-node-2.1.0-c9c70775a49c3d03bc2c06d9a73be550f978f8b1-integrity/node_modules/detect-node/", {"name":"detect-node","reference":"2.1.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-hpack-js-2.1.6-87774c0949e513f42e84575b3c45681fade2a0b2-integrity/node_modules/hpack.js/", {"name":"hpack.js","reference":"2.1.6"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-obuf-1.1.2-09bea3343d41859ebd446292d11c9d4db619084e-integrity/node_modules/obuf/", {"name":"obuf","reference":"1.1.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-readable-stream-2.3.8-91125e8042bba1b9887f49345f6277027ce8be9b-integrity/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.8"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-readable-stream-3.6.2-56a9b36ea965c00c5a93ef31eb111a0f11056967-integrity/node_modules/readable-stream/", {"name":"readable-stream","reference":"3.6.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-core-util-is-1.0.3-a6042d3634c2b27e9328f837b965fac83808db85-integrity/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.3.0-42f114594a46cf1a8e30b0a84f56c78c3edac21e-integrity/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.3.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-wbuf-1.7.3-c1d8d149316d3ea852848895cb6a0bfe887b87df-integrity/node_modules/wbuf/", {"name":"wbuf","reference":"1.7.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-minimalistic-assert-1.0.1-2e194de044626d4a10e7f7fbc00ce73e83e4d5c7-integrity/node_modules/minimalistic-assert/", {"name":"minimalistic-assert","reference":"1.0.1"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-webpack-dev-middleware-5.3.3-efae67c2793908e7311f1d9b06f2a08dcc97e51f-integrity/node_modules/webpack-dev-middleware/", {"name":"webpack-dev-middleware","reference":"5.3.3"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-memfs-3.6.0-d7a2110f86f79dd950a8b6df6d57bc984aa185f6-integrity/node_modules/memfs/", {"name":"memfs","reference":"3.6.0"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-fs-monkey-1.0.5-fe450175f0db0d7ea758102e1d84096acb925788-integrity/node_modules/fs-monkey/", {"name":"fs-monkey","reference":"1.0.5"}],
  ["../../../../../AppData/Local/Yarn/Cache/v6/npm-ws-8.14.2-6c249a806eb2db7a20d26d51e7709eab7b2e6c7f-integrity/node_modules/ws/", {"name":"ws","reference":"8.14.2"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 200 && relativeLocation[199] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 200)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 190 && relativeLocation[189] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 190)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 189 && relativeLocation[188] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 189)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 188 && relativeLocation[187] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 188)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 185 && relativeLocation[184] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 185)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 182 && relativeLocation[181] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 182)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 181 && relativeLocation[180] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 181)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 178 && relativeLocation[177] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 178)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 177 && relativeLocation[176] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 177)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 176 && relativeLocation[175] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 176)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 175 && relativeLocation[174] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 175)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 174 && relativeLocation[173] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 174)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 172 && relativeLocation[171] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 172)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 171 && relativeLocation[170] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 171)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 170 && relativeLocation[169] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 170)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 168 && relativeLocation[167] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 168)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 167 && relativeLocation[166] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 167)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 166 && relativeLocation[165] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 166)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 165 && relativeLocation[164] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 165)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 164 && relativeLocation[163] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 164)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 163 && relativeLocation[162] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 163)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 162 && relativeLocation[161] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 162)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 161 && relativeLocation[160] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 161)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 159 && relativeLocation[158] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 159)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 158 && relativeLocation[157] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 158)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 157 && relativeLocation[156] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 157)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 156 && relativeLocation[155] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 156)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 155 && relativeLocation[154] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 155)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 153 && relativeLocation[152] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 153)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 152 && relativeLocation[151] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 152)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 151 && relativeLocation[150] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 151)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 148 && relativeLocation[147] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 148)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 142 && relativeLocation[141] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 142)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 130 && relativeLocation[129] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 130)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 128 && relativeLocation[127] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 128)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 127 && relativeLocation[126] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 127)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 126 && relativeLocation[125] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 126)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 124 && relativeLocation[123] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 124)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 123 && relativeLocation[122] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 123)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
