package com.jmsocean.chat.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The signed-in user and their chat session token (sent as "Authorization: Bearer").
 * The token is encrypted with an AES key held in the Android Keystore, and backups are
 * off (allowBackup=false), so a copied prefs file cannot replay the session.
 */
object Session {
    private const val PREFS = "chat_session"
    private lateinit var prefs: SharedPreferences

    @Volatile var token: String? = null
        private set
    /** From /api/chat/me: superadmins manage every group and can delete any message. */
    @Volatile var isSuperadmin: Boolean = false
    @Volatile var username: String? = null
        private set

    fun init(ctx: Context) {
        prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        username = prefs.getString("username", null)
        token = prefs.getString("token", null)?.let { Crypto.decrypt(it) }
        if (token == null) username = null
    }

    val signedIn get() = token != null

    fun save(user: String, tok: String) {
        val enc = Crypto.encrypt(tok) ?: return
        prefs.edit().putString("username", user).putString("token", enc).apply()
        username = user
        token = tok
    }

    fun clear() {
        prefs.edit().clear().apply()
        username = null
        token = null
    }

    fun isMe(name: String?) = name != null && name.equals(username, ignoreCase = true)

    /** AES-256-GCM, key never leaves the Keystore. "base64(iv):base64(ciphertext)". */
    private object Crypto {
        private const val ALIAS = "jms_chat_session_key"
        private const val TRANSFORM = "AES/GCM/NoPadding"

        private fun key(): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            gen.init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            return gen.generateKey()
        }

        fun encrypt(plain: String): String? = runCatching {
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.ENCRYPT_MODE, key())
            Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" +
                Base64.encodeToString(c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
        }.getOrNull()

        fun decrypt(stored: String): String? = runCatching {
            val (iv, ct) = stored.split(":").also { require(it.size == 2) }
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(c.doFinal(Base64.decode(ct, Base64.NO_WRAP)))
        }.getOrNull()
    }
}
