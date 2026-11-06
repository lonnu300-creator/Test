
/**
 * Farnava Android Preparation
 * Version: 1.0.1
 * Node.js 22+
 *
 * Run:
 * node scripts/prepare-android.mjs
 *
 * Required execution order:
 * npx cap sync android
 * node scripts/prepare-android.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ANDROID_DIR = path.join(ROOT, 'android');
const APP_DIR = path.join(ANDROID_DIR, 'app');
const APP_SRC_MAIN = path.join(APP_DIR, 'src', 'main');
const APP_RES = path.join(APP_SRC_MAIN, 'res');
const CUSTOM_RES = path.join(ROOT, 'android-resources', 'res');

const MIN_SDK = 24;
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function log(message) {
  console.log(`[Farnava] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function isFile(file) {
  return fs.existsSync(file) &&
    fs.statSync(file).isFile();
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* =====================================
   1. COPY CUSTOM ANDROID RESOURCES
===================================== */

function copyResources(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  ensureDirectory(destination);

  for (const entry of fs.readdirSync(
    source,
    { withFileTypes: true }
  )) {
    const src = path.join(source, entry.name);
    const dest = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyResources(src, dest);
    } else if (entry.isFile()) {
      ensureDirectory(path.dirname(dest));
      fs.copyFileSync(src, dest);

      log(`Resource copied: ${path.relative(ROOT, dest)}`);
    }
  }
}

/* =====================================
   2. FIX MINIMUM ANDROID SDK
===================================== */

function updateMinSdk(file) {
  if (!isFile(file)) {
    return false;
  }

  const original = fs.readFileSync(file, 'utf8');
  let updated = original;

  const replacements = [
    /^([ \t]*minSdkVersion[ \t]*=[ \t]*)\d+([ \t]*(?:\/\/.*)?)$/gm,
    /^([ \t]*minSdkVersion[ \t]+)\d+([ \t]*(?:\/\/.*)?)$/gm,
    /^([ \t]*minSdk[ \t]*=[ \t]*)\d+([ \t]*(?:\/\/.*)?)$/gm
  ];

  for (const pattern of replacements) {
    updated = updated.replace(
      pattern,
      (_match, prefix, suffix) =>
        `${prefix}${MIN_SDK}${suffix}`
    );
  }

  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');

    log(`Minimum SDK updated: ${path.relative(ROOT, file)}`);

    return true;
  }

  return false;
}

function updateVersionName(file) {
  if (!isFile(file)) return;
  const original = fs.readFileSync(file, 'utf8');
  if (!/^\s*versionName\s+["'][^"']+["']/m.test(original)) {
    fail('Could not find Android versionName in app/build.gradle.');
  }
  const updated = original.replace(/(^\s*versionName\s+["'])[^"']+(["'])/m, (_match, prefix, suffix) =>
    `${prefix}${APP_VERSION}${suffix}`);
  if (updated !== original) fs.writeFileSync(file, updated, 'utf8');
}

/* =====================================
   3. FIX ANDROID MANIFEST
===================================== */

function updateManifest(file) {
  if (!isFile(file)) {
    return;
  }

  const original = fs.readFileSync(file, 'utf8');

  const pattern =
    /(<uses-sdk\b[^>]*\bandroid:minSdkVersion\s*=\s*["'])\d+(["'][^>]*\/?>)/g;

  const updated = original.replace(
    pattern,
    (_match, prefix, suffix) =>
      `${prefix}${MIN_SDK}${suffix}`
  );

  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');
    log('Android Manifest updated.');
  }
}

/* =====================================
   4. FIX DUPLICATE LAUNCHER COLOR
===================================== */

function removeDuplicateLauncherColor(valuesDir) {
  const customFile = path.join(
    valuesDir,
    'farnava_colors.xml'
  );

  const generatedFile = path.join(
    valuesDir,
    'ic_launcher_background.xml'
  );

  if (!isFile(customFile) || !isFile(generatedFile)) {
    return;
  }

  const customXml = fs.readFileSync(customFile, 'utf8');
  const generatedXml = fs.readFileSync(generatedFile, 'utf8');

  const name = 'ic_launcher_background';

  const makePattern = () => new RegExp(
    `<color\\b(?=[^>]*\\bname\\s*=\\s*["']${name}["'])[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/color\\s*>)`,
    'g'
  );

  const customPattern = makePattern();
  const generatedPattern = makePattern();

  if (!customPattern.test(customXml)) {
    return;
  }

  if (!generatedPattern.test(generatedXml)) {
    return;
  }

  const cleaned = generatedXml.replace(
    makePattern(),
    ''
  );

  fs.writeFileSync(generatedFile, cleaned, 'utf8');

  log('Duplicate launcher color removed.');
  log('Farnava custom color preserved.');
}

/* =====================================
   5. VERIFY MINIMUM SDK
===================================== */

function verifyMinSdk(files) {
  const declarations = [];

  const patterns = [
    /^\s*minSdkVersion\s*=\s*(\d+)/gm,
    /^\s*minSdkVersion\s+(\d+)/gm,
    /^\s*minSdk\s*=\s*(\d+)/gm,
    /android:minSdkVersion\s*=\s*["'](\d+)["']/g
  ];

  for (const file of files) {
    if (!isFile(file)) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        declarations.push({
          file,
          value: Number(match[1])
        });
      }
    }
  }

  if (declarations.length === 0) {
    fail('No numeric minSdkVersion declaration found.');
  }

  const invalid = declarations.filter(
    item => item.value < MIN_SDK
  );

  if (invalid.length > 0) {
    for (const item of invalid) {
      console.error(
        `${path.relative(ROOT, item.file)}: ${item.value}`
      );
    }

    fail('An Android minimum SDK below 24 remains.');
  }

  for (const item of declarations) {
    log(
      `Verified: ${path.relative(ROOT, item.file)} = ${item.value}`
    );
  }
}

/* =====================================
   6. MAIN PROCESS
===================================== */

function main() {
  log('Starting Android preparation...');
  log(`Project directory: ${ROOT}`);

  // Validate project.

  if (!isFile(path.join(ROOT, 'package.json'))) {
    fail('package.json not found.');
  }

  if (!isFile(path.join(ROOT, 'capacitor.config.json'))) {
    fail('capacitor.config.json not found.');
  }

  const gradleGroovy = path.join(
    APP_DIR,
    'build.gradle'
  );

  const gradleKotlin = path.join(
    APP_DIR,
    'build.gradle.kts'
  );

  if (!isFile(gradleGroovy) && !isFile(gradleKotlin)) {
    fail(
      'Android project not found. Run npx cap add android first.'
    );
  }

  if (!fs.existsSync(APP_SRC_MAIN)) {
    fail('Android app source directory not found.');
  }

  ensureDirectory(APP_RES);

  // Copy resources.

  if (fs.existsSync(CUSTOM_RES)) {
    copyResources(CUSTOM_RES, APP_RES);
  } else {
    log('No custom Android resources found.');
  }

  // Update Gradle files.

  const gradleFiles = [
    path.join(ANDROID_DIR, 'variables.gradle'),
    path.join(ANDROID_DIR, 'variables.gradle.kts'),
    gradleGroovy,
    gradleKotlin,
    path.join(ANDROID_DIR, 'build.gradle'),
    path.join(ANDROID_DIR, 'build.gradle.kts')
  ];

  let gradleFound = false;

  for (const file of gradleFiles) {
    if (isFile(file)) {
      gradleFound = true;
      updateMinSdk(file);
    }
  }

  if (isFile(gradleGroovy)) updateVersionName(gradleGroovy);

  if (!gradleFound) {
    fail('No Android Gradle configuration found.');
  }

  // Update manifest if necessary.

  const manifest = path.join(
    APP_SRC_MAIN,
    'AndroidManifest.xml'
  );

  updateManifest(manifest);

  // Remove duplicate launcher resource.

  removeDuplicateLauncherColor(
    path.join(APP_RES, 'values')
  );

  // Verify SDK configuration.

  verifyMinSdk([
    ...gradleFiles,
    manifest
  ]);

  log('Android preparation completed successfully.');
  log('Minimum supported Android API: 24');
}

/* =====================================
   7. EXECUTION
===================================== */

try {
  main();
} catch (error) {
  console.error(`[Farnava] BUILD PREPARATION FAILED`);
  console.error(error.message);

  if (process.env.DEBUG === '1') {
    console.error(error.stack);
  }

  process.exit(1);
}
