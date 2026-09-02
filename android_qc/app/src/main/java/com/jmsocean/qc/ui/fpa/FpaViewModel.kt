package com.jmsocean.qc.ui.fpa

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.FpaStatus
import com.jmsocean.qc.data.remote.Network
import com.jmsocean.qc.data.remote.QueueJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File

data class FpaUiState(
    val job: QueueJob? = null,
    val machine: String = "",
    val checking: Boolean = true,
    val alreadyDone: Boolean = false,
    val formImage: File? = null,
    val productImages: List<File> = emptyList(),
    val remarks: String = "",
    val submitting: Boolean = false,
    val error: String? = null,
    val submitted: Boolean = false,
    // saved (view mode)
    val savedFormUrl: String? = null,
    val savedProductUrls: List<String> = emptyList(),
    val doneBy: String? = null,
    val doneAt: String? = null
) {
    val canSubmit: Boolean
        get() = !submitting && formImage != null && productImages.size >= 2
    val productCount: Int get() = productImages.size
}

class FpaViewModel : ViewModel() {
    private val repo = QcApp.instance.repository
    private val session = QcApp.instance.session

    private val _state = MutableStateFlow(
        FpaUiState(job = repo.activeJob, machine = session.machine)
    )
    val state: StateFlow<FpaUiState> = _state.asStateFlow()

    init { checkStatus() }

    private fun checkStatus() {
        val job = _state.value.job
        if (job?.JobCardNo.isNullOrBlank()) {
            _state.update { it.copy(checking = false, error = "No active job selected.") }
            return
        }
        viewModelScope.launch {
            repo.fpaStatusFull(job!!.JobCardNo!!, session.machine)
                .onSuccess { st ->
                    if (st.ok && st.done) applySaved(st)
                    else _state.update { it.copy(checking = false, alreadyDone = false) }
                }
                .onFailure { _state.update { it.copy(checking = false) } } // treat unknown as not-done
        }
    }

    private fun applySaved(st: FpaStatus) {
        _state.update {
            it.copy(
                checking = false,
                alreadyDone = true,
                savedFormUrl = absUrl(st.form_url),
                savedProductUrls = parseUrls(st.product_images).map { u -> absUrl(u) ?: u },
                doneBy = st.done_by,
                doneAt = st.done_at
            )
        }
    }

    private fun absUrl(u: String?): String? {
        if (u.isNullOrBlank()) return null
        return if (u.startsWith("http")) u else Network.baseUrl.trimEnd('/') + "/" + u.trimStart('/')
    }

    private fun parseUrls(el: kotlinx.serialization.json.JsonElement?): List<String> = when (el) {
        is JsonArray -> el.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        is JsonPrimitive -> {
            val s = el.contentOrNull ?: return emptyList()
            runCatching { Json.parseToJsonElement(s) }.getOrNull()?.let { p ->
                (p as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            } ?: if (s.startsWith("http") || s.startsWith("/")) listOf(s) else emptyList()
        }
        else -> emptyList()
    }

    fun setFormImage(file: File) = _state.update { it.copy(formImage = file, error = null) }

    fun addProductImage(file: File) = _state.update {
        if (it.productImages.size >= 6) it
        else it.copy(productImages = it.productImages + file, error = null)
    }

    fun removeProductImage(file: File) = _state.update {
        it.copy(productImages = it.productImages - file)
    }

    fun onRemarks(v: String) = _state.update { it.copy(remarks = v) }

    fun submit() {
        val s = _state.value
        val job = s.job ?: return
        if (!s.canSubmit) {
            _state.update { it.copy(error = "Capture the FPA form and at least 2 product photos.") }
            return
        }
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            repo.submitFpa(
                job = job,
                formImage = s.formImage!!,
                productImages = s.productImages,
                remarks = s.remarks,
                machine = s.machine
            ).onSuccess {
                _state.update { it.copy(submitting = false, submitted = true, alreadyDone = true) }
                // reload from server so the saved images render in view mode
                repo.fpaStatusFull(job.JobCardNo ?: "", s.machine)
                    .onSuccess { st -> if (st.ok && st.done) applySaved(st) }
            }.onFailure { e ->
                _state.update { it.copy(submitting = false, error = e.message ?: "Upload failed") }
            }
        }
    }
}
