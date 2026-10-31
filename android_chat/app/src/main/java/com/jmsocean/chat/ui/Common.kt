package com.jmsocean.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.draw.drawBehind
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.jmsocean.chat.data.Session
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

// WhatsApp-like palette
val Teal = Color(0xFF075E54)
val TealLight = Color(0xFF128C7E)
val Green = Color(0xFF25D366)
val Tick = Color(0xFF34B7F1)
val BubbleOut = Color(0xFFD9FDD3)
val BubbleIn = Color(0xFFFFFFFF)
val ChatBg = Color(0xFFECE5DD)
val BubbleOutDark = Color(0xFF005C4B)
val BubbleInDark = Color(0xFF1F2C34)
val ChatBgDark = Color(0xFF0B141A)

/** Top bar colour: JMS green by day, WhatsApp-style dark grey at night. */
@Composable
fun headerColor(): Color = if (isSystemInDarkTheme()) Color(0xFF202C33) else Teal

@Composable
fun JmsChatTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) darkColorScheme(
        primary = Color(0xFF00A884), onPrimary = Color.White, secondary = Green,
        background = Color(0xFF111B21), surface = Color(0xFF1F2C34), surfaceVariant = Color(0xFF202C33)
    ) else lightColorScheme(
        primary = Teal, onPrimary = Color.White, secondary = Green, primaryContainer = Color(0xFFDDF3EF),
        background = Color.White, surface = Color.White, surfaceVariant = Color(0xFFF0F2F5)
    )
    // Slightly larger, calmer type for a cleaner, premium feel.
    val base = androidx.compose.material3.Typography()
    val type = base.copy(
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = base.bodyLarge.copy(lineHeight = 22.sp),
        bodyMedium = base.bodyMedium.copy(lineHeight = 20.sp)
    )
    MaterialTheme(colorScheme = colors, typography = type, content = content)
}

private val avatarColors = listOf(
    Color(0xFF00A884), Color(0xFF53BDEB), Color(0xFFFF8A65), Color(0xFFBA68C8),
    Color(0xFF4DB6AC), Color(0xFFF06292), Color(0xFF7986CB), Color(0xFFFFB74D)
)

/** Round avatar: the profile photo when [photoUrl] is set, else coloured initials. */
@Composable
fun Avatar(name: String, size: Dp = 48.dp, group: Boolean = false, online: Boolean = false, photoUrl: String? = null) {
    val c = avatarColors[(name.lowercase().hashCode() and 0x7fffffff) % avatarColors.size]
    Box(Modifier.size(size)) {
        Box(
            Modifier.size(size).clip(CircleShape).background(c),
            contentAlignment = Alignment.Center
        ) {
            Text(
                if (group) "👥" else initials(name),
                color = Color.White, fontWeight = FontWeight.SemiBold,
                fontSize = (size.value * 0.38f).sp
            )
            if (photoUrl != null) {
                val ctx = LocalContext.current
                AsyncImage(
                    model = remember(photoUrl) {
                        ImageRequest.Builder(ctx).data(photoUrl)
                            .addHeader("Authorization", "Bearer ${Session.token}")
                            .crossfade(true).build()
                    },
                    contentDescription = name, contentScale = ContentScale.Crop,
                    modifier = Modifier.size(size).clip(CircleShape)
                )
            }
        }
        if (online) Box(
            Modifier.size(size * 0.28f).align(Alignment.BottomEnd).clip(CircleShape)
                .background(Green).border(2.dp, Color.White, CircleShape)
        )
    }
}

fun initials(name: String): String {
    val parts = name.trim().split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }
    return when {
        parts.isEmpty() -> "?"
        parts.size == 1 -> parts[0].take(2).uppercase()
        else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
    }
}

private val zone: ZoneId = ZoneId.systemDefault()
private val hm = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)
private val dayFmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
private val weekday = DateTimeFormatter.ofPattern("EEEE", Locale.ENGLISH)
private val shortDate = DateTimeFormatter.ofPattern("dd/MM/yy", Locale.ENGLISH)

fun parseTs(iso: String?): OffsetDateTime? = iso?.let { runCatching { OffsetDateTime.parse(it).atZoneSameInstant(zone).toOffsetDateTime() }.getOrNull() }

fun timeOf(iso: String?): String = parseTs(iso)?.format(hm)?.lowercase() ?: ""

/** Chat list: time today, "Yesterday", weekday this week, else the date. */
fun listTime(iso: String?): String {
    val t = parseTs(iso) ?: return ""
    val days = ChronoUnit.DAYS.between(t.toLocalDate(), LocalDate.now(zone))
    return when {
        days == 0L -> t.format(hm).lowercase()
        days == 1L -> "Yesterday"
        days < 7 -> t.format(weekday)
        else -> t.format(shortDate)
    }
}

/** Date chip between messages. */
fun dayLabel(iso: String?): String {
    val t = parseTs(iso) ?: return ""
    val days = ChronoUnit.DAYS.between(t.toLocalDate(), LocalDate.now(zone))
    return when {
        days == 0L -> "Today"
        days == 1L -> "Yesterday"
        days < 7 -> t.format(weekday)
        else -> t.format(dayFmt)
    }
}

/** "online" / "last seen today at 3:15 pm" / "last seen yesterday at …" / "last seen 12 Oct 2026". */
fun lastSeenText(online: Boolean, iso: String?): String {
    if (online) return "online"
    val t = parseTs(iso) ?: return ""
    val days = ChronoUnit.DAYS.between(t.toLocalDate(), LocalDate.now(zone))
    val at = t.format(hm).lowercase()
    return when {
        days == 0L -> "last seen today at $at"
        days == 1L -> "last seen yesterday at $at"
        days < 7 -> "last seen ${t.format(weekday)} at $at"
        else -> "last seen ${t.format(dayFmt)}"
    }
}

/** Chat background: a soft dotted pattern (drawn, no image file), like WhatsApp's wallpaper. */
fun Modifier.chatWallpaper(dark: Boolean): Modifier = this.drawBehind {
    drawRect(if (dark) ChatBgDark else ChatBg)
    val dot = if (dark) Color.White.copy(alpha = 0.035f) else Color(0xFF6B5B45).copy(alpha = 0.07f)
    val step = 26.dp.toPx()
    var y = 0f
    var row = 0
    while (y < size.height) {
        var x = if (row % 2 == 0) 0f else step / 2
        while (x < size.width) {
            drawCircle(dot, radius = 1.6.dp.toPx(), center = androidx.compose.ui.geometry.Offset(x, y))
            x += step
        }
        y += step * 0.75f
        row++
    }
}

/** Three bouncing dots ("typing…"). */
@Composable
fun TypingDots(color: Color) {
    val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "typing")
    Row(verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { i ->
            val a by t.animateFloat(
                initialValue = 0.3f, targetValue = 1f,
                animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                    androidx.compose.animation.core.tween(500, delayMillis = i * 150),
                    androidx.compose.animation.core.RepeatMode.Reverse
                ), label = "dot$i"
            )
            Box(Modifier.padding(horizontal = 1.5.dp).size(5.dp).clip(CircleShape).background(color.copy(alpha = a)))
        }
    }
}

fun dayKey(iso: String?): LocalDate? = parseTs(iso)?.toLocalDate()

fun fileSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> String.format(Locale.ENGLISH, "%.1f MB", bytes / 1048576.0)
    bytes >= 1024 -> "${bytes / 1024} KB"
    else -> "$bytes B"
}

@Composable
fun dark() = isSystemInDarkTheme()
