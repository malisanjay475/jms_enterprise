package com.jmsocean.shifting.ui.scan

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.shifting.ShiftingApp
import com.jmsocean.shifting.data.AppUpdater
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.remote.AppVersion
import com.jmsocean.shifting.data.remote.LabelInfo
import com.jmsocean.shifting.ui.common.cleanDecimal
import com.jmsocean.shifting.ui.common.kgForQty
import com.jmsocean.shifting.ui.common.qtyForKg
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Last outcome shown in the coloured banner under the scan box. */
data class ScanResult(val ok: Boolean, val text: String)

data class ScanUiState(
    val input: String = "",
    val lookingUp: Boolean = false,
    val scanned: String = "",          // the raw scan the loaded label came from
    val label: LabelInfo? = null,
    val weight: String = "",
    val quantity: String = "",
    val locations: List<String> = emptyList(),
    val locationsError: String? = null,
    val location: String = "",
    val quickShift: Boolean = false,
    val submitting: Boolean = false,
    val result: ScanResult? = null,
    val shiftedThisSession: Int = 0,
    val update: AppVersion? = null,
    val downloadingUpdate: Boolean = false,
    val updateError: String? = null
)

enum class Feedback { SUCCESS, ERROR }

class ScanViewModel : ViewModel() {
    private val app = ShiftingApp.instance
    private val repo = app.repository

    private val _state = MutableStateFlow(
        ScanUiState(quickShift = app.session.quickShift, location = app.session.lastLocation)
    )
    val state: StateFlow<ScanUiState> = _state.asStateFlow()

    private val _feedback = MutableSharedFlow<Feedback>(extraBufferCapacity = 4)
    /** Beep/buzz requests for the screen. */
    val feedback: SharedFlow<Feedback> = _feedback.asSharedFlow()

    private var autoLookupJob: Job? = null

    init {
        loadLocations()
        checkForUpdate()
        // Wi-Fi back after a drop: reload the destination list if it failed.
        NetworkWatcher.onNetworkBack(viewModelScope) {
            if (_state.value.locations.isEmpty()) loadLocations()
        }
    }

    fun loadLocations() {
        viewModelScope.launch {
            repo.locations()
                .onSuccess { list ->
                    _state.update { s ->
                        // Keep the remembered destination only while it is still active.
                        val keep = s.location.takeIf { it.isNotBlank() && list.any { l -> l.equals(it, ignoreCase = true) } }
                        s.copy(
                            locations = list, locationsError = null,
                            // No silent default: the shifter picks Send To after the scan.
                            location = keep.orEmpty()
                        )
                    }
                }
                .onFailure { e -> _state.update { it.copy(locationsError = e.message ?: "Could not load destinations") } }
        }
    }

    /**
     * Typed/scanned text. Most scanners end with Enter (handled by [submitInput]); for the
     * ones that don't, a complete label code is looked up after a short pause.
     */
    fun onInput(value: String) {
        if (value.contains('\n') || value.contains('\r')) {
            val clean = value.replace("\r", "").replace("\n", "").trim()
            _state.update { it.copy(input = clean) }
            if (clean.isNotEmpty()) lookup(clean)
            return
        }
        _state.update { it.copy(input = value) }
        autoLookupJob?.cancel()
        if (looksLikeLabel(value)) {
            autoLookupJob = viewModelScope.launch {
                delay(450)
                if (_state.value.input == value) lookup(value.trim())
            }
        }
    }

    fun submitInput() {
        val raw = _state.value.input.trim()
        if (raw.isNotEmpty()) lookup(raw)
    }

    /** Camera result. */
    fun onCameraCode(raw: String) {
        _state.update { it.copy(input = raw.trim()) }
        lookup(raw.trim())
    }

    private fun looksLikeLabel(v: String): Boolean {
        val t = v.trim()
        return Regex("JMSLBL-[A-Za-z0-9_-]{6,}", RegexOption.IGNORE_CASE).containsMatchIn(t) ||
            Regex("[?&]uid=[^&]{6,}", RegexOption.IGNORE_CASE).containsMatchIn(t)
    }

    fun lookup(raw: String) {
        if (_state.value.lookingUp || _state.value.submitting) return
        autoLookupJob?.cancel()
        _state.update { it.copy(lookingUp = true, result = null, label = null, scanned = raw, weight = "") }
        viewModelScope.launch {
            repo.lookupLabel(raw)
                .onSuccess { label ->
                    // Quantity starts at what is left on the label; weight follows from the
                    // mould's standard weight (kg per piece).
                    val q = label.labelPendingQty.toInt()
                    _state.update {
                        it.copy(
                            lookingUp = false, label = label, input = "",
                            quantity = if (q > 0) q.toString() else "",
                            weight = kgForQty(q, label.unitWeightKg)
                        )
                    }
                    if (label.blocked) {
                        _feedback.tryEmit(Feedback.ERROR)
                        _state.update {
                            it.copy(
                                result = ScanResult(
                                    false,
                                    if (label.alreadyShifted) "This label is already shifted."
                                    else label.qcHoldMessage.ifBlank { "This job is on QC hold. Shifting is blocked." }
                                )
                            )
                        }
                    } else {
                        _feedback.tryEmit(Feedback.SUCCESS)
                        if (_state.value.quickShift && _state.value.location.isNotBlank()) confirm()
                    }
                }
                .onFailure { e ->
                    _feedback.tryEmit(Feedback.ERROR)
                    _state.update {
                        it.copy(lookingUp = false, input = "", result = ScanResult(false, e.message ?: "Could not read this label."))
                    }
                }
        }
    }

    fun setLocation(loc: String) {
        app.session.lastLocation = loc
        _state.update { it.copy(location = loc) }
    }

    /** Weight typed: pieces follow from the standard weight (when the mould has one). */
    fun setWeight(v: String) {
        val clean = cleanDecimal(v)
        val unit = _state.value.label?.unitWeightKg ?: 0.0
        _state.update {
            it.copy(
                weight = clean, result = null,
                quantity = if (unit > 0) qtyForKg(clean.toDoubleOrNull() ?: 0.0, unit).takeIf { q -> q > 0 }?.toString().orEmpty() else it.quantity
            )
        }
    }

    /** Pieces typed: weight follows from the standard weight. */
    fun setQuantity(v: String) {
        val clean = v.filter(Char::isDigit).take(7)
        val unit = _state.value.label?.unitWeightKg ?: 0.0
        _state.update {
            it.copy(
                quantity = clean, result = null,
                weight = if (unit > 0) kgForQty(clean.toIntOrNull() ?: 0, unit) else it.weight
            )
        }
    }

    fun setQuickShift(on: Boolean) {
        app.session.quickShift = on
        _state.update { it.copy(quickShift = on) }
    }

    fun clear() {
        autoLookupJob?.cancel()
        _state.update { it.copy(input = "", label = null, scanned = "", weight = "", quantity = "", result = null) }
    }

    fun confirm() {
        val s = _state.value
        val label = s.label ?: return
        if (label.blocked || s.submitting) return
        if (s.location.isBlank()) {
            _state.update { it.copy(result = ScanResult(false, "Pick where the material is going (Send To).")) }
            _feedback.tryEmit(Feedback.ERROR)
            return
        }
        val max = label.labelPendingQty.toInt()
        val qty = s.quantity.toIntOrNull() ?: 0
        if (qty <= 0) {
            _state.update { it.copy(result = ScanResult(false, "Enter the weight or the quantity.")) }
            _feedback.tryEmit(Feedback.ERROR)
            return
        }
        if (qty > max) {
            _state.update { it.copy(result = ScanResult(false, "Only $max pcs are left on this label.")) }
            _feedback.tryEmit(Feedback.ERROR)
            return
        }
        val weight = s.weight.toDoubleOrNull()?.takeIf { it > 0 }
        _state.update { it.copy(submitting = true, result = null) }
        viewModelScope.launch {
            repo.shiftLabel(s.scanned, s.location, quantity = qty.toDouble(), weightKg = weight)
                .onSuccess { savedQty ->
                    _feedback.tryEmit(Feedback.SUCCESS)
                    val q = if (savedQty > 0) savedQty else qty.toDouble()
                    _state.update {
                        it.copy(
                            submitting = false, label = null, scanned = "", weight = "", quantity = "",
                            shiftedThisSession = it.shiftedThisSession + 1,
                            result = ScanResult(
                                true,
                                "Shifted ${com.jmsocean.shifting.ui.common.qty(q)} pcs · ${label.colour.ifBlank { label.itemName }} " +
                                    "(label ${label.labelNo}/${label.totalLabels}) → ${s.location}"
                            )
                        )
                    }
                }
                .onFailure { e ->
                    _feedback.tryEmit(Feedback.ERROR)
                    _state.update { it.copy(submitting = false, result = ScanResult(false, e.message ?: "Shift failed.")) }
                }
        }
    }

    // ── Self-update ─────────────────────────────────────────────────────────

    private fun checkForUpdate() {
        viewModelScope.launch {
            val v = AppUpdater.checkForUpdate()
            if (v != null) _state.update { it.copy(update = v) }
        }
    }

    fun installUpdate(ctx: Context) {
        val v = _state.value.update ?: return
        _state.update { it.copy(downloadingUpdate = true, updateError = null) }
        viewModelScope.launch {
            val apk = AppUpdater.download(ctx, v)
            if (apk != null) {
                _state.update { it.copy(downloadingUpdate = false) }
                AppUpdater.install(ctx, apk)
            } else {
                _state.update { it.copy(downloadingUpdate = false, updateError = "Download failed. Check the factory Wi-Fi.") }
            }
        }
    }

    fun dismissUpdate() = _state.update { it.copy(update = null) }
}
