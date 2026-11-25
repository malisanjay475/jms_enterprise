package com.jmsocean.shifting

import android.app.Application
import com.jmsocean.shifting.data.FactoryServer
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
        // Factory first: it decides which server the saved login session belongs to.
        session = SessionStore(this)
        FactoryServer.init(this, alreadyLoggedIn = session.isLoggedIn)
        // Reload the saved login session before anything talks to the server.
        Network.cookieJar.init(this)
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
