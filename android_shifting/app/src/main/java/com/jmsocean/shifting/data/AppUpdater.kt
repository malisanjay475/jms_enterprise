package com.jmsocean.shifting.data

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.jmsocean.shifting.BuildConfig
import com.jmsocean.shifting.data.remote.AppVersion
import com.jmsocean.shifting.data.remote.Network
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Self-update against the server's static feed at /qc-app/shifting/version.json
 * (published by CI to MAIN, carried to the factory server with each release).
 * When a higher versionCode is published the app downloads it and hands the APK
 * to the system installer.
 */
object AppUpdater {

    /** Returns the published version if it is newer than the installed one, else null. */
    suspend fun checkForUpdate(): AppVersion? = withContext(Dispatchers.IO) {
        runCatching {
            val resp = Network.api.appVersion()
            val v = resp.body() ?: return@runCatching null
            if (v.versionCode > BuildConfig.VERSION_CODE && v.apk.isNotBlank()) v else null
        }.getOrNull()
    }

    /** Downloads the APK to cacheDir/apk and returns the file, or null on failure. */
    suspend fun download(ctx: Context, version: AppVersion): File? = withContext(Dispatchers.IO) {
        runCatching {
            val dir = File(ctx.cacheDir, "apk").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() } // never install a stale file
            val name = version.apk.substringAfterLast('/').ifBlank { "update.apk" }
            val dest = File(dir, name)
            val url = Network.baseUrl.trimEnd('/') + "/qc-app/shifting/" + name
            if (Network.downloadTo(url, dest) && dest.length() > 0) dest else null
        }.getOrNull()
    }

    /** Launches the system package installer for the downloaded APK. */
    fun install(ctx: Context, apk: File) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
    }
}
