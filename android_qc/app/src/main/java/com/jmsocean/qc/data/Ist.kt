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

    fun shift(): String {
        val hour = Calendar.getInstance(zone).get(Calendar.HOUR_OF_DAY)
        return if (hour in 6..17) "Day" else "Night"
    }
}
