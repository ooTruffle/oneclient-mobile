package expo.modules.materialyou

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Material You (Android 12+): the colours the system picked from the wallpaper.
 * Only the primary accent is exposed, at the tone Material 3 uses for the
 * light scheme's `primary` (system_accent1_600), which is dark enough for white
 * text — the same rule as the app's accent presets.
 */
class MaterialYouModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MaterialYou")

    Function("getAccent") { -> accentHex() }
  }

  private fun accentHex(): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
    val context = appContext.reactContext ?: return null
    val color = context.getColor(android.R.color.system_accent1_600)
    return String.format("#%06x", color and 0xffffff)
  }
}
