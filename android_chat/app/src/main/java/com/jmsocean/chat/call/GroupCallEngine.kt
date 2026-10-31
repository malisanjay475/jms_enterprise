package com.jmsocean.chat.call

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.jmsocean.chat.data.Api
import com.jmsocean.chat.data.IceServerConfig
import com.jmsocean.chat.data.RoomPerson
import com.jmsocean.chat.data.RoomSignal
import com.jmsocean.chat.data.Session
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
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class GroupPerson(val name: String, val me: Boolean = false, val connected: Boolean = false)

data class GroupCallState(
    val phase: Phase = Phase.IDLE,
    val roomId: String? = null,
    val convId: String = "",
    val title: String = "",
    val people: List<GroupPerson> = emptyList(),
    val startedAt: Long = 0,
    val muted: Boolean = false,
    val speaker: Boolean = true,
    val message: String? = null
) {
    enum class Phase { IDLE, JOINING, LIVE, ENDED }
}

/**
 * Group voice call: a WebRTC mesh, one PeerConnection per other person, one shared mic
 * track. The server (chatGroupCalls.js) only passes signals; GET rooms/:id/poll gives
 * who is in and signals for me. In each pair the one who joined later offers.
 */
object GroupCallEngine {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(GroupCallState())
    val state = _state.asStateFlow()

    private class Peer(val name: String, val joinedAt: String, val pc: PeerConnection) {
        @Volatile var remoteSet = false
        @Volatile var connected = false
        val pending = mutableListOf<IceCandidate>()
    }

    private val peers = ConcurrentHashMap<String, Peer>()
    private var ice: List<PeerConnection.IceServer> = emptyList()
    private var track: AudioTrack? = null
    private var me: RoomPerson? = null
    private var list: List<RoomPerson> = emptyList()
    private var lastSeq = 0L
    private var pollJob: Job? = null
    private lateinit var app: Context

    val active get() = _state.value.phase.let { it == GroupCallState.Phase.JOINING || it == GroupCallState.Phase.LIVE }

    private fun key(name: String) = name.lowercase()
    private fun time(s: String) = runCatching { Instant.parse(s).toEpochMilli() }.getOrDefault(0L)

    fun join(ctx: Context, convId: String, title: String) {
        if (active) return
        if (CallEngine.busy) { _state.value = GroupCallState(GroupCallState.Phase.ENDED, message = "End your other call first."); return }
        app = ctx.applicationContext
        _state.value = GroupCallState(GroupCallState.Phase.JOINING, convId = convId, title = title)
        scope.launch {
            runCatching { Api.joinGroupCall(convId) }
                .onSuccess { r ->
                    ice = servers(r.ice)
                    me = r.me
                    lastSeq = 0
                    val f = CallEngine.factory(app)
                    track = f.createAudioTrack("jms-group-audio", f.createAudioSource(MediaConstraints()))
                    app.getSystemService(AudioManager::class.java)?.let {
                        it.mode = AudioManager.MODE_IN_COMMUNICATION
                        it.isSpeakerphoneOn = true
                    }
                    _state.value = _state.value.copy(
                        phase = GroupCallState.Phase.LIVE, roomId = r.room.id, title = r.room.title.ifBlank { title },
                        startedAt = System.currentTimeMillis()
                    )
                    CallService.start(app)
                    CallNotifications.cancelGroupInvite(app, r.room.id)
                    sync(r.participants)
                    poll(r.room.id)
                }
                .onFailure { end(it.message ?: "Could not join the call.") }
        }
    }

    fun leave() {
        val id = _state.value.roomId
        if (id != null) scope.launch { runCatching { Api.leaveRoom(id) } }
        end("You left the call")
    }

    fun toggleMute() {
        val m = !_state.value.muted
        track?.setEnabled(!m)
        _state.value = _state.value.copy(muted = m)
        publish()
    }

    fun toggleSpeaker() {
        val on = !_state.value.speaker
        if (::app.isInitialized) app.getSystemService(AudioManager::class.java)?.isSpeakerphoneOn = on
        _state.value = _state.value.copy(speaker = on)
    }

    fun reset() {
        if (_state.value.phase == GroupCallState.Phase.ENDED) _state.value = GroupCallState()
    }

    // ---------------- internals ----------------
    private fun servers(list: List<IceServerConfig>) = list.map { s ->
        PeerConnection.IceServer.builder(s.urls).apply {
            s.username?.let { setUsername(it) }
            s.credential?.let { setPassword(it) }
        }.createIceServer()
    }

    /** In each pair the one who joined later offers (same moment: the larger name). */
    private fun iOffer(p: RoomPerson): Boolean {
        val m = me ?: return false
        val a = time(m.joined_at)
        val b = time(p.joined_at)
        return a > b || (a == b && key(m.username) > key(p.username))
    }

    private suspend fun sync(people: List<RoomPerson>) {
        list = people
        val here = mutableSetOf<String>()
        for (p in people) {
            val k = key(p.username)
            if (k == key(me?.username ?: Session.username ?: "")) { me = me?.copy(joined_at = p.joined_at); continue }
            here += k
            var have = peers[k]
            if (have != null && time(have.joinedAt) != time(p.joined_at)) { close(k); have = null } // they rejoined
            if (have == null && iOffer(p)) {
                val peer = makePeer(p.username, p.joined_at) ?: continue
                runCatching {
                    val offer = peer.pc.awaitCreate(true)
                    awaitSet { peer.pc.setLocalDescription(it, offer) }
                    signal(p.username, "offer", sdpJson(offer))
                }.onFailure { Log.w("JMSGroupCall", "offer ${p.username}: ${it.message}") }
            }
        }
        peers.keys.filter { it !in here }.forEach { close(it) }
        publish()
    }

    private fun makePeer(name: String, joinedAt: String): Peer? {
        val config = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        lateinit var peer: Peer
        val pc = CallEngine.factory(app).createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                val data = JSONObject().put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex).put("candidate", c.sdp).toString()
                scope.launch { signal(name, "ice", data) }
            }

            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                when (s) {
                    PeerConnection.PeerConnectionState.CONNECTED -> { peer.connected = true; publish() }
                    // the one who offers tries again on the next poll
                    PeerConnection.PeerConnectionState.FAILED -> if (peers[key(name)] === peer) { close(key(name)); publish() }
                    PeerConnection.PeerConnectionState.DISCONNECTED -> { peer.connected = false; publish() }
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
        track?.let { pc.addTrack(it, listOf("jms-group")) }
        peer = Peer(name, joinedAt, pc)
        peers[key(name)] = peer
        return peer
    }

    private fun close(k: String) {
        peers.remove(k)?.let { runCatching { it.pc.close() } }
    }

    private suspend fun signal(to: String, kind: String, data: String) {
        val id = _state.value.roomId ?: return
        runCatching { Api.roomSignal(id, to, kind, data) }
    }

    /** Every 0.9 s until someone is connected, then every 2 s. */
    private fun poll(roomId: String) {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (_state.value.roomId == roomId && active) {
                runCatching { Api.roomPoll(roomId, lastSeq) }
                    .onSuccess { r ->
                        if (r.status == "ended") { end("Call ended"); return@launch }
                        list = r.participants
                        for (s in r.signals) {
                            lastSeq = maxOf(lastSeq, s.seq)
                            handle(s)
                        }
                        sync(r.participants)
                    }
                    .onFailure { e ->
                        if ((e as? com.jmsocean.chat.data.ApiError)?.status == 409) { end("You left the call"); return@launch }
                    }
                delay(if (peers.values.any { it.connected }) 2000 else 900)
            }
        }
    }

    private suspend fun handle(s: RoomSignal) {
        val k = key(s.from)
        runCatching {
            val j = JSONObject(s.data)
            when (s.kind) {
                "offer" -> {
                    close(k)
                    val joined = list.firstOrNull { key(it.username) == k }?.joined_at ?: Instant.now().toString()
                    val peer = makePeer(s.from, joined) ?: return
                    awaitSet { peer.pc.setRemoteDescription(it, SessionDescription(SessionDescription.Type.OFFER, j.getString("sdp"))) }
                    drain(peer)
                    val answer = peer.pc.awaitCreate(false)
                    awaitSet { peer.pc.setLocalDescription(it, answer) }
                    signal(s.from, "answer", sdpJson(answer))
                }
                "answer" -> peers[k]?.let { peer ->
                    awaitSet { peer.pc.setRemoteDescription(it, SessionDescription(SessionDescription.Type.ANSWER, j.getString("sdp"))) }
                    drain(peer)
                }
                "ice" -> peers[k]?.let { peer ->
                    val c = IceCandidate(j.optString("sdpMid"), j.optInt("sdpMLineIndex"), j.getString("candidate"))
                    if (peer.remoteSet) peer.pc.addIceCandidate(c) else synchronized(peer.pending) { peer.pending.add(c) }
                }
            }
        }.onFailure { Log.w("JMSGroupCall", "signal ${s.kind} from ${s.from}: ${it.message}") }
    }

    private fun drain(peer: Peer) {
        peer.remoteSet = true
        val l = synchronized(peer.pending) { peer.pending.toList().also { peer.pending.clear() } }
        l.forEach { peer.pc.addIceCandidate(it) }
    }

    private fun publish() {
        val myName = me?.username ?: Session.username ?: "You"
        val others = list.filter { key(it.username) != key(myName) }.map { p ->
            GroupPerson(p.username, connected = peers[key(p.username)]?.connected == true)
        }
        _state.value = _state.value.copy(people = listOf(GroupPerson(myName, me = true, connected = true)) + others)
    }

    private fun end(msg: String) {
        pollJob?.cancel(); pollJob = null
        peers.keys.toList().forEach { close(it) }
        runCatching { track?.dispose() }
        track = null
        list = emptyList()
        if (::app.isInitialized) {
            app.getSystemService(AudioManager::class.java)?.let { it.mode = AudioManager.MODE_NORMAL; it.isSpeakerphoneOn = false }
            CallService.stop(app)
        }
        _state.value = _state.value.copy(phase = GroupCallState.Phase.ENDED, message = msg, people = emptyList())
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

    private suspend fun awaitSet(block: (SdpObserver) -> Unit): Unit = suspendCancellableCoroutine { cont ->
        block(object : SdpObserver {
            override fun onCreateSuccess(s: SessionDescription?) = Unit
            override fun onCreateFailure(e: String?) = Unit
            override fun onSetSuccess() { cont.resume(Unit) }
            override fun onSetFailure(e: String?) { cont.resumeWithException(IllegalStateException(e)) }
        })
    }

}
