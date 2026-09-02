package com.jmsocean.qc.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── QC Ocean palette (matches the approved build spec) ──────────────────────
val Bone      = Color(0xFFF7F5F1)
val Paper     = Color(0xFFFFFFFF)
val Ink       = Color(0xFF1A2332)
val InkSoft   = Color(0xFF3A4658)
val Steel     = Color(0xFF5B6472)
val Accent    = Color(0xFFE2571C)
val AccentDk  = Color(0xFFB8410F)
val Good      = Color(0xFF0F8A5F)
val Warn      = Color(0xFFD4A017)
val Crit      = Color(0xFFC22D2D)
val Line      = Color(0xFFE5E1D8)

// dark
val BoneD     = Color(0xFF12161D)
val PaperD    = Color(0xFF1B212B)
val InkD      = Color(0xFFEDEEF1)
val AccentD   = Color(0xFFF06A31)
val LineD     = Color(0xFF2A313C)

private val LightColors = lightColorScheme(
    primary = Accent, onPrimary = Color.White,
    secondary = Ink, onSecondary = Color.White,
    background = Bone, onBackground = Ink,
    surface = Paper, onSurface = Ink,
    surfaceVariant = Line, onSurfaceVariant = Steel,
    error = Crit, onError = Color.White,
    outline = Line
)

private val DarkColors = darkColorScheme(
    primary = AccentD, onPrimary = Color.White,
    secondary = InkD, onSecondary = Ink,
    background = BoneD, onBackground = InkD,
    surface = PaperD, onSurface = InkD,
    surfaceVariant = LineD, onSurfaceVariant = Color(0xFF9AA2AE),
    error = Color(0xFFE45B5B), onError = Color.White,
    outline = LineD
)

@Composable
fun QcTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content
    )
}
