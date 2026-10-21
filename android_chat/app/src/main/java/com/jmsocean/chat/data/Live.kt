package com.jmsocean.chat.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/**
 * Live events while the app is open (/api/chat/stream, Server-Sent Events). Reconnects
 * with a back-off; [start] when the app comes to the front, [stop] when it leaves
 * (push notifications cover the closed app).
 */
object Live {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<LiveEvent>(extraBufferCapacity = 256)
    val events = _events.asSharedFlow()

    private val _connected = MutableStateFlow(false)
    val connected = _connected.asStateFlow()

    private var source: EventSource? = null
    private var retryJob: Job? = null
    private var wanted = false
    private var attempt = 0

    fun start() {
        wanted = true
        if (source == null && retryJob == null) connect()
    }

    fun stop() {
        wanted = false
        retryJob?.cancel(); retryJob = null
        source?.cancel(); source = null
        _connected.value = false
    }

    private fun connect() {
        if (!wanted || !Session.signedIn) return
        val req = Request.Builder().url(Api.base + "/api/chat/stream").header("Accept", "text/event-stream").build()
        source = EventSources.createFactory(Api.streamClient).newEventSource(req, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                attempt = 0
                _connected.value = true
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                val ev = runCatching { Api.json.decodeFromString<LiveEvent>(data) }.getOrNull() ?: return
                if (ev.adminCopy) return
                _events.tryEmit(ev)
            }

            override fun onClosed(eventSource: EventSource) = retry()

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.d("JMSChat", "stream dropped: ${t?.message ?: response?.code}")
                retry()
            }
        })
    }

    private fun retry() {
        source = null
        _connected.value = false
        if (!wanted) return
        retryJob?.cancel()
        retryJob = scope.launch {
            delay(minOf(30_000L, 1_000L shl minOf(attempt++, 5)))
            retryJob = null
            // Reconnected after a gap: let screens reload what they missed.
            _events.tryEmit(LiveEvent(type = "reconnect"))
            connect()
        }
    }
}
