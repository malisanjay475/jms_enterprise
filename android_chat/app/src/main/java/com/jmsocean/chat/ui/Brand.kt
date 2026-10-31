package com.jmsocean.chat.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.chat.R
import kotlinx.coroutines.delay

/** Brand colours of the JMS Chat logo (BACKEND/PUBLIC/assets/brand/jms-chat-logo.svg). */
val BrandGradient = Brush.linearGradient(listOf(Color(0xFF00C29A), Color(0xFF008069), Color(0xFF054D44)))

/** The JMS Chat app logo (rounded tile). */
@Composable
fun BrandLogo(size: Dp, modifier: Modifier = Modifier) {
    Image(
        painterResource(R.drawable.jms_chat_logo), contentDescription = "JMS Chat",
        modifier = modifier.size(size).shadow(12.dp, RoundedCornerShape(size * 0.22f)).clip(RoundedCornerShape(size * 0.22f))
    )
}

/**
 * Shown once when the app opens (after the system splash): logo, "JMS Chat" and
 * "by Joyo Plastics", then fades into the app.
 */
@Composable
fun BrandSplash() {
    var show by rememberSaveable { mutableStateOf(true) }
    var grown by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        grown = true
        delay(1300)
        show = false
    }
    val scale by animateFloatAsState(if (grown) 1f else 0.82f, tween(600), label = "logo")
    AnimatedVisibility(visible = show, exit = fadeOut(tween(350))) {
        Box(Modifier.fillMaxSize().background(BrandGradient)) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                BrandLogo(128.dp, Modifier.scale(scale))
                Spacer(Modifier.height(22.dp))
                androidx.compose.material3.Text("JMS Chat", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                androidx.compose.material3.Text("Work chat for the shop floor", color = Color.White.copy(alpha = .8f), fontSize = 14.sp)
            }
            Column(
                Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 36.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                androidx.compose.material3.Text("from", color = Color.White.copy(alpha = .7f), fontSize = 13.sp)
                androidx.compose.material3.Text("Joyo Plastics", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.sp)
            }
        }
    }
}
