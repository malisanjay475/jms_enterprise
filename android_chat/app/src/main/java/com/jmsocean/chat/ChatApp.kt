package com.jmsocean.chat

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.jmsocean.chat.data.Live
import com.jmsocean.chat.data.Session
import com.jmsocean.chat.push.Notifier
import com.jmsocean.chat.push.Push

class ChatApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Session.init(this)
        Notifier.ensureChannel(this)
        Push.init(this)
        // Live stream only while the app is on screen; push covers the rest.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                Notifier.appInFront = true
                Live.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                Notifier.appInFront = false
                Live.stop()
            }
        })
    }
}
