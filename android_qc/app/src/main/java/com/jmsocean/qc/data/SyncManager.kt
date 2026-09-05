package com.jmsocean.qc.data

import com.jmsocean.qc.data.remote.Network
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Drains the OfflineQueue when the network is back. Runs on an app-scoped
 * coroutine; call drain() on app start, on queue refresh, and after enqueue.
 */
object SyncManager {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending.asStateFlow()

    fun refreshCount() { _pending.value = OfflineQueue.size() }

    fun drain() { scope.launch { drainNow() } }

    private suspend fun drainNow() {
        for (w in OfflineQueue.snapshot()) {
            try {
                val body = w.body.toRequestBody("application/json".toMediaTypeOrNull())
                val env = Network.api.postJson(w.path, body)
                if (env.ok) {
                    OfflineQueue.remove(w.id)
                } else {
                    // Server reachable but rejected (e.g. duplicate/validation).
                    // Retry a few times, then drop so it can't wedge the queue.
                    OfflineQueue.bumpAttempt(w.id)
                    if (w.attempts + 1 >= 5) OfflineQueue.remove(w.id)
                }
            } catch (_: Exception) {
                // Still offline — stop and try again next trigger.
                break
            }
        }
        refreshCount()
    }
}
