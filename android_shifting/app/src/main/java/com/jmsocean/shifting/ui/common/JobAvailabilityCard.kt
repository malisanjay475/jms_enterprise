package com.jmsocean.shifting.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.data.remote.Availability
import com.jmsocean.shifting.data.remote.LocQty
import com.jmsocean.shifting.data.remote.ShiftState
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
import com.jmsocean.shifting.ui.theme.Steel
import com.jmsocean.shifting.ui.theme.Warn

/** "Shifted to" chips: destination and pcs. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LocationChips(list: List<LocQty>) {
    if (list.isEmpty()) {
        Text("—", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        list.forEach { l ->
            Text(
                "${l.location}: ${qty(l.qty)}",
                fontSize = 11.sp, fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.10f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 7.dp, vertical = 2.dp)
            )
        }
    }
}

/** Grey "OR JR/25-26/4252" style chip; pass colours for a coloured one (SFG std). */
@Composable
fun InfoChip(label: String, value: String, background: Color = Color.Unspecified, content: Color = Color.Unspecified) {
    val bg = if (background == Color.Unspecified) MaterialTheme.colorScheme.surfaceVariant else background
    val fg = if (content == Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else content
    Text(
        buildAnnotatedString {
            if (label.isNotBlank()) append("$label ")
            withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = if (content == Color.Unspecified) MaterialTheme.colorScheme.onSurface else content)) { append(value) }
        },
        fontSize = 12.sp, color = fg, maxLines = 2,
        modifier = Modifier.background(bg, RoundedCornerShape(7.dp)).padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

/**
 * Whole job: OR / JC / party, produced, QC verified, not verified, shifted (with location),
 * ready on floor, QC hold, colour-wise table and the latest shifting entries.
 */
@Composable
fun JobAvailabilityCard(a: Availability) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            JobSummaryContent(a)
            JobBreakdownContent(a, leadingDivider = true)
        }
    }
}

/** Job header, info chips and metrics only (Manual Shift puts the form right under it). */
@Composable
fun JobSummaryCard(a: Availability) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { JobSummaryContent(a) }
    }
}

/** Colour-wise table and latest shifting as their own card; nothing when the job has neither. */
@Composable
fun JobBreakdownCard(a: Availability) {
    if (a.colours.isEmpty() && a.recent.isEmpty()) return
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { JobBreakdownContent(a, leadingDivider = false) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun JobSummaryContent(a: Availability) {
    Text("PRODUCTION · QC · SHIFTING", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(a.itemName.ifBlank { a.mouldName }.ifBlank { "—" }, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.width(6.dp))
        when {
            a.holdCount > 0 -> Pill("QC HOLD", Crit.copy(alpha = 0.15f), Crit)
            a.status.equals("running", ignoreCase = true) -> Pill("Running", Good.copy(alpha = 0.15f), Good)
            a.ppcCompleted -> PpcCompletedTag()
            a.status.isNotBlank() -> Pill(a.status, Steel.copy(alpha = 0.15f), Steel)
        }
    }
    ShiftStateBadge(a.shiftState, a.ready)
    a.closure?.let {
        Text(
            "Shifting closed by ${it.closedBy.ifBlank { "—" }}: ${it.reason.ifBlank { "no reason" }} (left ${qty(it.leftoverQty)} pcs)",
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Steel
        )
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (a.orderNo.isNotBlank()) InfoChip("OR", a.orderNo)
        if (a.jcNo.isNotBlank()) InfoChip("JC", a.jcNo)
        if (a.planCode.isNotBlank()) InfoChip("Plan", a.planCode)
        if (a.clientName.isNotBlank()) InfoChip("Party", a.clientName)
        if (a.mouldName.isNotBlank()) InfoChip("Mould", a.mouldName)
        if (a.planQty > 0) InfoChip("Plan qty", qty(a.planQty))
        if (a.hasSfgStd) {
            InfoChip(
                "SFG std", "${qty(a.sfgStd)} pcs / ${a.packName}" + if (a.sfgBagSize.isNotBlank()) " · ${a.sfgBagSize}" else "",
                background = Good.copy(alpha = 0.14f), content = Good
            )
        } else {
            InfoChip("", "SFG STD NOT SET", background = Crit.copy(alpha = 0.14f), content = Crit)
        }
    }
    MetricRow(
        Triple("Produced", qty(a.produced), Color.Unspecified),
        Triple("QC verified", qty(a.verified), Good),
        Triple("Not verified", qty(a.notVerified), if (a.notVerified > 0) Crit else Color.Unspecified)
    )
    MetricRow(
        Triple("Shifted", qty(a.shifted), MaterialTheme.colorScheme.primary),
        Triple("Ready (floor)", qty(a.ready), if (a.ready > 0) Good else Color.Unspecified),
        Triple("On QC hold", if (a.holdCount > 0 && a.holdQty <= 0) "Yes" else qty(a.holdQty), if (a.holdCount > 0) Crit else Color.Unspecified)
    )
    if (a.hasSfgStd && a.ready > 0) {
        Text("Ready = ${packText(a.ready, a.sfgStd, a.packName)}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Good)
    }
    if (a.holdCount > 0) {
        Text(
            "QC HOLD on ${a.machine}: ${a.holdReasons.joinToString("; ").ifBlank { "no reason given" }}",
            color = Crit, fontWeight = FontWeight.SemiBold, fontSize = 13.sp
        )
    }
    if (!a.verificationEnforced) {
        Text("QC verification data is not on this server; only production is checked.", fontSize = 11.sp, color = Warn)
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Shifted to", fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Spacer(Modifier.width(8.dp))
        LocationChips(a.byLocation)
    }
}

@Composable
private fun JobBreakdownContent(a: Availability, leadingDivider: Boolean) {
    if (a.colours.isNotEmpty()) {
        if (leadingDivider) HorizontalDivider()
        Text("Colour-wise", fontWeight = FontWeight.Bold, fontSize = 14.sp)
        Row(Modifier.fillMaxWidth()) {
            listOf("Colour" to 2.2f, "Prod" to 1f, "QC ok" to 1f, "Not ver." to 1f, "Shifted" to 1f, "Ready" to 1f).forEach { (h, w) ->
                Text(h, Modifier.weight(w), fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        a.colours.forEach { c ->
            Column {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(c.colour.ifBlank { "—" }, Modifier.weight(2.2f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                    Text(qty(c.produced), Modifier.weight(1f), fontSize = 12.sp)
                    Text(qty(c.verified), Modifier.weight(1f), fontSize = 12.sp, color = Good)
                    Text(qty(c.notVerified), Modifier.weight(1f), fontSize = 12.sp, color = if (c.notVerified > 0) Crit else Color.Unspecified)
                    Text(qty(c.shifted), Modifier.weight(1f), fontSize = 12.sp)
                    Text(qty(c.ready), Modifier.weight(1f), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (c.ready > 0) Good else Color.Unspecified)
                }
                if (c.state != ShiftState.UNKNOWN && c.state != ShiftState.NOT_PRODUCED) {
                    Row(Modifier.padding(top = 2.dp)) { ShiftStateBadge(c.state, c.ready) }
                }
                if (a.hasSfgStd && c.ready > 0) {
                    Text("Ready ${packText(c.ready, a.sfgStd, a.packName)}", fontSize = 11.sp, color = Good, fontWeight = FontWeight.SemiBold)
                }
                if (c.byLocation.isNotEmpty()) {
                    Row(Modifier.padding(top = 2.dp, bottom = 4.dp)) { LocationChips(c.byLocation) }
                }
            }
        }
        // Older manual shifts saved without a colour: own row, so the rows add up to Shifted.
        if (a.unassignedShifted > 0) {
            Column {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("No colour (manual)", Modifier.weight(2.2f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Warn, maxLines = 2)
                    Spacer(Modifier.weight(3f))
                    Text(qty(a.unassignedShifted), Modifier.weight(1f), fontSize = 12.sp)
                    Spacer(Modifier.weight(1f))
                }
                if (a.unassignedByLocation.isNotEmpty()) {
                    Row(Modifier.padding(top = 2.dp, bottom = 4.dp)) { LocationChips(a.unassignedByLocation) }
                }
            }
        }
    }

    if (a.recent.isNotEmpty()) {
        if (leadingDivider || a.colours.isNotEmpty()) HorizontalDivider()
        Text("Latest shifting", fontWeight = FontWeight.Bold, fontSize = 13.sp)
        a.recent.take(8).forEach { r ->
            Row(Modifier.fillMaxWidth()) {
                Text(
                    "${ShiftClock.prettyTime(r.at)} · ${r.colour.ifBlank { "Manual" }} → ${r.location} · ${r.by}",
                    Modifier.weight(1f), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    "${qty(r.qty)} pcs" + if (r.kg > 0) " · ${kg(r.kg)} kg" else "",
                    fontSize = 11.sp, fontWeight = FontWeight.Bold
                )
            }
        }
    }
}
