package com.jmsocean.shifting

import android.app.Application
import com.jmsocean.shifting.data.NetworkWatcher
import com.jmsocean.shifting.data.SessionStore
import com.jmsocean.shifting.data.ShiftingRepository
import com.jmsocean.shifting.data.remote.Network

/** App entry + tiny service locator (same approach as the QC app). */
class ShiftingApp : Application() {

    lateinit var session: SessionStore
        private set
    lateinit var repository: ShiftingRepository
        private set

    override fun onCreate() {
        super.onCreate()
        // Reload the saved login session before anything talks to the server.
        Network.cookieJar.init(this)
        session = SessionStore(this)
        repository = ShiftingRepository(session)
        instance = this
        // Screens showing a connection error reload by themselves when Wi-Fi is back.
        NetworkWatcher.start(this)
    }

    companion object {
        lateinit var instance: ShiftingApp
            private set
    }
}
