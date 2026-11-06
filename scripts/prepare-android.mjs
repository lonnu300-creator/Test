
#!/usr/bin/env node

/**
 * Farnava Android Preparation
 * Version: 1.0.0
 *
 * Run from repository root:
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

function info(message) {
  console.log(`[Farnava Android] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function isFile(file) {
  return fs.existsSync(file) &&
    fs.statSync(file).isFile();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Copy custom Android resources.
 */
function copyResourceTree(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) return;

  ensureDir(destinationDir);

  for (const entry of fs.readdirSync(
    sourceDir,
    { withFileTypes: true }
  )) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(
      destinationDir,
      entry.name
    );

    if (entry.isDirectory()) {
      copyResourceTree(source, destination);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destination));
      fs.copyFileSync(source, destination);

      info(`Copied ${path.relative(ROOT, destination)}`);
    }
  }
}

/**
 * Set Android minimum SDK to API 24.
 *
 * Required by Cordova Android Framework 14.
 */
function updateGradleMinSdk(file) {
  if (!isFile(file)) return false;

  const original = fs.readFileSync(file, 'utf8');
  let updated = original;

  // variables.gradle:
  // minSdkVersion = 23

  updated = updated.replace(
    /^([ \t]*minSdkVersion[ \t]*=[ \t]*)\d+([ \t]*(?:\/\/.*)?)$/gm,
    (_match, prefix, suffix) =>
      `${prefix}24${suffix}`
  );

  // build.gradle:
  // minSdkVersion 23

  updated = updated.replace(
    /^([ \t]*minSdkVersion[ \t]+)\d+([ \t]*(?:\/\/.*)?)$/gm,
    (_match, prefix, suffix) =>
      `${prefix}24${suffix}`
  );

  // build.gradle.kts:
  // minSdk = 23

  updated = updated.replace(
    /^([ \t]*minSdk[ \t]*=[ \t]*)\d+([ \t]*(?:\/\/.*)?)$/gm,
    (_match, prefix, suffix) =>
      `${prefix}24${suffix}`
  );

  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');

    info(
      `Set minSdkVersion to 24 in ${path.relative(ROOT, file)}`
    );

    return true;
  }

  return false;
}

/**
 * Update an explicit uses-sdk declaration if present.
 */
function updateManifestMinSdk(file) {
  if (!isFile(file)) return false;

  const original = fs.readFileSync(file, 'utf8');

  const pattern =
    /(<uses-sdk\b[^>]*\bandroid:minSdkVersion\s*=\s*["'])\d+(["'][^>]*\/?>)/s;

  const updated = original.replace(
    pattern,
    (_match, prefix, suffix) =>
      `${prefix}24${suffix}`
  );

  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');

    info(
      `Updated manifest minSdkVersion in ${path.relative(ROOT, file)}`
    );

    return true;
  }

  return false;
}

/**
 * Remove only the duplicated launcher background color.
 * Keep all other generated Android resources.
 */
function removeDuplicateLauncherBackground(valuesDir) {
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

  const customXml = fs.readFileSync(
    customFile,
    'utf8'
  );

  const generatedXml = fs.readFileSync(
    generatedFile,
    'utf8'
  );

  const resourceName = 'ic_launcher_background';

  const customDecl = new RegExp(
    `<color\\b(?=[^>]*\\bname\\s*=\\s*["']${resourceName}["'])[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/color\\s*>)`,
    'g'
  );

  const generatedDecl = new RegExp(
    `<color\\b(?=[^>]*\\bname\\s*=\\s*["']${resourceName}["'])[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/color\\s*>)`,
    'g'
  );

  if (!customDecl.test(customXml)) {
    return;
  }

  const cleaned = generatedXml.replace(
    generatedDecl,
    ''
  );

  if (cleaned !== generatedXml) {
    fs.writeFileSync(
      generatedFile,
      cleaned,
      'utf8'
    );

    info(
      'Removed duplicate launcher background color. ' +
      'Farnava custom color preserved.'
    );
  }
}

/**
 * Verify minimum SDK declarations.
 */
function collectMinSdkDeclarations(files) {
  const declarations = [];

  const patterns = [
    /^\s*minSdkVersion\s*=\s*(\d+)/gm,
    /^\s*minSdkVersion\s+(\d+)/gm,
    /^\s*minSdk\s*=\s*(\d+)/gm,
    /android:minSdkVersion\s*=\s*["'](\d+)["']/g
  ];

  for (const file of files) {
    if (!isFile(file)) continue;

    const content = fs.readFileSync(
      file,
      'utf8'
    );

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        declarations.push({
          file,
          value: Number(match[1])
        });
      }
    }
  }

  return declarations;
}

/**
 * Main preparation process.
 */
function main() {
  info(`Repository root: ${ROOT}`);

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
      'Android Gradle project not found. ' +
      'Run npx cap add android and npx cap sync android first.'
    );
  }

  if (!fs.existsSync(APP_SRC_MAIN)) {
    fail('Android app source directory not found.');
  }

  ensureDir(APP_RES);

  // Copy Farnava resources.
  if (fs.existsSync(CUSTOM_RES)) {
    copyResourceTree(
      CUSTOM_RES,
      APP_RES
    );
  } else {
    info('Custom Android resources not found; skipping copy.');
  }

  // Update Gradle configurations.
  const gradleFiles = [
    path.join(ANDROID_DIR, 'variables.gradle'),
    gradleGroovy,
    gradleKotlin,
    path.join(ANDROID_DIR, 'build.gradle'),
    path.join(ANDROID_DIR, 'build.gradle.kts')
  ];

  let gradleFileFound = false;

  for (const file of gradleFiles) {
    if (isFile(file)) {
      gradleFileFound = true;
      updateGradleMinSdk(file);
    }
  }

  if (!gradleFileFound) {
    fail('No Android Gradle configuration found.');
  }

  // Update Android manifest if it declares minSdk.
  const manifest = path.join(
    APP_SRC_MAIN,
    'AndroidManifest.xml'
  );

  updateManifestMinSdk(manifest);

  // Fix duplicate launcher background color.
  removeDuplicateLauncherBackground(
    path.join(APP_RES, 'values')
  );

  // Final verification.
  const declarations = collectMinSdkDeclarations([
    ...gradleFiles,
    manifest
  ]);

  if (declarations.length === 0) {
    fail(
      'Could not find minSdkVersion. ' +
      'Check android/variables.gradle.'
    );
  }

  const tooLow = declarations.filter(
    item => item.value < 24
  );

  if (tooLow.length > 0) {
    for (const item of tooLow) {
      console.error(
        ` - ${path.relative(ROOT, item.file)}: ` +
        `minSdkVersion=${item.value}`
      );
    }

    fail('At least one minSdkVersion is below 24.');
  }

  info(
    'Verified minSdk declarations: ' +
    declarations
      .map(item =>
        `${path.relative(ROOT, item.file)}=${item.value}`
      )
      .join(', ')
  );

  info('Android preparation completed successfully.');
}

// Execute.
try {
  main();
} catch (error) {
  console.error(
    `[Farnava Android] ERROR: ${error?.message || error}`
  );

  if (process.env.DEBUG === '1' && error?.stack) {
    console.error(error.stack);
  }

  process.exit(1);
}
