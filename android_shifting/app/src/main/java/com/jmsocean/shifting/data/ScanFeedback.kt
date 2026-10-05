package com.jmsocean.shifting.data

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.os.Build

/**
 * Beep + buzz so the shifter knows the result without looking at the screen:
 * one short beep for a good scan/shift, a long low tone and double buzz for an error.
 */
object ScanFeedback {
    private var tone: ToneGenerator? = null

    private fun tone(): ToneGenerator? {
        if (tone == null) tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90) }.getOrNull()
        return tone
    }

    private fun vibrator(ctx: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    fun success(ctx: Context) {
        runCatching { tone()?.startTone(ToneGenerator.TONE_PROP_ACK, 150) }
        runCatching { vibrator(ctx)?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE)) }
    }

    fun error(ctx: Context) {
        runCatching { tone()?.startTone(ToneGenerator.TONE_SUP_ERROR, 400) }
        runCatching {
            vibrator(ctx)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 80, 120), -1))
        }
    }
}
