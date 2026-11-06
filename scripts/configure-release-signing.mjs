/**
 * Farnava Release Signing Configuration
 * Version: 2.0.0
 *
 * Configures the Android Gradle Release build to use the private
 * Farnava keystore supplied through GitHub Actions secrets.
 *
 * Required environment variables:
 * FARNAVA_KEYSTORE_PATH
 * FARNAVA_KEYSTORE_PASSWORD
 * FARNAVA_KEY_ALIAS
 * FARNAVA_KEY_PASSWORD
 *
 * This file never prints passwords or private key material.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ANDROID_APP_DIR = path.join(ROOT, 'android', 'app');
const GRADLE_FILE = path.join(ANDROID_APP_DIR, 'build.gradle');

const REQUIRED_ENV = [
  'FARNAVA_KEYSTORE_PATH',
  'FARNAVA_KEYSTORE_PASSWORD',
  'FARNAVA_KEY_ALIAS',
  'FARNAVA_KEY_PASSWORD'
];

const BEGIN_MARKER = '// BEGIN FARNAVA MANAGED RELEASE SIGNING';
const END_MARKER = '// END FARNAVA MANAGED RELEASE SIGNING';

function fail(message) {
  console.error(`[Farnava Signing] ERROR: ${message}`);
  process.exit(1);
}

function log(message) {
  console.log(`[Farnava Signing] ${message}`);
}

function validateEnvironment() {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name] || !process.env[name].trim()) {
      fail(`Required environment variable is missing: ${name}`);
    }
  }

  const keystorePath = path.resolve(process.env.FARNAVA_KEYSTORE_PATH);

  if (!fs.existsSync(keystorePath) || !fs.statSync(keystorePath).isFile()) {
    fail('The configured Farnava release keystore file does not exist.');
  }

  process.env.FARNAVA_KEYSTORE_PATH = keystorePath;
}

function createManagedGradleBlock() {
  return `${BEGIN_MARKER}
android {
    signingConfigs {
        release {
            storeFile rootProject.file(System.getenv("FARNAVA_KEYSTORE_PATH"))
            storePassword System.getenv("FARNAVA_KEYSTORE_PASSWORD")
            keyAlias System.getenv("FARNAVA_KEY_ALIAS")
            keyPassword System.getenv("FARNAVA_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
${END_MARKER}`;
}

function removePreviousManagedBlock(source) {
  const start = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);

  if (start === -1 && end === -1) {
    return source;
  }

  if (start === -1 || end === -1 || end < start) {
    fail('The previous managed signing block is incomplete. Repair the Gradle file before continuing.');
  }

  const afterEnd = end + END_MARKER.length;
  return `${source.slice(0, start)}${source.slice(afterEnd)}`.trimEnd();
}

function configureGradle() {
  if (!fs.existsSync(GRADLE_FILE)) {
    fail('android/app/build.gradle was not found. The Capacitor Android project must be generated and synced first.');
  }

  let source = fs.readFileSync(GRADLE_FILE, 'utf8');

  if (!/\bandroid\s*\{/.test(source)) {
    fail('The Android Gradle extension block was not found in app/build.gradle.');
  }

  source = removePreviousManagedBlock(source);

  const managedBlock = createManagedGradleBlock();
  const updated = `${source.trimEnd()}\n\n${managedBlock}\n`;

  // Verify the exact block that will be appended.
  if (!updated.includes(`${BEGIN_MARKER}\nandroid {`)) {
    fail('Could not create the managed Release signing block.');
  }

  if (!/signingConfig\s+signingConfigs\.release/.test(managedBlock)) {
    fail('Release build is not explicitly assigned to signingConfigs.release.');
  }

  if (/signingConfig\s+signingConfigs\.debug/.test(managedBlock)) {
    fail('Debug signing must never be assigned by the Farnava Release workflow.');
  }

  fs.writeFileSync(GRADLE_FILE, updated, 'utf8');

  const saved = fs.readFileSync(GRADLE_FILE, 'utf8');
  const begin = saved.indexOf(BEGIN_MARKER);
  const end = saved.indexOf(END_MARKER);

  if (begin < 0 || end < begin) {
    fail('The managed signing block could not be verified after writing.');
  }

  const savedBlock = saved.slice(begin, end + END_MARKER.length);

  for (const required of [
    'storeFile rootProject.file(System.getenv("FARNAVA_KEYSTORE_PATH"))',
    'storePassword System.getenv("FARNAVA_KEYSTORE_PASSWORD")',
    'keyAlias System.getenv("FARNAVA_KEY_ALIAS")',
    'keyPassword System.getenv("FARNAVA_KEY_PASSWORD")',
    'signingConfig signingConfigs.release'
  ]) {
    if (!savedBlock.includes(required)) {
      fail(`Release signing verification failed: missing ${required}`);
    }
  }

  log('Gradle Release signing block has been installed and verified.');
  log('The Release build is explicitly assigned to the Farnava release keystore.');
}

validateEnvironment();
configureGradle();
