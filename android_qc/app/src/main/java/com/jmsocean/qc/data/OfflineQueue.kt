package com.jmsocean.qc.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID

/** A JSON write that couldn't reach the server and will be replayed later. */
@Serializable
data class PendingWrite(
    val id: String = UUID.randomUUID().toString(),
    val path: String,          // e.g. "api/dpr/submit"
    val body: String,          // serialized JSON body
    val label: String,         // human label for the pending indicator
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0
)

/**
 * File-backed queue of writes made while offline. Simple and dependency-free
 * (no Room/WorkManager): survives app restarts, drained by SyncManager when the
 * network returns. Thread-safe via a monitor lock.
 */
object OfflineQueue {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private lateinit var file: File
    private val lock = Any()

    fun init(context: Context) {
        file = File(context.filesDir, "offline_queue.json")
    }

    private fun readAll(): MutableList<PendingWrite> = synchronized(lock) {
        if (!::file.isInitialized || !file.exists()) return mutableListOf()
        return runCatching {
            json.decodeFromString<List<PendingWrite>>(file.readText()).toMutableList()
        }.getOrDefault(mutableListOf())
    }

    private fun writeAll(list: List<PendingWrite>) = synchronized(lock) {
        if (::file.isInitialized) runCatching { file.writeText(json.encodeToString(list)) }
    }

    fun enqueue(path: String, body: String, label: String) {
        val list = readAll()
        list.add(PendingWrite(path = path, body = body, label = label))
        writeAll(list)
    }

    fun snapshot(): List<PendingWrite> = readAll()

    fun size(): Int = readAll().size

    fun remove(id: String) {
        writeAll(readAll().filterNot { it.id == id })
    }

    fun bumpAttempt(id: String) {
        writeAll(readAll().map { if (it.id == id) it.copy(attempts = it.attempts + 1) else it })
    }
}
