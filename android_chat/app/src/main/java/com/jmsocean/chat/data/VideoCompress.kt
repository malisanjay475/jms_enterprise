package com.jmsocean.chat.data

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

/**
 * Shrinks a video to 480p H.264 at ~1 Mbit/s (like WhatsApp), so a 1-minute clip is
 * about 8 MB and fits the 10 MB chat limit. Returns null when it fails.
 */
object VideoCompress {
    suspend fun to480p(ctx: Context, src: Uri, dest: File): File? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
            val encoder = DefaultEncoderFactory.Builder(ctx.applicationContext)
                .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(1_000_000).build())
                .build()
            val transformer = Transformer.Builder(ctx.applicationContext)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .setEncoderFactory(encoder)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        if (cont.isActive) cont.resume(dest.takeIf { it.length() > 0 })
                    }

                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        dest.delete()
                        if (cont.isActive) cont.resume(null)
                    }
                })
                .build()
            val item = EditedMediaItem.Builder(MediaItem.fromUri(src))
                .setEffects(Effects(emptyList(), listOf(Presentation.createForHeight(480))))
                .build()
            runCatching { transformer.start(item, dest.path) }.onFailure { if (cont.isActive) cont.resume(null) }
            cont.invokeOnCancellation { runCatching { transformer.cancel() } }
        }
    }
}
