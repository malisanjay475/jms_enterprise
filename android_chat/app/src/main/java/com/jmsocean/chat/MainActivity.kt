package com.jmsocean.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.AppVersion
import com.jmsocean.chat.data.Live
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.data.Updater
import com.jmsocean.chat.push.Notifier
import com.jmsocean.chat.push.Push
import com.jmsocean.chat.ui.ChatListScreen
import com.jmsocean.chat.ui.ConversationScreen
import com.jmsocean.chat.ui.InfoScreen
import com.jmsocean.chat.ui.ProfileScreen
import com.jmsocean.chat.ui.StarredScreen
import com.jmsocean.chat.ui.JmsChatTheme
import com.jmsocean.chat.ui.LoginScreen
import com.jmsocean.chat.ui.NewChatScreen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    /** Chat to open from a tapped notification. */
    private val openFromIntent = MutableStateFlow<String?>(null)

    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openFromIntent.value = intent?.getStringExtra(Notifier.EXTRA_CONV)

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)

        if (Session.signedIn) lifecycleScope.launch { Push.register() }

        setContent {
            JmsChatTheme {
                val nav = rememberNavController()
                val scope = rememberCoroutineScope()
                var update by remember { mutableStateOf<AppVersion?>(null) }
                var updating by remember { mutableStateOf(false) }

                LaunchedEffect(Unit) { update = Updater.check() }
                LaunchedEffect(Unit) {
                    Api.signedOut.collect {
                        Live.stop()
                        nav.navigate("login") { popUpTo(0) }
                        Toast.makeText(this@MainActivity, "Please sign in again.", Toast.LENGTH_LONG).show()
                    }
                }
                LaunchedEffect(Unit) {
                    openFromIntent.collect { id ->
                        if (id != null && Session.signedIn) {
                            nav.navigate("chat/$id") { popUpTo("list") }
                            openFromIntent.value = null
                        }
                    }
                }

                NavHost(nav, startDestination = if (Session.signedIn) "list" else "login") {
                    composable("login") {
                        LoginScreen(onSignedIn = {
                            Live.start()
                            scope.launch { Push.register() }
                            nav.navigate("list") { popUpTo(0) }
                        })
                    }
                    composable("list") {
                        ChatListScreen(
                            onOpen = { nav.navigate("chat/$it") },
                            onNewChat = { nav.navigate("new") },
                            onNewGroup = { nav.navigate("group") },
                            onSignOut = { signOut(nav) },
                            onProfile = { nav.navigate("profile") },
                            onStarred = { nav.navigate("starred") }
                        )
                    }
                    composable("new") {
                        NewChatScreen(group = false, onBack = { nav.popBackStack() }, onNewGroup = { nav.navigate("group") },
                            onOpen = { id -> nav.navigate("chat/$id") { popUpTo("list") } })
                    }
                    composable("group") {
                        NewChatScreen(group = true, onBack = { nav.popBackStack() }, onNewGroup = {},
                            onOpen = { id -> nav.navigate("chat/$id") { popUpTo("list") } })
                    }
                    composable("chat/{id}") { entry ->
                        val id = entry.arguments?.getString("id") ?: return@composable
                        ConversationScreen(
                            id,
                            onBack = { if (!nav.popBackStack("list", false)) nav.navigate("list") { popUpTo(0) } },
                            onInfo = { nav.navigate("info/$id") }
                        )
                    }
                    composable("info/{id}") { entry ->
                        val id = entry.arguments?.getString("id") ?: return@composable
                        InfoScreen(id, onBack = { nav.popBackStack() }, onLeft = { nav.navigate("list") { popUpTo(0) } }, onMessage = { user ->
                            scope.launch {
                                runCatching { Api.openDirect(user) }
                                    .onSuccess { c -> nav.navigate("chat/${c.sync_id}") { popUpTo("list") } }
                                    .onFailure { Toast.makeText(this@MainActivity, it.message, Toast.LENGTH_LONG).show() }
                            }
                        })
                    }
                    composable("starred") {
                        StarredScreen(onBack = { nav.popBackStack() }, onOpen = { id -> nav.navigate("chat/$id") })
                    }
                    composable("profile") {
                        ProfileScreen(onBack = { nav.popBackStack() }, onSignOut = { signOut(nav) })
                    }
                }

                update?.let { v ->
                    AlertDialog(
                        onDismissRequest = { if (!updating) update = null },
                        title = { Text("Update available") },
                        text = { Text("JMS Chat ${v.versionName} is ready." + if (v.notes.isNotBlank()) "\n\n${v.notes}" else "") },
                        confirmButton = {
                            TextButton(enabled = !updating, onClick = {
                                updating = true
                                scope.launch {
                                    val apk = Updater.download(this@MainActivity, v)
                                    updating = false
                                    if (apk != null) {
                                        update = null
                                        Updater.install(this@MainActivity, apk)
                                    } else Toast.makeText(this@MainActivity, "Download failed. Try again later.", Toast.LENGTH_LONG).show()
                                }
                            }) { Text(if (updating) "Downloading…" else "Update") }
                        },
                        dismissButton = { if (!updating) TextButton(onClick = { update = null }) { Text("Later") } }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Notifier.EXTRA_CONV)?.let { openFromIntent.value = it }
    }

    private fun signOut(nav: NavHostController) {
        lifecycleScope.launch {
            Push.unregister()
            Api.logout()
            Live.stop()
            Session.clear()
            Notifier.clearAll(this@MainActivity)
            nav.navigate("login") { popUpTo(0) }
        }
    }
}
