package com.jmsocean.qc.data

import android.content.Context

/**
 * Lightweight session memory (username + line). Slice-1 uses plain
 * SharedPreferences; a later phase moves this to EncryptedSharedPreferences
 * once a real token is issued.
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("qc_session", Context.MODE_PRIVATE)

    var username: String
        get() = prefs.getString("username", "") ?: ""
        set(v) = prefs.edit().putString("username", v).apply()

    var line: String
        get() = prefs.getString("line", "") ?: ""
        set(v) = prefs.edit().putString("line", v).apply()

    var machine: String
        get() = prefs.getString("machine", "") ?: ""
        set(v) = prefs.edit().putString("machine", v).apply()

    val isLoggedIn: Boolean get() = username.isNotBlank()

    fun clear() = prefs.edit().clear().apply()
}
