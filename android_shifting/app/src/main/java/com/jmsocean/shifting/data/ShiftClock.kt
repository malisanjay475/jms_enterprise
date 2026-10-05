package com.jmsocean.shifting.data

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Factory shift rules (same as DPR / the server): Day 08:00–20:00, Night
 * 20:00–08:00, and a Night entry after midnight belongs to the previous date.
 * Always computed in IST, whatever time zone the phone is set to.
 */
object ShiftClock {
    val IST: ZoneId = ZoneId.of("Asia/Kolkata")

    data class Slot(val date: LocalDate, val shift: String) {
        val dateText: String get() = date.toString()
    }

    fun current(now: LocalDateTime = LocalDateTime.now(IST)): Slot {
        val hour = now.hour
        val shift = if (hour in 8..19) "Day" else "Night"
        val date = if (hour < 8) now.toLocalDate().minusDays(1) else now.toLocalDate()
        return Slot(date, shift)
    }

    private val timeFmt = DateTimeFormatter.ofPattern("dd MMM, HH:mm")
    private val dayFmt = DateTimeFormatter.ofPattern("EEE dd MMM yyyy")

    fun prettyDate(date: LocalDate): String = date.format(dayFmt)

    /** Server timestamps arrive as ISO strings (UTC "Z" or with offset); show them in IST. */
    fun prettyTime(raw: String): String = runCatching {
        OffsetDateTime.parse(raw).atZoneSameInstant(IST).format(timeFmt)
    }.recoverCatching {
        LocalDateTime.parse(raw.removeSuffix("Z")).format(timeFmt)
    }.getOrDefault(raw)
}
