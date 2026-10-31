package com.jmsocean.chat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.data.Session

private val Accent = Color(0xFF00A884)

/** WhatsApp-style floating bottom bar: Chats, Calls, Starred, You. */
@Composable
fun FloatingTabBar(tab: Int, unread: Int, onTab: (Int) -> Unit, onStarred: () -> Unit) {
    val dark = isSystemInDarkTheme()
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 14.dp, end = 14.dp, bottom = 10.dp)) {
        Surface(
            shape = RoundedCornerShape(32.dp),
            color = if (dark) Color(0xFF202C33) else Color.White,
            modifier = Modifier.fillMaxWidth().height(64.dp).shadow(10.dp, RoundedCornerShape(32.dp))
        ) {
            Row(Modifier.fillMaxSize().padding(horizontal = 6.dp), horizontalArrangement = Arrangement.SpaceAround, verticalAlignment = Alignment.CenterVertically) {
                TabItem(Icons.AutoMirrored.Filled.Chat, "Chats", tab == 0, badge = unread) { onTab(0) }
                TabItem(Icons.Default.Call, "Calls", tab == 1) { onTab(1) }
                TabItem(Icons.Default.Star, "Starred", false) { onStarred() }
                YouItem(tab == 2) { onTab(2) }
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(icon: ImageVector, label: String, on: Boolean, badge: Int = 0, onClick: () -> Unit) {
    Box(
        Modifier.weight(1f).height(56.dp).padding(horizontal = 2.dp).clip(RoundedCornerShape(28.dp))
            .background(if (on) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, label, tint = if (on) Accent else MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(24.dp))
            Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
        if (badge > 0) Box(
            Modifier.align(Alignment.TopCenter).padding(start = 30.dp, top = 2.dp).clip(RoundedCornerShape(10.dp))
                .background(Color(0xFF25D366)).padding(horizontal = 6.dp, vertical = 1.dp)
        ) { Text(if (badge > 99) "99+" else "$badge", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.YouItem(on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.weight(1f).height(56.dp).padding(horizontal = 2.dp).clip(RoundedCornerShape(28.dp))
            .background(if (on) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                Modifier.size(26.dp).clip(CircleShape).background(Accent),
                contentAlignment = Alignment.Center
            ) { Text(initials(Session.username), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            Text("You", fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun initials(name: String?): String =
    (name ?: "?").trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }

/** The "You" tab: profile at the top, then grouped settings rows (like WhatsApp on iPhone). */
@Composable
fun YouTab(
    modifier: Modifier,
    onProfile: () -> Unit,
    onStarred: () -> Unit,
    onTasks: () -> Unit,
    onApprovals: () -> Unit,
    onFolders: () -> Unit,
    onDevices: () -> Unit,
    onSignOut: () -> Unit
) {
    val dark = isSystemInDarkTheme()
    val page = if (dark) Color(0xFF0B141A) else Color(0xFFF2F2F7)
    Column(modifier.background(page).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Spacer(Modifier.height(24.dp))
        Column(Modifier.fillMaxWidth().clickable(onClick = onProfile), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(120.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
                Text(initials(Session.username), color = Color.White, fontSize = 42.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(12.dp))
            Text(Session.username ?: "", fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text("Tap to edit your profile", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        }
        Spacer(Modifier.height(24.dp))
        Group {
            SettingRow(Icons.Default.Star, "Starred messages", onStarred)
            SettingRow(Icons.Default.CheckCircle, "My tasks", onTasks)
            SettingRow(Icons.Default.Info, "Approvals", onApprovals)
            SettingRow(Icons.Default.Folder, "Chat folders", onFolders)
            SettingRow(Icons.Default.Phone, "My devices", onDevices, last = true)
        }
        Group {
            SettingRow(Icons.Default.AccountCircle, "Profile", onProfile, last = true)
        }
        Group {
            SettingRow(Icons.AutoMirrored.Filled.ExitToApp, "Sign out", onSignOut, last = true, red = true)
        }
        Text(
            "JMS Chat · ${Session.username ?: ""}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 110.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
    }
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    Surface(shape = RoundedCornerShape(18.dp), color = if (dark) Color(0xFF1F2C34) else Color.White, modifier = Modifier.fillMaxWidth().padding(bottom = 18.dp)) {
        Column { content() }
    }
}

@Composable
private fun SettingRow(icon: ImageVector, label: String, onClick: () -> Unit, last: Boolean = false, red: Boolean = false) {
    val color = if (red) Color(0xFFEA0038) else MaterialTheme.colorScheme.onSurface
    Column {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 15.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, null, tint = color, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Text(label, color = color, fontSize = 17.sp, modifier = Modifier.weight(1f))
            if (!red) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Color(0xFFC4CBD0))
        }
        if (!last) HorizontalDivider(Modifier.padding(start = 56.dp), thickness = 0.5.dp)
    }
}
