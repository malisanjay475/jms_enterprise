package com.jmsocean.shifting.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import java.util.Locale
import kotlin.math.roundToInt

/** Weight text for a quantity (kg per piece × pcs), up to 3 decimals. */
fun kgForQty(qty: Int, unitWeightKg: Double): String =
    if (unitWeightKg <= 0 || qty <= 0) "" else String.format(Locale.US, "%.3f", qty * unitWeightKg).trimEnd('0').trimEnd('.')

/** Pieces for a weight, rounded to the nearest piece. */
fun qtyForKg(kg: Double, unitWeightKg: Double): Int =
    if (unitWeightKg <= 0 || kg <= 0) 0 else (kg / unitWeightKg).roundToInt()

/** Full packs in a quantity at the SFG std (pcs per pack). */
fun packsForQty(qty: Int, std: Double): Int = if (std <= 0 || qty <= 0) 0 else (qty / std).toInt()

/** "276 LD bag + 8 pcs" — a quantity in SFG packs; blank without a std. */
fun packText(pcs: Double, std: Double, packName: String): String {
    if (std <= 0 || pcs <= 0) return ""
    val full = (pcs / std).toInt()
    val loose = (pcs - full * std).roundToInt()
    if (full == 0) return "${qty(pcs)} pcs (less than 1 $packName)"
    return "${qty(full.toDouble())} $packName" + if (loose > 0) " + ${qty(loose.toDouble())} pcs" else ""
}

fun cleanDecimal(v: String): String {
    val c = v.filter { it.isDigit() || it == '.' }.take(9)
    return if (c.count { it == '.' } > 1) c.substring(0, c.lastIndexOf('.')) else c
}

/** Drop-down picker (Send To, Line, Machine). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickerField(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Select",
    enabled: Boolean = true,
    optionLabel: (String) -> String = { it }
) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = open && enabled,
        onExpandedChange = { if (enabled) open = it },
        modifier = modifier
    ) {
        OutlinedTextField(
            value = if (selected.isBlank()) "" else optionLabel(selected),
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            placeholder = { Text(placeholder) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled)
        )
        ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
            if (options.isEmpty()) {
                DropdownMenuItem(text = { Text("Nothing to pick", color = MaterialTheme.colorScheme.onSurfaceVariant) }, onClick = { open = false })
            }
            options.forEach { o ->
                DropdownMenuItem(
                    text = { Text(optionLabel(o)) },
                    onClick = { onSelect(o); open = false },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding
                )
            }
        }
    }
}

/**
 * Weight (kg) and Quantity (pcs) side by side. With a known piece weight they are linked:
 * typing kg fills pcs and typing pcs fills kg (the caller keeps both values).
 */
@Composable
fun WeightQtyFields(
    weight: String,
    quantity: String,
    unitWeightKg: Double,
    onWeight: (String) -> Unit,
    onQuantity: (String) -> Unit,
    maxQty: Int? = null
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = weight,
                onValueChange = onWeight,
                label = { Text("Weight (kg)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f)
            )
            OutlinedTextField(
                value = quantity,
                onValueChange = onQuantity,
                label = { Text("Quantity (pcs)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f)
            )
        }
        val q = quantity.toIntOrNull() ?: 0
        val hint = when {
            maxQty != null && q > maxQty -> "Maximum ${qty(maxQty.toDouble())} pcs"
            unitWeightKg > 0 -> "1 pc = ${kg(unitWeightKg * 1000)} g · kg and pcs fill each other"
            else -> "No standard weight for this mould, enter pcs (kg optional)"
        }
        Text(
            hint,
            fontSize = 12.sp,
            color = if (maxQty != null && q > maxQty) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Packs, Quantity (pcs) and Weight (kg), all linked by the SFG std (pcs per pack) and the
 * piece weight — typing in one fills the other two (the caller keeps all three values).
 */
@Composable
fun PackQtyFields(
    packs: String,
    weight: String,
    quantity: String,
    sfgStd: Double,
    packName: String,
    unitWeightKg: Double,
    onPacks: (String) -> Unit,
    onWeight: (String) -> Unit,
    onQuantity: (String) -> Unit,
    maxQty: Int? = null
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = packs,
            onValueChange = onPacks,
            label = { Text("${packName.replaceFirstChar { it.uppercase() }}s (${qty(sfgStd)} pcs each)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth()
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = quantity,
                onValueChange = onQuantity,
                label = { Text("Quantity (pcs)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.weight(1f)
            )
            OutlinedTextField(
                value = weight,
                onValueChange = onWeight,
                label = { Text("Weight (kg)") },
                singleLine = true,
                enabled = unitWeightKg > 0,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.weight(1f)
            )
        }
        val q = quantity.toIntOrNull() ?: 0
        val over = maxQty != null && q > maxQty
        val hint = when {
            over -> "Maximum ${qty(maxQty!!.toDouble())} pcs (${packText(maxQty.toDouble(), sfgStd, packName).ifBlank { "0" }})"
            q > 0 -> "= ${packText(q.toDouble(), sfgStd, packName)}"
            unitWeightKg > 0 -> "Packs, pcs and kg fill each other · 1 pc = ${kg(unitWeightKg * 1000)} g"
            else -> "Packs and pcs fill each other (no standard weight for this mould)"
        }
        Text(
            hint,
            fontSize = 12.sp,
            fontWeight = if (q > 0 && !over) FontWeight.SemiBold else FontWeight.Normal,
            color = if (over) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/** Red card shown instead of the shift form when the mould has no SFG std (server blocks it too). */
@Composable
fun SfgBlockCard(mouldName: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.error)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("SFG STD NOT SET", color = MaterialTheme.colorScheme.onError, fontWeight = FontWeight.Black, fontSize = 24.sp, textAlign = TextAlign.Center)
            Text(
                "Mould Master has no SFG Std Packing for ${mouldName.ifBlank { "this mould" }}. Manual shifting is blocked until it is filled in Mould Master.",
                color = MaterialTheme.colorScheme.onError, fontSize = 13.sp, textAlign = TextAlign.Center
            )
        }
    }
}
