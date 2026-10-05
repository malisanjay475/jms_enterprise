package com.jmsocean.shifting.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.jmsocean.shifting.data.ShiftClock
import com.jmsocean.shifting.data.remote.Availability
import com.jmsocean.shifting.data.remote.LocQty
import com.jmsocean.shifting.ui.theme.Crit
import com.jmsocean.shifting.ui.theme.Good
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

/**
 * Whole job: OR / JC / party, produced, QC verified, not verified, shifted (with location),
 * ready on floor, QC hold, colour-wise table and the latest shifting entries.
 */
@Composable
fun JobAvailabilityCard(a: Availability) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("PRODUCTION · QC · SHIFTING", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(a.itemName.ifBlank { a.mouldName }.ifBlank { "—" }, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text("OR: ${a.orderNo.ifBlank { "—" }}   JC: ${a.jcNo.ifBlank { "—" }}", fontSize = 13.sp)
            Text("Party: ${a.clientName.ifBlank { "—" }}", fontSize = 13.sp)
            Text(
                listOf(a.machine, a.planCode, a.status, "Plan ${qty(a.planQty)}").filter { it.isNotBlank() }.joinToString(" · "),
                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
            )
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
            if (a.holdCount > 0) {
                Text(
                    "QC HOLD on ${a.machine}: ${a.holdReasons.joinToString("; ").ifBlank { "no reason given" }}",
                    color = Crit, fontWeight = FontWeight.SemiBold, fontSize = 13.sp
                )
            }
            if (!a.verificationEnforced) {
                Text("QC verification data is not on this server; only production is checked.", fontSize = 11.sp, color = Warn)
            }
            Text("Shifted to", fontWeight = FontWeight.Bold, fontSize = 12.sp)
            LocationChips(a.byLocation)

            if (a.colours.isNotEmpty()) {
                HorizontalDivider()
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
                        if (c.byLocation.isNotEmpty()) {
                            Row(Modifier.padding(top = 2.dp, bottom = 4.dp)) { LocationChips(c.byLocation) }
                        }
                    }
                }
            }

            if (a.recent.isNotEmpty()) {
                HorizontalDivider()
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
    }
}
