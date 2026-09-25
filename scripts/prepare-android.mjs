// Runs in CI after `tauri android init`: installs our MainActivity and wires
// release signing to the keystore described by gen/android/keystore.properties.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const gen = 'src-tauri/gen/android';
const activity = join(gen, 'app/src/main/java/com/snowfly/relay/MainActivity.kt');
if (!existsSync(activity)) throw new Error(`Expected generated activity at ${activity}`);
copyFileSync('android/MainActivity.kt', activity);

const gradlePath = join(gen, 'app/build.gradle.kts');
let gradle = readFileSync(gradlePath, 'utf8');

if (!gradle.includes('signingConfigs')) {
  if (!gradle.startsWith('import java.io.FileInputStream')) {
    gradle = `import java.io.FileInputStream\n${gradle}`;
  }
  gradle = gradle.replace(
    /android \{\n/,
    `android {
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = java.util.Properties()
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
`,
  );
  gradle = gradle.replace(
    /getByName\("release"\) \{\n/,
    `getByName("release") {\n            signingConfig = signingConfigs.getByName("release")\n`,
  );
}
if (!gradle.includes('signingConfigs.getByName("release")')) {
  throw new Error('Failed to patch release signing into build.gradle.kts');
}
writeFileSync(gradlePath, gradle);
console.log('Android project prepared');
