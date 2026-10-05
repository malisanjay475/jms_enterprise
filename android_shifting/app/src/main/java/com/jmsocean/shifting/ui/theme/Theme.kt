package com.jmsocean.shifting.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

// ── JMS Shifting palette (QC Ocean v3 base, teal accent). Names kept stable so screens recolor. ────
val Bone      = Color(0xFFEEF2F5)   // app background (cool light)
val Paper     = Color(0xFFFFFFFF)   // surface / cards
val Ink       = Color(0xFF0E1622)   // primary text
val InkSoft   = Color(0xFF3D4A5C)
val Steel     = Color(0xFF6B7A8D)   // muted
val Accent    = Color(0xFF0F766E)   // primary (ocean)
val AccentDk  = Color(0xFF115E59)
val Good      = Color(0xFF12A66A)
val Warn      = Color(0xFFE0952B)
val Crit      = Color(0xFFDB3B4B)
val Line      = Color(0xFFE2E8EE)

// dark
val BoneD     = Color(0xFF0B1017)
val PaperD    = Color(0xFF121A24)
val InkD      = Color(0xFFEAF0F5)
val AccentD   = Color(0xFF2DD4BF)
val LineD     = Color(0xFF22303C)

private val LightColors = lightColorScheme(
    primary = Accent, onPrimary = Color.White,
    primaryContainer = Color(0xFFDDF3EF), onPrimaryContainer = Color(0xFF0B3B37),
    secondary = AccentDk, onSecondary = Color.White,
    background = Bone, onBackground = Ink,
    surface = Paper, onSurface = Ink,
    surfaceVariant = Color(0xFFEAF1F5), onSurfaceVariant = Steel,
    error = Crit, onError = Color.White,
    outline = Line, outlineVariant = Color(0xFFEDF1F5)
)

private val DarkColors = darkColorScheme(
    primary = AccentD, onPrimary = Color(0xFF042F2B),
    primaryContainer = Color(0xFF0F2E2B), onPrimaryContainer = Color(0xFF99F6E4),
    secondary = AccentD, onSecondary = Color(0xFF042F2B),
    background = BoneD, onBackground = InkD,
    surface = PaperD, onSurface = InkD,
    surfaceVariant = Color(0xFF1A2530), onSurfaceVariant = Color(0xFF8496A6),
    error = Color(0xFFF0596A), onError = Color(0xFF2E1519),
    outline = LineD, outlineVariant = Color(0xFF1A2530)
)

// App font. System default for now (clean on modern Android); swap to a bundled
// Plus Jakarta Sans FontFamily here later to apply it app-wide in one place.
private val AppFont = FontFamily.Default

private fun appTypography(): Typography {
    val b = Typography()
    fun set(s: androidx.compose.ui.text.TextStyle) = s.copy(fontFamily = AppFont)
    return Typography(
        displayLarge = set(b.displayLarge), displayMedium = set(b.displayMedium), displaySmall = set(b.displaySmall),
        headlineLarge = set(b.headlineLarge), headlineMedium = set(b.headlineMedium), headlineSmall = set(b.headlineSmall),
        titleLarge = set(b.titleLarge), titleMedium = set(b.titleMedium), titleSmall = set(b.titleSmall),
        bodyLarge = set(b.bodyLarge), bodyMedium = set(b.bodyMedium), bodySmall = set(b.bodySmall),
        labelLarge = set(b.labelLarge), labelMedium = set(b.labelMedium), labelSmall = set(b.labelSmall)
    )
}

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp)
)

@Composable
fun ShiftingTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = appTypography(),
        shapes = AppShapes,
        content = content
    )
}
