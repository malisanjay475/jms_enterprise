package com.jmsocean.qc.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Emits each time the phone gets a working network back (e.g. factory Wi-Fi
 * reconnects after roaming or sleep), so screens showing a connection error
 * can reload on their own.
 */
object NetworkWatcher {
    private val _back = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val networkBack: SharedFlow<Unit> = _back.asSharedFlow()

    fun start(context: Context) {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) _back.tryEmit(Unit)
            }
            override fun onAvailable(network: Network) { _back.tryEmit(Unit) }
        })
    }
}
