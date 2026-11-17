# Builds a release APK on this PC (no EAS). Usage, from the project folder:
#   powershell -ExecutionPolicy Bypass -File scripts/build-android-local.ps1          # incremental
#   powershell -ExecutionPolicy Bypass -File scripts/build-android-local.ps1 -Clean   # re-run prebuild first
#   ... -KeepVersion   # rebuild without bumping the versionCode
#
# Needs: Java 17 in %LOCALAPPDATA%\Programs\jdk17 and the Android SDK in
# %LOCALAPPDATA%\Android\Sdk (both installed per-user, no admin). Env vars are
# set for this script only; nothing is changed system-wide.
#
# Signing: if credentials.json + the keystore from `npx eas-cli credentials`
# (Android > "Download credentials") are in the project, the APK is signed with
# the same key as the EAS builds, so it installs over them. Otherwise it is
# signed with the debug key and you must uninstall the EAS build first.

param([switch]$Clean, [switch]$KeepVersion)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA 'Programs\jdk17'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
foreach ($dir in $env:JAVA_HOME, $env:ANDROID_HOME) {
  if (-not (Test-Path $dir)) { throw "Missing $dir - install Java 17 / the Android SDK first." }
}

if ($Clean -or -not (Test-Path 'android')) {
  $env:CI = '1'
  npx expo prebuild -p android --clean --no-install
  if ($LASTEXITCODE) { throw 'prebuild failed' }
}

# Version: app.json is the one source of truth, shared with EAS (which also
# bumps it, via autoIncrement + appVersionSource "local"). Every build gets the
# next versionCode so Android sees it as an update. -KeepVersion rebuilds the
# current number instead.
$appJsonPath = Join-Path $root 'app.json'
$appJson = Get-Content $appJsonPath -Raw | ConvertFrom-Json
if (-not $KeepVersion) {
  $appJson.expo.android.versionCode = [int]$appJson.expo.android.versionCode + 1
  # Node rewrites it so the formatting stays the same as EAS leaves it.
  node -e "const f=process.argv[1],fs=require('fs'),j=JSON.parse(fs.readFileSync(f,'utf8'));j.expo.android.versionCode=+process.argv[2];fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')" $appJsonPath $appJson.expo.android.versionCode
  if ($LASTEXITCODE) { throw 'Could not update app.json' }
}
$versionCode = $appJson.expo.android.versionCode
$versionName = $appJson.expo.version
# prebuild copied these into build.gradle once; keep them in step without a full prebuild.
$gradleFile = Join-Path $root 'android\app\build.gradle'
$gradle = [IO.File]::ReadAllText($gradleFile) `
  -replace '(?m)^(\s*)versionCode \d+', "`${1}versionCode $versionCode" `
  -replace '(?m)^(\s*)versionName "[^"]*"', "`${1}versionName `"$versionName`""
[IO.File]::WriteAllText($gradleFile, $gradle) # UTF-8 without a BOM
Write-Host "Building version $versionName ($versionCode)" -ForegroundColor Cyan

# Gradle reads the SDK location from here.
"sdk.dir=$($env:ANDROID_HOME -replace '\\', '\\')" | Set-Content -Encoding ascii 'android\local.properties'

Push-Location android
try {
  # The init script keeps native build paths under Windows' 260-character limit.
  .\gradlew.bat assembleRelease --console=plain --init-script "$PSScriptRoot\android-short-paths.gradle"
  if ($LASTEXITCODE) { throw "Gradle failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}

$built = 'android\app\build\outputs\apk\release\app-release.apk'
New-Item -ItemType Directory -Force 'dist' | Out-Null
$out = "dist\oneclient-mobile-$(Get-Date -Format 'yyyyMMdd-HHmm').apk"

$creds = 'credentials.json'
if (Test-Path $creds) {
  $ks = (Get-Content $creds -Raw | ConvertFrom-Json).android.keystore
  $buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') | Sort-Object Name | Select-Object -Last 1
  $apksigner = Join-Path $buildTools.FullName 'apksigner.bat'
  # Passwords go through env vars so they never appear on a command line.
  $env:OCM_KS_PASS = $ks.keystorePassword
  $env:OCM_KEY_PASS = $ks.keyPassword
  try {
    & $apksigner sign --ks $ks.keystorePath --ks-key-alias $ks.keyAlias `
      --ks-pass env:OCM_KS_PASS --key-pass env:OCM_KEY_PASS --out $out $built
    if ($LASTEXITCODE) { throw 'apksigner failed' }
  } finally {
    Remove-Item Env:OCM_KS_PASS, Env:OCM_KEY_PASS -ErrorAction SilentlyContinue
  }
  Remove-Item "$out.idsig" -ErrorAction SilentlyContinue
  Write-Host "Signed with your Expo key: $out" -ForegroundColor Green
} else {
  Copy-Item $built $out
  Write-Host "Built $out (debug key - uninstall the EAS build before installing this one)." -ForegroundColor Yellow
}

# Each APK is ~80 MB; keep only the newest few.
$keep = 3
Get-ChildItem 'dist\oneclient-mobile-*.apk' | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip $keep | ForEach-Object {
    Remove-Item $_.FullName
    Write-Host "Removed old build $($_.Name)" -ForegroundColor DarkGray
  }
