package com.jmsocean.chat.ui

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.BuildConfig
import com.jmsocean.chat.R
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Session
import kotlinx.coroutines.launch

private const val HINTS = "chat_hints"

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val ctx = LocalContext.current
    val hints = remember { ctx.getSharedPreferences(HINTS, Context.MODE_PRIVATE) }
    var user by remember { mutableStateOf(hints.getString("last_user", "") ?: "") }
    var pass by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current

    fun submit() {
        if (busy) return
        if (user.isBlank() || pass.isEmpty()) { error = "Enter your username and password."; return }
        focus.clearFocus()
        busy = true; error = null
        scope.launch {
            val r = Api.login(user.trim(), pass)
            busy = false
            if (r.ok && r.token != null) {
                hints.edit().putString("last_user", user.trim()).apply()
                Session.save(r.username ?: user.trim(), r.token)
                onSignedIn()
            } else error = r.error ?: "Sign-in failed."
        }
    }

    Box(
        Modifier.fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF075E54), Color(0xFF0B7C6E), Color(0xFF128C7E))))
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
                .verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(56.dp))
            Box(Modifier.size(96.dp).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.jms_logo), contentDescription = "JMS", modifier = Modifier.size(64.dp))
            }
            Spacer(Modifier.height(16.dp))
            Text("JMS Chat", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Text("Talk to your team, anywhere", color = Color.White.copy(alpha = 0.8f), fontSize = 15.sp)
            Spacer(Modifier.height(36.dp))

            Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 8.dp,
                modifier = Modifier.fillMaxWidth().widthIn(max = 440.dp)) {
                Column(Modifier.padding(24.dp)) {
                    Text("Sign in", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                    Text("Use your JMS username and password", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(20.dp))
                    val fieldColors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color(0xFF00A884), focusedLabelColor = Color(0xFF00A884), cursorColor = Color(0xFF00A884)
                    )
                    OutlinedTextField(
                        value = user, onValueChange = { user = it; error = null }, label = { Text("Username") }, singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Person, null) }, shape = RoundedCornerShape(14.dp), colors = fieldColors,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = pass, onValueChange = { pass = it; error = null }, label = { Text("Password") }, singleLine = true,
                        leadingIcon = { Icon(Icons.Default.Lock, null) }, shape = RoundedCornerShape(14.dp), colors = fieldColors,
                        visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { show = !show }) {
                                Icon(if (show) Icons.Default.VisibilityOff else Icons.Default.Visibility, if (show) "Hide password" else "Show password")
                            }
                        },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { submit() }),
                        modifier = Modifier.fillMaxWidth()
                    )
                    error?.let {
                        Spacer(Modifier.height(12.dp))
                        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                            Text(it, color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 14.sp, modifier = Modifier.padding(12.dp))
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    Button(
                        onClick = { submit() }, enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884)),
                        shape = RoundedCornerShape(28.dp),
                        modifier = Modifier.fillMaxWidth().height(54.dp)
                    ) {
                        if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                        else Text("Sign in", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            Text(
                "🔒 Works from anywhere · Messages may be reviewed by administrators",
                color = Color.White.copy(alpha = 0.75f), fontSize = 12.sp, textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(6.dp))
            Text("JMS Ocean · v${BuildConfig.VERSION_NAME}", color = Color.White.copy(alpha = 0.55f), fontSize = 12.sp)
            Spacer(Modifier.height(24.dp))
        }
    }
}
