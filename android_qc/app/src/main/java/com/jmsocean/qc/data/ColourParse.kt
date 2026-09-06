package com.jmsocean.qc.data

import com.jmsocean.qc.data.remote.ColourLine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Extract colour + planned qty from a job's ColourDetails (tolerant of key names). */
fun parseColourLines(el: JsonElement?): List<ColourLine> {
    val arr = el as? JsonArray ?: return emptyList()
    return arr.mapNotNull { item ->
        val o = item as? JsonObject ?: return@mapNotNull null
        val name = firstString(o, "colour", "color", "colourName", "name", "shade")
            ?: return@mapNotNull null
        val qty = firstString(o, "planQty", "plan_qty", "qty", "quantity", "planned")
            ?.toDoubleOrNull()?.toInt() ?: 0
        ColourLine(name, qty)
    }
}

private fun firstString(o: JsonObject, vararg keys: String): String? {
    for (k in keys) {
        val v = o[k]?.jsonPrimitive?.contentOrNull
        if (!v.isNullOrBlank()) return v
    }
    return null
}

/**
 * Machine sort — a byte-for-byte port of the backend `naturalCompare`
 * (Supervisor.html / summary-matrix), so the app's dropdown order is identical
 * to the web. Splits "Line>Model-Tonnage-Index": sort by LINE first, then the
 * trailing INDEX number, then the full string — all numeric-aware.
 */
private val TRAILING_NUM = Regex("(\\d+)$")

private fun machineMeta(v: String): Pair<String, Int> {
    val parts = v.split(">")
    val line = if (parts.size > 1) parts[0] else ""
    val rest = if (parts.size > 1) parts[1] else v
    val idx = TRAILING_NUM.find(rest)?.value?.toIntOrNull() ?: 999999
    return line to idx
}

/** Numeric-aware string compare (like localeCompare {numeric:true}). */
private fun naturalStrCompare(a: String, b: String): Int {
    val ta = tokenize(a); val tb = tokenize(b)
    val n = minOf(ta.size, tb.size)
    for (i in 0 until n) {
        val x = ta[i]; val y = tb[i]
        val c = if (x is Int && y is Int) x.compareTo(y)
        else x.toString().compareTo(y.toString(), ignoreCase = true)
        if (c != 0) return c
    }
    return ta.size - tb.size
}

val naturalMachineComparator: Comparator<String> = Comparator { a, b ->
    val (la, ia) = machineMeta(a)
    val (lb, ib) = machineMeta(b)
    val lineCmp = naturalStrCompare(la, lb)
    if (lineCmp != 0) return@Comparator lineCmp
    val idxCmp = ia - ib
    if (idxCmp != 0) return@Comparator idxCmp
    naturalStrCompare(a, b)
}

private fun tokenize(s: String): List<Any> {
    val out = mutableListOf<Any>()
    val sb = StringBuilder()
    var digit = false
    fun flush() {
        if (sb.isEmpty()) return
        out.add(if (digit) sb.toString().toIntOrNull() ?: sb.toString() else sb.toString())
        sb.clear()
    }
    for (c in s) {
        val isD = c.isDigit()
        if (sb.isNotEmpty() && isD != digit) flush()
        digit = isD
        sb.append(c)
    }
    flush()
    return out
}
