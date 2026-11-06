import fs from 'node:fs';
import path from 'node:path';

const gradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
const required = [
  'FARNAVA_KEYSTORE_PATH',
  'FARNAVA_KEYSTORE_PASSWORD',
  'FARNAVA_KEY_ALIAS',
  'FARNAVA_KEY_PASSWORD'
];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (!fs.existsSync(process.env.FARNAVA_KEYSTORE_PATH)) {
  console.error('Release keystore file was not found.');
  process.exit(1);
}
if (!fs.existsSync(gradlePath)) {
  console.error('android/app/build.gradle was not found.');
  process.exit(1);
}

let gradle = fs.readFileSync(gradlePath, 'utf8');

if (!gradle.includes('signingConfigs {')) {
  const signingBlock = `
    signingConfigs {
        release {
            storeFile file(System.getenv("FARNAVA_KEYSTORE_PATH"))
            storePassword System.getenv("FARNAVA_KEYSTORE_PASSWORD")
            keyAlias System.getenv("FARNAVA_KEY_ALIAS")
            keyPassword System.getenv("FARNAVA_KEY_PASSWORD")
        }
    }

`;
  const buildTypesIndex = gradle.indexOf('buildTypes {');
  if (buildTypesIndex < 0) {
    console.error('Could not find buildTypes block in app/build.gradle.');
    process.exit(1);
  }
  gradle = gradle.slice(0, buildTypesIndex) + signingBlock + gradle.slice(buildTypesIndex);
}

const buildTypesIndex = gradle.indexOf('buildTypes {');
const releaseIndex = gradle.indexOf('release {', buildTypesIndex);
if (buildTypesIndex < 0 || releaseIndex < 0) {
  console.error('Could not find buildTypes.release block in app/build.gradle.');
  process.exit(1);
}
const openBrace = gradle.indexOf('{', releaseIndex);
let depth = 0;
let closeBrace = -1;
for (let i = openBrace; i < gradle.length; i++) {
  if (gradle[i] === '{') depth++;
  else if (gradle[i] === '}') {
    depth--;
    if (depth === 0) {
      closeBrace = i;
      break;
    }
  }
}
if (closeBrace < 0) {
  console.error('Could not parse buildTypes.release block.');
  process.exit(1);
}
const releaseBlock = gradle.slice(releaseIndex, closeBrace + 1);
if (!releaseBlock.includes('signingConfig')) {
  const insertAt = openBrace + 1;
  gradle = gradle.slice(0, insertAt) + '\n            signingConfig signingConfigs.release' + gradle.slice(insertAt);
}

fs.writeFileSync(gradlePath, gradle);
console.log('Release APK signing configuration is ready.');
