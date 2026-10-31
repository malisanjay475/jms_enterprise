package com.jmsocean.chat.data

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * App lock (like WhatsApp's): a 4-digit passcode, optional fingerprint, locks when the
 * app has been in the background longer than [timeoutMs] (default 1 minute) and on
 * every cold start. The passcode is stored only as a salted PBKDF2 hash.
 */
object AppLock {
    private const val PREFS = "chat_lock"
    private lateinit var prefs: SharedPreferences
    private val _locked = MutableStateFlow(false)
    val locked = _locked.asStateFlow()
    private var backgroundAt = 0L

    val TIMEOUTS = listOf(0L to "Immediately", 60_000L to "After 1 minute", 5 * 60_000L to "After 5 minutes", 30 * 60_000L to "After 30 minutes")

    fun init(ctx: Context) {
        prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        _locked.value = enabled // cold start: locked
    }

    val enabled get() = ::prefs.isInitialized && prefs.getString("hash", null) != null
    var useBiometric: Boolean
        get() = prefs.getBoolean("bio", true)
        set(v) { prefs.edit().putBoolean("bio", v).apply() }
    var timeoutMs: Long
        get() = prefs.getLong("timeout", 60_000L)
        set(v) { prefs.edit().putLong("timeout", v).apply() }

    fun onBackground() { backgroundAt = System.currentTimeMillis() }

    fun onForeground() {
        if (enabled && backgroundAt > 0 && System.currentTimeMillis() - backgroundAt >= timeoutMs) _locked.value = true
    }

    fun lockNow() { if (enabled) _locked.value = true }

    fun unlock() { _locked.value = false; backgroundAt = 0 }

    fun check(pin: String): Boolean {
        val salt = prefs.getString("salt", null) ?: return false
        val hash = prefs.getString("hash", null) ?: return false
        return hash(pin, Base64.decode(salt, Base64.NO_WRAP)) == hash
    }

    fun setPin(pin: String) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        prefs.edit()
            .putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString("hash", hash(pin, salt))
            .apply()
        _locked.value = false
    }

    fun disable() {
        prefs.edit().remove("hash").remove("salt").apply()
        _locked.value = false
    }

    private fun hash(pin: String, salt: ByteArray): String {
        val spec = PBEKeySpec(pin.toCharArray(), salt, 20_000, 256)
        val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        return Base64.encodeToString(key, Base64.NO_WRAP)
    }
}
