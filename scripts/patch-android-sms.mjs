import fs from "node:fs";
const file = "android/app/src/main/AndroidManifest.xml";
let xml = fs.readFileSync(file, "utf8");
const permissions = [
  '<uses-permission android:name="android.permission.READ_SMS" />',
  '<uses-permission android:name="android.permission.RECEIVE_SMS" />',
  // دوربین برای اسکن برگه‌ی پوز (ورودی فایل با capture)
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />'
];
for (const p of permissions) if (!xml.includes(p)) xml = xml.replace(/<manifest\b[^>]*>/, (m) => `${m}\n    ${p}`);
fs.writeFileSync(file, xml);
console.log("Rexa SMS + camera permissions enabled in AndroidManifest.xml");
