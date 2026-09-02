package com.jmsocean.qc

import android.app.Application
import com.jmsocean.qc.data.QcRepository
import com.jmsocean.qc.data.SessionStore

/**
 * App entry + tiny service locator. Hilt replaces this in a later phase;
 * for the first slice, manual singletons keep the build simple and green.
 */
class QcApp : Application() {

    lateinit var session: SessionStore
        private set
    lateinit var repository: QcRepository
        private set

    override fun onCreate() {
        super.onCreate()
        session = SessionStore(this)
        repository = QcRepository(session)
        instance = this
    }

    companion object {
        lateinit var instance: QcApp
            private set
    }
}
