package com.jmsocean.chat.data

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.jmsocean.chat.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Self-update against MAIN's static feed /qc-app/chat/version.json (published by CI,
 * same as the QC and Shifting apps). A higher versionCode is downloaded and handed to
 * the system installer.
 */
object Updater {
    suspend fun check(): AppVersion? {
        val v = Api.appVersion() ?: return null
        return if (v.versionCode > BuildConfig.VERSION_CODE && v.apk.isNotBlank()) v else null
    }

    suspend fun download(ctx: Context, v: AppVersion): File? = withContext(Dispatchers.IO) {
        runCatching {
            val dir = File(ctx.cacheDir, "apk").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() } // never install a stale file
            val name = v.apk.substringAfterLast('/').ifBlank { "update.apk" }
            val dest = File(dir, name)
            if (Api.downloadTo("${Api.base}/qc-app/chat/$name", dest) && dest.length() > 0) dest else null
        }.getOrNull()
    }

    fun install(ctx: Context, apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apk)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        })
    }
}
