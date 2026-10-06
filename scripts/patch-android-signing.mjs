// Forces the debug build to be signed with the fixed key stored at ~/.android/debug.keystore
// (the GitHub secret DEBUG_KEYSTORE_BASE64), instead of whatever default key Gradle picks.
import fs from "node:fs";
const file = "android/app/build.gradle";
let g = fs.readFileSync(file, "utf8");
if (!g.includes("rexaFixedKey")) {
  const block = `android {
    // rexaFixedKey: امضای ثابت برای اینکه هر APK جدید روی قبلی نصب شود
    signingConfigs {
        debug {
            storeFile file("\${System.getProperty('user.home')}/.android/debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
        release {
            storeFile file("\${System.getProperty('user.home')}/.android/debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }`;
  if (!/^android \{/m.test(g)) throw new Error("android { block not found in build.gradle");
  g = g.replace(/^android \{/m, block);
  fs.writeFileSync(file, g);
}
console.log("Rexa fixed signing key configured in build.gradle");
