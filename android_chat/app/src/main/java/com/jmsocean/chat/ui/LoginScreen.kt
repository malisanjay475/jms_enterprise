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
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.SupervisorAccount
import androidx.compose.material.icons.filled.Work
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.vector.ImageVector
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
import kotlinx.coroutines.delay
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

    // Sign-up (chatSignup.js): first open on this phone shows the request form; a waiting
    // request is followed with its token; once approved the first password is set here.
    val first = remember { !hints.contains("last_user") && !hints.getBoolean("seen", false) }
    var mode by remember {
        mutableStateOf(when {
            hints.getString("signup_token", null) != null -> Mode.Waiting
            first -> Mode.Signup
            else -> Mode.Login
        })
    }
    var suName by remember { mutableStateOf("") }
    var suMobile by remember { mutableStateOf("") }
    var suDesig by remember { mutableStateOf("") }
    var suDept by remember { mutableStateOf("") }
    var suHod by remember { mutableStateOf("") }
    var waitName by remember { mutableStateOf(hints.getString("signup_name", "") ?: "") }
    var pwUser by remember { mutableStateOf("") }
    var pw1 by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    var pwMobile by remember { mutableStateOf("") }
    var needMobile by remember { mutableStateOf(false) }

    fun go(m: Mode) { error = null; busy = false; mode = m }
    fun forget() { hints.edit().remove("signup_token").remove("signup_name").apply() }
    fun askPassword(username: String) {
        pwUser = username; pw1 = ""; pw2 = ""
        needMobile = hints.getString("signup_token", null) == null
        go(Mode.SetPassword)
    }

    // While a request waits: ask the server every 15 s.
    LaunchedEffect(mode) {
        while (mode == Mode.Waiting) {
            val token = hints.getString("signup_token", null) ?: break
            val st = Api.signupStatus(token)
            when {
                st == null -> Unit // offline: try again later
                st.status == "pending" -> st.name?.let { waitName = it }
                st.status == "approved" && !st.password_set && st.username != null -> { askPassword(st.username); break }
                st.status == "approved" -> { forget(); user = st.username ?: user; go(Mode.Login); break }
                else -> { forget(); go(Mode.Signup); break } // rejected: start over, nothing to show
            }
            delay(15_000)
        }
    }

    fun signedIn(username: String, token: String) {
        forget()
        hints.edit().putString("last_user", username).putBoolean("seen", true).apply()
        Session.save(username, token)
        onSignedIn()
    }

    fun submit() {
        if (busy) return
        if (user.isBlank() || pass.isEmpty()) { error = "Enter your username and password."; return }
        focus.clearFocus()
        busy = true; error = null
        scope.launch {
            val r = Api.login(user.trim(), pass)
            busy = false
            when {
                r.set_password -> askPassword(r.username ?: user.trim())
                r.ok && r.token != null -> signedIn(r.username ?: user.trim(), r.token)
                else -> error = r.error ?: "Sign-in failed."
            }
        }
    }

    fun sendRequest() {
        if (busy) return
        val name = suName.trim()
        error = when {
            name.length < 2 -> "Enter your full name."
            suMobile.filter { it.isDigit() }.length < 10 -> "Enter a valid 10-digit mobile number."
            suDesig.isBlank() -> "Enter your designation."
            suDept.isBlank() -> "Enter your department."
            suHod.isBlank() -> "Enter your HOD's name."
            else -> null
        }
        if (error != null) return
        focus.clearFocus()
        busy = true
        scope.launch {
            val r = Api.signup(name, suMobile, suDesig.trim(), suDept.trim(), suHod.trim())
            busy = false
            if (r.ok && r.token != null) {
                hints.edit().putString("signup_token", r.token).putString("signup_name", name).putBoolean("seen", true).apply()
                waitName = name
                go(Mode.Waiting)
            } else error = r.error ?: "Could not send the request."
        }
    }

    fun savePassword() {
        if (busy) return
        error = when {
            pw1.length < 6 -> "Use at least 6 characters."
            pw1 != pw2 -> "The two passwords are not the same."
            needMobile && pwMobile.filter { it.isDigit() }.length < 10 -> "Enter the mobile number from your request."
            else -> null
        }
        if (error != null) return
        focus.clearFocus()
        busy = true
        scope.launch {
            val token = if (needMobile) null else hints.getString("signup_token", null)
            val r = Api.setPassword(pwUser, pw1, token, if (needMobile) pwMobile else null)
            busy = false
            when {
                r.ok && r.token != null -> signedIn(r.username ?: pwUser, r.token)
                r.need_mobile -> { needMobile = true; error = r.error ?: "Enter the mobile number from your request." }
                else -> error = r.error ?: "Could not set the password."
            }
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
                    when (mode) {
                        Mode.Login -> {
                            Text("Sign in", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                            Text("Use your JMS username and password", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(20.dp))
                            Field(user, { user = it; error = null }, "Username", Icons.Default.Person, KeyboardType.Ascii)
                            Spacer(Modifier.height(12.dp))
                            OutlinedTextField(
                                value = pass, onValueChange = { pass = it; error = null }, label = { Text("Password") }, singleLine = true,
                                leadingIcon = { Icon(Icons.Default.Lock, null) }, shape = RoundedCornerShape(14.dp), colors = fieldColors(),
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
                            ErrorBox(error)
                            Spacer(Modifier.height(20.dp))
                            MainButton("Sign in", busy) { submit() }
                            Alt("New here?", "Request access") { go(Mode.Signup) }
                        }
                        Mode.Signup -> {
                            Text("Join JMS Chat", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                            Text("Send your details. An admin will approve your account.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(16.dp))
                            Field(suName, { suName = it; error = null }, "Full name", Icons.Default.Person, KeyboardType.Text)
                            Spacer(Modifier.height(10.dp))
                            Field(suMobile, { suMobile = it.filter { c -> c.isDigit() || c == '+' || c == ' ' }.take(16); error = null }, "Mobile number", Icons.Default.Phone, KeyboardType.Phone)
                            Spacer(Modifier.height(10.dp))
                            Field(suDesig, { suDesig = it; error = null }, "Designation", Icons.Default.Work, KeyboardType.Text)
                            Spacer(Modifier.height(10.dp))
                            Field(suDept, { suDept = it; error = null }, "Department", Icons.Default.Business, KeyboardType.Text)
                            Spacer(Modifier.height(10.dp))
                            Field(suHod, { suHod = it; error = null }, "HOD name", Icons.Default.SupervisorAccount, KeyboardType.Text, ImeAction.Done)
                            ErrorBox(error)
                            Spacer(Modifier.height(20.dp))
                            MainButton("Send request", busy) { sendRequest() }
                            Alt("Already have an account?", "Sign in") { hints.edit().putBoolean("seen", true).apply(); go(Mode.Login) }
                        }
                        Mode.Waiting -> {
                            Text("⏳", fontSize = 44.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            Text("Request sent", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            Spacer(Modifier.height(8.dp))
                            Text(
                                (if (waitName.isNotBlank()) "Hi $waitName, your" else "Your") + " request is waiting for approval from your admin.",
                                fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(6.dp))
                            Text(
                                "You can close the app. This screen updates by itself.",
                                fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(16.dp))
                            CircularProgressIndicator(color = Color(0xFF00A884), strokeWidth = 3.dp, modifier = Modifier.size(28.dp).align(Alignment.CenterHorizontally))
                            Alt("Have an account already?", "Sign in") { go(Mode.Login) }
                        }
                        Mode.SetPassword -> {
                            Text("🎉", fontSize = 44.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            Text("You're approved!", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            Spacer(Modifier.height(6.dp))
                            Text(
                                "Your username is $pwUser\nSet a password to start chatting.",
                                fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(16.dp))
                            if (needMobile) {
                                Field(pwMobile, { pwMobile = it.filter { c -> c.isDigit() || c == '+' || c == ' ' }.take(16); error = null }, "Mobile number from your request", Icons.Default.Phone, KeyboardType.Phone)
                                Spacer(Modifier.height(10.dp))
                            }
                            Field(pw1, { pw1 = it; error = null }, "New password", Icons.Default.Lock, KeyboardType.Password, password = true)
                            Spacer(Modifier.height(10.dp))
                            Field(pw2, { pw2 = it; error = null }, "Confirm password", Icons.Default.Lock, KeyboardType.Password, ImeAction.Done, password = true)
                            ErrorBox(error)
                            Spacer(Modifier.height(20.dp))
                            MainButton("Set password and sign in", busy) { savePassword() }
                            Alt("Not you?", "Sign in") { go(Mode.Login) }
                        }
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

private enum class Mode { Login, Signup, Waiting, SetPassword }

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Color(0xFF00A884), focusedLabelColor = Color(0xFF00A884), cursorColor = Color(0xFF00A884)
)

@Composable
private fun Field(
    value: String, onChange: (String) -> Unit, label: String, icon: ImageVector, type: KeyboardType,
    ime: ImeAction = ImeAction.Next, password: Boolean = false
) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true,
        leadingIcon = { Icon(icon, null) }, shape = RoundedCornerShape(14.dp), colors = fieldColors(),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = ime),
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun ErrorBox(error: String?) {
    error ?: return
    Spacer(Modifier.height(12.dp))
    Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
        Text(error, color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 14.sp, modifier = Modifier.padding(12.dp))
    }
}

@Composable
private fun MainButton(text: String, busy: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = !busy,
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF00A884)),
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier.fillMaxWidth().height(54.dp)
    ) {
        if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
        else Text(text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Alt(question: String, action: String, onClick: () -> Unit) {
    Spacer(Modifier.height(8.dp))
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text("$question ", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(action, color = Color(0xFF008069), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}
