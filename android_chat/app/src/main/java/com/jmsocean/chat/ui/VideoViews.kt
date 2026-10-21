package com.jmsocean.chat.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.Attachment
import com.jmsocean.chat.data.Session

/** A video message: dark tile with a play button and its size. */
@Composable
fun VideoTile(att: Attachment, onPlay: () -> Unit) {
    Box(
        Modifier.padding(vertical = 2.dp).size(240.dp, 160.dp).clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF1F2C34)).clickable(onClick = onPlay),
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.size(56.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(36.dp))
        }
        Text("🎥 ${fileSize(att.size)}", color = Color.White, fontSize = 12.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp))
    }
}

/** Full-screen player; streams from the server with the chat session header. */
@OptIn(UnstableApi::class)
@Composable
fun VideoPlayerDialog(attachmentId: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val player = remember {
        val http = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(mapOf("Authorization" to "Bearer ${Session.token}"))
        ExoPlayer.Builder(ctx).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build().apply {
            setMediaItem(MediaItem.fromUri(Api.fileUrl(attachmentId)))
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(Unit) { onDispose { player.release() } }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(factory = { PlayerView(it).apply { this.player = player } }, modifier = Modifier.fillMaxSize())
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                Icon(Icons.Default.Close, "Close", tint = Color.White)
            }
        }
    }
}
