package com.jmsocean.shifting.data

import android.content.Context

/**
 * Small per-phone memory: who is logged in, their line, and the shifter's
 * working preferences (last destination, Quick shift). The login session itself
 * is the encrypted cookie in Network.cookieJar.
 */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("shifting_session", Context.MODE_PRIVATE)

    var username: String
        get() = prefs.getString("username", "") ?: ""
        set(v) = prefs.edit().putString("username", v).apply()

    var line: String
        get() = prefs.getString("line", "") ?: ""
        set(v) = prefs.edit().putString("line", v).apply()

    /** Last "Send To" picked on the Scan screen, offered again on the next scan. */
    var lastLocation: String
        get() = prefs.getString("last_location", "") ?: ""
        set(v) = prefs.edit().putString("last_location", v).apply()

    /** Quick shift: confirm automatically right after a good scan. */
    var quickShift: Boolean
        get() = prefs.getBoolean("quick_shift", false)
        set(v) = prefs.edit().putBoolean("quick_shift", v).apply()

    /** Completed-jobs window on the Jobs screen (3 / 7 / 30 days). */
    var jobDays: Int
        get() = prefs.getInt("job_days", 7)
        set(v) = prefs.edit().putInt("job_days", v).apply()

    /** Manual screen: show only machines with QC approved qty. */
    var approvedOnly: Boolean
        get() = prefs.getBoolean("approved_only", false)
        set(v) = prefs.edit().putBoolean("approved_only", v).apply()

    val isLoggedIn: Boolean get() = username.isNotBlank()

    /** Clears the login but keeps the shifter's working preferences. */
    fun clearLogin() = prefs.edit().remove("username").remove("line").apply()
}
