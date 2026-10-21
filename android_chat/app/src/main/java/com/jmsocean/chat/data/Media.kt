package com.jmsocean.chat.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import java.io.File

/** Camera files, photo shrinking, voice notes. */
object Media {

    /** A fresh file + content URI for the camera app to write a photo into. */
    fun newCameraTarget(ctx: Context): Pair<File, Uri> {
        val dir = File(ctx.cacheDir, "camera").apply { mkdirs() }
        dir.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 3600_000L }?.forEach { it.delete() }
        val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        return f to FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
    }

    /**
     * Shrinks a photo to at most [maxSide] px on the long side as an upright JPEG, like
     * WhatsApp does: a 4 MB camera shot becomes ~250 KB and sends in a second.
     * Returns null when the bytes are not a decodable image.
     */
    fun shrinkPhoto(src: File, dest: File, maxSide: Int = 1600, quality: Int = 80): File? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(src.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        var bmp = BitmapFactory.decodeFile(src.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val scale = maxSide.toFloat() / maxOf(bmp.width, bmp.height)
        val m = Matrix()
        if (scale < 1f) m.postScale(scale, scale)
        val rotate = when (ExifInterface(src.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (rotate != 0f) m.postRotate(rotate)
        if (!m.isIdentity) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        dest.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, quality, it) }
        dest
    }.getOrNull()

    /** Hold-to-record voice notes. Opus in Ogg on Android 10+, AAC in MP4 before. */
    class Recorder(private val ctx: Context) {
        private var rec: MediaRecorder? = null
        var file: File? = null
            private set
        private var startedAt = 0L

        val mime: String get() = if (Build.VERSION.SDK_INT >= 29) "audio/ogg" else "audio/mp4"

        fun start(): Boolean = runCatching {
            val ext = if (Build.VERSION.SDK_INT >= 29) "ogg" else "m4a"
            val f = File(ctx.cacheDir, "voice-${System.currentTimeMillis()}.$ext")
            @Suppress("DEPRECATION")
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            if (Build.VERSION.SDK_INT >= 29) {
                r.setOutputFormat(MediaRecorder.OutputFormat.OGG)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            } else {
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            }
            r.setAudioEncodingBitRate(32000)
            r.setAudioSamplingRate(48000)
            r.setOutputFile(f.path)
            r.prepare()
            r.start()
            rec = r
            file = f
            startedAt = System.currentTimeMillis()
            true
        }.getOrDefault(false)

        /** Stops and returns the file, or null when it was too short (under 1 s) or failed. */
        fun stop(): File? {
            val r = rec ?: return null
            rec = null
            val long = System.currentTimeMillis() - startedAt >= 1000
            val ok = runCatching { r.stop() }.isSuccess
            r.release()
            val f = file
            return if (ok && long && f != null && f.length() > 0) f else { f?.delete(); null }
        }

        fun cancel() { stop()?.delete() }
    }

    /** One voice note plays at a time, streamed from the server with the session header. */
    object Player {
        private var mp: MediaPlayer? = null
        var playingId: String? = null
            private set
        private var onEnd: (() -> Unit)? = null

        fun play(ctx: Context, id: String, url: String, onDone: () -> Unit) {
            stop()
            val p = MediaPlayer()
            playingId = id
            onEnd = onDone
            runCatching {
                p.setDataSource(ctx, Uri.parse(url), mapOf("Authorization" to "Bearer ${Session.token}"))
                p.setOnPreparedListener { it.start() }
                p.setOnCompletionListener { stop() }
                p.setOnErrorListener { _, _, _ -> stop(); true }
                p.prepareAsync()
                mp = p
            }.onFailure { stop() }
        }

        fun position(): Pair<Int, Int> = mp?.let { runCatching { it.currentPosition to it.duration }.getOrNull() } ?: (0 to 0)

        fun stop() {
            mp?.let { runCatching { it.stop() }; it.release() }
            mp = null
            playingId = null
            onEnd?.invoke()
            onEnd = null
        }
    }
}
