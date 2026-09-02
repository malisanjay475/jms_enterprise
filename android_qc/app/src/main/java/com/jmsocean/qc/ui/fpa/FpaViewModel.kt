package com.jmsocean.qc.ui.fpa

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.jmsocean.qc.QcApp
import com.jmsocean.qc.data.remote.QueueJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
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
    val submitted: Boolean = false
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
            repo.fpaStatus(job!!.JobCardNo!!, session.machine)
                .onSuccess { done -> _state.update { it.copy(checking = false, alreadyDone = done) } }
                .onFailure { _state.update { it.copy(checking = false) } } // treat unknown as not-done
        }
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
            }.onFailure { e ->
                _state.update { it.copy(submitting = false, error = e.message ?: "Upload failed") }
            }
        }
    }
}
