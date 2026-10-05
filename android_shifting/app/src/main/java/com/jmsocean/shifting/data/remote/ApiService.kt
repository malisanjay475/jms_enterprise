package com.jmsocean.shifting.data.remote

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The JMS Shifting endpoints (same ones the web Shifting Supervisor page uses).
 * Every call returns the full Response so 4xx bodies — "QC HOLD …", "already
 * shifted", "only N left on the shop floor" — are read and shown to the user.
 */
interface ApiService {

    @POST("api/login")
    suspend fun login(@Body req: LoginRequest): Response<ApiEnvelope>

    @GET("api/shifting/locations")
    suspend fun locations(): Response<ApiEnvelope>

    @GET("api/shifting/scan-label")
    suspend fun scanLabel(@Query("scan") scan: String): Response<ApiEnvelope>

    @POST("api/shifting/scan-entry")
    suspend fun scanEntry(@Body body: ScanEntryRequest): Response<ApiEnvelope>

    @GET("api/shifting/jobs")
    suspend fun jobs(
        @Query("days") days: Int,
        @Query("line") line: String? = null
    ): Response<ApiEnvelope>

    @GET("api/shifting/jobs/{id}/details")
    suspend fun jobDetails(@Path("id") planId: String): Response<ApiEnvelope>

    @POST("api/shifting/entry")
    suspend fun manualEntry(@Body body: ManualEntryRequest): Response<ApiEnvelope>

    @GET("api/shifting/availability")
    suspend fun availability(@Query("plan_id") planId: String): Response<ApiEnvelope>

    @GET("api/shifting/line-team")
    suspend fun lineTeam(
        @Query("date") date: String,
        @Query("shift") shift: String,
        @Query("line_access") lineAccess: String
    ): Response<ApiEnvelope>

    @POST("api/shifting/line-team")
    suspend fun saveLineTeam(@Body body: LineTeamRequest): Response<ApiEnvelope>

    @GET("api/shifting/logs")
    suspend fun logs(@Query("limit") limit: Int = 300): Response<ApiEnvelope>

    @GET("api/shifting/shift-report")
    suspend fun shiftReport(
        @Query("from") from: String,
        @Query("to") to: String,
        @Query("shift") shift: String
    ): Response<ApiEnvelope>

    // Self-update feed: static files on the server. Response<> so a missing feed
    // (404, before the first publish) is simply "no update".
    @GET("qc-app/shifting/version.json")
    suspend fun appVersion(): Response<AppVersion>
}
