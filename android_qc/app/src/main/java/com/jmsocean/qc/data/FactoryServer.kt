package com.jmsocean.qc.data

import android.content.Context
import android.content.SharedPreferences
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * The factory LOCAL servers the app can talk to. A new host must also be added to
 * res/xml/network_security_config.xml (plain http is allowed per host only).
 */
enum class Factory(val label: String, val url: String) {
    DUNGRA("Dungra Unit 1", "http://192.168.1.173:3001/"),
    SHIVANI("Shivani - Kachigam", "http://192.168.1.175:3001/"),
    PREMIER("Premier - Kachigam", "http://192.168.3.51:3001/")
}

/**
 * The factory chosen on this phone, kept across restarts, logouts and app updates.
 * One APK serves every factory because all LOCAL servers mirror the same update feed.
 */
object FactoryServer {
    private const val KEY = "factory"
    private var prefs: SharedPreferences? = null

    /** Null until the user picks one on the login screen. */
    @Volatile
    var selected: Factory? = null
        private set

    /** Dungra until chosen: every build before the chooser only talked to Dungra. */
    val current: Factory get() = selected ?: Factory.DUNGRA
    val httpUrl: HttpUrl get() = current.url.toHttpUrl()

    /** Call before the first request. A phone already logged in by an older build stays on Dungra. */
    fun init(context: Context, alreadyLoggedIn: Boolean) {
        val p = context.applicationContext.getSharedPreferences("qc_factory", Context.MODE_PRIVATE)
        prefs = p
        val saved = p.getString(KEY, null)
        selected = Factory.entries.firstOrNull { it.name == saved }
        if (selected == null && alreadyLoggedIn) select(Factory.DUNGRA)
    }

    fun select(factory: Factory) {
        selected = factory
        prefs?.edit()?.putString(KEY, factory.name)?.apply()
    }
}
