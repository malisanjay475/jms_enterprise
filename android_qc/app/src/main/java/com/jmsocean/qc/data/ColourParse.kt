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
 * Natural machine sort — "Line>Model-Tonnage-Index" or "Machine 10" ordered
 * by alpha prefix then the trailing number, so 2 < 10 (not lexicographic).
 */
val naturalMachineComparator: Comparator<String> = Comparator { a, b ->
    val ta = tokenize(a); val tb = tokenize(b)
    val n = minOf(ta.size, tb.size)
    for (i in 0 until n) {
        val x = ta[i]; val y = tb[i]
        val cmp = if (x is Int && y is Int) x.compareTo(y)
        else x.toString().compareTo(y.toString(), ignoreCase = true)
        if (cmp != 0) return@Comparator cmp
    }
    ta.size - tb.size
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
