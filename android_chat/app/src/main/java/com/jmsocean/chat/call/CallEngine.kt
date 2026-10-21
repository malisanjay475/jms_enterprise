package com.jmsocean.chat.call

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.IceServerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** What the call screen shows. */
data class CallState(
    val phase: Phase = Phase.IDLE,
    val callId: String? = null,
    val peer: String = "",
    val incoming: Boolean = false,
    val answeredAt: Long = 0,
    val muted: Boolean = false,
    val speaker: Boolean = false,
    val message: String? = null
) {
    enum class Phase { IDLE, CALLING, RINGING, CONNECTING, ACTIVE, ENDED }
}

/**
 * One voice call at a time, WebRTC audio only. Offer / answer / ICE go through the
 * server (POST /api/chat/calls/:id/signal) and are picked up by polling
 * /api/chat/calls/:id/signals, which also reports when the other side ended.
 */
object CallEngine {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(CallState())
    val state = _state.asStateFlow()

    private var factory: PeerConnectionFactory? = null
    private var pc: PeerConnection? = null
    private var track: AudioTrack? = null
    private var pollJob: Job? = null
    private var lastSeq = 0L
    private val pendingIce = mutableListOf<IceCandidate>()
    private var remoteSet = false
    private lateinit var app: Context

    val busy get() = _state.value.phase.let { it != CallState.Phase.IDLE && it != CallState.Phase.ENDED }

    private fun factory(ctx: Context): PeerConnectionFactory {
        factory?.let { return it }
        app = ctx.applicationContext
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions())
        val adm = JavaAudioDeviceModule.builder(app)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        return PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory().also { factory = it }
    }

    // ---------------- outgoing ----------------
    fun startOutgoing(ctx: Context, peer: String) {
        if (busy) return
        _state.value = CallState(CallState.Phase.CALLING, peer = peer)
        scope.launch {
            runCatching { Api.startCall(peer) }
                .onSuccess { r ->
                    _state.value = _state.value.copy(callId = r.call.id)
                    CallService.start(ctx)
                    val conn = connect(ctx, r.ice) ?: return@launch fail("Could not start the call.")
                    val offer = conn.awaitCreate(true)
                    conn.awaitSetLocal(offer)
                    Api.callSignal(r.call.id, "offer", sdpJson(offer))
                    poll(r.call.id)
                }
                .onFailure { fail(it.message ?: "Call failed.") }
        }
    }

    // ---------------- incoming ----------------
    /** Push said someone is calling: remember it; the ringing UI is shown by Notifier/CallActivity. */
    fun ringing(callId: String, caller: String) {
        if (busy && _state.value.callId != callId) return
        _state.value = CallState(CallState.Phase.RINGING, callId = callId, peer = caller, incoming = true)
    }

    fun accept(ctx: Context) {
        val s = _state.value
        val id = s.callId ?: return
        if (s.phase != CallState.Phase.RINGING) return
        _state.value = s.copy(phase = CallState.Phase.CONNECTING)
        CallNotifications.cancelIncoming(ctx, id)
        CallService.start(ctx)
        scope.launch {
            runCatching { Api.callAction(id, "accept") }
                .onSuccess { r ->
                    connect(ctx, r.ice) ?: return@launch fail("Could not start the call.")
                    poll(id)
                }
                .onFailure { fail(it.message ?: "The call has ended.") }
        }
    }

    fun decline(ctx: Context) {
        val id = _state.value.callId ?: return
        CallNotifications.cancelIncoming(ctx, id)
        scope.launch { runCatching { Api.callAction(id, "decline") } }
        finish("Declined")
    }

    fun hangUp() {
        val id = _state.value.callId
        if (id != null) scope.launch { runCatching { Api.callAction(id, "end") } }
        finish("Call ended")
    }

    /** The other side ended / the call was missed (push or poll). */
    fun remoteEnded(callId: String, reason: String) {
        if (_state.value.callId != callId) return
        finish(when (reason) { "declined" -> "Declined"; "missed" -> "No answer"; else -> "Call ended" })
    }

    fun toggleMute() {
        val m = !_state.value.muted
        track?.setEnabled(!m)
        _state.value = _state.value.copy(muted = m)
    }

    fun toggleSpeaker() {
        val on = !_state.value.speaker
        audio()?.isSpeakerphoneOn = on
        _state.value = _state.value.copy(speaker = on)
    }

    fun reset() {
        if (_state.value.phase == CallState.Phase.ENDED) _state.value = CallState()
    }

    // ---------------- internals ----------------
    private fun audio(): AudioManager? = if (::app.isInitialized) app.getSystemService(AudioManager::class.java) else null

    private fun connect(ctx: Context, ice: List<IceServerConfig>): PeerConnection? {
        val f = factory(ctx)
        val servers = ice.map { s ->
            PeerConnection.IceServer.builder(s.urls).apply {
                s.username?.let { setUsername(it) }
                s.credential?.let { setPassword(it) }
            }.createIceServer()
        }
        val config = PeerConnection.RTCConfiguration(servers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        remoteSet = false
        pendingIce.clear()
        lastSeq = 0
        val conn = f.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                val id = _state.value.callId ?: return
                val data = JSONObject().put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).put("candidate", c.sdp).toString()
                scope.launch { runCatching { Api.callSignal(id, "ice", data) } }
            }

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                when (newState) {
                    PeerConnection.PeerConnectionState.CONNECTED -> if (_state.value.phase != CallState.Phase.ACTIVE) {
                        _state.value = _state.value.copy(phase = CallState.Phase.ACTIVE, answeredAt = System.currentTimeMillis())
                    }
                    PeerConnection.PeerConnectionState.FAILED -> {
                        hangUp(); _state.value = _state.value.copy(message = "Connection lost")
                    }
                    else -> Unit
                }
            }

            override fun onSignalingChange(p0: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) = Unit
            override fun onIceConnectionReceivingChange(p0: Boolean) = Unit
            override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) = Unit
            override fun onAddStream(p0: MediaStream?) = Unit
            override fun onRemoveStream(p0: MediaStream?) = Unit
            override fun onDataChannel(p0: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
        }) ?: return null
        val source = f.createAudioSource(MediaConstraints())
        track = f.createAudioTrack("jms-audio", source).also { conn.addTrack(it, listOf("jms")) }
        audio()?.let {
            it.mode = AudioManager.MODE_IN_COMMUNICATION
            it.isSpeakerphoneOn = false
        }
        pc = conn
        return conn
    }

    /** Signals from the other phone + call status, every 0.7 s while setting up, 2 s once talking. */
    private fun poll(callId: String) {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (_state.value.callId == callId && busy) {
                runCatching { Api.callSignals(callId, lastSeq) }.onSuccess { r ->
                    for (s in r.signals) {
                        lastSeq = maxOf(lastSeq, s.seq)
                        handleSignal(s.kind, s.data)
                    }
                    when (r.status) {
                        "ended", "declined", "missed", "cancelled" -> { remoteEnded(callId, r.status); return@launch }
                        "accepted" -> if (_state.value.phase == CallState.Phase.CALLING) {
                            _state.value = _state.value.copy(phase = CallState.Phase.CONNECTING)
                        }
                    }
                }
                delay(if (_state.value.phase == CallState.Phase.ACTIVE) 2000 else 700)
            }
        }
    }

    private suspend fun handleSignal(kind: String, data: String) {
        val conn = pc ?: return
        runCatching {
            val j = JSONObject(data)
            when (kind) {
                "offer" -> {
                    conn.awaitSetRemote(SessionDescription(SessionDescription.Type.OFFER, j.getString("sdp")))
                    remoteSet = true
                    drainIce(conn)
                    val answer = conn.awaitCreate(false)
                    conn.awaitSetLocal(answer)
                    Api.callSignal(_state.value.callId ?: return, "answer", sdpJson(answer))
                }
                "answer" -> {
                    conn.awaitSetRemote(SessionDescription(SessionDescription.Type.ANSWER, j.getString("sdp")))
                    remoteSet = true
                    drainIce(conn)
                }
                "ice" -> {
                    val c = IceCandidate(j.optString("sdpMid"), j.optInt("sdpMLineIndex"), j.getString("candidate"))
                    if (remoteSet) conn.addIceCandidate(c) else synchronized(pendingIce) { pendingIce.add(c) }
                }
            }
        }.onFailure { Log.w("JMSCall", "signal $kind: ${it.message}") }
    }

    private fun drainIce(conn: PeerConnection) {
        val list = synchronized(pendingIce) { pendingIce.toList().also { pendingIce.clear() } }
        list.forEach { conn.addIceCandidate(it) }
    }

    private fun fail(msg: String) {
        _state.value = _state.value.copy(message = msg)
        val id = _state.value.callId
        if (id != null) scope.launch { runCatching { Api.callAction(id, "end") } }
        finish(msg)
    }

    private fun finish(msg: String) {
        pollJob?.cancel(); pollJob = null
        runCatching { pc?.close() }
        pc = null
        runCatching { track?.dispose() }
        track = null
        audio()?.let { it.mode = AudioManager.MODE_NORMAL; it.isSpeakerphoneOn = false }
        if (::app.isInitialized) CallService.stop(app)
        _state.value = _state.value.copy(phase = CallState.Phase.ENDED, message = msg)
    }

    private fun sdpJson(s: SessionDescription) =
        JSONObject().put("type", s.type.canonicalForm()).put("sdp", s.description).toString()

    // --- coroutine wrappers for the callback-style WebRTC API ---
    private suspend fun PeerConnection.awaitCreate(offer: Boolean): SessionDescription = suspendCancellableCoroutine { cont ->
        val obs = object : SdpObserver {
            override fun onCreateSuccess(s: SessionDescription) { cont.resume(s) }
            override fun onCreateFailure(e: String?) { cont.resumeWithException(IllegalStateException(e)) }
            override fun onSetSuccess() = Unit
            override fun onSetFailure(e: String?) = Unit
        }
        val c = MediaConstraints().apply { mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true")) }
        if (offer) createOffer(obs, c) else createAnswer(obs, c)
    }

    private suspend fun PeerConnection.awaitSetLocal(s: SessionDescription) = awaitSet { setLocalDescription(it, s) }
    private suspend fun PeerConnection.awaitSetRemote(s: SessionDescription) = awaitSet { setRemoteDescription(it, s) }

    private suspend fun awaitSet(block: (SdpObserver) -> Unit): Unit = suspendCancellableCoroutine { cont ->
        block(object : SdpObserver {
            override fun onCreateSuccess(s: SessionDescription?) = Unit
            override fun onCreateFailure(e: String?) = Unit
            override fun onSetSuccess() { cont.resume(Unit) }
            override fun onSetFailure(e: String?) { cont.resumeWithException(IllegalStateException(e)) }
        })
    }
}
