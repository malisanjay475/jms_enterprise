package com.jmsocean.qc.data.remote

import com.jmsocean.qc.BuildConfig
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import android.content.Context
import android.content.SharedPreferences
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The JMS API authenticates with a signed session cookie (jms_session) set by
 * /api/login. It used to live only in memory, so as soon as Android killed the
 * app the cookie was gone while SessionStore still said "logged in" — every
 * request after that went out with only a username in the body (the server's
 * legacy fallback), which would stop working once login is required everywhere.
 *
 * The cookies are now also kept in the app's private SharedPreferences and
 * reloaded at start ([init], called from QcApp.onCreate), so the session
 * survives restarts. Expired cookies are dropped; logout clears everything.
 */
class PersistentCookieJar : CookieJar {
    private val store = ConcurrentHashMap<String, MutableList<Cookie>>()
    private var prefs: SharedPreferences? = null

    /** Loads saved cookies. Call once before the first request. */
    fun init(context: Context) {
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        store.clear()
        val raw = p.getString(KEY, null) ?: return
        runCatching {
            val arr = JSONArray(raw)
            val now = System.currentTimeMillis()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val expiresAt = o.getLong("expiresAt")
                if (expiresAt <= now) continue
                val b = Cookie.Builder()
                    .name(o.getString("name"))
                    .value(o.getString("value"))
                    .path(o.optString("path", "/"))
                    .expiresAt(expiresAt)
                val domain = o.getString("domain")
                if (o.optBoolean("hostOnly", true)) b.hostOnlyDomain(domain) else b.domain(domain)
                if (o.optBoolean("secure", false)) b.secure()
                if (o.optBoolean("httpOnly", false)) b.httpOnly()
                store.getOrPut(o.getString("host")) { mutableListOf() }.add(b.build())
            }
        }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val list = store.getOrPut(url.host) { mutableListOf() }
        synchronized(list) {
            for (c in cookies) {
                list.removeAll { it.name == c.name }
                // An expired Set-Cookie is how the server clears a cookie.
                if (c.expiresAt > System.currentTimeMillis()) list.add(c)
            }
        }
        persist()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val list = store[url.host] ?: return emptyList()
        val now = System.currentTimeMillis()
        return synchronized(list) { list.filter { it.expiresAt > now && it.matches(url) } }
    }

    /** True when an unexpired login session cookie is held for the API host. */
    fun hasSession(host: String): Boolean {
        val list = store[host] ?: return false
        val now = System.currentTimeMillis()
        return synchronized(list) { list.any { it.name == SESSION_COOKIE && it.expiresAt > now } }
    }

    fun clear() {
        store.clear()
        prefs?.edit()?.remove(KEY)?.apply()
    }

    private fun persist() {
        val p = prefs ?: return
        val arr = JSONArray()
        for ((host, list) in store) {
            val snapshot = synchronized(list) { list.toList() }
            for (c in snapshot) {
                arr.put(
                    JSONObject()
                        .put("host", host)
                        .put("name", c.name)
                        .put("value", c.value)
                        .put("domain", c.domain)
                        .put("path", c.path)
                        .put("expiresAt", c.expiresAt)
                        .put("secure", c.secure)
                        .put("httpOnly", c.httpOnly)
                        .put("hostOnly", c.hostOnly)
                )
            }
        }
        p.edit().putString(KEY, arr.toString()).apply()
    }

    companion object {
        private const val PREFS = "qc_cookies"
        private const val KEY = "cookies"
        const val SESSION_COOKIE = "jms_session"
    }
}

object Network {

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        explicitNulls = false
    }

    val cookieJar = PersistentCookieJar()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
            else HttpLoggingInterceptor.Level.NONE
        })
        .build()

    val api: ApiService = Retrofit.Builder()
        .baseUrl(BuildConfig.BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(ApiService::class.java)

    val baseUrl: String get() = BuildConfig.BASE_URL

    /** Host of the API server, for [PersistentCookieJar.hasSession]. */
    val apiHost: String by lazy { BuildConfig.BASE_URL.toHttpUrl().host }

    /** Streams a URL to a file. Used by the self-updater to fetch the new APK. */
    fun downloadTo(url: String, dest: File): Boolean {
        val req = Request.Builder().url(url).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return false
            val body = resp.body ?: return false
            dest.outputStream().use { out -> body.byteStream().copyTo(out) }
        }
        return true
    }
}
