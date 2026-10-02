package com.jmsocean.qc.data

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The backend runs on Asia/Kolkata and treats the night shift (00:00–05:30)
 * as the previous calendar day. These helpers keep the app in step regardless
 * of the phone's own timezone.
 */
object Ist {
    private val zone: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")

    fun date(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zone }.format(Date())

    /** Yesterday's IST date (yyyy-MM-dd) — for the Today/Yesterday selector. */
    fun yesterday(): String {
        val cal = Calendar.getInstance(zone).apply { add(Calendar.DAY_OF_MONTH, -1) }
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = zone }.format(cal.time)
    }

    /**
     * Production date + shift for "now" (same rule as supervisor.html): the
     * shift changes at 08:10 and 20:10 IST, and before 08:10 it is still the
     * previous day's Night shift — so a Night entry made after midnight keeps
     * the date the shift started on.
     */
    fun production(): Pair<String, String> {
        val cal = Calendar.getInstance(zone)
        val mins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        return when {
            mins in 490 until 1210 -> date() to "Day"
            mins < 490 -> yesterday() to "Night"
            else -> date() to "Night"
        }
    }

    fun productionDate(): String = production().first
    fun productionShift(): String = production().second

    fun shift(): String {
        val hour = Calendar.getInstance(zone).get(Calendar.HOUR_OF_DAY)
        return if (hour in 6..17) "Day" else "Night"
    }
}
