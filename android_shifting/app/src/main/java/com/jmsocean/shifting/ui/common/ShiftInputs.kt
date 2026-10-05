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
import java.util.Locale
import kotlin.math.roundToInt

/** Weight text for a quantity (kg per piece × pcs), up to 3 decimals. */
fun kgForQty(qty: Int, unitWeightKg: Double): String =
    if (unitWeightKg <= 0 || qty <= 0) "" else String.format(Locale.US, "%.3f", qty * unitWeightKg).trimEnd('0').trimEnd('.')

/** Pieces for a weight, rounded to the nearest piece. */
fun qtyForKg(kg: Double, unitWeightKg: Double): Int =
    if (unitWeightKg <= 0 || kg <= 0) 0 else (kg / unitWeightKg).roundToInt()

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
