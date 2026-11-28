package com.jmsocean.shifting.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL

/**
 * The factory LOCAL servers the app can talk to. A new host must also be added to
 * res/xml/network_security_config.xml (plain http is allowed per host only).
 * [ports]: the ports its server may run on, usual one first; login finds the live one.
 */
enum class Factory(val label: String, val host: String, val ports: List<Int>) {
    DUNGRA("Dungra Unit 1", "192.168.1.173", listOf(3001, 3000)),
    SHIVANI("Shivani - Kachigam", "192.168.1.175", listOf(3000, 3001)),
    PREMIER("Premier - Kachigam", "192.168.3.51", listOf(3001, 3000))
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
    val url: String get() = urlOf(current)
    val httpUrl: HttpUrl get() = url.toHttpUrl()

    /** Address of a factory, on the port found at its last login (else its usual port). */
    fun urlOf(f: Factory): String = "http://${f.host}:${portOf(f)}/"

    private fun portOf(f: Factory): Int =
        prefs?.getInt("port_${f.name}", 0)?.takeIf { it in f.ports } ?: f.ports.first()

    /**
     * Finds and remembers the port the JMS server of the chosen factory answers on.
     * False when none does (wrong Wi-Fi, or the server is down).
     */
    suspend fun findServer(): Boolean = withContext(Dispatchers.IO) {
        val f = current
        val saved = portOf(f)
        val port = (listOf(saved) + f.ports).distinct().firstOrNull { answers(f.host, it) }
        if (port != null) prefs?.edit()?.putInt("port_${f.name}", port)?.apply()
        port != null
    }

    /** True only for a JMS server, so another program on that port is never sent a password. */
    private fun answers(host: String, port: Int): Boolean = runCatching {
        val c = URL("http://$host:$port/api/health").openConnection(Proxy.NO_PROXY) as HttpURLConnection
        c.connectTimeout = 4000
        c.readTimeout = 6000
        try {
            // A JMS server with a database problem answers 503; it is still the right server.
            val stream = if (c.responseCode < 400) c.inputStream else c.errorStream
            stream?.bufferedReader()?.use { it.readText() }.orEmpty().contains("jms-backend")
        } finally {
            c.disconnect()
        }
    }.getOrDefault(false)

    /** Call before the first request. A phone already logged in by an older build stays on Dungra. */
    fun init(context: Context, alreadyLoggedIn: Boolean) {
        val p = context.applicationContext.getSharedPreferences("shifting_factory", Context.MODE_PRIVATE)
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
