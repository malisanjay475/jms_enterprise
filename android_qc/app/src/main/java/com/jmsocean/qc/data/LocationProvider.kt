package com.jmsocean.qc.data

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.tasks.await

/** A single GPS fix for the login geofence. */
data class Geo(val lat: Double, val lng: Double, val acc: Double)

/**
 * Fetches one fresh location fix. The MAIN server refuses login without it
 * (non-admin users can only sign in from inside the factory perimeter).
 */
object LocationProvider {

    fun hasPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission") // caller checks hasPermission() first
    suspend fun current(ctx: Context): Geo? {
        if (!hasPermission(ctx)) return null
        val client = LocationServices.getFusedLocationProviderClient(ctx)
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(30_000)
            .build()
        val loc = try {
            client.getCurrentLocation(request, null).await()
        } catch (_: Exception) {
            null
        } ?: return null
        return Geo(loc.latitude, loc.longitude, if (loc.hasAccuracy()) loc.accuracy.toDouble() else 0.0)
    }
}
